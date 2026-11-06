/* =========================================================
   database.js - IndexedDB wrapper (main application storage)
   ========================================================= */
'use strict';

const DB = (() => {
  const NAME = 'FoodBusinessIMS';
  const VERSION = 1;
  const STORES = {
    products: 'id',
    categories: 'id',
    transactions: 'id',
    movements: 'id',
    customers: 'id',
    suppliers: 'id',
    users: 'id',
    settings: 'key'
  };
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('Your browser does not support IndexedDB. Please use a modern browser (Chrome, Edge, Firefox).'));
        return;
      }
      let req;
      try { req = indexedDB.open(NAME, VERSION); }
      catch (e) { reject(new Error('Local database could not be opened. Private browsing may block storage.')); return; }

      req.onupgradeneeded = () => {
        const d = req.result;
        Object.entries(STORES).forEach(([name, keyPath]) => {
          if (d.objectStoreNames.contains(name)) return;
          const store = d.createObjectStore(name, { keyPath });
          if (name === 'transactions') { store.createIndex('date', 'date'); store.createIndex('customerId', 'customerId'); }
          if (name === 'movements') { store.createIndex('productId', 'productId'); store.createIndex('date', 'date'); }
          if (name === 'products') store.createIndex('categoryId', 'categoryId');
          if (name === 'users') store.createIndex('username', 'username', { unique: true });
        });
      };
      req.onsuccess = () => {
        db = req.result;
        db.onversionchange = () => { db.close(); location.reload(); };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Failed to open the local database.'));
      req.onblocked = () => reject(new Error('The database is blocked by another open tab. Close other tabs and reload.'));
    });
  }

  /** Wraps an IDBRequest in a Promise. */
  function req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Runs `work(tx)` inside a single IndexedDB transaction.
   * The promise resolves with work()'s result only after the transaction COMMITS.
   * If work() throws, the whole transaction is aborted (nothing is saved).
   */
  function run(storeNames, mode, work) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('Database is not open.')); return; }
      let tx;
      try { tx = db.transaction(storeNames, mode); }
      catch (e) { reject(e); return; }
      let result, failure = null;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('The operation was cancelled.'));
      let p;
      try { p = Promise.resolve(work(tx)); } catch (e) { p = Promise.reject(e); }
      p.then(r => { result = r; }).catch(err => {
        failure = err;
        try { tx.abort(); } catch (_) { /* already finished */ }
      });
    });
  }

  const getAll = store => run([store], 'readonly', tx => req(tx.objectStore(store).getAll()));
  const get = (store, key) => run([store], 'readonly', tx => req(tx.objectStore(store).get(key)));
  const put = (store, record) => run([store], 'readwrite', tx => req(tx.objectStore(store).put(record)));
  const add = (store, record) => run([store], 'readwrite', tx => req(tx.objectStore(store).add(record)));
  const remove = (store, key) => run([store], 'readwrite', tx => req(tx.objectStore(store).delete(key)));
  const count = store => run([store], 'readonly', tx => req(tx.objectStore(store).count()));

  async function getSetting(key, fallback = null) {
    const rec = await get('settings', key);
    return rec ? rec.value : fallback;
  }
  const setSetting = (key, value) => put('settings', { key, value });

  /** Next sequential ID inside an open transaction store, e.g. MOV-000123. */
  async function nextIdIn(store, prefix, len) {
    const keys = await req(store.getAllKeys());
    return Utils.nextId(prefix, keys, len);
  }

  async function exportAll() {
    const data = {};
    await run(Object.keys(STORES), 'readonly', async tx => {
      for (const name of Object.keys(STORES)) data[name] = await req(tx.objectStore(name).getAll());
    });
    return data;
  }

  /** Replaces ALL stores with `data` in one atomic transaction. */
  function replaceAll(data) {
    const names = Object.keys(STORES);
    return run(names, 'readwrite', async tx => {
      for (const name of names) {
        const store = tx.objectStore(name);
        await req(store.clear());
        for (const record of (data[name] || [])) await req(store.put(record));
      }
    });
  }

  /** Inserts records without clearing (used by first-launch seeding). */
  function bulkAdd(data) {
    const names = Object.keys(data).filter(n => STORES[n]);
    return run(names, 'readwrite', async tx => {
      for (const name of names) {
        const store = tx.objectStore(name);
        for (const record of data[name]) {
          const exists = await req(store.get(record[STORES[name]]));
          if (!exists) await req(store.add(record)); // never overwrite existing records
        }
      }
    });
  }

  function friendlyError(err) {
    if (!err) return 'An unknown storage error occurred.';
    if (err.name === 'QuotaExceededError') return 'Browser storage is full. Remove large product images or export a backup and reset data.';
    if (err.name === 'ConstraintError') return 'A record with the same unique value already exists.';
    if (err.name === 'AbortError' && err.message) return err.message;
    return err.message || String(err);
  }

  return {
    STORES, open, req, run, getAll, get, put, add, remove, count,
    getSetting, setSetting, nextIdIn, exportAll, replaceAll, bulkAdd, friendlyError
  };
})();

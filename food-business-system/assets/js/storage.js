/* =========================================================
   storage.js - LocalStorage for lightweight preferences only
   (Application records are stored in IndexedDB - see database.js)
   ========================================================= */
'use strict';

const Prefs = (() => {
  const KEY = 'fbs_prefs';
  const SESSION_KEY = 'fbs_session';
  const defaults = {
    sidebarCollapsed: false,
    pageSize: 10,
    autoPrintReceipt: false,
    showPosImages: true,
    lowStockAlerts: true,
    expiryAlerts: true,
    productViewMode: 'grid',
    inventoryViewMode: 'grid',
    dashboardRange: '7',
    lastBackup: null
  };
  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      cache = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (e) {
      console.warn('Preferences could not be read; using defaults.', e);
      cache = Object.assign({}, defaults);
    }
    return cache;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); }
    catch (e) { console.warn('Preferences could not be saved.', e); }
  }

  return {
    defaults,
    all: () => Object.assign({}, load()),
    get: key => load()[key],
    set(key, value) { load()[key] = value; save(); },
    setMany(obj) { Object.assign(load(), obj); save(); },
    reset() { cache = Object.assign({}, defaults); save(); },

    /* Demo session (stores the logged-in user ID only - never passwords) */
    getSession() { try { return localStorage.getItem(SESSION_KEY); } catch (_) { return null; } },
    setSession(userId) { try { localStorage.setItem(SESSION_KEY, userId); } catch (_) { /* ignore */ } },
    clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ } }
  };
})();

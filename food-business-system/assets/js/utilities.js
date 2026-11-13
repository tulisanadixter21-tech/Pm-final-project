/* =========================================================
   utilities.js - Shared helpers (formatting, UI, CSV, dates,
   batch shelf-life & FEFO helpers, and sales analytics)
   ========================================================= */
'use strict';

const Utils = (() => {
  const charts = [];
  const pad = (n, len = 2) => String(n).padStart(len, '0');

  /* ---------- Text & numbers ---------- */
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function currencySymbol() {
    return (typeof App !== 'undefined' && App.settings && App.settings.currencySymbol) || '₱';
  }
  function money(n) {
    const v = Number(n) || 0;
    return (v < 0 ? '-' : '') + currencySymbol() +
      Math.abs(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(n, decimals = 0) {
    return (Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: decimals });
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  }

  /* ---------- Dates (local time) ---------- */
  function dateKey(d) {
    d = new Date(d);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function compactDate(d) { return dateKey(d).replace(/-/g, ''); }
  function parseDate(str) {
    if (!str) return null;
    if (str instanceof Date) return new Date(str);
    const s = String(str).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function startOfDay(d) { d = new Date(d); d.setHours(0, 0, 0, 0); return d; }
  function endOfDay(d) { d = new Date(d); d.setHours(23, 59, 59, 999); return d; }
  function addDays(d, n) { d = new Date(d); d.setDate(d.getDate() + n); return d; }
  function startOfWeek(d) { d = startOfDay(d); return addDays(d, -((d.getDay() + 6) % 7)); } // Monday
  function startOfMonth(d) { d = new Date(d); return new Date(d.getFullYear(), d.getMonth(), 1); }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = parseDate(iso);
    if (!d) return '—';
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }
  function fmtShort(d) { return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }); }
  /** Returns true if ISO date falls in [from, to] (YYYY-MM-DD strings, both optional). */
  function inDateRange(iso, from, to) {
    const t = new Date(iso).getTime();
    if (from && t < startOfDay(parseDate(from)).getTime()) return false;
    if (to && t > endOfDay(parseDate(to)).getTime()) return false;
    return true;
  }
  function relativeTime(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
    const days = Math.floor(diff / 86400);
    return days === 1 ? 'yesterday' : days + ' days ago';
  }

  /* ---------- IDs ---------- */
  function nextId(prefix, ids, len = 3) {
    let max = 0;
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
    ids.forEach(id => { const m = re.exec(id); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return prefix + pad(max + 1, len);
  }

  /* ---------- Validation ---------- */
  const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const isPhone = v => /^\+?[0-9][0-9\s\-()]{6,18}$/.test(v) && v.replace(/\D/g, '').length >= 7;
  function isMoney(v) { return v !== '' && !isNaN(v) && Number(v) >= 0 && /^\d+(\.\d{1,2})?$/.test(String(v).trim()); }
  function isWholeNumber(v) { return v !== '' && /^\d+$/.test(String(v).trim()); }

  /* ---------- Toasts ---------- */
  function toast(message, type = 'success') {
    const icons = { success: 'check-circle-fill', danger: 'x-circle-fill', warning: 'exclamation-triangle-fill', info: 'info-circle-fill' };
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast align-items-center border-0 toast-${type}`;
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    el.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="bi bi-${icons[type] || icons.info} me-2"></i>${esc(message)}</div>
      <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
    container.appendChild(el);
    const t = new bootstrap.Toast(el, { delay: type === 'danger' ? 5500 : 3500 });
    el.addEventListener('hidden.bs.toast', () => el.remove());
    t.show();
  }

  /* ---------- Modals ---------- */
  function modal({ title, body, footer = '', size = '', staticBackdrop = false, onShown, onHidden }) {
    const el = document.createElement('div');
    el.className = 'modal fade';
    el.tabIndex = -1;
    el.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size ? 'modal-' + size : ''}">
      <div class="modal-content">
        <div class="modal-header"><h5 class="modal-title fw-semibold">${title}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div></div>`;
    document.body.appendChild(el);

    const openCount = document.querySelectorAll('.modal.show').length;
    if (openCount) el.style.zIndex = 1055 + openCount * 20;

    const instance = new bootstrap.Modal(el, staticBackdrop ? { backdrop: 'static', keyboard: false } : {});
    el.addEventListener('show.bs.modal', () => {
      if (!openCount) return;
      setTimeout(() => {
        const backdrops = document.querySelectorAll('.modal-backdrop');
        const bd = backdrops[backdrops.length - 1];
        if (bd) bd.style.zIndex = 1054 + openCount * 20;
      }, 0);
    });
    el.addEventListener('shown.bs.modal', () => {
      const f = el.querySelector('[autofocus]');
      if (f) f.focus();
      if (onShown) onShown(el);
    });
    el.addEventListener('hidden.bs.modal', () => {
      if (onHidden) onHidden(el);
      instance.dispose();
      el.remove();
      if (document.querySelector('.modal.show')) document.body.classList.add('modal-open');
    });
    instance.show();
    return { el, close: () => instance.hide() };
  }

  function confirm({ title = 'Please confirm', message = '', confirmText = 'Confirm', danger = false, requireText = '' } = {}) {
    return new Promise(resolve => {
      let ok = false;
      const m = modal({
        title: esc(title),
        body: `<div class="d-flex gap-3">
            <div class="stat-icon ${danger ? 'tone-red' : 'tone-green'}"><i class="bi bi-${danger ? 'exclamation-triangle' : 'question-circle'}"></i></div>
            <div class="flex-grow-1"><div>${message}</div>
            ${requireText ? `<div class="mt-3"><label class="form-label small">Type <strong>${esc(requireText)}</strong> to continue</label>
              <input class="form-control" data-confirm-input autocomplete="off"></div>` : ''}</div></div>`,
        footer: `<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm-ok ${requireText ? 'disabled' : ''}>${esc(confirmText)}</button>`,
        onHidden: () => resolve(ok)
      });
      const btn = m.el.querySelector('[data-confirm-ok]');
      if (requireText) {
        m.el.querySelector('[data-confirm-input]').addEventListener('input', e => {
          btn.disabled = e.target.value.trim() !== requireText;
        });
      }
      btn.addEventListener('click', () => { ok = true; m.close(); });
    });
  }

  /* ---------- Forms ---------- */
  function formData(form) {
    const o = {};
    new FormData(form).forEach((v, k) => {
      if (k in o) { o[k] = [].concat(o[k], v); } else { o[k] = typeof v === 'string' ? v.trim() : v; }
    });
    return o;
  }
  function clearErrors(form) {
    form.querySelectorAll('.is-invalid').forEach(f => f.classList.remove('is-invalid'));
    form.querySelectorAll('.invalid-feedback.js-err').forEach(f => f.remove());
  }
  function showErrors(form, errors) {
    clearErrors(form);
    let first = null;
    Object.entries(errors).forEach(([name, msg]) => {
      const field = form.querySelector(`[name="${name}"]`);
      if (!field) { toast(msg, 'danger'); return; }
      field.classList.add('is-invalid');
      const fb = document.createElement('div');
      fb.className = 'invalid-feedback js-err';
      fb.textContent = msg;
      const holder = field.closest('.input-group') || field;
      holder.insertAdjacentElement('afterend', fb);
      fb.style.display = 'block';
      if (!first) first = field;
    });
    if (first) first.focus();
    return Object.keys(errors).length === 0;
  }

  /* ---------- Files, CSV, print ---------- */
  function download(filename, content, mime = 'text/plain') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function toCSV(columns, rows) {
    const cell = v => {
      v = v == null ? '' : String(v);
      return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const head = columns.map(c => cell(c.label)).join(',');
    const body = rows.map(r => columns.map(c => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
    return [head, ...body].join('\r\n');
  }
  function exportCSV(filename, columns, rows) {
    if (!rows.length) { toast('There are no records to export.', 'warning'); return; }
    download(filename, '\uFEFF' + toCSV(columns, rows), 'text/csv;charset=utf-8');
    toast(`Exported ${rows.length} record(s) to ${filename}`);
  }
  function stamp() { const d = new Date(); return `${compactDate(d)}-${pad(d.getHours())}${pad(d.getMinutes())}`; }

  function readImage(file, maxSize = 480) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) return reject(new Error('Please choose an image file (JPG, PNG, WEBP).'));
      if (file.size > 5 * 1024 * 1024) return reject(new Error('Image must be smaller than 5 MB.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the selected image.'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => reject(new Error('The selected file is not a valid image.'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function print(html) {
    const area = document.getElementById('print-area');
    area.innerHTML = html;
    document.body.classList.add('printing');
    const done = () => {
      document.body.classList.remove('printing');
      area.innerHTML = '';
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 80);
  }

  /* =========================================================
     EXPIRATION, SHELF-LIFE & BATCH (FEFO) HELPERS
     ========================================================= */

  /** Configurable warning periods (in days) from Settings, with defaults 7 / 3 / 1. */
  function expiryThresholds() {
    const s = (typeof App !== 'undefined' && App.settings) || {};
    const near = Number.isInteger(Number(s.expiryNearDays)) && Number(s.expiryNearDays) > 0 ? Number(s.expiryNearDays) : 7;
    const verySoon = Number.isInteger(Number(s.expiryVerySoonDays)) && Number(s.expiryVerySoonDays) > 0 ? Number(s.expiryVerySoonDays) : 3;
    const critical = Number.isInteger(Number(s.expiryCriticalDays)) && Number(s.expiryCriticalDays) >= 0 ? Number(s.expiryCriticalDays) : 1;
    return {
      near: Math.max(near, verySoon),
      verySoon: Math.max(verySoon, critical),
      critical
    };
  }

  /**
   * Calculates remaining shelf life in calendar days relative to `refDate` (default: today).
   * Returns null if no expirationDate is set.
   * Negative = already expired, 0 = expires today, positive = days remaining.
   */
  function daysUntilExpiry(expirationDate, refDate = new Date()) {
    if (!expirationDate) return null;
    const exp = parseDate(expirationDate);
    if (!exp) return null;
    const today0 = startOfDay(refDate);
    const exp0 = startOfDay(exp);
    return Math.round((exp0.getTime() - today0.getTime()) / 86400000);
  }

  /**
   * Classifies a batch's expiration date into one of:
   * - Expired (red / danger)
   * - Expiring Very Soon (orange)
   * - Nearing Expiration (yellow / warning)
   * - Safe (green / success)
   */
  function batchShelfStatus(expirationDate, refDate = new Date()) {
    const days = daysUntilExpiry(expirationDate, refDate);
    if (days === null) {
      return { key: 'safe', group: 'safe', label: 'Safe', cls: 'success', tone: 'green', days: null, daysText: 'No expiry set' };
    }
    const th = expiryThresholds();
    const daysText = days < 0
      ? `Expired ${Math.abs(days)}d ago`
      : days === 0 ? 'Expires today' : `${days}d left`;

    if (days < 0) {
      return { key: 'expired', group: 'expired', label: 'Expired', cls: 'danger', tone: 'red', days, daysText };
    }
    if (days <= th.verySoon) {
      return { key: 'very-soon', group: 'expiring', label: 'Expiring Very Soon', cls: 'orange', tone: 'orange', days, daysText };
    }
    if (days <= th.near) {
      return { key: 'nearing', group: 'expiring', label: 'Nearing Expiration', cls: 'warning', tone: 'amber', days, daysText };
    }
    return { key: 'safe', group: 'safe', label: 'Safe', cls: 'success', tone: 'green', days, daysText };
  }

  function shelfBadge(statusObj) {
    if (!statusObj) return '<span class="text-muted small">—</span>';
    return `<span class="badge badge-soft-${statusObj.cls}">${esc(statusObj.label)}</span>`;
  }

  /** Sorts batches FEFO (earliest expiration date first, then earliest received date). */
  function sortBatchesFEFO(batches = []) {
    return [...batches].sort((a, b) => {
      const ea = a.expirationDate || '9999-12-31';
      const eb = b.expirationDate || '9999-12-31';
      if (ea !== eb) return ea.localeCompare(eb);
      return String(a.dateReceived || '').localeCompare(String(b.dateReceived || '')) || String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  /**
   * Normalizes and synchronizes `product.batches` with `product.stock` for backward compatibility.
   * Existing products without `batches` (or where batch sum drifted) get a clean FEFO batch list.
   */
  function ensureProductBatches(p, refDate = new Date()) {
    if (!p) return [];
    const stock = Math.max(0, Number(p.stock) || 0);
    let batches = Array.isArray(p.batches)
      ? p.batches.filter(b => b && Number(b.qty) > 0).map((b, idx) => ({
          id: b.id || `${p.id}-B${pad(idx + 1, 2)}`,
          dateReceived: b.dateReceived ? dateKey(parseDate(b.dateReceived) || refDate) : dateKey(p.createdAt || refDate),
          expirationDate: b.expirationDate ? dateKey(parseDate(b.expirationDate)) : '',
          qty: Math.max(0, Math.round(Number(b.qty) || 0)),
          initialQty: Math.max(Number(b.initialQty) || 0, Math.round(Number(b.qty) || 0)),
          note: b.note || ''
        }))
      : [];

    const sum = batches.reduce((s, b) => s + b.qty, 0);
    if (sum < stock) {
      const diff = stock - sum;
      const defaultDays = Number(p.defaultShelfLifeDays) > 0 ? Number(p.defaultShelfLifeDays) : 14;
      const recDate = dateKey(p.createdAt || refDate);
      const expDate = p.expirationDate
        ? dateKey(parseDate(p.expirationDate))
        : dateKey(addDays(refDate, defaultDays));
      batches.push({
        id: nextId(`${p.id}-B`, batches.map(x => x.id), 2),
        dateReceived: recDate,
        expirationDate: expDate,
        qty: diff,
        initialQty: diff,
        note: batches.length ? 'Reconciled stock' : 'Opening batch'
      });
    } else if (sum > stock) {
      batches = sortBatchesFEFO(batches);
      let excess = sum - stock;
      for (const b of batches) {
        if (excess <= 0) break;
        const cut = Math.min(b.qty, excess);
        b.qty -= cut;
        excess -= cut;
      }
      batches = batches.filter(b => b.qty > 0);
    }
    p.batches = sortBatchesFEFO(batches);
    p.stock = p.batches.reduce((s, b) => s + b.qty, 0);
    return p.batches;
  }

  /**
   * Computes a product's batch & shelf-life summary:
   * - `sellableQty`: total quantity in non-expired batches
   * - `expiredQty`: total quantity in expired batches
   * - `expiringQty`: total quantity in nearing/very-soon batches
   * - `earliestBatch`: earliest-expiring active batch
   * - `earliestSellable`: earliest non-expired batch (FEFO next batch to sell)
   * - `status`: most urgent shelf-life status across active batches
   */
  function productShelfSummary(p, refDate = new Date()) {
    const batches = sortBatchesFEFO((p && Array.isArray(p.batches) ? p.batches : []).filter(b => Number(b.qty) > 0));
    if (!batches.length) {
      if (p && Number(p.stock) > 0) {
        ensureProductBatches(p, refDate);
        return productShelfSummary(p, refDate);
      }
      const emptyStatus = { key: 'none', group: 'none', label: 'No Stock', cls: 'secondary', tone: 'gray', days: null, daysText: '—' };
      return {
        batches: [],
        totalQty: 0,
        sellableQty: 0,
        expiredQty: 0,
        expiringQty: 0,
        expiringVerySoonQty: 0,
        nearingQty: 0,
        safeQty: 0,
        earliestBatch: null,
        earliestSellable: null,
        status: emptyStatus,
        overallStatus: emptyStatus
      };
    }

    let sellableQty = 0, expiredQty = 0, expiringQty = 0, expiringVerySoonQty = 0, nearingQty = 0, safeQty = 0;
    const enriched = batches.map(b => {
      const st = batchShelfStatus(b.expirationDate, refDate);
      if (st.key === 'expired') expiredQty += b.qty;
      else {
        sellableQty += b.qty;
        if (st.key === 'very-soon') { expiringQty += b.qty; expiringVerySoonQty += b.qty; }
        else if (st.key === 'nearing') { expiringQty += b.qty; nearingQty += b.qty; }
        else safeQty += b.qty;
      }
      return { ...b, status: st };
    });

    const earliestBatch = enriched[0] || null;
    const earliestSellable = enriched.find(b => b.status.key !== 'expired') || null;
    const priority = { 'expired': 0, 'very-soon': 1, 'nearing': 2, 'safe': 3 };
    const worst = [...enriched].sort((a, b) => priority[a.status.key] - priority[b.status.key] || (a.status.days ?? 9999) - (b.status.days ?? 9999))[0];
    const resolvedStatus = worst ? worst.status : batchShelfStatus(null, refDate);

    return {
      batches: enriched,
      totalQty: sellableQty + expiredQty,
      sellableQty,
      expiredQty,
      expiringQty,
      expiringVerySoonQty,
      nearingQty,
      safeQty,
      earliestBatch,
      earliestSellable,
      status: resolvedStatus,
      overallStatus: resolvedStatus
    };
  }

  /** Quantity that can legally be sold in POS (excludes expired batches). */
  function sellableStock(p, refDate = new Date()) {
    if (!p) return 0;
    if (Array.isArray(p.batches)) return productShelfSummary(p, refDate).sellableQty;
    return Math.max(0, Number(p.stock) || 0);
  }

  /**
   * Deducts `qty` from `product.batches` in FEFO order.
   * When `allowExpired` is false (e.g. POS sale), expired batches are skipped and cannot be sold.
   * When `batchId` is provided, deducts specifically from that batch first.
   * Mutates `product.batches` and `product.stock`, and returns `{ deducted, allocations: [{batchId, expirationDate, qty}] }`.
   */
  function deductBatchesFEFO(product, qty, { allowExpired = false, batchId = '', refDate = new Date() } = {}) {
    ensureProductBatches(product, refDate);
    let remaining = Math.round(Number(qty) || 0);
    if (remaining <= 0) return { deducted: 0, allocations: [] };

    const ordered = sortBatchesFEFO(product.batches);
    if (batchId) {
      const idx = ordered.findIndex(b => b.id === batchId);
      if (idx > 0) {
        const [picked] = ordered.splice(idx, 1);
        ordered.unshift(picked);
      }
    }

    const allocations = [];
    for (const b of ordered) {
      if (remaining <= 0) break;
      if (b.qty <= 0) continue;
      if (!allowExpired && batchShelfStatus(b.expirationDate, refDate).key === 'expired') continue;
      const take = Math.min(b.qty, remaining);
      b.qty -= take;
      remaining -= take;
      allocations.push({ batchId: b.id, expirationDate: b.expirationDate || '', qty: take });
    }

    if (remaining > 0) {
      throw new Error(allowExpired
        ? `Insufficient stock for "${product.name}".`
        : `Cannot sell expired stock for "${product.name}". Only ${sellableStock(product, refDate)} non-expired ${product.unit} available.`);
    }

    product.batches = sortBatchesFEFO(ordered.filter(b => b.qty > 0));
    product.stock = product.batches.reduce((s, b) => s + b.qty, 0);
    return { deducted: qty, allocations };
  }

  /* ---------- Inventory status ---------- */
  function stockStatus(p) {
    const s = Number(p.stock) || 0;
    const r = Number(p.reorderLevel) || 0;
    if (s <= 0) return { key: 'out', label: 'Out of Stock', cls: 'danger' };
    if (s <= r) return { key: 'low', label: 'Low Stock', cls: 'warning' };
    return { key: 'in', label: 'In Stock', cls: 'success' };
  }
  function stockBadge(p) {
    const s = stockStatus(p);
    return `<span class="badge badge-soft-${s.cls}">${s.label}</span>`;
  }
  const FALLBACK_FOOD_IMAGE = 'assets/images/foods/placeholder-food.svg';
  const FALLBACK_INGREDIENT_IMAGE = 'assets/images/ingredients/placeholder-ingredient.svg';
  function fallbackImageFor(p) {
    return (p && (p.isIngredient || String(p.id || '').startsWith('ING-')))
      ? FALLBACK_INGREDIENT_IMAGE
      : FALLBACK_FOOD_IMAGE;
  }
  function productImageSrc(p) {
    if (p && p.image && String(p.image).trim()) return p.image;
    if (p && typeof Prefs !== 'undefined' && typeof Prefs.defaultFoodImage === 'function') {
      const mapped = Prefs.defaultFoodImage(p);
      if (mapped) return mapped;
    }
    return fallbackImageFor(p);
  }
  function productThumb(p, cls = 'prod-thumb') {
    const src = productImageSrc(p);
    const fb = fallbackImageFor(p);
    const alt = p && p.name ? esc(p.name) : 'Item';
    return `<img src="${esc(src)}" alt="${alt}" class="${cls}" loading="lazy" onerror="this.onerror=null;this.src='${fb}'">`;
  }

  /* ---------- Pagination ---------- */
  function paginate(list, page, size) {
    const pages = Math.max(1, Math.ceil(list.length / size));
    page = Math.min(Math.max(1, page || 1), pages);
    return {
      items: list.slice((page - 1) * size, page * size), page, pages, total: list.length,
      start: list.length ? (page - 1) * size + 1 : 0, end: Math.min(page * size, list.length)
    };
  }
  function pagerHTML(p) {
    if (!p.total) return '';
    const btn = (n, label, disabled, active, aria = '') =>
      `<li class="page-item ${disabled ? 'disabled' : ''} ${active ? 'active' : ''}"><button class="page-link" data-page="${n}" ${disabled ? 'tabindex="-1" aria-disabled="true"' : ''} ${active ? 'aria-current="page"' : ''} ${aria ? `aria-label="${aria}"` : ''}>${label}</button></li>`;
    const nums = [];
    const from = Math.max(1, p.page - 2), to = Math.min(p.pages, p.page + 2);
    if (from > 1) nums.push(btn(1, '1', false, p.page === 1, 'Page 1'));
    if (from > 2) nums.push('<li class="page-item disabled"><span class="page-link">…</span></li>');
    for (let i = from; i <= to; i++) nums.push(btn(i, i, false, i === p.page, `Page ${i}`));
    if (to < p.pages - 1) nums.push('<li class="page-item disabled"><span class="page-link">…</span></li>');
    if (to < p.pages) nums.push(btn(p.pages, p.pages, false, p.page === p.pages, `Page ${p.pages}`));
    return `<div class="pager"><div class="pager-info">Showing ${p.start}–${p.end} of ${p.total}</div>
      <ul class="pagination pagination-sm">${btn(p.page - 1, '<i class="bi bi-chevron-left" aria-hidden="true"></i>', p.page === 1, false, 'Previous page')}${nums.join('')}${btn(p.page + 1, '<i class="bi bi-chevron-right" aria-hidden="true"></i>', p.page === p.pages, false, 'Next page')}</ul></div>`;
  }
  function bindPager(container, onPage) {
    container.addEventListener('click', e => {
      const b = e.target.closest('[data-page]');
      if (!b || b.closest('.disabled')) return;
      onPage(parseInt(b.dataset.page, 10));
    });
  }

  /* ---------- UI snippets ---------- */
  function emptyState(icon, title, text = '', action = '') {
    return `<div class="empty-state"><div class="empty-icon"><i class="bi bi-${icon}"></i></div>
      <h2 class="h6">${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${action ? `<div class="mt-3">${action}</div>` : ''}</div>`;
  }
  function emptyRow(colspan, icon, title, text = '') {
    return `<tr><td colspan="${colspan}">${emptyState(icon, title, text)}</td></tr>`;
  }
  function statCard({ icon, tone = 'green', label, value, sub = '' }) {
    return `<div class="card stat-card"><div class="stat-icon tone-${tone}"><i class="bi bi-${icon}"></i></div>
      <div class="min-w-0"><div class="stat-label">${esc(label)}</div><div class="stat-value">${value}</div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div></div>`;
  }
  function debounce(fn, wait = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  /* ---------- Charts ---------- */
  function chart(canvas, config) {
    if (!canvas || typeof Chart === 'undefined') return null;
    const c = new Chart(canvas, config);
    charts.push(c);
    return c;
  }
  function destroyCharts() { while (charts.length) { try { charts.pop().destroy(); } catch (_) { /* ignore */ } } }
  const palette = ['#16a34a', '#2563eb', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#84cc16', '#f97316', '#64748b'];

  return {
    pad, esc, round2, money, num, initials, currencySymbol,
    dateKey, compactDate, parseDate, startOfDay, endOfDay, addDays, startOfWeek, startOfMonth,
    fmtDate, fmtDateTime, fmtShort, inDateRange, relativeTime,
    nextId, isEmail, isPhone, isMoney, isWholeNumber,
    toast, modal, confirm, formData, showErrors, clearErrors,
    download, toCSV, exportCSV, stamp, readImage, print,
    expiryThresholds, daysUntilExpiry, batchShelfStatus, shelfBadge,
    sortBatchesFEFO, ensureProductBatches, productShelfSummary, sellableStock, deductBatchesFEFO,
    stockStatus, stockBadge, FALLBACK_FOOD_IMAGE, FALLBACK_INGREDIENT_IMAGE, fallbackImageFor, productImageSrc, productThumb,
    paginate, pagerHTML, bindPager, emptyState, emptyRow, statCard, debounce,
    chart, destroyCharts, palette
  };
})();

/* =========================================================
   Stats - sales aggregation & trend analytics computed from
   real completed transactions (excludes cancelled/voided).
   ========================================================= */
const Stats = {
  /** Returns only completed sales transactions (excludes cancelled or voided records). */
  completed(txns = []) {
    return txns.filter(t => t && (!t.status || t.status === 'completed'));
  },
  /** Filter completed transactions by Date objects (inclusive). */
  between(txns, from, to) {
    const a = from ? from.getTime() : -Infinity, b = to ? to.getTime() : Infinity;
    return Stats.completed(txns).filter(t => { const x = new Date(t.date).getTime(); return x >= a && x <= b; });
  },
  totals(txns) {
    const valid = Stats.completed(txns);
    let revenue = 0, items = 0, cost = 0, discount = 0, gross = 0;
    valid.forEach(t => {
      revenue += Number(t.total) || 0;
      discount += Number(t.discount) || 0;
      gross += Number(t.subtotal) || 0;
      (t.items || []).forEach(i => { items += i.qty; cost += (Number(i.cost) || 0) * i.qty; });
    });
    revenue = Utils.round2(revenue);
    cost = Utils.round2(cost);
    const count = valid.length;
    const avgOrder = count > 0 ? Utils.round2(revenue / count) : 0;
    return {
      revenue, count, items, avgOrder, cost,
      profit: Utils.round2(revenue - cost),
      discount: Utils.round2(discount),
      gross: Utils.round2(gross)
    };
  },
  /** Per-product sales; revenue is net of transaction discounts (allocated proportionally). */
  productSales(txns, sortBy = 'qty') {
    const valid = Stats.completed(txns);
    const map = new Map();
    valid.forEach(t => {
      const ratio = t.subtotal > 0 ? t.total / t.subtotal : 1;
      (t.items || []).forEach(i => {
        const row = map.get(i.productId) || {
          productId: i.productId, name: i.name, category: i.category || '',
          qty: 0, revenue: 0, cost: 0, txns: 0, lastSold: ''
        };
        row.qty += i.qty;
        row.revenue += i.subtotal * ratio;
        row.cost += (Number(i.cost) || 0) * i.qty;
        row.txns += 1;
        row.name = i.name;
        if (!row.lastSold || t.date > row.lastSold) row.lastSold = t.date;
        map.set(i.productId, row);
      });
    });
    const totalRev = [...map.values()].reduce((s, r) => s + r.revenue, 0);
    const totalQty = [...map.values()].reduce((s, r) => s + r.qty, 0);
    return [...map.values()].map(r => ({
      ...r,
      revenue: Utils.round2(r.revenue),
      cost: Utils.round2(r.cost),
      profit: Utils.round2(r.revenue - r.cost),
      revenueShare: totalRev > 0 ? Utils.round2((r.revenue / totalRev) * 100) : 0,
      qtyShare: totalQty > 0 ? Utils.round2((r.qty / totalQty) * 100) : 0
    })).sort((a, b) => sortBy === 'revenue'
      ? (b.revenue - a.revenue || b.qty - a.qty)
      : (b.qty - a.qty || b.revenue - a.revenue));
  },
  /**
   * Identifies slow-moving products in a given period by comparing active catalog products
   * against actual units sold in `txns`. Returns items sorted by lowest qty sold first.
   */
  slowMovers(products = [], txns = [], categories = []) {
    const valid = Stats.completed(txns);
    const soldMap = new Map(Stats.productSales(valid).map(r => [r.productId, r]));
    const catName = id => (categories.find(c => c.id === id) || {}).name || 'Uncategorized';
    const allLastSold = new Map();
    valid.forEach(t => (t.items || []).forEach(i => {
      const prev = allLastSold.get(i.productId);
      if (!prev || t.date > prev) allLastSold.set(i.productId, t.date);
    }));

    const rows = products.filter(p => p.status === 'active').map(p => {
      const s = soldMap.get(p.id) || { qty: 0, revenue: 0, cost: 0, profit: 0, txns: 0 };
      const lastSold = s.lastSold || allLastSold.get(p.id) || '';
      const totalUnits = p.stock + s.qty;
      const turnoverPct = totalUnits > 0 ? Utils.round2((s.qty / totalUnits) * 100) : 0;
      return {
        productId: p.id,
        name: p.name,
        category: catName(p.categoryId),
        stock: p.stock,
        unit: p.unit,
        qty: s.qty,
        txns: s.txns,
        revenue: s.revenue,
        stockValue: Utils.round2(p.stock * p.cost),
        stockValueCost: Utils.round2(p.stock * p.cost),
        turnoverPct,
        lastSold,
        classification: s.qty === 0 ? 'No Sales in Period' : 'Slow-Moving'
      };
    }).sort((a, b) => a.qty - b.qty || a.revenue - b.revenue || b.stock - a.stock);

    if (!rows.length) return [];
    const medianQty = rows[Math.floor(rows.length / 2)].qty;
    return rows.filter((r, idx) => r.qty === 0 || r.qty <= medianQty || idx < Math.ceil(rows.length * 0.4));
  },
  /**
   * Compares current period [from, to] with the immediately preceding period of equal duration.
   */
  comparePeriods(allTxns, from, to) {
    const a = Utils.startOfDay(from), b = Utils.endOfDay(to);
    const spanDays = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000));
    const prevTo = Utils.endOfDay(Utils.addDays(a, -1));
    const prevFrom = Utils.startOfDay(Utils.addDays(prevTo, -(spanDays - 1)));
    const curTxns = Stats.between(allTxns, a, b);
    const prevTxns = Stats.between(allTxns, prevFrom, prevTo);
    const cur = Stats.totals(curTxns);
    const prev = Stats.totals(prevTxns);
    const pct = (c, p) => p > 0 ? Utils.round2(((c - p) / p) * 100) : null;
    const deltas = {
      revenue: pct(cur.revenue, prev.revenue),
      count: pct(cur.count, prev.count),
      items: pct(cur.items, prev.items),
      avgOrder: pct(cur.avgOrder, prev.avgOrder),
      revenuePct: pct(cur.revenue, prev.revenue),
      countPct: pct(cur.count, prev.count),
      itemsPct: pct(cur.items, prev.items),
      avgOrderPct: pct(cur.avgOrder, prev.avgOrder)
    };
    return {
      days: spanDays,
      spanDays,
      prevFrom,
      prevTo,
      current: { ...cur, from: a, to: b },
      previous: { ...prev, from: prevFrom, to: prevTo },
      deltas,
      delta: deltas,
      sufficientForComparison: cur.count > 0 && prev.count > 0
    };
  },
  /**
   * Analyzes peak sales days of the week and peak hours of the day from actual transaction timestamps.
   * Explicitly reports when there is insufficient history (< 3 transactions).
   */
  peakPatterns(txns = []) {
    const valid = Stats.completed(txns);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const days = dayNames.map((name, i) => ({ dayIndex: i, label: name, short: name.slice(0, 3), count: 0, revenue: 0, items: 0 }));
    const hours = Array.from({ length: 24 }, (_, h) => {
      const ampm = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
      return { hour: h, label: ampm, count: 0, revenue: 0, items: 0 };
    });

    let validTimestamps = 0;
    valid.forEach(t => {
      const d = new Date(t.date);
      if (isNaN(d.getTime())) return;
      validTimestamps++;
      const rev = Number(t.total) || 0;
      const it = (t.items || []).reduce((s, i) => s + i.qty, 0);
      const dw = d.getDay();
      const hr = d.getHours();
      days[dw].count += 1;
      days[dw].revenue = Utils.round2(days[dw].revenue + rev);
      days[dw].items += it;
      hours[hr].count += 1;
      hours[hr].revenue = Utils.round2(hours[hr].revenue + rev);
      hours[hr].items += it;
    });

    const distinctDays = new Set(valid.map(t => Utils.dateKey(t.date))).size;
    const sufficient = validTimestamps >= 3 && distinctDays >= 2;
    const peakDay = sufficient ? [...days].sort((a, b) => b.revenue - a.revenue || b.count - a.count)[0] : null;
    const peakHour = sufficient ? [...hours].sort((a, b) => b.count - a.count || b.revenue - a.revenue)[0] : null;

    return {
      sufficient,
      validTimestamps,
      totalTransactions: validTimestamps,
      distinctDays,
      days,
      hours,
      peakDay: peakDay && peakDay.count > 0 ? peakDay : null,
      peakHour: peakHour && peakHour.count > 0 ? peakHour : null
    };
  },
  byDay(txns, from, to) {
    const valid = Stats.completed(txns);
    const rows = [];
    for (let d = Utils.startOfDay(from); d <= to; d = Utils.addDays(d, 1)) {
      rows.push({ key: Utils.dateKey(d), label: Utils.fmtShort(d), start: new Date(d), end: Utils.endOfDay(d), txns: [] });
    }
    const idx = new Map(rows.map((r, i) => [r.key, i]));
    valid.forEach(t => { const i = idx.get(Utils.dateKey(t.date)); if (i !== undefined) rows[i].txns.push(t); });
    return rows.map(r => ({ ...r, ...Stats.totals(r.txns) }));
  },
  byWeek(txns, weeks, end = new Date()) {
    const valid = Stats.completed(txns);
    const rows = [];
    const lastStart = Utils.startOfWeek(end);
    for (let w = weeks - 1; w >= 0; w--) {
      const start = Utils.addDays(lastStart, -7 * w);
      const stop = Utils.endOfDay(Utils.addDays(start, 6));
      const list = Stats.between(valid, start, stop);
      rows.push({ key: Utils.dateKey(start), label: `${Utils.fmtShort(start)} – ${Utils.fmtShort(stop)}`, start, end: stop, txns: list, ...Stats.totals(list) });
    }
    return rows;
  },
  byMonth(txns, months, end = new Date()) {
    const valid = Stats.completed(txns);
    const rows = [];
    for (let m = months - 1; m >= 0; m--) {
      const start = new Date(end.getFullYear(), end.getMonth() - m, 1);
      const stop = Utils.endOfDay(new Date(start.getFullYear(), start.getMonth() + 1, 0));
      const list = Stats.between(valid, start, stop);
      rows.push({ key: `${start.getFullYear()}-${Utils.pad(start.getMonth() + 1)}`, label: start.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }), start, end: stop, txns: list, ...Stats.totals(list) });
    }
    return rows;
  },
  /** Group transactions between two dates into daily / weekly / monthly buckets covering the range. */
  groupRange(txns, from, to, mode) {
    const valid = Stats.completed(txns);
    if (mode === 'day') return Stats.byDay(valid, from, to);
    const rows = [];
    let start = mode === 'week' ? Utils.startOfWeek(from) : Utils.startOfMonth(from);
    while (start <= to) {
      const stop = mode === 'week'
        ? Utils.endOfDay(Utils.addDays(start, 6))
        : Utils.endOfDay(new Date(start.getFullYear(), start.getMonth() + 1, 0));
      const list = Stats.between(valid, start < from ? from : start, stop > to ? to : stop);
      const label = mode === 'week'
        ? `${Utils.fmtShort(start)} – ${Utils.fmtShort(stop)}`
        : start.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
      rows.push({ key: Utils.dateKey(start), label, start, end: stop, txns: list, ...Stats.totals(list) });
      start = mode === 'week' ? Utils.addDays(start, 7) : new Date(start.getFullYear(), start.getMonth() + 1, 1);
    }
    return rows;
  }
};

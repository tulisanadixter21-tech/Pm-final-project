/* =========================================================
   inventory.js - Inventory Tracking, Expiration & Shelf-Life
   (FEFO multi-batch tracking, Stock In/Out/Adjustment/Discard,
   Expiring Soon view, and Movement History)
   Every stock change creates a movement record atomically.
   ========================================================= */
'use strict';

const Inventory = {
  title: 'Inventory',
  subtitle: 'Manage raw ingredients, kitchen supplies, perishable batches, shelf life and movement history',
  view: 'stock',
  state: { search: '', category: '', status: '', expiry: '', sort: 'priority', viewMode: 'grid', page: 1 },
  bstate: { search: '', filter: 'attention', page: 1 },
  mstate: { search: '', type: '', from: '', to: '', page: 1 },
  TYPES: ['Initial Stock', 'Stock In', 'Stock Out', 'Expired / Discarded', 'Adjustment'],
  UNITS: ['kg', 'g', 'L', 'mL', 'pack', 'pc', 'box', 'bottle', 'can', 'tray'],
  REASONS: {
    in: ['Supplier delivery', 'Kitchen prep / restock', 'Transfer in', 'Other'],
    out: ['Kitchen prep / production use', 'Daily cooking consumption', 'Staff meal / internal use', 'Other'],
    discard: ['Expired batch discarded', 'Spoiled / quality check failed', 'Contaminated / damaged packaging', 'End-of-day perishable disposal', 'Other'],
    adjust: ['Physical count correction', 'Data entry correction', 'Other']
  },

  /* ---------- Shared helpers used by other modules ---------- */
  buildMovement({ id, product, type, quantity, previousStock, newStock, reason, refId = '', date, batchId = '', dateReceived = '', expirationDate = '' }) {
    return {
      id, productId: product.id, productName: product.name, type, quantity: Math.abs(Number(quantity) || 0),
      previousStock, newStock, date: date || new Date().toISOString(), reason: reason || '', refId,
      batchId: batchId || '', dateReceived: dateReceived || '', expirationDate: expirationDate || '',
      userName: Auth.user ? Auth.user.fullName : 'System'
    };
  },
  typeBadge(type) {
    const cls = {
      'Initial Stock': 'secondary',
      'Stock In': 'success',
      'Stock Out': 'danger',
      'Expired / Discarded': 'orange',
      'Adjustment': 'purple',
      'Sale': 'info'
    }[type] || 'secondary';
    return `<span class="badge badge-soft-${cls}">${Utils.esc(type)}</span>`;
  },
  signedQty(mv) {
    const diff = mv.newStock - mv.previousStock;
    if (diff > 0) return `<span class="text-success fw-semibold">+${Utils.num(diff)}</span>`;
    if (diff < 0) return `<span class="text-danger fw-semibold">${Utils.num(diff)}</span>`;
    return '<span class="text-muted">0</span>';
  },

  async render(el) {
    el.innerHTML = `
      <div id="inv-alert"></div>
      <div class="row g-3 mb-3" id="inv-cards"></div>
      <ul class="nav nav-pills section-tabs mb-3">
        <li class="nav-item"><button class="nav-link ${this.view === 'stock' ? 'active' : ''}" data-view="stock"><i class="bi bi-clipboard-data me-1"></i>Stock Levels</button></li>
        <li class="nav-item"><button class="nav-link ${this.view === 'expiring' ? 'active' : ''}" data-view="expiring"><i class="bi bi-hourglass-split me-1"></i>Expiring Soon &amp; Batches <span class="badge bg-danger rounded-pill ms-1 d-none" id="inv-exp-tab-badge">0</span></button></li>
        <li class="nav-item"><button class="nav-link ${this.view === 'history' ? 'active' : ''}" data-view="history"><i class="bi bi-clock-history me-1"></i>Movement History</button></li>
      </ul>
      <div id="inv-view"></div>`;
    el.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
      this.view = b.dataset.view;
      el.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
      this.renderView();
    }));
    await this.load();
  },

  async load() {
    if (typeof Prefs !== 'undefined' && typeof Prefs.syncProductImages === 'function') {
      await Prefs.syncProductImages();
    }
    const [allProducts, dbCategories, allMovements, suppliers] = await Promise.all([
      DB.getAll('products'), DB.getAll('categories'), DB.getAll('movements'), DB.getAll('suppliers')]);
    this.suppliers = suppliers;
    this.products = allProducts.filter(p => p.isIngredient || String(p.id || '').startsWith('ING-'));
    this.products.forEach(p => {
      p.isIngredient = true;
      if ((!p.image || !String(p.image).startsWith('assets/images/ingredients/')) && typeof Prefs !== 'undefined' && Prefs.defaultFoodImage) {
        p.image = Prefs.defaultFoodImage(p) || p.image || '';
      }
      Utils.ensureProductBatches(p);
    });
    const ingCats = (typeof Prefs !== 'undefined' && Array.isArray(Prefs.INGREDIENT_CATEGORIES))
      ? Prefs.INGREDIENT_CATEGORIES.map(c => ({ ...c }))
      : [];
    const catMap = new Map(ingCats.map(c => [c.id, c]));
    this.products.forEach(p => {
      if (p.categoryId && !catMap.has(p.categoryId)) {
        const found = dbCategories.find(c => c.id === p.categoryId);
        catMap.set(p.categoryId, { id: p.categoryId, name: p.categoryName || (found ? found.name : p.categoryId) });
      }
    });
    this.categories = Array.from(catMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    const ingIds = new Set(this.products.map(p => p.id));
    this.movements = allMovements.filter(m => ingIds.has(m.productId) || String(m.productId || '').startsWith('ING-'));
    this.movements.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    try { localStorage.setItem('fbs_ingredients', JSON.stringify(this.products)); } catch {}
    this.renderSummary();
    this.renderView();
  },

  catName(id, item) {
    if (item && item.categoryName) return item.categoryName;
    const c = (this.categories || []).find(x => x.id === id);
    if (c) return c.name;
    if (typeof Prefs !== 'undefined' && Array.isArray(Prefs.INGREDIENT_CATEGORIES)) {
      const ic = Prefs.INGREDIENT_CATEGORIES.find(x => x.id === id);
      if (ic) return ic.name;
    }
    return 'Kitchen Supply';
  },

  /** Returns a flat list of all active batches across products with shelf-life metadata. */
  allBatches() {
    const rows = [];
    this.products.forEach(p => {
      const shelf = Utils.productShelfSummary(p);
      shelf.batches.forEach(b => {
        rows.push({
          ...b,
          productId: p.id,
          productName: p.name,
          categoryId: p.categoryId,
          categoryName: this.catName(p.categoryId, p),
          unit: p.unit,
          cost: p.cost,
          productStatus: p.status
        });
      });
    });
    const prio = { 'expired': 0, 'very-soon': 1, 'nearing': 2, 'safe': 3 };
    return rows.sort((a, b) => prio[a.status.key] - prio[b.status.key] || (a.status.days ?? 9999) - (b.status.days ?? 9999) || a.productName.localeCompare(b.productName));
  },

  renderSummary() {
    const counts = { in: 0, low: 0, out: 0 };
    let value = 0, retail = 0;
    let expiredBatches = 0, expiredUnits = 0, expiringBatches = 0, expiringUnits = 0;

    this.products.forEach(p => {
      counts[Utils.stockStatus(p).key]++;
      value += p.stock * p.cost;
      retail += p.stock * p.price;
      const shelf = Utils.productShelfSummary(p);
      shelf.batches.forEach(b => {
        if (b.status.key === 'expired') { expiredBatches++; expiredUnits += b.qty; }
        else if (b.status.group === 'expiring') { expiringBatches++; expiringUnits += b.qty; }
      });
    });

    const tabBadge = document.getElementById('inv-exp-tab-badge');
    if (tabBadge) {
      const attn = expiredBatches + expiringBatches;
      tabBadge.textContent = attn;
      tabBadge.classList.toggle('d-none', attn === 0);
    }

    const alerts = this.products.filter(p => p.status === 'active' && Utils.stockStatus(p).key !== 'in');
    let alertHtml = '';
    if (expiredBatches > 0 || (expiringBatches > 0 && Prefs.get('expiryAlerts') !== false)) {
      alertHtml += `<div class="alert ${expiredBatches > 0 ? 'alert-soft-danger' : 'alert-soft-orange'} d-flex flex-wrap gap-2 align-items-center mb-2">
        <i class="bi bi-hourglass-bottom fs-5"></i>
        <div class="flex-grow-1">
          <strong>Ingredient Expiration Alert:</strong>
          ${expiredBatches > 0 ? `<span class="fw-semibold">${expiredBatches} expired ingredient batch(es) (${Utils.num(expiredUnits)} units)</span> cannot be used for kitchen prep and should be discarded. ` : ''}
          ${expiringBatches > 0 ? `<span>${expiringBatches} ingredient batch(es) (${Utils.num(expiringUnits)} units) are nearing expiration.</span>` : ''}
        </div>
        <button type="button" class="btn btn-sm ${expiredBatches > 0 ? 'btn-danger' : 'btn-outline-primary'}" id="inv-jump-expiring">Review Batches</button>
      </div>`;
    }
    if (alerts.length && Prefs.get('lowStockAlerts')) {
      alertHtml += `<div class="alert alert-soft-warning d-flex gap-2 align-items-start mb-3"><i class="bi bi-exclamation-triangle-fill fs-5"></i>
        <div><strong>${alerts.length} raw ingredient(s) low or out of stock:</strong> ${alerts.slice(0, 6).map(p => `${Utils.esc(p.name)} (${p.stock} ${Utils.esc(p.unit)})`).join(', ')}${alerts.length > 6 ? '…' : ''}</div></div>`;
    }
    const alertEl = document.getElementById('inv-alert');
    alertEl.innerHTML = alertHtml;
    const jump = alertEl.querySelector('#inv-jump-expiring');
    if (jump) jump.addEventListener('click', () => {
      this.view = 'expiring';
      document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === 'expiring'));
      this.renderView();
    });

    document.getElementById('inv-cards').innerHTML = `
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'check2-circle', tone: 'green', label: 'In Stock', value: counts.in, sub: 'Above reorder level' })}</div>
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'exclamation-triangle', tone: 'amber', label: 'Low Stock', value: counts.low, sub: 'At or below reorder level' })}</div>
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'x-octagon', tone: 'red', label: 'Out of Stock', value: counts.out, sub: 'Zero available' })}</div>
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'hourglass-split', tone: 'orange', label: 'Expiring Soon', value: expiringBatches, sub: `${Utils.num(expiringUnits)} units within ${Utils.expiryThresholds().near}d` })}</div>
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'calendar-x', tone: 'red', label: 'Expired Batches', value: expiredBatches, sub: `${Utils.num(expiredUnits)} units unusable` })}</div>
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'cash-stack', tone: 'blue', label: 'Inventory Value', value: Utils.money(value), sub: `${this.products.length} raw ingredients` })}</div>`;
  },

  renderView() {
    if (this.view === 'history') this.renderHistory();
    else if (this.view === 'expiring') this.renderExpiringView();
    else this.renderStock();
  },

  /* ---------- Stock levels ---------- */
  placeholderIcon(p) {
    const cat = this.catName(p.categoryId).toLowerCase();
    if (cat.includes('beverage') || cat.includes('drink') || cat.includes('tea')) return 'cup-straw';
    if (cat.includes('dessert') || cat.includes('cake') || cat.includes('pastry')) return 'cake2';
    if (cat.includes('pizza')) return 'pie-chart';
    if (cat.includes('pasta') || cat.includes('noodle')) return 'bowl-hot';
    return 'egg-fried';
  },

  earliestExpiryKey(p) {
    const shelf = Utils.productShelfSummary(p);
    return (shelf.earliestBatch && shelf.earliestBatch.expirationDate) || '9999-12-31';
  },

  renderStock() {
    const savedMode = Prefs.get('inventoryViewMode');
    if (savedMode === 'grid' || savedMode === 'list') this.state.viewMode = savedMode;
    const s = this.state;
    const box = document.getElementById('inv-view');
    box.innerHTML = `
      <div class="card mb-3">
        <div class="card-body">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 pb-2 border-bottom">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold"><i class="bi bi-boxes text-primary me-1"></i>Raw Ingredients &amp; Kitchen Supplies</span>
              <span class="badge badge-soft-secondary" id="inv-count-badge">0 items</span>
            </div>
            <div class="d-flex gap-2 flex-wrap align-items-center">
              <div class="btn-group prod-view-toggle" id="inv-view-toggle" role="group" aria-label="Switch inventory view">
                <button type="button" class="btn btn-sm ${s.viewMode === 'grid' ? 'btn-primary' : 'btn-light'}" data-ivmode="grid" title="Grid View">
                  <i class="bi bi-grid-3x3-gap-fill me-1"></i>Grid
                </button>
                <button type="button" class="btn btn-sm ${s.viewMode === 'list' ? 'btn-primary' : 'btn-light'}" data-ivmode="list" title="List View">
                  <i class="bi bi-list-ul me-1"></i>List
                </button>
              </div>
              <button class="btn btn-light btn-sm" id="inv-export"><i class="bi bi-filetype-csv me-1"></i>Export CSV</button>
              <button class="btn btn-primary btn-sm" id="inv-add"><i class="bi bi-plus-lg me-1"></i>Add Ingredient</button>
            </div>
          </div>
          <div class="toolbar">
            <div class="search-box"><i class="bi bi-search"></i>
              <input type="search" class="form-control" id="inv-search" aria-label="Search ingredients by name or SKU" placeholder="Search by ingredient name or SKU / ID…" value="${Utils.esc(s.search)}"></div>
            <select class="form-select" id="inv-cat" aria-label="Filter by category"><option value="">All categories</option>${this.categories.map(c => `<option value="${c.id}">${Utils.esc(c.name)}</option>`).join('')}</select>
            <select class="form-select" id="inv-status" aria-label="Filter by stock status">
              <option value="">All stock status</option><option value="in">In Stock</option><option value="low">Low Stock</option><option value="out">Out of Stock</option></select>
            <select class="form-select" id="inv-expiry" aria-label="Filter by expiration status" title="Filter by expiration status">
              <option value="">All Shelf-Life</option>
              <option value="expiring">Expiring Soon (Nearing / Very Soon)</option>
              <option value="expired">Expired</option>
              <option value="safe">Safe</option>
            </select>
            <select class="form-select" id="inv-sort" aria-label="Sort inventory">
              <option value="priority">Sort: Stock Priority (Low/Out First)</option>
              <option value="expiry-asc">Sort: Expiration (Soonest)</option>
              <option value="expiry-desc">Sort: Expiration (Latest)</option>
              <option value="stock-asc">Sort: Quantity (Low–High)</option>
              <option value="stock-desc">Sort: Quantity (High–Low)</option>
              <option value="name-asc">Sort: Name (A–Z)</option>
              <option value="name-desc">Sort: Name (Z–A)</option>
              <option value="value-desc">Sort: Stock Value (High–Low)</option>
            </select>
          </div>
        </div>
      </div>
      <div id="inv-stock-display"></div>
      <div class="card mt-3"><div id="inv-pager"></div></div>`;

    box.querySelector('#inv-cat').value = s.category;
    box.querySelector('#inv-status').value = s.status;
    box.querySelector('#inv-expiry').value = s.expiry;
    box.querySelector('#inv-sort').value = s.sort || 'priority';

    box.querySelector('#inv-search').addEventListener('input', Utils.debounce(e => { s.search = e.target.value.trim(); s.page = 1; this.drawStock(); }));
    box.querySelector('#inv-cat').addEventListener('change', e => { s.category = e.target.value; s.page = 1; this.drawStock(); });
    box.querySelector('#inv-status').addEventListener('change', e => { s.status = e.target.value; s.page = 1; this.drawStock(); });
    box.querySelector('#inv-expiry').addEventListener('change', e => { s.expiry = e.target.value; s.page = 1; this.drawStock(); });
    box.querySelector('#inv-sort').addEventListener('change', e => { s.sort = e.target.value; s.page = 1; this.drawStock(); });

    box.querySelector('#inv-view-toggle').addEventListener('click', e => {
      const btn = e.target.closest('[data-ivmode]');
      if (!btn) return;
      s.viewMode = btn.dataset.ivmode;
      Prefs.set('inventoryViewMode', s.viewMode);
      box.querySelectorAll('#inv-view-toggle .btn').forEach(b => {
        b.classList.toggle('btn-primary', b === btn);
        b.classList.toggle('btn-light', b !== btn);
      });
      this.drawStock();
    });

    box.querySelector('#inv-export').addEventListener('click', () => this.exportStockCSV(this.filteredStock()));
    const addBtn = box.querySelector('#inv-add');
    if (addBtn) addBtn.addEventListener('click', () => this.openIngredientForm());
    Utils.bindPager(box.querySelector('#inv-pager'), p => { s.page = p; this.drawStock(); });
    box.querySelector('#inv-stock-display').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const p = this.products.find(x => x.id === b.dataset.id);
      if (!p) return;
      if (b.dataset.act === 'history') {
        this.mstate = { search: p.id, type: '', from: '', to: '', page: 1 };
        this.view = 'history';
        document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === 'history'));
        this.renderHistory();
      } else if (b.dataset.act === 'batches') {
        this.openBatchesModal(p);
      } else if (b.dataset.act === 'edit-ing') {
        this.openIngredientForm(p);
      } else {
        this.openStockForm(p, b.dataset.act);
      }
    });
    this.drawStock();
  },

  matchesExpiryFilter(p, filter) {
    if (!filter) return true;
    const shelf = Utils.productShelfSummary(p);
    if (filter === 'expired') return shelf.expiredQty > 0 || shelf.status.key === 'expired';
    if (filter === 'expiring') return shelf.expiringQty > 0 || shelf.status.group === 'expiring';
    if (filter === 'safe') return shelf.totalQty > 0 && shelf.expiredQty === 0 && shelf.expiringQty === 0;
    return true;
  },

  filteredStock() {
    const s = this.state, q = s.search.toLowerCase();
    const order = { out: 0, low: 1, in: 2 };
    const list = this.products.filter(p =>
      (!q || [p.id, p.name, this.catName(p.categoryId, p)].join(' ').toLowerCase().includes(q)) &&
      (!s.category || p.categoryId === s.category) &&
      (!s.status || Utils.stockStatus(p).key === s.status) &&
      this.matchesExpiryFilter(p, s.expiry));

    const sortMode = s.sort || 'priority';
    list.sort((a, b) => {
      if (sortMode === 'priority') return order[Utils.stockStatus(a).key] - order[Utils.stockStatus(b).key] || a.name.localeCompare(b.name);
      if (sortMode === 'expiry-asc') return this.earliestExpiryKey(a).localeCompare(this.earliestExpiryKey(b)) || a.name.localeCompare(b.name);
      if (sortMode === 'expiry-desc') return this.earliestExpiryKey(b).localeCompare(this.earliestExpiryKey(a)) || a.name.localeCompare(b.name);
      if (sortMode === 'stock-asc') return a.stock - b.stock || a.name.localeCompare(b.name);
      if (sortMode === 'stock-desc') return b.stock - a.stock || a.name.localeCompare(b.name);
      if (sortMode === 'name-asc') return a.name.localeCompare(b.name);
      if (sortMode === 'name-desc') return b.name.localeCompare(a.name);
      if (sortMode === 'value-desc') return (b.stock * b.cost) - (a.stock * a.cost) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return list;
  },

  drawStock() {
    const display = document.getElementById('inv-stock-display');
    if (!display) return;
    const list = this.filteredStock();
    const countBadge = document.getElementById('inv-count-badge');
    if (countBadge) {
      countBadge.textContent = `${list.length} of ${this.products.length} item${this.products.length === 1 ? '' : 's'}`;
    }

    const baseSize = Prefs.get('pageSize') || 10;
    const pageSize = this.state.viewMode === 'grid' ? Math.max(12, baseSize) : baseSize;
    const pg = Utils.paginate(list, this.state.page, pageSize);
    this.state.page = pg.page;

    if (this.state.viewMode === 'list') {
      display.innerHTML = `
        <div class="card">
          <div class="table-wrap"><table class="table table-hover"><thead><tr>
            <th>Ingredient ID</th><th>Ingredient Name</th><th>Category</th>
            <th class="text-end">Available</th><th class="text-end">Reorder</th><th>Unit</th>
            <th>Stock Status</th><th>Next Expiration &amp; Shelf Life</th><th>Last Updated</th><th class="text-end">Actions</th>
          </tr></thead>
          <tbody id="inv-tbody">${pg.items.length ? pg.items.map(p => this.stockRowHTML(p)).join('')
            : Utils.emptyRow(10, 'clipboard-x', 'No raw ingredients found', this.products.length ? 'Adjust your search or filters.' : 'Click "Add Ingredient" to add raw kitchen stock.')}</tbody></table></div>
        </div>`;
    } else {
      display.innerHTML = pg.items.length
        ? `<div class="row g-3" id="inv-grid">${pg.items.map(p => this.stockCardHTML(p)).join('')}</div>`
        : `<div class="card">${Utils.emptyState('clipboard-x', 'No raw ingredients found', this.products.length ? 'Adjust your search or filters.' : 'Click "Add Ingredient" to add raw kitchen stock.')}</div>`;
    }

    const pager = document.getElementById('inv-pager');
    if (pager) pager.innerHTML = Utils.pagerHTML(pg);
  },

  stockCardHTML(p) {
    const shelf = Utils.productShelfSummary(p);
    const eb = shelf.earliestBatch;
    const cat = this.catName(p.categoryId, p);
    const stockCostVal = Utils.round2(p.stock * p.cost);
    const fallbackImg = Utils.fallbackImageFor(p);

    let expiryBlock = '';
    if (p.stock > 0 && eb) {
      expiryBlock = `
        <div class="d-flex align-items-center gap-1 flex-wrap">
          ${Utils.shelfBadge(shelf.status)}
          <span class="fw-semibold">${Utils.esc(eb.status.daysText)}</span>
        </div>
        <div class="text-muted small">
          <i class="bi bi-calendar-event me-1"></i>Exp: ${Utils.fmtDate(eb.expirationDate)} · ${shelf.batches.length} batch${shelf.batches.length === 1 ? '' : 'es'}
          ${shelf.expiredQty > 0 ? `<span class="text-danger fw-semibold ms-1">(${Utils.num(shelf.expiredQty)} exp)</span>` : ''}
        </div>`;
    } else {
      expiryBlock = `
        <span class="text-muted small"><i class="bi bi-hourglass me-1"></i>No active batches</span>
        <span class="text-muted small">Updated ${Utils.fmtDate(p.updatedAt)}</span>`;
    }

    return `
      <div class="col-12 col-sm-6 col-md-6 col-lg-4 col-xl-3">
        <div class="prod-card ${p.status === 'inactive' ? 'is-inactive' : ''}" data-inv-card="${Utils.esc(p.id)}">
          <div class="prod-card-media" data-act="batches" data-id="${Utils.esc(p.id)}" title="Manage batches for ${Utils.esc(p.name)}">
            <img src="${Utils.esc(Utils.productImageSrc(p))}" alt="${Utils.esc(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${fallbackImg}'">
            <div class="prod-card-top">
              <span class="prod-sku-chip mono">${Utils.esc(p.id)}</span>
              <div class="d-flex flex-column align-items-end gap-1">
                ${Utils.stockBadge(p)}
                ${p.status === 'inactive' ? '<span class="badge badge-soft-secondary">Inactive</span>' : ''}
              </div>
            </div>
          </div>

          <div class="prod-card-body">
            <div class="prod-card-cat">
              <span class="text-truncate"><i class="bi bi-tag me-1"></i>${Utils.esc(cat)}</span>
              <span class="text-muted fw-normal">Cost: ${Utils.money(p.cost)}/${Utils.esc(p.unit)}</span>
            </div>
            <div class="prod-card-title" data-act="batches" data-id="${Utils.esc(p.id)}" title="${Utils.esc(p.name)}">
              ${Utils.esc(p.name)}
            </div>
            <div class="cell-sub mb-2"><i class="bi bi-clock me-1"></i>Updated ${Utils.fmtDateTime(p.updatedAt)}</div>

            <div class="prod-card-metrics">
              <div>
                <div class="prod-metric-label">Available Stock</div>
                <div class="prod-metric-price">${Utils.num(p.stock)} <span class="fw-normal small text-muted">${Utils.esc(p.unit)}</span></div>
                <div class="cell-sub">${shelf.expiredQty > 0 ? `<span class="text-danger fw-semibold">${Utils.num(shelf.sellableQty)} usable</span>` : `Usable: ${Utils.num(shelf.sellableQty)}`}</div>
              </div>
              <div class="text-end">
                <div class="prod-metric-label">Reorder / Value</div>
                <div class="prod-metric-stock">≤ ${p.reorderLevel} <span class="fw-normal small text-muted">${Utils.esc(p.unit)}</span></div>
                <div class="cell-sub">Value: ${Utils.money(stockCostVal)}</div>
              </div>
            </div>

            <div class="prod-card-expiry">
              ${expiryBlock}
            </div>
          </div>

          <div class="prod-card-footer">
            <div class="d-flex gap-1">
              <button type="button" class="btn btn-soft btn-sm" data-act="in" data-id="${Utils.esc(p.id)}" title="Stock In (Add Batch)">
                <i class="bi bi-box-arrow-in-down me-1"></i>In
              </button>
              <button type="button" class="btn btn-light btn-sm" data-act="out" data-id="${Utils.esc(p.id)}" title="Stock Out (FEFO)">
                <i class="bi bi-box-arrow-up me-1"></i>Out
              </button>
            </div>
            <div class="d-flex gap-1">
              <button type="button" class="btn btn-light btn-sm ${shelf.expiredQty > 0 ? 'text-danger' : ''}" data-act="discard" data-id="${Utils.esc(p.id)}" title="Record Expired / Spoiled / Discarded Stock">
                <i class="bi bi-trash3"></i>
              </button>
              <button type="button" class="btn btn-light btn-sm" data-act="batches" data-id="${Utils.esc(p.id)}" title="View / Manage Batches (${shelf.batches.length})">
                <i class="bi bi-boxes"></i>
              </button>
              <button type="button" class="btn btn-light btn-sm" data-act="adjust" data-id="${Utils.esc(p.id)}" title="Stock Adjustment">
                <i class="bi bi-sliders"></i>
              </button>
              <button type="button" class="btn btn-light btn-sm" data-act="history" data-id="${Utils.esc(p.id)}" title="Movement History">
                <i class="bi bi-clock-history"></i>
              </button>
            </div>
          </div>
        </div>
      </div>`;
  },

  stockRowHTML(p) {
    const shelf = Utils.productShelfSummary(p);
    const eb = shelf.earliestBatch;
    const shelfCell = eb
      ? `<div class="d-flex align-items-center gap-1 flex-wrap">${Utils.shelfBadge(shelf.status)}
           <span class="small fw-semibold">${Utils.esc(eb.status.daysText)}</span></div>
         <div class="cell-sub">Exp: ${Utils.fmtDate(eb.expirationDate)} · ${shelf.batches.length} batch${shelf.batches.length === 1 ? '' : 'es'}${shelf.expiredQty > 0 ? ` · <span class="text-danger fw-semibold">${shelf.expiredQty} expired</span>` : ''}</div>`
      : '<span class="text-muted small">No active batches</span>';
    return `<tr>
      <td class="mono">${Utils.esc(p.id)}</td>
      <td><div class="d-flex align-items-center gap-2">${Utils.productThumb(p)}
        <div><div class="cell-title">${Utils.esc(p.name)}</div><div class="cell-sub">Cost: ${Utils.money(p.cost)}/${Utils.esc(p.unit)}</div></div></div></td>
      <td>${Utils.esc(this.catName(p.categoryId, p))}</td>
      <td class="text-end"><div class="fw-semibold">${Utils.num(p.stock)}</div>
        ${shelf.expiredQty > 0 ? `<div class="cell-sub text-danger">${Utils.num(shelf.sellableQty)} usable</div>` : ''}</td>
      <td class="text-end">${p.reorderLevel}</td>
      <td>${Utils.esc(p.unit)}</td>
      <td>${Utils.stockBadge(p)}</td>
      <td>${shelfCell}</td>
      <td class="small">${Utils.fmtDateTime(p.updatedAt)}</td>
      <td class="text-end text-nowrap">
        <button class="btn btn-soft btn-action" data-act="in" data-id="${p.id}" title="Stock In (New Batch)"><i class="bi bi-box-arrow-in-down"></i> In</button>
        <button class="btn btn-light btn-action" data-act="out" data-id="${p.id}" title="Stock Out (FEFO)"><i class="bi bi-box-arrow-up"></i> Out</button>
        <button class="btn btn-light btn-action ${shelf.expiredQty > 0 ? 'text-danger' : ''}" data-act="discard" data-id="${p.id}" title="Record Expired / Spoiled / Discarded Stock"><i class="bi bi-trash3"></i></button>
        <button class="btn btn-light btn-action" data-act="batches" data-id="${p.id}" title="View / Manage Batches (${shelf.batches.length})"><i class="bi bi-boxes"></i></button>
        <button class="btn btn-light btn-action" data-act="adjust" data-id="${p.id}" title="Stock Adjustment"><i class="bi bi-sliders"></i></button>
        <button class="btn btn-light btn-action" data-act="history" data-id="${p.id}" title="Movement History"><i class="bi bi-clock-history"></i></button>
      </td></tr>`;
  },

  /* ---------- Expiring Soon & Batches view ---------- */
  renderExpiringView() {
    const s = this.bstate;
    const th = Utils.expiryThresholds();
    const box = document.getElementById('inv-view');
    box.innerHTML = `<div class="card">
      <div class="card-body border-bottom">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div class="small text-muted">
            <i class="bi bi-info-circle me-1"></i>FEFO (First Expired, First Out) is active: sales and stock-outs automatically deduct from the earliest-expiring non-expired batch first.
            Warning thresholds: <span class="badge badge-soft-warning">Nearing ≤ ${th.near}d</span>
            <span class="badge badge-soft-orange">Very Soon ≤ ${th.verySoon}d</span>
            <span class="badge badge-soft-danger">Expired &lt; 0d</span>
          </div>
          ${Auth.can('settings') ? '<a href="#/settings" class="btn btn-sm btn-light"><i class="bi bi-sliders me-1"></i>Configure Warning Days</a>' : ''}
        </div>
        <div class="toolbar">
          <div class="search-box"><i class="bi bi-search"></i>
            <input type="search" class="form-control" id="bat-search" placeholder="Search product, batch ID or note…" value="${Utils.esc(s.search)}"></div>
          <div class="btn-group" role="group" id="bat-filter-group">
            <button type="button" class="btn btn-sm ${s.filter === 'all' ? 'btn-primary' : 'btn-light'}" data-bf="all">All Batches</button>
            <button type="button" class="btn btn-sm ${s.filter === 'attention' ? 'btn-primary' : 'btn-light'}" data-bf="attention">Needs Attention</button>
            <button type="button" class="btn btn-sm ${s.filter === 'expiring' ? 'btn-primary' : 'btn-light'}" data-bf="expiring">Expiring Soon</button>
            <button type="button" class="btn btn-sm ${s.filter === 'expired' ? 'btn-primary' : 'btn-light'}" data-bf="expired">Expired</button>
            <button type="button" class="btn btn-sm ${s.filter === 'safe' ? 'btn-primary' : 'btn-light'}" data-bf="safe">Safe</button>
          </div>
          <div class="ms-auto"><button class="btn btn-light" id="bat-export"><i class="bi bi-filetype-csv me-1"></i>Export Batches CSV</button></div>
        </div>
      </div>
      <div class="table-wrap"><table class="table table-hover"><thead><tr>
        <th>Batch ID</th><th>Product</th><th>Category</th><th>Date Received</th><th>Expiration Date</th>
        <th>Remaining Shelf Life</th><th>Status</th><th class="text-end">Batch Qty</th><th>Note</th><th class="text-end">Actions</th>
      </tr></thead><tbody id="bat-tbody"></tbody></table></div>
      <div id="bat-pager"></div>
    </div>`;

    box.querySelector('#bat-search').addEventListener('input', Utils.debounce(e => { s.search = e.target.value.trim(); s.page = 1; this.drawExpiringTable(); }));
    box.querySelector('#bat-filter-group').addEventListener('click', e => {
      const b = e.target.closest('[data-bf]');
      if (!b) return;
      s.filter = b.dataset.bf; s.page = 1;
      box.querySelectorAll('#bat-filter-group .btn').forEach(x => {
        x.classList.toggle('btn-primary', x === b);
        x.classList.toggle('btn-light', x !== b);
      });
      this.drawExpiringTable();
    });
    box.querySelector('#bat-export').addEventListener('click', () => this.exportBatchesCSV(this.filteredBatches()));
    Utils.bindPager(box.querySelector('#bat-pager'), p => { s.page = p; this.drawExpiringTable(); });
    box.querySelector('#bat-tbody').addEventListener('click', e => {
      const b = e.target.closest('[data-bdiscard]');
      if (!b) return;
      const p = this.products.find(x => x.id === b.dataset.pid);
      if (p) this.openStockForm(p, 'discard', b.dataset.bdiscard);
    });
    this.drawExpiringTable();
  },

  filteredBatches() {
    const s = this.bstate, q = s.search.toLowerCase();
    return this.allBatches().filter(b => {
      if (s.filter === 'attention' && b.status.key === 'safe') return false;
      if (s.filter === 'expiring' && b.status.group !== 'expiring') return false;
      if (s.filter === 'expired' && b.status.key !== 'expired') return false;
      if (s.filter === 'safe' && b.status.key !== 'safe') return false;
      if (!q) return true;
      return [b.id, b.productId, b.productName, b.categoryName, b.note, b.status.label].join(' ').toLowerCase().includes(q);
    });
  },

  drawExpiringTable() {
    const list = this.filteredBatches();
    const pg = Utils.paginate(list, this.bstate.page, Prefs.get('pageSize'));
    this.bstate.page = pg.page;
    document.getElementById('bat-tbody').innerHTML = pg.items.length ? pg.items.map(b => {
      const prod = this.products.find(x => x.id === b.productId) || { id: b.productId, name: b.productName };
      return `<tr>
      <td class="mono small">${Utils.esc(b.id)}</td>
      <td><div class="d-flex align-items-center gap-2">${Utils.productThumb(prod)}<div><div class="cell-title">${Utils.esc(b.productName)}</div><div class="cell-sub mono">${Utils.esc(b.productId)}</div></div></div></td>
      <td>${Utils.esc(b.categoryName)}</td>
      <td class="small">${Utils.fmtDate(b.dateReceived)}</td>
      <td class="small fw-semibold">${Utils.fmtDate(b.expirationDate)}</td>
      <td class="small fw-semibold ${b.status.key === 'expired' ? 'text-danger' : b.status.key === 'very-soon' ? 'text-orange' : ''}">${Utils.esc(b.status.daysText)}</td>
      <td>${Utils.shelfBadge(b.status)}</td>
      <td class="text-end fw-semibold">${Utils.num(b.qty)} <span class="cell-sub">${Utils.esc(b.unit)}</span></td>
      <td class="small text-muted">${Utils.esc(b.note || '—')}</td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm ${b.status.key === 'expired' ? 'btn-danger' : 'btn-light'} btn-action" data-bdiscard="${b.id}" data-pid="${b.productId}" title="Discard / Write Off from this batch">
          <i class="bi bi-trash3 me-1"></i>${b.status.key === 'expired' ? 'Discard Expired' : 'Discard'}
        </button>
      </td>
    </tr>`;
    }).join('') : Utils.emptyRow(10, 'check2-circle', 'No batches match this filter', 'All perishable batches are within safe shelf-life limits.');
    document.getElementById('bat-pager').innerHTML = Utils.pagerHTML(pg);
  },

  /* ---------- Product Batches Modal ---------- */
  openBatchesModal(p) {
    const shelf = Utils.productShelfSummary(p);
    const m = Utils.modal({
      title: `<i class="bi bi-boxes me-2"></i>Inventory Batches (FEFO) · ${Utils.esc(p.name)}`,
      size: 'lg',
      body: `
        <div class="d-flex flex-wrap align-items-center justify-content-between gap-3 p-3 rounded-3 mb-3" style="background:var(--brand-lighter)">
          <div class="d-flex align-items-center gap-3">
            ${Utils.productThumb(p)}
            <div>
              <div class="fw-semibold">${Utils.esc(p.name)} <span class="mono text-muted">(${Utils.esc(p.id)})</span></div>
              <div class="small text-muted">Total stock: <strong>${Utils.num(p.stock)} ${Utils.esc(p.unit)}</strong> · Sellable: <strong class="text-success">${Utils.num(shelf.sellableQty)} ${Utils.esc(p.unit)}</strong>${shelf.expiredQty > 0 ? ` · Expired: <strong class="text-danger">${Utils.num(shelf.expiredQty)} ${Utils.esc(p.unit)}</strong>` : ''}</div>
            </div>
          </div>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-sm btn-primary" id="bm-add-batch"><i class="bi bi-plus-lg me-1"></i>Add Batch (Stock In)</button>
            ${p.stock > 0 ? '<button type="button" class="btn btn-sm btn-outline-danger" id="bm-discard"><i class="bi bi-trash3 me-1"></i>Discard / Spoilage</button>' : ''}
          </div>
        </div>
        <div class="table-wrap"><table class="table table-sm table-hover">
          <thead><tr><th>FEFO Order</th><th>Batch ID</th><th>Date Received</th><th>Expiration Date</th><th>Shelf Life</th><th>Status</th><th class="text-end">Qty</th><th>Note</th><th class="text-end">Action</th></tr></thead>
          <tbody>${shelf.batches.length ? shelf.batches.map((b, i) => `<tr>
            <td><span class="badge badge-soft-secondary">#${i + 1}</span></td>
            <td class="mono small">${Utils.esc(b.id)}</td>
            <td class="small">${Utils.fmtDate(b.dateReceived)}</td>
            <td class="small fw-semibold">${Utils.fmtDate(b.expirationDate)}</td>
            <td class="small">${Utils.esc(b.status.daysText)}</td>
            <td>${Utils.shelfBadge(b.status)}</td>
            <td class="text-end fw-semibold">${Utils.num(b.qty)} ${Utils.esc(p.unit)}</td>
            <td class="small text-muted">${Utils.esc(b.note || '—')}</td>
            <td class="text-end"><button class="btn btn-light btn-action text-danger" data-bm-discard="${b.id}" title="Discard from this batch"><i class="bi bi-trash3"></i></button></td>
          </tr>`).join('') : Utils.emptyRow(9, 'boxes', 'No active batches for this product')}</tbody>
        </table></div>`,
      footer: '<button class="btn btn-light" data-bs-dismiss="modal">Close</button>'
    });
    m.el.querySelector('#bm-add-batch').addEventListener('click', () => { m.close(); setTimeout(() => this.openStockForm(p, 'in'), 250); });
    const discBtn = m.el.querySelector('#bm-discard');
    if (discBtn) discBtn.addEventListener('click', () => { m.close(); setTimeout(() => this.openStockForm(p, 'discard'), 250); });
    m.el.querySelectorAll('[data-bm-discard]').forEach(btn => btn.addEventListener('click', () => {
      const bid = btn.dataset.bmDiscard;
      m.close();
      setTimeout(() => this.openStockForm(p, 'discard', bid), 250);
    }));
  },

  /* ---------- Add / Edit Raw Ingredient ---------- */
  openIngredientForm(ing = null) {
    const isEdit = !!ing;
    const nextId = isEdit ? ing.id : Utils.nextId('ING-', this.products.map(p => p.id), 3);
    const todayStr = Utils.dateKey(new Date());
    const defaultExpStr = Utils.dateKey(Utils.addDays(new Date(), 14));
    let imageData = ing ? (ing.image || (typeof Prefs !== 'undefined' && Prefs.defaultFoodImage ? Prefs.defaultFoodImage(ing) : '')) : '';

    const m = Utils.modal({
      title: `<i class="bi bi-${isEdit ? 'pencil-square' : 'plus-circle'} me-2"></i>${isEdit ? 'Edit Raw Ingredient' : 'Add Raw Ingredient'}`,
      size: 'lg',
      body: `<form id="ing-form" novalidate>
        <div class="row g-3">
          <div class="col-md-4"><label class="form-label">Ingredient ID</label>
            <input class="form-control mono" name="id" value="${Utils.esc(nextId)}" readonly></div>
          <div class="col-md-8"><label class="form-label required">Ingredient Name</label>
            <input class="form-control" name="name" maxlength="80" value="${Utils.esc(ing ? ing.name : '')}" placeholder="e.g. Burger Buns, Mozzarella Cheese"></div>
          <div class="col-md-6"><label class="form-label required">Category</label>
            <select class="form-select" name="categoryId">
              <option value="">Select category…</option>
              ${this.categories.map(c => `<option value="${c.id}" ${ing && ing.categoryId === c.id ? 'selected' : ''}>${Utils.esc(c.name)}</option>`).join('')}
            </select></div>
          <div class="col-md-3"><label class="form-label required">Unit</label>
            <select class="form-select" name="unit">
              ${this.UNITS.map(u => `<option value="${u}" ${ing && ing.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select></div>
          <div class="col-md-3"><label class="form-label required">Unit Cost</label>
            <div class="input-group"><span class="input-group-text">${Utils.currencySymbol()}</span>
              <input type="number" step="0.01" min="0" class="form-control" name="cost" value="${ing ? ing.cost : ''}"></div></div>
          <div class="col-md-4"><label class="form-label required">${isEdit ? 'Current Stock' : 'Initial Batch Qty'}</label>
            <input type="number" step="1" min="0" class="form-control" name="stock" value="${ing ? ing.stock : 0}" ${isEdit ? 'readonly' : ''}></div>
          <div class="col-md-4"><label class="form-label required">Reorder Level</label>
            <input type="number" step="1" min="0" class="form-control" name="reorderLevel" value="${ing ? ing.reorderLevel : 10}"></div>
          <div class="col-md-4"><label class="form-label">Default Shelf Life (Days)</label>
            <input type="number" step="1" min="1" max="3650" class="form-control" name="defaultShelfLifeDays" value="${ing && ing.defaultShelfLifeDays ? ing.defaultShelfLifeDays : 14}"></div>
          ${!isEdit ? `
            <div class="col-md-6"><label class="form-label required">Date Received</label>
              <input type="date" class="form-control" name="dateReceived" value="${todayStr}"></div>
            <div class="col-md-6"><label class="form-label required">Initial Batch Expiration Date</label>
              <input type="date" class="form-control" name="expirationDate" value="${defaultExpStr}"></div>
          ` : ''}
          <div class="col-md-8"><label class="form-label">Description / Storage Notes</label>
            <input class="form-control" name="description" maxlength="200" value="${Utils.esc(ing ? ing.description : '')}" placeholder="Storage temperature or supplier notes"></div>
          <div class="col-md-4"><label class="form-label">Photo (optional)</label>
            <input type="file" accept="image/*" class="form-control" id="ing-img"></div>
        </div></form>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary" id="ing-save"><i class="bi bi-check2 me-1"></i>${isEdit ? 'Save Changes' : 'Save Ingredient'}</button>`
    });

    const form = m.el.querySelector('#ing-form');
    m.el.querySelector('#ing-img').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try { imageData = await Utils.readImageFile(f); } catch (err) { Utils.toast(err.message, 'danger'); }
    });

    m.el.querySelector('#ing-save').addEventListener('click', async () => {
      const d = Utils.formData(form), errors = {};
      if (!d.name) errors.name = 'Ingredient name is required.';
      if (!d.categoryId) errors.categoryId = 'Select a category.';
      if (!Utils.isNonNegNumber(d.cost)) errors.cost = 'Enter a valid unit cost.';
      if (!Utils.isWholeNumber(d.stock)) errors.stock = 'Enter a whole number.';
      if (!Utils.isWholeNumber(d.reorderLevel)) errors.reorderLevel = 'Enter a whole number.';
      if (!Utils.showErrors(form, errors)) return;

      const now = new Date().toISOString();
      const stock = parseInt(d.stock, 10);
      const catObj = this.categories.find(c => c.id === d.categoryId);
      const shelfDays = parseInt(d.defaultShelfLifeDays, 10) > 0 ? parseInt(d.defaultShelfLifeDays, 10) : 14;
      const rec = {
        id: nextId,
        name: d.name,
        categoryId: d.categoryId,
        categoryName: catObj ? catObj.name : 'Kitchen Supply',
        cost: Utils.round2(d.cost),
        price: Utils.round2(d.cost),
        stock,
        reorderLevel: parseInt(d.reorderLevel, 10),
        unit: d.unit || 'pc',
        description: d.description,
        status: 'active',
        isIngredient: true,
        image: imageData || (typeof Prefs !== 'undefined' && Prefs.defaultFoodImage ? Prefs.defaultFoodImage({ id: nextId, name: d.name, isIngredient: true }) : '') || 'assets/images/ingredients/placeholder-ingredient.svg',
        defaultShelfLifeDays: shelfDays,
        batches: isEdit ? (ing.batches || []) : (stock > 0 ? [{
          id: `${nextId}-B01`,
          dateReceived: d.dateReceived || todayStr,
          expirationDate: d.expirationDate || defaultExpStr,
          qty: stock,
          initialQty: stock,
          note: 'Initial ingredient batch'
        }] : []),
        createdAt: isEdit ? ing.createdAt : now,
        updatedAt: now
      };

      await DB.run(['products', 'movements'], 'readwrite', async tx => {
        tx.objectStore('products').put(rec);
        if (!isEdit && stock > 0) {
          const ms = tx.objectStore('movements');
          const mid = await DB.nextIdIn(ms, 'MOV-', 6);
          ms.add(this.buildMovement({
            id: mid, product: rec, type: 'Initial Stock', quantity: stock,
            previousStock: 0, newStock: stock, reason: 'Initial ingredient batch',
            date: now, batchId: `${nextId}-B01`, dateReceived: d.dateReceived || todayStr, expirationDate: d.expirationDate || defaultExpStr
          }));
        }
      });
      Utils.toast(`Ingredient "${rec.name}" saved.`);
      m.close();
      await this.load();
      App.dataChanged();
    });
  },

  /* ---------- Stock In / Out / Discard / Adjustment ---------- */
  openStockForm(p, mode, preselectedBatchId = '') {
    const cfg = {
      in: { title: 'Stock In (Add Perishable Batch)', icon: 'box-arrow-in-down', btn: 'Add Stock Batch' },
      out: { title: 'Stock Out (FEFO Deduction)', icon: 'box-arrow-up', btn: 'Remove Stock' },
      discard: { title: 'Record Expired / Spoiled / Discarded Stock', icon: 'trash3', btn: 'Confirm Discard' },
      adjust: { title: 'Stock Adjustment', icon: 'sliders', btn: 'Save Adjustment' }
    }[mode];
    const sups = this.suppliers.filter(s => s.status === 'active');
    const linked = sups.filter(s => (s.productIds || []).includes(p.id));
    const shelf = Utils.productShelfSummary(p);
    const todayStr = Utils.dateKey(new Date());
    const defaultExpStr = Utils.dateKey(Utils.addDays(new Date(), Number(p.defaultShelfLifeDays) > 0 ? Number(p.defaultShelfLifeDays) : 7));
    const selectedBatch = preselectedBatchId ? shelf.batches.find(b => b.id === preselectedBatchId) : null;

    const m = Utils.modal({
      title: `<i class="bi bi-${cfg.icon} me-2"></i>${cfg.title}`,
      body: `<div class="d-flex align-items-center gap-3 p-3 rounded-3 mb-3" style="background:var(--brand-lighter)">${Utils.productThumb(p)}
          <div class="flex-grow-1"><div class="fw-semibold">${Utils.esc(p.name)}</div>
            <div class="cell-sub">${Utils.esc(p.id)} · Reorder level ${p.reorderLevel} · ${shelf.batches.length} active batch(es)</div></div>
          <div class="text-end"><div class="cell-sub">Current stock</div><div class="fs-5 fw-bold">${Utils.num(p.stock)} <span class="fs-6 fw-normal">${Utils.esc(p.unit)}</span></div></div></div>
        <form id="stock-form" novalidate><div class="row g-3">
          ${(mode === 'out' || mode === 'discard') && shelf.batches.length ? `
            <div class="col-12">
              <label class="form-label">Batch Selection</label>
              <select class="form-select" name="batchId" id="stock-batch-sel">
                <option value="">Automatic FEFO (Earliest-expiring batch first)</option>
                ${shelf.batches.map(b => `<option value="${b.id}" ${b.id === preselectedBatchId ? 'selected' : ''}>
                  ${Utils.esc(b.id)} · Exp ${Utils.fmtDate(b.expirationDate)} (${Utils.esc(b.status.label)} — ${Utils.esc(b.status.daysText)}) · Qty: ${b.qty} ${Utils.esc(p.unit)}
                </option>`).join('')}
              </select>
            </div>` : ''}
          <div class="col-sm-6"><label class="form-label required">${mode === 'adjust' ? 'New (counted) stock' : 'Quantity'}</label>
            <input type="number" class="form-control" name="qty" min="0" step="1" ${mode === 'out' || mode === 'discard' ? `max="${p.stock}"` : ''} value="${selectedBatch ? selectedBatch.qty : ''}" autofocus></div>
          <div class="col-sm-6"><label class="form-label">Resulting stock</label><input class="form-control" id="result-stock" readonly value="${p.stock}"></div>
          ${mode === 'in' ? `
            <div class="col-sm-6"><label class="form-label required">Date Received</label>
              <input type="date" class="form-control" name="dateReceived" value="${todayStr}"></div>
            <div class="col-sm-6"><label class="form-label required">Expiration Date</label>
              <input type="date" class="form-control" name="expirationDate" value="${defaultExpStr}">
              <div class="form-text" id="shelf-preview"></div></div>` : ''}
          <div class="col-12"><label class="form-label required">Reason</label>
            <select class="form-select" name="reason"><option value="">Select reason…</option>${this.REASONS[mode].map((r, i) => `<option ${mode === 'discard' && i === 0 ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
          ${mode === 'in' ? `<div class="col-12"><label class="form-label">Supplier (optional)</label>
            <select class="form-select" name="supplier"><option value="">— None —</option>
            ${linked.map(s => `<option value="${Utils.esc(s.name)}">${Utils.esc(s.name)} (supplies this item)</option>`).join('')}
            ${sups.filter(s => !linked.includes(s)).map(s => `<option value="${Utils.esc(s.name)}">${Utils.esc(s.name)}</option>`).join('')}</select></div>` : ''}
          <div class="col-12"><label class="form-label">Notes / Batch Label</label><input class="form-control" name="notes" maxlength="120" placeholder="Optional batch note or details"></div>
        </div></form>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
        <button class="btn ${mode === 'discard' ? 'btn-danger' : 'btn-primary'}" id="stock-save">${cfg.btn}</button>`
    });
    const form = m.el.querySelector('#stock-form');
    const calc = () => {
      const q = parseInt(form.qty.value, 10);
      if (isNaN(q)) { m.el.querySelector('#result-stock').value = p.stock; return; }
      m.el.querySelector('#result-stock').value = mode === 'in' ? p.stock + q : (mode === 'out' || mode === 'discard') ? p.stock - q : q;
    };
    form.qty.addEventListener('input', calc);
    calc();

    const batchSel = m.el.querySelector('#stock-batch-sel');
    if (batchSel && mode === 'discard') {
      batchSel.addEventListener('change', () => {
        const b = shelf.batches.find(x => x.id === batchSel.value);
        if (b) { form.qty.value = b.qty; calc(); }
      });
    }

    if (mode === 'in') {
      const updatePreview = () => {
        const st = Utils.batchShelfStatus(form.expirationDate.value);
        m.el.querySelector('#shelf-preview').innerHTML = `Shelf life: <strong>${Utils.esc(st.daysText)}</strong> (${Utils.esc(st.label)})`;
      };
      form.expirationDate.addEventListener('change', updatePreview);
      updatePreview();
    }

    form.addEventListener('submit', e => { e.preventDefault(); m.el.querySelector('#stock-save').click(); });
    m.el.querySelector('#stock-save').addEventListener('click', async ev => {
      const d = Utils.formData(form), errors = {};
      if (!Utils.isWholeNumber(d.qty)) errors.qty = 'Enter a whole number of 0 or more.';
      else {
        const q = parseInt(d.qty, 10);
        if (mode !== 'adjust' && q <= 0) errors.qty = 'Quantity must be greater than 0.';
        if ((mode === 'out' || mode === 'discard') && q > p.stock) errors.qty = `Cannot remove more than the available stock (${p.stock}).`;
        if (mode === 'adjust' && q === p.stock) errors.qty = 'The counted stock is the same as the current stock.';
        if (q > 1000000) errors.qty = 'Quantity is too large.';
      }
      if (mode === 'in') {
        if (!d.dateReceived) errors.dateReceived = 'Date received is required.';
        if (!d.expirationDate) errors.expirationDate = 'Expiration date is required.';
        else if (d.dateReceived && d.expirationDate < d.dateReceived) errors.expirationDate = 'Expiration date cannot be earlier than Date Received.';
      }
      if (!d.reason) errors.reason = 'Please select a reason.';
      if (!Utils.showErrors(form, errors)) return;
      let reason = d.reason;
      if (d.supplier) reason += ' - ' + d.supplier;
      if (d.notes) reason += ' (' + d.notes + ')';
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const res = await this.applyChange(p.id, mode, parseInt(d.qty, 10), reason, {
          dateReceived: d.dateReceived || '',
          expirationDate: d.expirationDate || '',
          batchId: d.batchId || '',
          note: d.notes || d.reason
        });
        Utils.toast(`${cfg.title} recorded. ${p.name}: ${res.previousStock} → ${res.newStock} ${p.unit}.`);
        m.close();
        await this.load();
        App.dataChanged();
      } catch (err) {
        Utils.toast(DB.friendlyError(err), 'danger');
        btn.disabled = false;
      }
    });
  },

  /**
   * Applies a stock change + batch update + movement record in ONE IndexedDB transaction.
   * Supports modes: 'in', 'out', 'discard', 'adjust'.
   */
  applyChange(productId, mode, qty, reason, opts = {}) {
    return DB.run(['products', 'movements'], 'readwrite', async tx => {
      const ps = tx.objectStore('products'), ms = tx.objectStore('movements');
      const p = await DB.req(ps.get(productId));
      if (!p) throw new Error('Product no longer exists.');
      const now = new Date();
      const nowIso = now.toISOString();
      Utils.ensureProductBatches(p, now);

      const prev = p.stock;
      const isOut = mode === 'out' || mode === 'discard';
      const next = mode === 'in' ? prev + qty : isOut ? prev - qty : qty;
      if (next < 0) throw new Error(`Insufficient stock. Only ${prev} ${p.unit} available.`);

      let batchId = opts.batchId || '';
      let dateReceived = opts.dateReceived || Utils.dateKey(now);
      let expirationDate = opts.expirationDate || '';

      if (mode === 'in') {
        if (!expirationDate) {
          const days = Number(p.defaultShelfLifeDays) > 0 ? Number(p.defaultShelfLifeDays) : 7;
          expirationDate = Utils.dateKey(Utils.addDays(Utils.parseDate(dateReceived) || now, days));
        }
        batchId = Utils.nextId(`${p.id}-B`, (p.batches || []).map(b => b.id), 2);
        p.batches.push({
          id: batchId,
          dateReceived,
          expirationDate,
          qty,
          initialQty: qty,
          note: opts.note || reason || 'Stock In'
        });
        p.batches = Utils.sortBatchesFEFO(p.batches);
        p.stock = p.batches.reduce((s, b) => s + b.qty, 0);
      } else if (isOut) {
        const res = Utils.deductBatchesFEFO(p, qty, { allowExpired: true, batchId, refDate: now });
        if (res.allocations.length) {
          batchId = res.allocations.map(a => a.batchId).join(', ');
          expirationDate = res.allocations[0].expirationDate || '';
        }
      } else if (mode === 'adjust') {
        if (next > prev) {
          const added = next - prev;
          const days = Number(p.defaultShelfLifeDays) > 0 ? Number(p.defaultShelfLifeDays) : 7;
          expirationDate = opts.expirationDate || Utils.dateKey(Utils.addDays(now, days));
          batchId = Utils.nextId(`${p.id}-B`, (p.batches || []).map(b => b.id), 2);
          p.batches.push({
            id: batchId,
            dateReceived,
            expirationDate,
            qty: added,
            initialQty: added,
            note: reason || 'Stock adjustment'
          });
          p.batches = Utils.sortBatchesFEFO(p.batches);
          p.stock = p.batches.reduce((s, b) => s + b.qty, 0);
        } else if (next < prev) {
          const res = Utils.deductBatchesFEFO(p, prev - next, { allowExpired: true, batchId, refDate: now });
          if (res.allocations.length) batchId = res.allocations.map(a => a.batchId).join(', ');
        }
      }

      const typeLabel = mode === 'in'
        ? 'Stock In'
        : mode === 'discard'
          ? 'Expired / Discarded'
          : mode === 'out'
            ? 'Stock Out'
            : 'Adjustment';

      const mv = this.buildMovement({
        id: await DB.nextIdIn(ms, 'MOV-', 6),
        product: p,
        type: typeLabel,
        quantity: Math.abs(next - prev),
        previousStock: prev,
        newStock: p.stock,
        reason: batchId && !String(reason).includes(batchId) ? `${reason} [Batch: ${batchId}]` : reason,
        date: nowIso,
        batchId,
        dateReceived,
        expirationDate
      });
      p.updatedAt = nowIso;
      await DB.req(ps.put(p));
      await DB.req(ms.add(mv));
      return mv;
    });
  },

  /* ---------- Movement history ---------- */
  renderHistory() {
    const s = this.mstate;
    const box = document.getElementById('inv-view');
    box.innerHTML = `<div class="card">
      <div class="card-body border-bottom"><div class="toolbar">
        <div class="search-box"><i class="bi bi-search"></i><input type="search" class="form-control" id="mv-search" placeholder="Search product, movement ID, batch or reason…" value="${Utils.esc(s.search)}"></div>
        <select class="form-select" id="mv-type"><option value="">All movement types</option>${this.TYPES.map(t => `<option>${t}</option>`).join('')}</select>
        <input type="date" class="form-control" id="mv-from" value="${s.from}" title="From date">
        <input type="date" class="form-control" id="mv-to" value="${s.to}" title="To date">
        <div class="ms-auto d-flex gap-2"><button class="btn btn-light" id="mv-clear">Clear</button>
          <button class="btn btn-light" id="mv-export"><i class="bi bi-filetype-csv me-1"></i>Export CSV</button></div>
      </div></div>
      <div class="table-wrap"><table class="table table-hover"><thead><tr><th>Movement ID</th><th>Date & Time</th><th>Product</th><th>Type</th>
        <th class="text-end">Quantity</th><th class="text-end">Previous</th><th class="text-end">New</th><th>Reason / Batch</th><th>By</th></tr></thead>
        <tbody id="mv-tbody"></tbody></table></div><div id="mv-pager"></div></div>`;
    box.querySelector('#mv-type').value = s.type;
    box.querySelector('#mv-search').addEventListener('input', Utils.debounce(e => { s.search = e.target.value.trim(); s.page = 1; this.drawHistory(); }));
    box.querySelector('#mv-type').addEventListener('change', e => { s.type = e.target.value; s.page = 1; this.drawHistory(); });
    box.querySelector('#mv-from').addEventListener('change', e => { s.from = e.target.value; s.page = 1; this.drawHistory(); });
    box.querySelector('#mv-to').addEventListener('change', e => { s.to = e.target.value; s.page = 1; this.drawHistory(); });
    box.querySelector('#mv-clear').addEventListener('click', () => { this.mstate = { search: '', type: '', from: '', to: '', page: 1 }; this.renderHistory(); });
    box.querySelector('#mv-export').addEventListener('click', () => this.exportMovementsCSV(this.filteredHistory()));
    Utils.bindPager(box.querySelector('#mv-pager'), p => { s.page = p; this.drawHistory(); });
    this.drawHistory();
  },

  filteredHistory() {
    const s = this.mstate, q = s.search.toLowerCase();
    return this.movements.filter(m =>
      (!q || [m.id, m.productId, m.productName, m.reason, m.refId, m.batchId].join(' ').toLowerCase().includes(q)) &&
      (!s.type || m.type === s.type) && Utils.inDateRange(m.date, s.from, s.to));
  },

  drawHistory() {
    const list = this.filteredHistory();
    const pg = Utils.paginate(list, this.mstate.page, Prefs.get('pageSize'));
    this.mstate.page = pg.page;
    document.getElementById('mv-tbody').innerHTML = pg.items.length ? pg.items.map(m => `<tr>
        <td class="mono small">${Utils.esc(m.id)}</td><td class="small text-nowrap">${Utils.fmtDateTime(m.date)}</td>
        <td><div class="cell-title small">${Utils.esc(m.productName)}</div><div class="cell-sub">${Utils.esc(m.productId)}</div></td>
        <td>${this.typeBadge(m.type)}</td><td class="text-end">${this.signedQty(m)}</td>
        <td class="text-end">${Utils.num(m.previousStock)}</td><td class="text-end fw-semibold">${Utils.num(m.newStock)}</td>
        <td class="small"><div class="text-nowrap-ellipsis" title="${Utils.esc(m.reason)}">${Utils.esc(m.reason)}</div></td>
        <td class="small text-nowrap">${Utils.esc(m.userName || '')}</td></tr>`).join('')
      : Utils.emptyRow(9, 'clock-history', 'No movements found', 'Stock changes and sales will be recorded here.');
    document.getElementById('mv-pager').innerHTML = Utils.pagerHTML(pg);
  },

  /* ---------- CSV ---------- */
  async exportStockCSV(list) {
    if (!list) { [this.products, this.categories] = await Promise.all([DB.getAll('products'), DB.getAll('categories')]); list = this.products; }
    Utils.exportCSV(`inventory-${Utils.stamp()}.csv`, [
      { label: 'Product ID', key: 'id' }, { label: 'Product Name', key: 'name' }, { label: 'Category', value: p => this.catName(p.categoryId) },
      { label: 'Available Stock', key: 'stock' }, { label: 'Sellable Stock', value: p => Utils.sellableStock(p) },
      { label: 'Expired Stock', value: p => Utils.productShelfSummary(p).expiredQty },
      { label: 'Reorder Level', key: 'reorderLevel' }, { label: 'Unit', key: 'unit' },
      { label: 'Stock Status', value: p => Utils.stockStatus(p).label },
      { label: 'Shelf-Life Status', value: p => Utils.productShelfSummary(p).status.label },
      { label: 'Earliest Expiration Date', value: p => (Utils.productShelfSummary(p).earliestBatch || {}).expirationDate || '' },
      { label: 'Remaining Shelf Life', value: p => (Utils.productShelfSummary(p).earliestBatch || { status: {} }).status.daysText || '' },
      { label: 'Unit Cost', key: 'cost' },
      { label: 'Stock Value (Cost)', value: p => Utils.round2(p.stock * p.cost) }, { label: 'Last Updated', value: p => Utils.fmtDateTime(p.updatedAt) }
    ], list);
  },
  async exportBatchesCSV(list) {
    if (!list) { await this.load(); list = this.allBatches(); }
    Utils.exportCSV(`inventory-batches-${Utils.stamp()}.csv`, [
      { label: 'Batch ID', key: 'id' },
      { label: 'Product ID', key: 'productId' },
      { label: 'Product Name', key: 'productName' },
      { label: 'Category', key: 'categoryName' },
      { label: 'Date Received', key: 'dateReceived' },
      { label: 'Expiration Date', key: 'expirationDate' },
      { label: 'Remaining Days', value: b => b.status.days ?? '' },
      { label: 'Shelf-Life Status', value: b => b.status.label },
      { label: 'Quantity', key: 'qty' },
      { label: 'Unit', key: 'unit' },
      { label: 'Note', key: 'note' }
    ], list);
  },
  async exportMovementsCSV(list) {
    if (!list) list = (await DB.getAll('movements')).sort((a, b) => b.date.localeCompare(a.date));
    Utils.exportCSV(`inventory-movements-${Utils.stamp()}.csv`, [
      { label: 'Movement ID', key: 'id' }, { label: 'Date and Time', value: m => Utils.fmtDateTime(m.date) },
      { label: 'Product ID', key: 'productId' }, { label: 'Product', key: 'productName' }, { label: 'Movement Type', key: 'type' },
      { label: 'Quantity', key: 'quantity' }, { label: 'Change', value: m => m.newStock - m.previousStock },
      { label: 'Previous Stock', key: 'previousStock' }, { label: 'New Stock', key: 'newStock' },
      { label: 'Batch ID', key: 'batchId' }, { label: 'Expiration Date', key: 'expirationDate' },
      { label: 'Reason', key: 'reason' }, { label: 'Reference', key: 'refId' }, { label: 'Recorded By', key: 'userName' }
    ], list);
  }
};

/* =========================================================
   products.js - Finished Menu Item Management (Responsive Card
   Grid & List Views, CRUD, categories, images, and servings)
   ========================================================= */
'use strict';

const Products = {
  title: 'Products',
  subtitle: 'Manage finished menu items, prices, categories, photos and available servings',
  state: { search: '', category: '', availability: '', status: '', sort: 'name-asc', viewMode: 'grid', page: 1 },
  products: [],
  categories: [],
  UNITS: ['pc', 'serving', 'cup', 'slice', 'plate', 'box', 'bottle', 'pack', 'bowl', 'set'],

  async render(el) {
    const savedMode = Prefs.get('productViewMode');
    if (savedMode === 'grid' || savedMode === 'list') this.state.viewMode = savedMode;
    const s = this.state;

    el.innerHTML = `
      <!-- Top Controls Card -->
      <div class="card mb-3">
        <div class="card-body">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 pb-2 border-bottom">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold"><i class="bi bi-grid-3x3-gap text-primary me-1"></i>Menu Catalog</span>
              <span class="badge badge-soft-secondary" id="prod-count-badge">0 products</span>
            </div>
            <div class="d-flex gap-2 flex-wrap align-items-center">
              <div class="btn-group prod-view-toggle" id="prod-view-toggle" role="group" aria-label="Switch product view">
                <button type="button" class="btn btn-sm ${s.viewMode === 'grid' ? 'btn-primary' : 'btn-light'}" data-vmode="grid" title="Grid View">
                  <i class="bi bi-grid-3x3-gap-fill me-1"></i>Grid
                </button>
                <button type="button" class="btn btn-sm ${s.viewMode === 'list' ? 'btn-primary' : 'btn-light'}" data-vmode="list" title="List View">
                  <i class="bi bi-list-ul me-1"></i>List
                </button>
              </div>
              <button class="btn btn-light btn-sm" id="prod-cats"><i class="bi bi-tags me-1"></i>Categories</button>
              <button class="btn btn-light btn-sm" id="prod-export"><i class="bi bi-filetype-csv me-1"></i>Export CSV</button>
              <button class="btn btn-primary" id="prod-add"><i class="bi bi-plus-lg me-1"></i>Add Product</button>
            </div>
          </div>

          <div class="toolbar">
            <div class="search-box"><i class="bi bi-search"></i>
              <input type="search" class="form-control" id="prod-search" placeholder="Search by product name or SKU / ID…" value="${Utils.esc(s.search)}"></div>
            <select class="form-select" id="prod-cat" aria-label="Filter by category"></select>
            <select class="form-select" id="prod-avail" aria-label="Filter by stock status">
              <option value="">All stock status</option>
              <option value="in">In Stock</option>
              <option value="low">Low Stock</option>
              <option value="out">Out of Stock</option>
            </select>
            <select class="form-select" id="prod-status" aria-label="Filter by active status">
              <option value="">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select class="form-select" id="prod-sort" aria-label="Sort products">
              <option value="name-asc">Sort: Name (A–Z)</option>
              <option value="name-desc">Sort: Name (Z–A)</option>
              <option value="price-asc">Sort: Price (Low–High)</option>
              <option value="price-desc">Sort: Price (High–Low)</option>
              <option value="stock-asc">Sort: Quantity (Low–High)</option>
              <option value="stock-desc">Sort: Quantity (High–Low)</option>
              <option value="id-asc">Sort: Product ID / SKU</option>
              <option value="newest">Sort: Newest First</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Products Display Container (Grid or List) -->
      <div id="prod-display"></div>
      <div class="card mt-3"><div id="prod-pager"></div></div>`;

    el.querySelector('#prod-avail').value = s.availability;
    el.querySelector('#prod-status').value = s.status;
    if (!['name-asc', 'name-desc', 'price-asc', 'price-desc', 'stock-asc', 'stock-desc', 'id-asc', 'newest'].includes(s.sort)) {
      s.sort = 'name-asc';
    }
    el.querySelector('#prod-sort').value = s.sort;

    el.querySelector('#prod-search').addEventListener('input', Utils.debounce(e => {
      s.search = e.target.value.trim();
      s.page = 1;
      this.renderTable();
    }));

    [['#prod-cat', 'category'], ['#prod-avail', 'availability'], ['#prod-status', 'status'], ['#prod-sort', 'sort']].forEach(([sel, key]) =>
      el.querySelector(sel).addEventListener('change', e => {
        s[key] = e.target.value;
        s.page = 1;
        this.renderTable();
      }));

    el.querySelector('#prod-view-toggle').addEventListener('click', e => {
      const btn = e.target.closest('[data-vmode]');
      if (!btn) return;
      s.viewMode = btn.dataset.vmode;
      Prefs.set('productViewMode', s.viewMode);
      el.querySelectorAll('#prod-view-toggle .btn').forEach(b => {
        b.classList.toggle('btn-primary', b === btn);
        b.classList.toggle('btn-light', b !== btn);
      });
      this.renderTable();
    });

    el.querySelector('#prod-add').addEventListener('click', () => this.openForm());
    el.querySelector('#prod-cats').addEventListener('click', () => this.manageCategories());
    el.querySelector('#prod-export').addEventListener('click', () => this.exportCSV(this.filtered()));
    Utils.bindPager(el.querySelector('#prod-pager'), p => { s.page = p; this.renderTable(); });

    el.querySelector('#prod-display').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const p = this.products.find(x => x.id === b.dataset.id);
      if (!p) return;
      if (b.dataset.act === 'view') this.view(p);
      if (b.dataset.act === 'edit') this.openForm(p);
      if (b.dataset.act === 'delete') this.remove(p);
    });

    await this.load();
  },

  async load() {
    if (typeof Prefs !== 'undefined' && typeof Prefs.syncProductImages === 'function') {
      await Prefs.syncProductImages();
    }
    const [allProducts, categories] = await Promise.all([DB.getAll('products'), DB.getAll('categories')]);
    // Products module strictly shows finished menu items (excludes raw ingredients)
    this.products = allProducts.filter(p => !p.isIngredient && !String(p.id || '').startsWith('ING-'));
    this.products.forEach(p => {
      if (!p.image && typeof Prefs !== 'undefined' && Prefs.defaultFoodImage) {
        p.image = Prefs.defaultFoodImage(p) || '';
      }
    });
    this.categories = categories.sort((a, b) => a.name.localeCompare(b.name));
    const sel = document.getElementById('prod-cat');
    if (sel) {
      if (this.state.category && !this.categories.some(c => c.id === this.state.category)) this.state.category = '';
      sel.innerHTML = '<option value="">All categories</option>' + this.categories.map(c => `<option value="${c.id}">${Utils.esc(c.name)}</option>`).join('');
      sel.value = this.state.category;
    }
    this.renderTable();
  },

  catName(id) { const c = this.categories.find(x => x.id === id); return c ? c.name : 'Uncategorized'; },

  filtered() {
    const s = this.state, q = s.search.toLowerCase();
    const list = this.products.filter(p =>
      (!q || [p.id, p.name, p.description, this.catName(p.categoryId)].join(' ').toLowerCase().includes(q)) &&
      (!s.category || p.categoryId === s.category) &&
      (!s.availability || Utils.stockStatus(p).key === s.availability) &&
      (!s.status || p.status === s.status));

    const [field, dir] = (s.sort || 'name-asc').split('-');
    const m = dir === 'desc' ? -1 : 1;
    list.sort((a, b) => {
      if (s.sort === 'newest') return (b.createdAt || '').localeCompare(a.createdAt || '');
      if (field === 'name' || field === 'id') return String(a[field] || '').localeCompare(String(b[field] || '')) * m;
      return ((Number(a[field]) || 0) - (Number(b[field]) || 0)) * m || a.name.localeCompare(b.name);
    });
    return list;
  },

  /** Renders either the responsive Product Card Grid or the List View table. */
  renderTable() {
    const display = document.getElementById('prod-display');
    if (!display) return;
    const list = this.filtered();
    const countBadge = document.getElementById('prod-count-badge');
    if (countBadge) {
      countBadge.textContent = `${list.length} of ${this.products.length} product${this.products.length === 1 ? '' : 's'}`;
    }

    const baseSize = Prefs.get('pageSize') || 10;
    const pageSize = this.state.viewMode === 'grid' ? Math.max(12, baseSize) : baseSize;
    const pg = Utils.paginate(list, this.state.page, pageSize);
    this.state.page = pg.page;

    if (this.state.viewMode === 'list') {
      display.innerHTML = `
        <div class="card">
          <div class="table-wrap">
            <table class="table table-hover" id="prod-list-table">
              <thead><tr>
                <th>Product</th><th>SKU / ID</th><th>Category</th>
                <th class="text-end">Selling Price</th><th class="text-end">Cost Price</th>
                <th class="text-end">Available Servings</th><th>Stock Status</th>
                <th>Status</th><th class="text-end">Actions</th>
              </tr></thead>
              <tbody id="prod-tbody">${pg.items.length ? pg.items.map(p => this.listRowHTML(p)).join('')
                : Utils.emptyRow(9, 'box-seam', this.products.length ? 'No products match your filters' : 'No products yet',
                    this.products.length ? 'Try changing the search or filters.' : 'Click "Add Product" to create your first menu item.')}</tbody>
            </table>
          </div>
        </div>`;
    } else {
      display.innerHTML = pg.items.length
        ? `<div class="row g-3" id="prod-grid">${pg.items.map(p => this.cardHTML(p)).join('')}</div>`
        : `<div class="card">${Utils.emptyState('box-seam',
            this.products.length ? 'No products match your filters' : 'No products yet',
            this.products.length ? 'Try adjusting your search query, category, or stock status filter.' : 'Click "Add Product" to create your first menu item.')}</div>`;
    }

    const pager = document.getElementById('prod-pager');
    if (pager) pager.innerHTML = Utils.pagerHTML(pg);
  },

  cardHTML(p) {
    const cat = this.catName(p.categoryId);
    const fb = Utils.fallbackImageFor(p);

    return `
      <div class="col-12 col-sm-6 col-md-6 col-lg-4 col-xl-3">
        <div class="prod-card ${p.status === 'inactive' ? 'is-inactive' : ''}" data-card-id="${Utils.esc(p.id)}">
          <div class="prod-card-media" data-act="view" data-id="${Utils.esc(p.id)}" title="View ${Utils.esc(p.name)} details">
            <img src="${Utils.esc(Utils.productImageSrc(p))}" alt="${Utils.esc(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${fb}'">
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
              <span class="text-muted fw-normal text-lowercase">/${Utils.esc(p.unit)}</span>
            </div>
            <div class="prod-card-title" data-act="view" data-id="${Utils.esc(p.id)}" title="${Utils.esc(p.name)}">
              ${Utils.esc(p.name)}
            </div>
            <div class="prod-card-desc">${Utils.esc(p.description || 'No description provided.')}</div>

            <div class="prod-card-metrics mt-auto mb-0">
              <div>
                <div class="prod-metric-label">Selling Price</div>
                <div class="prod-metric-price">${Utils.money(p.price)}</div>
                <div class="cell-sub">Cost: ${Utils.money(p.cost)}</div>
              </div>
              <div class="text-end">
                <div class="prod-metric-label">Available</div>
                <div class="prod-metric-stock">${Utils.num(p.stock)} <span class="fw-normal small text-muted">${Utils.esc(p.unit)}</span></div>
                <div class="cell-sub">Reorder ≤ ${p.reorderLevel}</div>
              </div>
            </div>
          </div>

          <div class="prod-card-footer">
            <button type="button" class="btn btn-light btn-sm" data-act="view" data-id="${Utils.esc(p.id)}" title="View product details">
              <i class="bi bi-eye me-1"></i>Details
            </button>
            <div class="d-flex gap-1">
              <button type="button" class="btn btn-soft btn-sm" data-act="edit" data-id="${Utils.esc(p.id)}" title="Edit product">
                <i class="bi bi-pencil me-1"></i>Edit
              </button>
              <button type="button" class="btn btn-light btn-sm text-danger" data-act="delete" data-id="${Utils.esc(p.id)}" title="Delete product">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>`;
  },

  listRowHTML(p) {
    return `
      <tr data-row-id="${Utils.esc(p.id)}">
        <td><div class="d-flex align-items-center gap-2">${Utils.productThumb(p)}
          <div><div class="cell-title">${Utils.esc(p.name)}</div><div class="cell-sub text-nowrap-ellipsis">${Utils.esc(p.description || '')}</div></div></div></td>
        <td class="mono">${Utils.esc(p.id)}</td>
        <td>${Utils.esc(this.catName(p.categoryId))}</td>
        <td class="text-end fw-semibold">${Utils.money(p.price)}</td>
        <td class="text-end text-muted">${Utils.money(p.cost)}</td>
        <td class="text-end">${Utils.num(p.stock)} <span class="cell-sub">${Utils.esc(p.unit)}</span></td>
        <td>${Utils.stockBadge(p)}</td>
        <td><span class="badge badge-soft-${p.status === 'active' ? 'success' : 'secondary'} text-capitalize">${p.status}</span></td>
        <td class="text-end text-nowrap">
          <button class="btn btn-light btn-action" data-act="view" data-id="${p.id}" title="View"><i class="bi bi-eye"></i></button>
          <button class="btn btn-light btn-action" data-act="edit" data-id="${p.id}" title="Edit"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-light btn-action text-danger" data-act="delete" data-id="${p.id}" title="Delete"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
  },

  /* ---------- Add / Edit ---------- */
  async openForm(product = null) {
    const isEdit = !!product;
    const p = product || {
      id: Utils.nextId('P', this.products.map(x => x.id), 3), name: '', categoryId: '', description: '', price: '', cost: '',
      stock: 0, reorderLevel: App.settings.lowStockThreshold ?? 10, unit: 'serving',
      image: '', status: 'active'
    };
    if (!this.categories.length) { Utils.toast('Please create at least one category first.', 'warning'); this.manageCategories(); return; }
    let image = p.image || '';
    const m = Utils.modal({
      title: isEdit ? `<i class="bi bi-pencil-square me-2"></i>Edit Product` : '<i class="bi bi-plus-circle me-2"></i>Add Product',
      size: 'lg', staticBackdrop: true,
      body: `<form id="prod-form" novalidate><div class="row g-3">
        <div class="col-md-4">
          <label class="form-label">Product Image</label>
          <div class="img-preview mb-2" id="img-preview"><img src="${Utils.esc(image || Utils.FALLBACK_FOOD_IMAGE)}" alt="${Utils.esc(p.name || 'Product image preview')}" onerror="this.onerror=null;this.src='${Utils.FALLBACK_FOOD_IMAGE}'"></div>
          <input type="file" accept="image/*" class="form-control form-control-sm" id="img-input">
          <button type="button" class="btn btn-link btn-sm text-danger px-0 ${image ? '' : 'd-none'}" id="img-remove"><i class="bi bi-x-circle me-1"></i>Remove image</button>
          <div class="form-text">JPG/PNG up to 5 MB. Images are resized and stored locally.</div>
        </div>
        <div class="col-md-8"><div class="row g-3">
          <div class="col-sm-5"><label class="form-label required">Product ID / SKU</label>
            <input class="form-control mono" name="id" value="${Utils.esc(p.id)}" ${isEdit ? 'readonly' : ''} maxlength="20"></div>
          <div class="col-sm-7"><label class="form-label required">Product Name</label>
            <input class="form-control" name="name" value="${Utils.esc(p.name)}" maxlength="80" autofocus></div>
          <div class="col-sm-7"><label class="form-label required">Category</label>
            <select class="form-select" name="categoryId"><option value="">Select category…</option>
              ${this.categories.map(c => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${Utils.esc(c.name)}</option>`).join('')}</select></div>
          <div class="col-sm-5"><label class="form-label required">Unit of Measurement</label>
            <input class="form-control" name="unit" list="unit-list" value="${Utils.esc(p.unit)}" maxlength="15">
            <datalist id="unit-list">${this.UNITS.map(u => `<option value="${u}">`).join('')}</datalist></div>
          <div class="col-12"><label class="form-label">Description</label>
            <textarea class="form-control" name="description" rows="2" maxlength="300">${Utils.esc(p.description)}</textarea></div>
        </div></div>
        <div class="col-sm-6 col-md-3"><label class="form-label required">Selling Price (${Utils.currencySymbol()})</label>
          <input type="number" class="form-control" name="price" min="0" step="0.01" value="${p.price}"></div>
        <div class="col-sm-6 col-md-3"><label class="form-label required">Cost Price (${Utils.currencySymbol()})</label>
          <input type="number" class="form-control" name="cost" min="0" step="0.01" value="${p.cost}"></div>
        <div class="col-sm-4 col-md-2"><label class="form-label required">${isEdit ? 'Available Servings' : 'Initial Servings'}</label>
          <input type="number" class="form-control" name="stock" min="0" step="1" value="${p.stock}"></div>
        <div class="col-sm-4 col-md-2"><label class="form-label required">Reorder Level</label>
          <input type="number" class="form-control" name="reorderLevel" min="0" step="1" value="${p.reorderLevel}"></div>
        <div class="col-sm-4 col-md-2"><label class="form-label">Status</label>
          <select class="form-select" name="status"><option value="active">Active</option><option value="inactive" ${p.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>

        <div class="col-12"><div class="small text-muted" id="margin-info"></div></div>
      </div></form>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary" id="prod-save"><i class="bi bi-check-lg me-1"></i>${isEdit ? 'Save Changes' : 'Add Product'}</button>`
    });
    const form = m.el.querySelector('#prod-form');
    const preview = m.el.querySelector('#img-preview');
    const removeBtn = m.el.querySelector('#img-remove');
    const updateMargin = () => {
      const price = parseFloat(form.price.value), cost = parseFloat(form.cost.value);
      m.el.querySelector('#margin-info').innerHTML = price > 0 && cost >= 0
        ? `Estimated margin per unit: <strong>${Utils.money(price - cost)}</strong> (${(((price - cost) / price) * 100).toFixed(1)}%)` : '';
    };
    form.price.addEventListener('input', updateMargin);
    form.cost.addEventListener('input', updateMargin);
    updateMargin();
    m.el.querySelector('#img-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        image = await Utils.readImage(file);
        preview.innerHTML = `<img src="${image}" alt="">`;
        removeBtn.classList.remove('d-none');
      } catch (err) { Utils.toast(err.message, 'danger'); e.target.value = ''; }
    });
    removeBtn.addEventListener('click', () => {
      image = '';
      preview.innerHTML = `<img src="${Utils.FALLBACK_FOOD_IMAGE}" alt="Placeholder">`;
      m.el.querySelector('#img-input').value = '';
      removeBtn.classList.add('d-none');
    });
    form.addEventListener('submit', e => { e.preventDefault(); m.el.querySelector('#prod-save').click(); });
    m.el.querySelector('#prod-save').addEventListener('click', async ev => {
      const d = Utils.formData(form);
      const errors = this.validate(d, isEdit ? product : null);
      if (!Utils.showErrors(form, errors)) return;
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await this.save(d, image, product);
        Utils.toast(isEdit ? 'Product updated successfully.' : 'Product added successfully.');
        m.close();
        await this.load();
        App.dataChanged();
      } catch (err) {
        Utils.toast(DB.friendlyError(err), 'danger');
        btn.disabled = false;
      }
    });
  },

  validate(d, existing) {
    const e = {};
    if (!existing) {
      if (!d.id) e.id = 'Product ID is required.';
      else if (!/^[A-Za-z0-9\-_]{2,20}$/.test(d.id)) e.id = 'Use 2–20 letters, numbers, dashes or underscores.';
      else if (this.products.some(p => p.id.toLowerCase() === d.id.toLowerCase())) e.id = 'This Product ID already exists.';
    }
    if (!d.name) e.name = 'Product name is required.';
    else if (d.name.length < 2) e.name = 'Product name must be at least 2 characters.';
    else if (this.products.some(p => p.name.toLowerCase() === d.name.toLowerCase() && (!existing || p.id !== existing.id))) e.name = 'A product with this name already exists.';
    if (!d.categoryId) e.categoryId = 'Please select a category.';
    if (!d.unit) e.unit = 'Unit is required.';
    if (!Utils.isMoney(d.price) || Number(d.price) <= 0) e.price = 'Enter a valid selling price greater than 0 (max 2 decimals).';
    if (!Utils.isMoney(d.cost)) e.cost = 'Enter a valid cost price (0 or more, max 2 decimals).';
    if (!Utils.isWholeNumber(d.stock)) e.stock = 'Stock must be a whole number of 0 or more.';
    if (!Utils.isWholeNumber(d.reorderLevel)) e.reorderLevel = 'Reorder level must be a whole number of 0 or more.';
    return e;
  },

  /** Saves the menu product and records a stock movement atomically when stock changes. */
  async save(d, image, existing) {
    const now = new Date();
    const nowIso = now.toISOString();
    const idUpper = existing ? existing.id : String(d.id || '').toUpperCase();
    const isIng = Boolean((existing && existing.isIngredient) || d.isIngredient || idUpper.startsWith('ING-'));

    const record = {
      ...(existing || {}),
      id: idUpper,
      name: d.name,
      categoryId: d.categoryId,
      categoryName: d.categoryName || (existing && existing.categoryName) || '',
      description: d.description || '',
      unit: d.unit,
      price: Utils.round2(d.price ?? d.cost ?? 0),
      cost: Utils.round2(d.cost ?? 0),
      stock: parseInt(d.stock, 10),
      reorderLevel: parseInt(d.reorderLevel, 10),
      isIngredient: isIng,
      batches: isIng ? ((existing && existing.batches) || []) : [],
      image: image || (typeof Prefs !== 'undefined' && Prefs.defaultFoodImage ? Prefs.defaultFoodImage(idUpper, d.name) : ''),
      status: d.status === 'inactive' ? 'inactive' : 'active',
      createdAt: existing ? existing.createdAt : nowIso,
      updatedAt: nowIso
    };

    if (isIng) {
      const shelfDays = parseInt(d.defaultShelfLifeDays, 10) > 0 ? parseInt(d.defaultShelfLifeDays, 10) : (existing && existing.defaultShelfLifeDays) || 7;
      record.defaultShelfLifeDays = shelfDays;
      const recDate = d.dateReceived || Utils.dateKey(now);
      const expDate = d.expirationDate || Utils.dateKey(Utils.addDays(Utils.parseDate(recDate) || now, shelfDays));
      if (!existing && record.stock > 0) {
        record.batches = [{
          id: `${record.id}-B01`,
          dateReceived: recDate,
          expirationDate: expDate,
          qty: record.stock,
          initialQty: record.stock,
          note: 'Initial ingredient batch'
        }];
      } else {
        Utils.ensureProductBatches(record, now);
      }
    }

    await DB.run(['products', 'movements'], 'readwrite', async tx => {
      const ps = tx.objectStore('products'), ms = tx.objectStore('movements');
      const current = await DB.req(ps.get(record.id));
      if (!existing && current) throw new Error('This ID already exists.');
      const prev = current ? current.stock : 0;

      if (!existing || prev !== record.stock) {
        const id = await DB.nextIdIn(ms, 'MOV-', 6);
        await DB.req(ms.add(Inventory.buildMovement({
          id, product: record, type: existing ? 'Adjustment' : 'Initial Stock',
          quantity: Math.abs(record.stock - prev), previousStock: prev, newStock: record.stock,
          reason: existing ? 'Stock edited via form' : 'Initial stock on creation',
          date: nowIso
        })));
      }
      await DB.req(ps.put(record));
    });
    return record;
  },

  /* ---------- View ---------- */
  async view(p) {
    const [movements, txns, suppliers] = await Promise.all([DB.getAll('movements'), DB.getAll('transactions'), DB.getAll('suppliers')]);
    const sold = Stats.productSales(txns).find(r => r.productId === p.id) || { qty: 0, revenue: 0 };
    const recent = movements.filter(mv => mv.productId === p.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const sups = suppliers.filter(s => (s.productIds || []).includes(p.id));
    const m = Utils.modal({
      title: `<i class="bi bi-box-seam me-2"></i>Product Details`, size: 'lg',
      body: `<div class="row g-4">
        <div class="col-md-4"><div class="img-preview"><img src="${Utils.esc(Utils.productImageSrc(p))}" alt="${Utils.esc(p.name)}" onerror="this.onerror=null;this.src='${Utils.FALLBACK_FOOD_IMAGE}'"></div></div>
        <div class="col-md-8">
          <div class="d-flex flex-wrap align-items-center gap-2 mb-1"><h4 class="mb-0">${Utils.esc(p.name)}</h4>${Utils.stockBadge(p)}
            <span class="badge badge-soft-${p.status === 'active' ? 'success' : 'secondary'} text-capitalize">${p.status}</span></div>
          <div class="text-muted mb-3">${Utils.esc(p.description || 'No description.')}</div>
          <div class="detail-grid">
            <div><div class="detail-label">Product ID / SKU</div><div class="detail-value mono">${Utils.esc(p.id)}</div></div>
            <div><div class="detail-label">Category</div><div class="detail-value">${Utils.esc(this.catName(p.categoryId))}</div></div>
            <div><div class="detail-label">Selling Price</div><div class="detail-value">${Utils.money(p.price)}</div></div>
            <div><div class="detail-label">Cost Price</div><div class="detail-value">${Utils.money(p.cost)}</div></div>
            <div><div class="detail-label">Available Servings</div><div class="detail-value">${Utils.num(p.stock)} ${Utils.esc(p.unit)}</div></div>
            <div><div class="detail-label">Reorder Level</div><div class="detail-value">${p.reorderLevel} ${Utils.esc(p.unit)}</div></div>
            <div><div class="detail-label">Total Sold</div><div class="detail-value">${Utils.num(sold.qty)} ${Utils.esc(p.unit)}</div></div>
            <div><div class="detail-label">Sales Revenue</div><div class="detail-value">${Utils.money(sold.revenue)}</div></div>
            <div><div class="detail-label">Suppliers</div><div class="detail-value">${sups.length ? sups.map(s => Utils.esc(s.name)).join(', ') : '—'}</div></div>
            <div><div class="detail-label">Last Updated</div><div class="detail-value">${Utils.fmtDateTime(p.updatedAt)}</div></div>
          </div>
        </div>
        <div class="col-12"><h6 class="fw-semibold">Recent Serving &amp; Stock Movements</h6>
          <div class="table-wrap"><table class="table table-sm"><thead><tr><th>Date</th><th>Type</th><th class="text-end">Qty</th><th class="text-end">Prev → New</th><th>Reason</th></tr></thead>
          <tbody>${recent.length ? recent.map(mv => `<tr><td class="small">${Utils.fmtDateTime(mv.date)}</td><td>${Inventory.typeBadge(mv.type)}</td>
            <td class="text-end">${Inventory.signedQty(mv)}</td><td class="text-end">${mv.previousStock} → ${mv.newStock}</td><td class="small">${Utils.esc(mv.reason)}</td></tr>`).join('')
            : Utils.emptyRow(5, 'clock-history', 'No movements recorded')}</tbody></table></div></div>
      </div>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Close</button><button class="btn btn-primary" id="view-edit"><i class="bi bi-pencil me-1"></i>Edit</button>`
    });
    m.el.querySelector('#view-edit').addEventListener('click', () => { m.close(); setTimeout(() => this.openForm(p), 300); });
  },

  /* ---------- Delete ---------- */
  async remove(p) {
    const ok = await Utils.confirm({
      title: 'Delete product', danger: true, confirmText: 'Delete Product',
      message: `Delete <strong>${Utils.esc(p.name)}</strong> (${Utils.esc(p.id)})? This cannot be undone.<br>
        <span class="small text-muted">Past sales and movement records keep their saved product names. Consider setting the product to <em>Inactive</em> instead if you may sell it again.</span>`
    });
    if (!ok) return;
    try {
      await DB.run(['products', 'suppliers'], 'readwrite', async tx => {
        const ss = tx.objectStore('suppliers');
        const sups = await DB.req(ss.getAll());
        for (const s of sups) {
          if ((s.productIds || []).includes(p.id)) { s.productIds = s.productIds.filter(id => id !== p.id); await DB.req(ss.put(s)); }
        }
        await DB.req(tx.objectStore('products').delete(p.id));
      });
      Utils.toast('Product deleted.');
      await this.load();
      App.dataChanged();
    } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
  },

  /* ---------- Categories ---------- */
  async manageCategories() {
    const m = Utils.modal({
      title: '<i class="bi bi-tags me-2"></i>Product Categories',
      body: `<form id="cat-form" class="d-flex gap-2 mb-3" novalidate>
          <input type="hidden" name="id"><div class="flex-grow-1"><input class="form-control" name="name" placeholder="Category name" maxlength="40"></div>
          <button class="btn btn-primary" type="submit" id="cat-submit"><i class="bi bi-plus-lg"></i> Add</button>
          <button class="btn btn-light d-none" type="button" id="cat-cancel">Cancel</button></form>
        <div class="table-wrap"><table class="table table-sm"><thead><tr><th>Category</th><th class="text-end">Products</th><th class="text-end">Actions</th></tr></thead>
        <tbody id="cat-list"></tbody></table></div>`,
      footer: '<button class="btn btn-light" data-bs-dismiss="modal">Close</button>',
      onHidden: () => this.load()
    });
    const form = m.el.querySelector('#cat-form');
    const list = m.el.querySelector('#cat-list');
    const resetForm = () => { form.reset(); form.id.value = ''; m.el.querySelector('#cat-submit').innerHTML = '<i class="bi bi-plus-lg"></i> Add'; m.el.querySelector('#cat-cancel').classList.add('d-none'); Utils.clearErrors(form); };
    const draw = async () => {
      const [cats, allProds] = await Promise.all([DB.getAll('categories'), DB.getAll('products')]);
      this.categories = cats.sort((a, b) => a.name.localeCompare(b.name));
      this.products = allProds.filter(p => !p.isIngredient && !String(p.id || '').startsWith('ING-'));
      list.innerHTML = this.categories.length ? this.categories.map(c => {
        const n = this.products.filter(p => p.categoryId === c.id).length;
        return `<tr><td>${Utils.esc(c.name)}</td><td class="text-end">${n}</td><td class="text-end text-nowrap">
          <button class="btn btn-light btn-action" data-edit="${c.id}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-light btn-action text-danger" data-del="${c.id}"><i class="bi bi-trash"></i></button></td></tr>`;
      }).join('') : Utils.emptyRow(3, 'tags', 'No categories yet');
    };
    m.el.querySelector('#cat-cancel').addEventListener('click', resetForm);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const d = Utils.formData(form), errors = {};
      if (!d.name) errors.name = 'Category name is required.';
      else if (this.categories.some(c => c.name.toLowerCase() === d.name.toLowerCase() && c.id !== d.id)) errors.name = 'This category already exists.';
      if (!Utils.showErrors(form, errors)) return;
      try {
        const existing = this.categories.find(c => c.id === d.id);
        const rec = existing ? { ...existing, name: d.name } : { id: Utils.nextId('CAT-', this.categories.map(c => c.id), 2), name: d.name, description: '' };
        await DB.put('categories', rec);
        Utils.toast(existing ? 'Category updated.' : 'Category added.');
        resetForm();
        await draw();
      } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
    });
    list.addEventListener('click', async e => {
      const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
      if (ed) {
        const c = this.categories.find(x => x.id === ed.dataset.edit);
        form.id.value = c.id; form.name.value = c.name; form.name.focus();
        m.el.querySelector('#cat-submit').innerHTML = '<i class="bi bi-check-lg"></i> Save';
        m.el.querySelector('#cat-cancel').classList.remove('d-none');
      }
      if (del) {
        const c = this.categories.find(x => x.id === del.dataset.del);
        const used = this.products.filter(p => p.categoryId === c.id).length;
        if (used) { Utils.toast(`Cannot delete "${c.name}" — ${used} product(s) still use it.`, 'warning'); return; }
        const ok = await Utils.confirm({ title: 'Delete category', danger: true, confirmText: 'Delete', message: `Delete category <strong>${Utils.esc(c.name)}</strong>?` });
        if (!ok) return;
        try { await DB.remove('categories', c.id); Utils.toast('Category deleted.'); await draw(); }
        catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
      }
    });
    await draw();
  },

  /* ---------- CSV ---------- */
  async exportCSV(list) {
    if (!list) {
      const [allProds, cats] = await Promise.all([DB.getAll('products'), DB.getAll('categories')]);
      this.categories = cats;
      list = allProds.filter(p => !p.isIngredient && !String(p.id || '').startsWith('ING-'));
    }
    Utils.exportCSV(`products-${Utils.stamp()}.csv`, [
      { label: 'Product ID', key: 'id' }, { label: 'Product Name', key: 'name' },
      { label: 'Category', value: p => this.catName(p.categoryId) }, { label: 'Description', key: 'description' },
      { label: 'Selling Price', key: 'price' }, { label: 'Cost Price', key: 'cost' }, { label: 'Available Servings', key: 'stock' },
      { label: 'Reorder Level', key: 'reorderLevel' }, { label: 'Unit', key: 'unit' },
      { label: 'Availability', value: p => Utils.stockStatus(p).label },
      { label: 'Status', key: 'status' },
      { label: 'Last Updated', value: p => Utils.fmtDateTime(p.updatedAt) }
    ], list);
  }
};

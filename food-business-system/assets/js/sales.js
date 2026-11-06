/* =========================================================
   sales.js - Point of Sale (POS) & Transaction History
   Atomic checkout: validates stock, saves transaction, deducts
   inventory, and creates movement records in one IndexedDB tx.
   ========================================================= */
'use strict';

const Sales = {
  title: 'Sales & POS',
  subtitle: 'Process orders at the counter, print receipts and review transaction history',
  view: 'pos',
  pos: { search: '', category: '', cart: [], customerId: '', discountType: 'none', discountValue: '', cash: '', busy: false },
  hstate: { search: '', from: '', to: '', customerId: '', page: 1 },

  async render(el) {
    el.innerHTML = `
      <ul class="nav nav-pills section-tabs mb-3">
        <li class="nav-item"><button class="nav-link ${this.view === 'pos' ? 'active' : ''}" data-view="pos"><i class="bi bi-cart3 me-1"></i>Point of Sale (POS)</button></li>
        <li class="nav-item"><button class="nav-link ${this.view === 'history' ? 'active' : ''}" data-view="history"><i class="bi bi-receipt-cutoff me-1"></i>Transaction History</button></li>
      </ul>
      <div id="sales-view"></div>`;
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
    const [allProducts, categories, customers, txns] = await Promise.all([
      DB.getAll('products'), DB.getAll('categories'), DB.getAll('customers'), DB.getAll('transactions')]);
    // POS strictly sells finished menu items (excludes raw ingredients)
    this.products = allProducts.filter(p => !p.isIngredient && !String(p.id || '').startsWith('ING-'));
    this.products.forEach(p => {
      if (!p.image && typeof Prefs !== 'undefined' && Prefs.defaultFoodImage) {
        p.image = Prefs.defaultFoodImage(p) || '';
      }
    });
    this.categories = categories.sort((a, b) => a.name.localeCompare(b.name));
    this.customers = customers.sort((a, b) => a.name.localeCompare(b.name));
    this.txns = txns.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    this.reconcileCart();
    this.renderView();
  },

  catName(id) { const c = (this.categories || []).find(x => x.id === id); return c ? c.name : 'Uncategorized'; },

  /** Ensures cart items still exist and do not exceed available servings. */
  reconcileCart() {
    this.pos.cart = this.pos.cart.filter(item => {
      const p = this.products.find(x => x.id === item.productId && x.status === 'active');
      const avail = p ? Math.max(0, Number(p.stock) || 0) : 0;
      if (!p || avail <= 0) return false;
      item.name = p.name;
      item.price = p.price;
      item.cost = p.cost;
      item.unit = p.unit;
      item.category = this.catName(p.categoryId);
      if (item.qty > avail) item.qty = avail;
      return true;
    });
  },

  renderView() { if (this.view === 'history') this.renderHistory(); else this.renderPOS(); },

  /* =========================================================
     POINT OF SALE
     ========================================================= */
  renderPOS() {
    const box = document.getElementById('sales-view');
    const p = this.pos;
    box.innerHTML = `
      <div class="row g-3">
        <!-- Product Catalog -->
        <div class="col-lg-7 col-xl-8">
          <div class="card">
            <div class="card-body">
              <div class="d-flex flex-wrap gap-2 mb-3">
                <div class="search-box flex-grow-1" style="max-width:none"><i class="bi bi-search"></i>
                  <input type="search" class="form-control" id="pos-search" placeholder="Search food item or scan product ID…" value="${Utils.esc(p.search)}"></div>
              </div>
              <div class="pos-cats mb-3" id="pos-cats">
                <button class="btn ${!p.category ? 'btn-primary' : 'btn-light'}" data-cat="">All Items</button>
                ${this.categories.map(c => `<button class="btn ${p.category === c.id ? 'btn-primary' : 'btn-light'}" data-cat="${c.id}">${Utils.esc(c.name)}</button>`).join('')}
              </div>
              <div class="pos-grid" id="pos-grid"></div>
            </div>
          </div>
        </div>

        <!-- Shopping Cart & Order Summary -->
        <div class="col-lg-5 col-xl-4">
          <div class="card cart-card">
            <div class="card-header d-flex justify-content-between align-items-center">
              <span><i class="bi bi-basket2 me-1"></i>Current Order <span class="badge bg-primary rounded-pill ms-1" id="cart-count">0</span></span>
              <button class="btn btn-sm btn-link text-danger text-decoration-none p-0" id="cart-clear">Clear</button>
            </div>
            <div class="card-body">
              <!-- Customer selector -->
              <div class="mb-2">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <label class="form-label mb-0 small">Customer</label>
                  ${Auth.can('customers') ? '<button type="button" class="btn btn-link btn-sm p-0 text-decoration-none" id="pos-new-cust"><i class="bi bi-person-plus me-1"></i>New customer</button>' : ''}
                </div>
                <select class="form-select form-select-sm" id="pos-customer">
                  <option value="">Guest Customer (Walk-in)</option>
                  ${this.customers.map(c => `<option value="${c.id}" ${c.id === p.customerId ? 'selected' : ''}>${Utils.esc(c.name)} (${Utils.esc(c.phone || c.id)})</option>`).join('')}
                </select>
              </div>

              <!-- Cart lines -->
              <div class="cart-items my-2" id="cart-items"></div>

              <!-- Discount -->
              <div class="border-top pt-2 mt-2">
                <div class="row g-2 align-items-center mb-2">
                  <div class="col-5"><label class="form-label mb-0 small">Discount</label></div>
                  <div class="col-7">
                    <div class="input-group input-group-sm">
                      <select class="form-select" id="pos-disc-type" style="max-width:92px">
                        <option value="none">None</option>
                        <option value="percent" ${p.discountType === 'percent' ? 'selected' : ''}>% Off</option>
                        <option value="fixed" ${p.discountType === 'fixed' ? 'selected' : ''}>${Utils.currencySymbol()} Off</option>
                      </select>
                      <input type="number" class="form-control" id="pos-disc-val" min="0" step="0.01" placeholder="0" value="${Utils.esc(p.discountValue)}" ${p.discountType === 'none' ? 'disabled' : ''}>
                    </div>
                  </div>
                </div>
                <div class="d-flex gap-1 flex-wrap mb-2">
                  <button type="button" class="btn btn-light btn-sm py-0 px-2 small" data-disc="none">No Discount</button>
                  <button type="button" class="btn btn-light btn-sm py-0 px-2 small" data-disc="10">10% Promo</button>
                  <button type="button" class="btn btn-light btn-sm py-0 px-2 small" data-disc="20">20% Senior/PWD</button>
                </div>

                <!-- Summary -->
                <div class="summary-row"><span class="text-muted">Subtotal</span><span id="sum-sub">${Utils.money(0)}</span></div>
                <div class="summary-row"><span class="text-muted">Discount</span><span class="text-danger" id="sum-disc">-${Utils.money(0)}</span></div>
                <div class="summary-row summary-total"><span>Total</span><span id="sum-total">${Utils.money(0)}</span></div>

                <!-- Payment -->
                <div class="mt-3">
                  <label class="form-label small mb-1 required">Cash Received (${Utils.currencySymbol()})</label>
                  <input type="number" class="form-control" id="pos-cash" min="0" step="0.01" placeholder="Enter cash amount…" value="${Utils.esc(p.cash)}">
                  <div class="quick-cash d-flex flex-wrap gap-1 mt-2" id="quick-cash"></div>
                </div>
                <div class="d-flex justify-content-between align-items-center mt-2 p-2 rounded-3" style="background:var(--brand-lighter)">
                  <span class="fw-semibold small">Change</span>
                  <span class="fs-5 fw-bold" id="sum-change">${Utils.money(0)}</span>
                </div>
                <div class="text-danger small mt-1 d-none" id="pos-error"></div>

                <button class="btn btn-primary w-100 py-2 mt-3" id="pos-checkout">
                  <i class="bi bi-check2-circle me-1"></i>Complete Sale
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    // Catalog events
    box.querySelector('#pos-search').addEventListener('input', e => { p.search = e.target.value.trim(); this.drawCatalog(); });
    box.querySelector('#pos-search').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const exact = this.products.find(x => x.status === 'active' && x.id.toLowerCase() === p.search.toLowerCase());
        if (exact) { e.preventDefault(); this.addToCart(exact.id); }
      }
    });
    box.querySelector('#pos-cats').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      p.category = b.dataset.cat;
      box.querySelectorAll('#pos-cats .btn').forEach(x => {
        x.classList.toggle('btn-primary', x === b);
        x.classList.toggle('btn-light', x !== b);
      });
      this.drawCatalog();
    });
    box.querySelector('#pos-grid').addEventListener('click', e => {
      const card = e.target.closest('[data-pid]');
      if (card && !card.disabled) this.addToCart(card.dataset.pid);
    });

    // Cart events
    box.querySelector('#pos-customer').addEventListener('change', e => { p.customerId = e.target.value; });
    const newCustBtn = box.querySelector('#pos-new-cust');
    if (newCustBtn) newCustBtn.addEventListener('click', () => Customers.openForm(null, async created => {
      this.customers = (await DB.getAll('customers')).sort((a, b) => a.name.localeCompare(b.name));
      p.customerId = created.id;
      this.renderPOS();
    }));
    box.querySelector('#cart-clear').addEventListener('click', () => {
      if (!p.cart.length) return;
      p.cart = []; p.discountType = 'none'; p.discountValue = ''; p.cash = '';
      this.drawCatalog(); this.drawCart();
    });
    box.querySelector('#cart-items').addEventListener('click', e => {
      const b = e.target.closest('[data-cact]');
      if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.cact === 'inc') this.changeQty(id, 1);
      if (b.dataset.cact === 'dec') this.changeQty(id, -1);
      if (b.dataset.cact === 'rm') this.removeFromCart(id);
    });
    box.querySelector('#cart-items').addEventListener('change', e => {
      if (e.target.matches('[data-cqty]')) this.setQty(e.target.dataset.cqty, parseInt(e.target.value, 10));
    });

    // Discount & payment events
    const discType = box.querySelector('#pos-disc-type');
    const discVal = box.querySelector('#pos-disc-val');
    discType.addEventListener('change', () => {
      p.discountType = discType.value;
      if (p.discountType === 'none') p.discountValue = '';
      discVal.disabled = p.discountType === 'none';
      discVal.value = p.discountValue;
      this.updateTotals();
    });
    discVal.addEventListener('input', () => { p.discountValue = discVal.value; this.updateTotals(); });
    box.querySelectorAll('[data-disc]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.disc === 'none') { p.discountType = 'none'; p.discountValue = ''; }
      else { p.discountType = 'percent'; p.discountValue = b.dataset.disc; }
      discType.value = p.discountType;
      discVal.disabled = p.discountType === 'none';
      discVal.value = p.discountValue;
      this.updateTotals();
    }));
    box.querySelector('#pos-cash').addEventListener('input', e => { p.cash = e.target.value; this.updateTotals(); });
    box.querySelector('#quick-cash').addEventListener('click', e => {
      const b = e.target.closest('[data-cash]');
      if (!b) return;
      p.cash = b.dataset.cash;
      box.querySelector('#pos-cash').value = p.cash;
      this.updateTotals();
    });
    box.querySelector('#pos-checkout').addEventListener('click', () => this.checkout());

    this.drawCatalog();
    this.drawCart();
  },

  drawCatalog() {
    const grid = document.getElementById('pos-grid');
    if (!grid) return;
    const q = this.pos.search.toLowerCase();
    const showImg = Prefs.get('showPosImages') !== false;
    const list = this.products.filter(p => p.status === 'active' &&
      (!this.pos.category || p.categoryId === this.pos.category) &&
      (!q || (p.id + ' ' + p.name).toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) {
      grid.innerHTML = `<div style="grid-column:1/-1">${Utils.emptyState('search', 'No matching products', 'Try another category or search term.')}</div>`;
      return;
    }
    grid.innerHTML = list.map(p => {
      const inCart = (this.pos.cart.find(c => c.productId === p.id) || {}).qty || 0;
      const avail = Math.max(0, Number(p.stock) || 0);
      const st = Utils.stockStatus(p);
      return `<button type="button" class="pos-item position-relative ${inCart ? 'in-cart' : ''}" data-pid="${p.id}" ${avail <= 0 ? 'disabled' : ''}>
        ${inCart ? `<span class="badge bg-primary rounded-pill pos-incart">${inCart}</span>` : ''}
        ${showImg ? `<div class="pos-img"><img src="${Utils.esc(Utils.productImageSrc(p))}" alt="${Utils.esc(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${Utils.FALLBACK_FOOD_IMAGE}'"></div>` : ''}
        <div class="cell-sub mono mb-1">${Utils.esc(p.id)}</div>
        <div class="pos-name">${Utils.esc(p.name)}</div>
        <div class="d-flex justify-content-between align-items-center mt-auto pt-2 w-100">
          <span class="pos-price">${Utils.money(p.price)}</span>
          <span class="badge badge-soft-${st.cls} pos-stock">${avail > 0 ? `${avail} ${Utils.esc(p.unit)}` : 'Out'}</span>
        </div>
      </button>`;
    }).join('');
  },

  addToCart(productId) {
    const p = this.products.find(x => x.id === productId && x.status === 'active');
    if (!p) { Utils.toast('This product is unavailable.', 'warning'); return; }
    const avail = Math.max(0, Number(p.stock) || 0);
    if (avail <= 0) {
      Utils.toast('This product is out of stock.', 'danger');
      return;
    }
    const line = this.pos.cart.find(c => c.productId === productId);
    if (line) {
      if (line.qty + 1 > avail) {
        Utils.toast(`Only ${avail} ${p.unit} of ${p.name} available.`, 'warning');
        return;
      }
      line.qty += 1;
    } else {
      this.pos.cart.push({ productId: p.id, name: p.name, category: this.catName(p.categoryId), unit: p.unit, price: p.price, cost: p.cost, qty: 1 });
    }
    this.drawCatalog();
    this.drawCart();
  },

  changeQty(productId, delta) {
    const line = this.pos.cart.find(c => c.productId === productId);
    if (!line) return;
    this.setQty(productId, line.qty + delta);
  },

  setQty(productId, qty) {
    const line = this.pos.cart.find(c => c.productId === productId);
    const p = this.products.find(x => x.id === productId);
    if (!line || !p) return;
    if (isNaN(qty) || qty <= 0) { this.removeFromCart(productId); return; }
    const avail = Math.max(0, Number(p.stock) || 0);
    if (qty > avail) {
      Utils.toast(`Only ${avail} ${p.unit} of ${p.name} available.`, 'warning');
      qty = avail;
    }
    if (qty <= 0) { this.removeFromCart(productId); return; }
    line.qty = qty;
    this.drawCatalog();
    this.drawCart();
  },

  removeFromCart(productId) {
    this.pos.cart = this.pos.cart.filter(c => c.productId !== productId);
    this.drawCatalog();
    this.drawCart();
  },

  drawCart() {
    const holder = document.getElementById('cart-items');
    if (!holder) return;
    const cart = this.pos.cart;
    document.getElementById('cart-count').textContent = cart.reduce((s, i) => s + i.qty, 0);
    if (!cart.length) {
      holder.innerHTML = Utils.emptyState('cart', 'Cart is empty', 'Select products from the catalog to start an order.');
      this.updateTotals();
      return;
    }
    holder.innerHTML = cart.map(i => `
      <div class="cart-line">
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold small text-truncate">${Utils.esc(i.name)}</div>
          <div class="cell-sub">${Utils.money(i.price)} / ${Utils.esc(i.unit)}</div>
        </div>
        <div class="qty-ctrl">
          <button type="button" data-cact="dec" data-id="${i.productId}" aria-label="Decrease">−</button>
          <input type="number" min="1" value="${i.qty}" data-cqty="${i.productId}">
          <button type="button" data-cact="inc" data-id="${i.productId}" aria-label="Increase">+</button>
        </div>
        <div class="text-end" style="min-width:74px"><div class="fw-semibold small">${Utils.money(i.price * i.qty)}</div></div>
        <button type="button" class="btn btn-sm text-danger p-0" data-cact="rm" data-id="${i.productId}" title="Remove"><i class="bi bi-x-lg"></i></button>
      </div>`).join('');
    this.updateTotals();
  },

  totals() {
    const subtotal = Utils.round2(this.pos.cart.reduce((s, i) => s + Utils.round2(i.price * i.qty), 0));
    const raw = Math.max(0, Number(this.pos.discountValue) || 0);
    let discount = 0;
    if (this.pos.discountType === 'percent') discount = Utils.round2(subtotal * (Math.min(100, raw) / 100));
    if (this.pos.discountType === 'fixed') discount = Utils.round2(Math.min(subtotal, raw));
    const total = Utils.round2(Math.max(0, subtotal - discount));
    const cash = this.pos.cash === '' ? null : Utils.round2(Number(this.pos.cash));
    const change = cash !== null ? Utils.round2(cash - total) : 0;
    return { subtotal, discount, total, cash, change };
  },

  updateTotals() {
    const t = this.totals();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('sum-sub', Utils.money(t.subtotal));
    set('sum-disc', '-' + Utils.money(t.discount));
    set('sum-total', Utils.money(t.total));
    const changeEl = document.getElementById('sum-change');
    if (changeEl) {
      changeEl.textContent = t.cash === null || t.change < 0 ? Utils.money(0) : Utils.money(t.change);
      changeEl.classList.toggle('text-danger', t.cash !== null && t.change < 0);
    }
    const qc = document.getElementById('quick-cash');
    if (qc) {
      const bills = [...new Set([t.total, 50, 100, 200, 500, 1000].filter(v => v > 0 && v >= t.total))].slice(0, 5);
      qc.innerHTML = bills.map((b, i) => `<button type="button" class="btn btn-light" data-cash="${b}">${i === 0 ? 'Exact ' : ''}${Utils.money(b)}</button>`).join('');
    }
    const errEl = document.getElementById('pos-error');
    if (errEl) {
      let msg = '';
      if (this.pos.discountType === 'percent' && Number(this.pos.discountValue) > 100) msg = 'Percentage discount cannot exceed 100%.';
      else if (this.pos.discountType === 'fixed' && Number(this.pos.discountValue) > t.subtotal) msg = 'Discount cannot exceed the subtotal.';
      else if (t.cash !== null && t.total > 0 && t.cash < t.total) msg = `Insufficient cash. Need ${Utils.money(t.total - t.cash)} more.`;
      errEl.textContent = msg;
      errEl.classList.toggle('d-none', !msg);
    }
  },

  async checkout() {
    if (this.pos.busy) return; // prevent duplicate transactions
    const p = this.pos;
    if (!p.cart.length) { Utils.toast('Cannot checkout an empty cart. Please add products first.', 'warning'); return; }
    const t = this.totals();
    if (p.discountType === 'percent' && (Number(p.discountValue) < 0 || Number(p.discountValue) > 100)) {
      Utils.toast('Discount percentage must be between 0 and 100.', 'danger'); return;
    }
    if (p.discountType === 'fixed' && (Number(p.discountValue) < 0 || Number(p.discountValue) > t.subtotal)) {
      Utils.toast('Fixed discount cannot exceed the order subtotal.', 'danger'); return;
    }
    if (t.cash === null || isNaN(t.cash) || !Utils.isMoney(p.cash)) {
      Utils.toast('Please enter a valid cash payment amount.', 'warning');
      document.getElementById('pos-cash').focus();
      return;
    }
    if (t.cash < t.total) {
      Utils.toast(`Insufficient payment. Total is ${Utils.money(t.total)}.`, 'danger');
      document.getElementById('pos-cash').focus();
      return;
    }

    const cust = this.customers.find(c => c.id === p.customerId);
    const ok = await Utils.confirm({
      title: 'Confirm Sale',
      confirmText: 'Confirm & Save Sale',
      message: `<div class="mb-2">Complete this transaction for <strong>${Utils.esc(cust ? cust.name : 'Guest Customer')}</strong>?</div>
        <div class="p-2 rounded-3" style="background:var(--brand-lighter)">
          <div class="d-flex justify-content-between"><span>Items (${p.cart.reduce((s, i) => s + i.qty, 0)})</span><span>${Utils.money(t.subtotal)}</span></div>
          ${t.discount > 0 ? `<div class="d-flex justify-content-between text-danger"><span>Discount</span><span>-${Utils.money(t.discount)}</span></div>` : ''}
          <div class="d-flex justify-content-between fw-bold fs-6 border-top mt-1 pt-1"><span>Total</span><span>${Utils.money(t.total)}</span></div>
          <div class="d-flex justify-content-between small"><span>Cash received</span><span>${Utils.money(t.cash)}</span></div>
          <div class="d-flex justify-content-between small fw-semibold"><span>Change</span><span>${Utils.money(t.change)}</span></div>
        </div>`
    });
    if (!ok) return;

    p.busy = true;
    const btn = document.getElementById('pos-checkout');
    if (btn) btn.disabled = true;

    try {
      const now = new Date();
      const prefix = `TXN-${Utils.compactDate(now)}-`;
      const items = p.cart.map(i => ({
        productId: i.productId, name: i.name, category: i.category, unit: i.unit,
        qty: i.qty, price: Utils.round2(i.price), cost: Utils.round2(i.cost), subtotal: Utils.round2(i.price * i.qty)
      }));

      // Atomic IndexedDB transaction across products + transactions + movements
      const saved = await DB.run(['products', 'transactions', 'movements'], 'readwrite', async tx => {
        const ps = tx.objectStore('products'), ts = tx.objectStore('transactions'), ms = tx.objectStore('movements');
        const allKeys = await DB.req(ts.getAllKeys());
        const id = Utils.nextId(prefix, allKeys.filter(k => String(k).startsWith(prefix)), 4);
        const movKeys = await DB.req(ms.getAllKeys());
        let movSeq = movKeys.reduce((m, k) => Math.max(m, parseInt(String(k).replace(/\D/g, ''), 10) || 0), 0);

        for (const item of items) {
          const prod = await DB.req(ps.get(item.productId));
          if (!prod || prod.status !== 'active') throw new Error(`"${item.name}" is no longer available.`);
          const avail = Math.max(0, Number(prod.stock) || 0);
          if (avail < item.qty) {
            throw new Error(`Insufficient servings for "${prod.name}". Available: ${avail}, in cart: ${item.qty}.`);
          }
          const prev = prod.stock;
          prod.stock = prev - item.qty;
          prod.updatedAt = now.toISOString();
          await DB.req(ps.put(prod));
          await DB.req(ms.add(Inventory.buildMovement({
            id: 'MOV-' + Utils.pad(++movSeq, 6), product: prod, type: 'Sale',
            quantity: item.qty, previousStock: prev, newStock: prod.stock,
            reason: `Sold - ${id}`,
            refId: id, date: now.toISOString()
          })));
        }

        const record = {
          id, date: now.toISOString(), items,
          itemCount: items.reduce((s, i) => s + i.qty, 0),
          subtotal: t.subtotal,
          discountType: p.discountType,
          discountValue: p.discountType === 'none' ? 0 : Number(p.discountValue) || 0,
          discount: t.discount,
          total: t.total, cash: t.cash, change: t.change,
          customerId: cust ? cust.id : null,
          customerName: cust ? cust.name : 'Guest',
          cashierId: Auth.user.id,
          cashierName: Auth.user.fullName,
          status: 'completed'
        };
        await DB.req(ts.add(record));
        return record;
      });

      // Reset cart and refresh UI
      p.cart = []; p.customerId = ''; p.discountType = 'none'; p.discountValue = ''; p.cash = '';
      Utils.toast(`Sale ${saved.id} completed!`);
      await this.load();
      await App.dataChanged();
      this.showReceipt(saved, Prefs.get('autoPrintReceipt'));
    } catch (err) {
      Utils.toast(DB.friendlyError(err), 'danger');
      await this.load();
    } finally {
      p.busy = false;
      if (btn) btn.disabled = false;
    }
  },

  /* =========================================================
     RECEIPT
     ========================================================= */
  receiptHTML(t) {
    const s = App.settings;
    return `<div class="receipt">
      <h3>${Utils.esc(s.businessName)}</h3>
      <div class="center">${Utils.esc(s.address || '')}</div>
      ${s.phone ? `<div class="center">Tel: ${Utils.esc(s.phone)}</div>` : ''}
      ${s.receiptHeader ? `<div class="center mt-1">${Utils.esc(s.receiptHeader)}</div>` : ''}
      <div class="line"></div>
      <div><strong>Receipt:</strong> ${Utils.esc(t.id)}</div>
      <div><strong>Date:</strong> ${Utils.fmtDateTime(t.date)}</div>
      ${s.receiptShowCustomer !== false ? `<div><strong>Customer:</strong> ${Utils.esc(t.customerName || 'Guest')}</div>` : ''}
      ${s.receiptShowCashier !== false ? `<div><strong>Cashier:</strong> ${Utils.esc(t.cashierName || '')}</div>` : ''}
      <div class="line"></div>
      <table>
        <thead><tr><td><strong>Item</strong></td><td class="r"><strong>Qty×Price</strong></td><td class="r"><strong>Amount</strong></td></tr></thead>
        <tbody>
          ${t.items.map(i => `<tr>
            <td>${Utils.esc(i.name)}</td>
            <td class="r">${i.qty}×${Utils.money(i.price)}</td>
            <td class="r">${Utils.money(i.subtotal)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="line"></div>
      <table>
        <tr><td>Subtotal (${t.itemCount} item${t.itemCount === 1 ? '' : 's'})</td><td class="r">${Utils.money(t.subtotal)}</td></tr>
        ${t.discount > 0 ? `<tr><td>Discount ${t.discountType === 'percent' ? `(${t.discountValue}%)` : ''}</td><td class="r">-${Utils.money(t.discount)}</td></tr>` : ''}
        <tr class="big"><td>TOTAL</td><td class="r">${Utils.money(t.total)}</td></tr>
        <tr><td>Cash Received</td><td class="r">${Utils.money(t.cash)}</td></tr>
        <tr><td><strong>Change</strong></td><td class="r"><strong>${Utils.money(t.change)}</strong></td></tr>
      </table>
      <div class="line"></div>
      <div class="center">${Utils.esc(s.receiptFooter || 'Thank you!')}</div>
    </div>`;
  },

  showReceipt(t, autoPrint = false) {
    const html = this.receiptHTML(t);
    const m = Utils.modal({
      title: `<i class="bi bi-receipt me-2"></i>Receipt · ${Utils.esc(t.id)}`,
      body: `<div class="p-3 bg-light rounded-3">${html}</div>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Close</button>
        <button class="btn btn-primary" id="rcpt-print"><i class="bi bi-printer me-1"></i>Print Receipt</button>`
    });
    m.el.querySelector('#rcpt-print').addEventListener('click', () => Utils.print(html));
    if (autoPrint) setTimeout(() => Utils.print(html), 250);
  },

  /* =========================================================
     TRANSACTION HISTORY
     ========================================================= */
  renderHistory() {
    const s = this.hstate;
    const box = document.getElementById('sales-view');
    box.innerHTML = `<div class="card">
      <div class="card-body border-bottom"><div class="toolbar">
        <div class="search-box"><i class="bi bi-search"></i>
          <input type="search" class="form-control" id="tx-search" placeholder="Search transaction ID, customer or product…" value="${Utils.esc(s.search)}"></div>
        <select class="form-select" id="tx-cust"><option value="">All customers</option><option value="__guest__">Guest only</option>
          ${this.customers.map(c => `<option value="${c.id}">${Utils.esc(c.name)}</option>`).join('')}</select>
        <input type="date" class="form-control" id="tx-from" value="${s.from}" title="From date">
        <input type="date" class="form-control" id="tx-to" value="${s.to}" title="To date">
        <div class="ms-auto d-flex gap-2">
          <button class="btn btn-light" id="tx-clear">Clear</button>
          <button class="btn btn-light" id="tx-export"><i class="bi bi-filetype-csv me-1"></i>Export CSV</button>
        </div>
      </div></div>
      <div class="px-3 py-2 bg-light border-bottom small d-flex flex-wrap gap-3" id="tx-summary"></div>
      <div class="table-wrap"><table class="table table-hover"><thead><tr>
        <th>Transaction ID</th><th>Date & Time</th><th>Customer</th><th>Products</th>
        <th class="text-end">Subtotal</th><th class="text-end">Discount</th><th class="text-end">Total</th><th>Status</th><th>Cashier</th><th class="text-end">Actions</th>
      </tr></thead><tbody id="tx-tbody"></tbody></table></div><div id="tx-pager"></div></div>`;
    box.querySelector('#tx-cust').value = s.customerId;
    box.querySelector('#tx-search').addEventListener('input', Utils.debounce(e => { s.search = e.target.value.trim(); s.page = 1; this.drawHistory(); }));
    box.querySelector('#tx-cust').addEventListener('change', e => { s.customerId = e.target.value; s.page = 1; this.drawHistory(); });
    box.querySelector('#tx-from').addEventListener('change', e => { s.from = e.target.value; s.page = 1; this.drawHistory(); });
    box.querySelector('#tx-to').addEventListener('change', e => { s.to = e.target.value; s.page = 1; this.drawHistory(); });
    box.querySelector('#tx-clear').addEventListener('click', () => { this.hstate = { search: '', from: '', to: '', customerId: '', page: 1 }; this.renderHistory(); });
    box.querySelector('#tx-export').addEventListener('click', () => this.exportCSV(this.filteredHistory()));
    Utils.bindPager(box.querySelector('#tx-pager'), p => { s.page = p; this.drawHistory(); });
    box.querySelector('#tx-tbody').addEventListener('click', e => {
      const vBtn = e.target.closest('[data-void]');
      if (vBtn) {
        const t = this.txns.find(x => x.id === vBtn.dataset.void);
        if (t) this.voidTransaction(t);
        return;
      }
      const b = e.target.closest('[data-tx]');
      if (!b) return;
      const t = this.txns.find(x => x.id === b.dataset.tx);
      if (t) this.showReceipt(t, b.dataset.print === '1');
    });
    this.drawHistory();
  },

  filteredHistory() {
    const s = this.hstate, q = s.search.toLowerCase();
    return this.txns.filter(t => {
      if (s.customerId === '__guest__' && t.customerId) return false;
      if (s.customerId && s.customerId !== '__guest__' && t.customerId !== s.customerId) return false;
      if (!Utils.inDateRange(t.date, s.from, s.to)) return false;
      if (!q) return true;
      const hay = [t.id, t.customerName, t.cashierName, t.status || 'completed', ...t.items.map(i => i.name)].join(' ').toLowerCase();
      return hay.includes(q);
    });
  },

  drawHistory() {
    const list = this.filteredHistory();
    const tot = Stats.totals(list);
    const voidedCount = list.filter(t => t.status === 'voided' || t.status === 'cancelled').length;
    document.getElementById('tx-summary').innerHTML = `
      <span>Completed Transactions: <strong>${Utils.num(tot.count)}</strong></span>
      ${voidedCount > 0 ? `<span class="text-danger">Voided/Cancelled: <strong>${Utils.num(voidedCount)}</strong> (excluded from revenue)</span>` : ''}
      <span>Items sold: <strong>${Utils.num(tot.items)}</strong></span>
      <span>Avg. Order Value: <strong>${Utils.money(tot.avgOrder)}</strong></span>
      <span>Discounts: <strong>${Utils.money(tot.discount)}</strong></span>
      <span>Total revenue: <strong class="text-primary">${Utils.money(tot.revenue)}</strong></span>`;
    const pg = Utils.paginate(list, this.hstate.page, Prefs.get('pageSize'));
    this.hstate.page = pg.page;
    document.getElementById('tx-tbody').innerHTML = pg.items.length ? pg.items.map(t => {
      const isVoid = t.status === 'voided' || t.status === 'cancelled';
      return `<tr class="${isVoid ? 'opacity-75' : ''}">
      <td class="mono">${Utils.esc(t.id)}</td>
      <td class="small text-nowrap">${Utils.fmtDateTime(t.date)}</td>
      <td>${Utils.esc(t.customerName || 'Guest')}</td>
      <td class="small"><div class="text-nowrap-ellipsis" title="${Utils.esc(t.items.map(i => `${i.name} ×${i.qty}`).join(', '))}">
        ${Utils.esc(t.items.map(i => `${i.name} ×${i.qty}`).join(', '))}</div></td>
      <td class="text-end">${Utils.money(t.subtotal)}</td>
      <td class="text-end ${t.discount > 0 ? 'text-danger' : 'text-muted'}">${t.discount > 0 ? '-' + Utils.money(t.discount) : '—'}</td>
      <td class="text-end fw-semibold ${isVoid ? 'text-decoration-line-through text-muted' : ''}">${Utils.money(t.total)}</td>
      <td>${isVoid ? `<span class="badge badge-soft-danger text-capitalize">${Utils.esc(t.status)}</span>` : '<span class="badge badge-soft-success">Completed</span>'}</td>
      <td class="small">${Utils.esc(t.cashierName || '')}</td>
      <td class="text-end text-nowrap">
        <button class="btn btn-light btn-action" data-tx="${t.id}" title="View Receipt"><i class="bi bi-receipt"></i></button>
        <button class="btn btn-light btn-action" data-tx="${t.id}" data-print="1" title="Print Receipt"><i class="bi bi-printer"></i></button>
        ${!isVoid ? `<button class="btn btn-light btn-action text-danger" data-void="${t.id}" title="Void Transaction & Restore Stock"><i class="bi bi-x-circle"></i></button>` : ''}
      </td></tr>`;
    }).join('')
      : Utils.emptyRow(10, 'receipt', 'No transactions found', 'Completed sales matching your filters will appear here.');
    document.getElementById('tx-pager').innerHTML = Utils.pagerHTML(pg);
  },

  async voidTransaction(t) {
    if (t.status === 'voided' || t.status === 'cancelled') return;
    const ok = await Utils.confirm({
      title: `Void Transaction ${t.id}`,
      danger: true,
      confirmText: 'Void & Restore Stock',
      message: `Void transaction <strong>${Utils.esc(t.id)}</strong> (${Utils.money(t.total)})?<br>
        <span class="small text-muted">Sold quantities will be restored to inventory and this transaction will be excluded from sales revenue and trend calculations.</span>`
    });
    if (!ok) return;
    try {
      const now = new Date();
      await DB.run(['products', 'transactions', 'movements'], 'readwrite', async tx => {
        const ps = tx.objectStore('products'), ts = tx.objectStore('transactions'), ms = tx.objectStore('movements');
        const movKeys = await DB.req(ms.getAllKeys());
        let movSeq = movKeys.reduce((m, k) => Math.max(m, parseInt(String(k).replace(/\D/g, ''), 10) || 0), 0);
        for (const item of t.items) {
          const prod = await DB.req(ps.get(item.productId));
          if (!prod) continue;
          const prev = Number(prod.stock) || 0;
          prod.stock = prev + (Number(item.qty) || 0);
          prod.updatedAt = now.toISOString();
          await DB.req(ps.put(prod));
          await DB.req(ms.add(Inventory.buildMovement({
            id: 'MOV-' + Utils.pad(++movSeq, 6), product: prod, type: 'Stock In',
            quantity: item.qty, previousStock: prev, newStock: prod.stock,
            reason: `Voided sale - ${t.id}`, refId: t.id, date: now.toISOString()
          })));
        }
        t.status = 'voided';
        t.voidedAt = now.toISOString();
        await DB.req(ts.put(t));
      });
      Utils.toast(`Transaction ${t.id} voided and stock restored.`);
      await this.load();
      await App.dataChanged();
      this.drawHistory();
    } catch (err) {
      Utils.toast(DB.friendlyError(err), 'danger');
    }
  },

  async exportCSV(list) {
    if (!list) list = (await DB.getAll('transactions')).sort((a, b) => b.date.localeCompare(a.date));
    Utils.exportCSV(`sales-${Utils.stamp()}.csv`, [
      { label: 'Transaction ID', key: 'id' },
      { label: 'Date and Time', value: t => Utils.fmtDateTime(t.date) },
      { label: 'Customer', key: 'customerName' },
      { label: 'Items Count', key: 'itemCount' },
      { label: 'Products Purchased', value: t => t.items.map(i => `${i.name} (${i.qty} x ${i.price})`).join('; ') },
      { label: 'Subtotal', key: 'subtotal' },
      { label: 'Discount', key: 'discount' },
      { label: 'Total', key: 'total' },
      { label: 'Cash Received', key: 'cash' },
      { label: 'Change', key: 'change' },
      { label: 'Cashier', key: 'cashierName' }
    ], list);
  }
};

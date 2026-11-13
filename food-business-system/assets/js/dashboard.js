/* =========================================================
   dashboard.js - Business overview computed from stored data
   Includes Expiration Alerts, Sales Trends & Period Comparison,
   Best-Sellers (by Qty & Revenue), and Slow-Moving Products.
   ========================================================= */
'use strict';

const Dashboard = {
  title: 'Dashboard',
  subtitle: 'Overview of today\'s sales, shelf-life alerts, sales trends and inventory performance',
  bestSort: 'qty',
  trendMode: 'daily',

  async render(el) {
    if (typeof Prefs !== 'undefined' && typeof Prefs.syncProductImages === 'function') {
      await Prefs.syncProductImages();
    }
    const [allProducts, txns, categories] = await Promise.all([DB.getAll('products'), DB.getAll('transactions'), DB.getAll('categories')]);
    const menuProducts = allProducts.filter(p => !p.isIngredient && !String(p.id || '').startsWith('ING-'));
    const ingredients = allProducts.filter(p => p.isIngredient || String(p.id || '').startsWith('ING-'));
    this.products = menuProducts;
    this.ingredients = ingredients;
    this.txns = Stats.completed(txns).sort((a, b) => b.date.localeCompare(a.date));
    this.allTxnsCount = txns.length;
    this.categories = categories;

    const now = new Date();
    const today = Stats.totals(Stats.between(this.txns, Utils.startOfDay(now), Utils.endOfDay(now)));
    const yesterday = Stats.totals(Stats.between(this.txns, Utils.startOfDay(Utils.addDays(now, -1)), Utils.endOfDay(Utils.addDays(now, -1))));
    const active = menuProducts.filter(p => p.status === 'active');
    const activeIngredients = ingredients.filter(p => p.status === 'active');
    const status = { in: 0, low: 0, out: 0 };
    activeIngredients.forEach(p => status[Utils.stockStatus(p).key]++);
    const change = yesterday.revenue > 0 ? ((today.revenue - yesterday.revenue) / yesterday.revenue) * 100 : null;
    const changeHtml = change === null
      ? (today.revenue > 0 ? 'No sales yesterday' : 'No sales yet today')
      : `<span class="${change >= 0 ? 'text-success' : 'text-danger'}"><i class="bi bi-arrow-${change >= 0 ? 'up' : 'down'}-short"></i>${Math.abs(change).toFixed(1)}%</span> vs yesterday`;

    // Gather shelf-life & expiration summary across raw ingredients in Inventory
    const expBatches = [];
    let expiredUnits = 0, verySoonUnits = 0, nearingUnits = 0, safeUnits = 0;
    const ingCats = (typeof Prefs !== 'undefined' && Array.isArray(Prefs.INGREDIENT_CATEGORIES)) ? Prefs.INGREDIENT_CATEGORIES : [];
    const catMap = new Map([...categories, ...ingCats].map(c => [c.id, c.name]));
    activeIngredients.forEach(p => {
      const sum = Utils.productShelfSummary(p, now);
      expiredUnits += sum.expiredQty;
      verySoonUnits += sum.expiringVerySoonQty;
      nearingUnits += sum.nearingQty;
      safeUnits += sum.safeQty;
      sum.batches.forEach(b => {
        if (b.status.key !== 'safe') {
          expBatches.push({
            productId: p.id,
            productName: p.name,
            category: p.categoryName || catMap.get(p.categoryId) || 'Kitchen Supply',
            unit: p.unit,
            batchId: b.id,
            dateReceived: b.dateReceived,
            expirationDate: b.expirationDate,
            qty: b.qty,
            status: b.status
          });
        }
      });
    });
    expBatches.sort((a, b) => a.status.days - b.status.days || a.productName.localeCompare(b.productName));

    const range = Prefs.get('dashboardRange') || '7';
    const last = Prefs.get('lastBackup');
    const needBackup = Auth.can('settings') && (!last || (Date.now() - new Date(last).getTime()) / 86400000 >= 7);
    const th = Utils.expiryThresholds();

    el.innerHTML = `
      ${needBackup ? `<div class="alert alert-soft-info d-flex align-items-center gap-2 mb-3"><i class="bi bi-cloud-arrow-down fs-5"></i>
        <div class="flex-grow-1">Your records are stored only in this browser. ${last ? `Last backup: ${Utils.fmtDateTime(last)}.` : 'You have not made a backup yet.'}</div>
        <a href="#/settings" class="btn btn-sm btn-outline-primary">Back up now</a></div>` : ''}

      ${Auth.can('inventory') && (expiredUnits > 0 || verySoonUnits > 0) && Prefs.get('expiryAlerts') !== false ? `
      <div class="alert ${expiredUnits > 0 ? 'alert-soft-danger' : 'alert-soft-orange'} d-flex flex-wrap align-items-center gap-2 mb-3">
        <i class="bi bi-${expiredUnits > 0 ? 'calendar-x' : 'hourglass-bottom'} fs-5"></i>
        <div class="flex-grow-1 small">
          <strong>Ingredient Expiration Alert:</strong>
          ${expiredUnits > 0 ? `<span class="fw-semibold">${Utils.num(expiredUnits)} ingredient unit(s) expired</span>` : ''}
          ${expiredUnits > 0 && verySoonUnits > 0 ? ' · ' : ''}
          ${verySoonUnits > 0 ? `<span class="fw-semibold">${Utils.num(verySoonUnits)} unit(s) expiring within ${th.verySoon} day(s)</span>` : ''}
          ${nearingUnits > 0 ? ` · <span>${Utils.num(nearingUnits)} unit(s) nearing expiration (≤${th.near}d)</span>` : ''}.
          FEFO (First Expired, First Out) is active for kitchen inventory batches.
        </div>
        <a href="#/inventory" class="btn btn-sm ${expiredUnits > 0 ? 'btn-danger' : 'btn-outline-dark'}" id="dash-open-expiring">
          <i class="bi bi-hourglass-split me-1"></i>Review Batches
        </a>
      </div>` : ''}

      <div class="row g-3 mb-3">
        <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'cash-coin', tone: 'green', label: "Today's Sales", value: Utils.money(today.revenue), sub: changeHtml })}</div>
        <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'receipt', tone: 'blue', label: 'Total Transactions', value: Utils.num(this.txns.length), sub: `${today.count} today · Avg ${Utils.money(today.avgOrder)}` })}</div>
        <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'box-seam', tone: 'purple', label: 'Menu Products', value: Utils.num(menuProducts.length), sub: `${active.length} active on POS` })}</div>
        <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'check2-circle', tone: 'teal', label: 'Raw Ingredients', value: Utils.num(activeIngredients.length), sub: `${status.in} in stock` })}</div>
        <div class="col-6 col-md-4 col-xl-2">${Auth.can('inventory') ? `<a href="#/inventory" class="text-decoration-none text-reset">${Utils.statCard({ icon: 'exclamation-triangle', tone: 'amber', label: 'Low Stock', value: Utils.num(status.low), sub: 'At or below reorder level' })}</a>` : Utils.statCard({ icon: 'exclamation-triangle', tone: 'amber', label: 'Low Stock', value: Utils.num(status.low), sub: 'At or below reorder level' })}</div>
        <div class="col-6 col-md-4 col-xl-2">${Auth.can('inventory') ? `<a href="#/inventory" class="text-decoration-none text-reset">${Utils.statCard({ icon: 'x-octagon', tone: 'red', label: 'Out of Stock', value: Utils.num(status.out), sub: 'Needs restocking' })}</a>` : Utils.statCard({ icon: 'x-octagon', tone: 'red', label: 'Out of Stock', value: Utils.num(status.out), sub: 'Needs restocking' })}</div>
      </div>

      <!-- Date Filter & Period Comparison Bar -->
      <div class="card mb-3">
        <div class="card-body py-2 d-flex flex-wrap align-items-center gap-2 border-bottom">
          <span class="fw-semibold small"><i class="bi bi-calendar3 me-1"></i>Sales Analysis Period</span>
          <select class="form-select form-select-sm" id="dash-range" aria-label="Sales analysis period" style="width:auto">
            <option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option>
            <option value="month">This month</option><option value="custom">Custom range</option></select>
          <div class="d-flex gap-2 align-items-center ${range === 'custom' ? '' : 'd-none'}" id="dash-custom">
            <input type="date" class="form-control form-control-sm" id="dash-from" aria-label="Custom start date"><span class="small">to</span>
            <input type="date" class="form-control form-control-sm" id="dash-to" aria-label="Custom end date"></div>
          <span class="small text-muted ms-auto" id="dash-range-label"></span>
        </div>
        <!-- Sales Trends & Period Comparison Widget -->
        <div class="card-body py-2 bg-light" id="dash-trend-summary"></div>
      </div>

      <div class="row g-3 mb-3">
        <div class="col-xl-8">
          <div class="card h-100">
            <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <span>Sales Trends</span>
                <span class="small text-muted fw-normal ms-1" id="daily-total"></span>
              </div>
              <div class="btn-group btn-group-sm" id="dash-trend-mode" role="group" aria-label="Trend granularity">
                <button type="button" class="btn ${this.trendMode === 'daily' ? 'btn-primary' : 'btn-light'}" data-tmode="daily">Daily</button>
                <button type="button" class="btn ${this.trendMode === 'weekly' ? 'btn-primary' : 'btn-light'}" data-tmode="weekly">Weekly</button>
                <button type="button" class="btn ${this.trendMode === 'monthly' ? 'btn-primary' : 'btn-light'}" data-tmode="monthly">Monthly</button>
              </div>
            </div>
            <div class="card-body">
              <div class="chart-box"><canvas id="chart-daily"></canvas></div>
              <div class="mt-2 pt-2 border-top small d-flex flex-wrap gap-3 align-items-center" id="dash-peak-insights"></div>
            </div>
          </div>
        </div>
        <div class="col-xl-4"><div class="card h-100"><div class="card-header">Inventory Status</div>
          <div class="card-body"><div class="chart-box" id="inv-chart-box"><canvas id="chart-inventory"></canvas></div></div></div></div>
      </div>

      <div class="row g-3 mb-3">
        <div class="col-lg-6"><div class="card h-100"><div class="card-header">Weekly Sales <span class="small text-muted fw-normal">(last 8 weeks)</span></div>
          <div class="card-body"><div class="chart-box sm"><canvas id="chart-weekly"></canvas></div></div></div></div>
        <div class="col-lg-6"><div class="card h-100"><div class="card-header">Monthly Sales <span class="small text-muted fw-normal">(last 12 months)</span></div>
          <div class="card-body"><div class="chart-box sm"><canvas id="chart-monthly"></canvas></div></div></div></div>
      </div>

      <!-- Best-Selling Products & Rankings -->
      <div class="row g-3 mb-3">
        <div class="col-lg-5">
          <div class="card h-100">
            <div class="card-header d-flex justify-content-between align-items-center">
              <span>Best-Selling Products <span class="small text-muted fw-normal">(selected range)</span></span>
              <div class="btn-group btn-group-sm" id="dash-best-sort">
                <button type="button" class="btn ${this.bestSort === 'qty' ? 'btn-primary' : 'btn-light'}" data-bsort="qty">By Qty</button>
                <button type="button" class="btn ${this.bestSort === 'revenue' ? 'btn-primary' : 'btn-light'}" data-bsort="revenue">By Revenue</button>
              </div>
            </div>
            <div class="card-body" id="best-chart-body"><div class="chart-box sm"><canvas id="chart-best"></canvas></div></div>
          </div>
        </div>
        <div class="col-lg-7">
          <div class="card h-100">
            <div class="card-header d-flex justify-content-between align-items-center">
              <span>Best-Sellers Ranking <span class="small text-muted fw-normal" id="best-sort-label">(ranked by quantity sold)</span></span>
              <a href="#/reports" class="btn btn-sm btn-soft">Full Report</a>
            </div>
            <div class="table-wrap"><table class="table table-sm">
              <thead><tr><th>#</th><th>Product</th><th class="text-end">Qty Sold</th><th class="text-end">Revenue</th><th class="text-end">Share</th></tr></thead>
              <tbody id="best-table"></tbody></table></div>
          </div>
        </div>
      </div>

      <!-- Expiration Alerts Widget & Slow-Moving Products Section -->
      <div class="row g-3 mb-3">
        <div class="col-xl-6">
          <div class="card h-100">
            <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span><i class="bi bi-hourglass-split text-warning me-1"></i>Expiration &amp; Shelf-Life Alerts</span>
              <div class="d-flex flex-wrap gap-1 align-items-center">
                <span class="badge badge-soft-danger" title="Expired units">${Utils.num(expiredUnits)} Expired</span>
                <span class="badge badge-soft-orange" title="Expiring very soon">${Utils.num(verySoonUnits)} Very Soon</span>
                <span class="badge badge-soft-warning" title="Nearing expiration">${Utils.num(nearingUnits)} Nearing</span>
                <span class="badge badge-soft-success" title="Safe units">${Utils.num(safeUnits)} Safe</span>
                ${Auth.can('inventory') ? '<a href="#/inventory" class="btn btn-sm btn-soft ms-1" id="dash-manage-expiry">Batches</a>' : ''}
              </div>
            </div>
            <div class="table-wrap">
              <table class="table table-sm table-hover">
                <thead><tr><th>Ingredient &amp; Batch</th><th>Expiration</th><th class="text-end">Qty</th><th>Shelf-Life Status</th></tr></thead>
                <tbody>${this.expirationRows(expBatches)}</tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="col-xl-6">
          <div class="card h-100">
            <div class="card-header d-flex justify-content-between align-items-center">
              <span><i class="bi bi-turtle text-secondary me-1"></i>Slow-Moving Products <span class="small text-muted fw-normal">(selected range)</span></span>
              <a href="#/reports" class="btn btn-sm btn-soft">Analyze</a>
            </div>
            <div class="table-wrap">
              <table class="table table-sm table-hover">
                <thead><tr><th>Product</th><th class="text-end">In Stock</th><th class="text-end">Sold in Period</th><th class="text-end">Tied Capital</th><th>Stock Status</th></tr></thead>
                <tbody id="slow-table"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="row g-3">
        <div class="col-xl-7"><div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center">Recent Transactions
            ${Auth.can('sales') ? '<a href="#/sales" class="btn btn-sm btn-soft">Open POS</a>' : ''}</div>
          <div class="table-wrap"><table class="table table-sm table-hover"><thead><tr><th>Transaction</th><th>Date & Time</th><th class="text-end">Items</th><th class="text-end">Total</th></tr></thead>
          <tbody>${this.recentRows()}</tbody></table></div></div></div>
        <div class="col-xl-5"><div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center">Low Stock Ingredients
            ${Auth.can('inventory') ? '<a href="#/inventory" class="btn btn-sm btn-soft">Manage</a>' : ''}</div>
          <div class="table-wrap"><table class="table table-sm"><thead><tr><th>Ingredient</th><th class="text-end">Stock</th><th class="text-end">Reorder</th><th>Status</th></tr></thead>
          <tbody>${this.lowRows()}</tbody></table></div></div></div>
      </div>`;

    const openExp = el.querySelector('#dash-open-expiring');
    if (openExp) openExp.addEventListener('click', () => { Inventory.view = 'expiring'; });
    const manageExp = el.querySelector('#dash-manage-expiry');
    if (manageExp) manageExp.addEventListener('click', () => { Inventory.view = 'expiring'; });

    const sel = el.querySelector('#dash-range');
    sel.value = range;
    const from = el.querySelector('#dash-from'), to = el.querySelector('#dash-to');
    to.value = Utils.dateKey(now);
    from.value = Utils.dateKey(Utils.addDays(now, -13));
    sel.addEventListener('change', () => {
      Prefs.set('dashboardRange', sel.value);
      el.querySelector('#dash-custom').classList.toggle('d-none', sel.value !== 'custom');
      this.renderRangeCharts();
    });
    [from, to].forEach(i => i.addEventListener('change', () => this.renderRangeCharts()));

    el.querySelector('#dash-trend-mode').addEventListener('click', e => {
      const b = e.target.closest('[data-tmode]');
      if (!b) return;
      this.trendMode = b.dataset.tmode;
      el.querySelectorAll('#dash-trend-mode .btn').forEach(x => {
        x.classList.toggle('btn-primary', x === b);
        x.classList.toggle('btn-light', x !== b);
      });
      this.renderRangeCharts();
    });

    el.querySelector('#dash-best-sort').addEventListener('click', e => {
      const b = e.target.closest('[data-bsort]');
      if (!b) return;
      this.bestSort = b.dataset.bsort;
      el.querySelectorAll('#dash-best-sort .btn').forEach(x => {
        x.classList.toggle('btn-primary', x === b);
        x.classList.toggle('btn-light', x !== b);
      });
      this.renderRangeCharts();
    });

    this.renderStaticCharts(status);
    this.renderRangeCharts();
  },

  expirationRows(expBatches) {
    const list = expBatches.slice(0, 7);
    if (!list.length) return Utils.emptyRow(4, 'shield-check', 'All stock is safe', 'No batches are expired or nearing expiration.');
    return list.map(b => `<tr>
      <td><div class="cell-title small">${Utils.esc(b.productName)}</div><div class="cell-sub mono">${Utils.esc(b.batchId)} · ${Utils.esc(b.category)}</div></td>
      <td class="small"><div>${Utils.fmtDate(b.expirationDate)}</div><div class="cell-sub">${Utils.esc(b.status.daysText)}</div></td>
      <td class="text-end fw-semibold">${Utils.num(b.qty)} <span class="cell-sub">${Utils.esc(b.unit)}</span></td>
      <td>${Utils.shelfBadge(b.status)}</td>
    </tr>`).join('');
  },

  getRange() {
    const now = new Date();
    const v = document.getElementById('dash-range').value;
    if (v === 'month') return [Utils.startOfMonth(now), Utils.endOfDay(now)];
    if (v === 'custom') {
      let a = Utils.parseDate(document.getElementById('dash-from').value) || Utils.addDays(now, -6);
      let b = Utils.parseDate(document.getElementById('dash-to').value) || now;
      if (a > b) [a, b] = [b, a];
      if ((b - a) / 86400000 > 366) a = Utils.addDays(b, -366);
      return [Utils.startOfDay(a), Utils.endOfDay(b)];
    }
    return [Utils.startOfDay(Utils.addDays(now, -(parseInt(v, 10) - 1))), Utils.endOfDay(now)];
  },

  recentRows() {
    const list = this.txns.slice(0, 8);
    if (!list.length) return Utils.emptyRow(4, 'receipt', 'No transactions yet', 'Completed sales will appear here.');
    return list.map(t => `<tr><td class="mono">${Utils.esc(t.id)}</td><td class="small">${Utils.fmtDateTime(t.date)}</td>
      <td class="text-end small">${Utils.num(t.itemCount)}</td><td class="text-end fw-semibold">${Utils.money(t.total)}</td></tr>`).join('');
  },

  lowRows() {
    const source = (this.ingredients && this.ingredients.length) ? this.ingredients : this.products;
    const list = source.filter(p => p.status === 'active' && Utils.stockStatus(p).key !== 'in')
      .sort((a, b) => a.stock - b.stock).slice(0, 8);
    if (!list.length) return Utils.emptyRow(4, 'check2-circle', 'Stock levels look good', 'No ingredients are at or below their reorder level.');
    return list.map(p => `<tr><td><div class="cell-title small">${Utils.esc(p.name)}</div><div class="cell-sub">${Utils.esc(p.id)}</div></td>
      <td class="text-end">${Utils.num(p.stock)} <span class="cell-sub">${Utils.esc(p.unit)}</span></td><td class="text-end">${p.reorderLevel}</td><td>${Utils.stockBadge(p)}</td></tr>`).join('');
  },

  baseLineOptions(isMoney = true) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => isMoney ? ' ' + Utils.money(c.parsed.y) : ' ' + c.parsed.y } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => isMoney ? Utils.currencySymbol() + Utils.num(v) : v } }, x: { grid: { display: false } } }
    };
  },

  renderStaticCharts(status) {
    const weekly = Stats.byWeek(this.txns, 8);
    Utils.chart(document.getElementById('chart-weekly'), {
      type: 'bar',
      data: { labels: weekly.map(w => Utils.fmtShort(w.start)), datasets: [{ data: weekly.map(w => w.revenue), backgroundColor: '#16a34a', borderRadius: 6, maxBarThickness: 36 }] },
      options: { ...this.baseLineOptions(), plugins: { legend: { display: false }, tooltip: { callbacks: { title: c => weekly[c[0].dataIndex].label, label: c => ' ' + Utils.money(c.parsed.y) + ` · ${weekly[c.dataIndex].count} txns` } } } }
    });
    const monthly = Stats.byMonth(this.txns, 12);
    Utils.chart(document.getElementById('chart-monthly'), {
      type: 'line',
      data: { labels: monthly.map(m => m.label), datasets: [{ data: monthly.map(m => m.revenue), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.12)', fill: true, tension: .35, pointRadius: 3 }] },
      options: this.baseLineOptions()
    });
    const total = status.in + status.low + status.out;
    if (!total) {
      document.getElementById('inv-chart-box').innerHTML = Utils.emptyState('box', 'No active products', 'Add products to see inventory status.');
    } else {
      Utils.chart(document.getElementById('chart-inventory'), {
        type: 'doughnut',
        data: { labels: ['In Stock', 'Low Stock', 'Out of Stock'], datasets: [{ data: [status.in, status.low, status.out], backgroundColor: ['#16a34a', '#f59e0b', '#ef4444'], borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom' } } }
      });
    }
  },

  fmtDelta(val) {
    if (val === null || val === undefined || isNaN(val)) {
      return '<span class="text-muted small">Insufficient prior period data</span>';
    }
    const up = val >= 0;
    return `<span class="small fw-semibold ${up ? 'text-success' : 'text-danger'}"><i class="bi bi-arrow-${up ? 'up' : 'down'}-short"></i>${Math.abs(val).toFixed(1)}%</span> <span class="text-muted small">vs prev period</span>`;
  },

  renderRangeCharts() {
    const [from, to] = this.getRange();
    const inRange = Stats.between(this.txns, from, to);
    const cmp = Stats.comparePeriods(this.txns, from, to);
    const totals = cmp.current;
    document.getElementById('dash-range-label').textContent = `${Utils.fmtDate(from)} – ${Utils.fmtDate(to)} (${cmp.days}d)`;
    document.getElementById('daily-total').textContent = `${Utils.money(totals.revenue)} · ${totals.count} txns · Avg ${Utils.money(totals.avgOrder)}`;

    // Period Comparison Summary Bar
    const summaryEl = document.getElementById('dash-trend-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="row g-2 align-items-stretch small">
          <div class="col-6 col-md-3">
            <div class="trend-kpi-tile">
              <div class="prod-metric-label">Period Revenue</div>
              <div class="fw-bold fs-5 text-primary">${Utils.money(totals.revenue)}</div>
              <div class="mt-1">${this.fmtDelta(cmp.deltas.revenue)}</div>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="trend-kpi-tile">
              <div class="prod-metric-label">Transactions</div>
              <div class="fw-bold fs-5">${Utils.num(totals.count)}</div>
              <div class="mt-1">${this.fmtDelta(cmp.deltas.count)}</div>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="trend-kpi-tile">
              <div class="prod-metric-label">Avg. Transaction Value</div>
              <div class="fw-bold fs-5">${Utils.money(totals.avgOrder)}</div>
              <div class="mt-1">${this.fmtDelta(cmp.deltas.avgOrder)}</div>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="trend-kpi-tile">
              <div class="prod-metric-label">Products Sold</div>
              <div class="fw-bold fs-5">${Utils.num(totals.items)} <span class="fw-normal small text-muted">units</span></div>
              <div class="mt-1">${this.fmtDelta(cmp.deltas.items)}</div>
            </div>
          </div>
        </div>
        ${!cmp.sufficientForComparison ? `<div class="small text-muted mt-2"><i class="bi bi-info-circle me-1"></i>Insufficient sales history in either the selected or preceding period (${Utils.fmtDate(cmp.prevFrom)} – ${Utils.fmtDate(cmp.prevTo)}) for a full period-over-period comparison.</div>` : ''}`;
    }

    // Peak Sales Day & Hour insights
    const peaks = Stats.peakPatterns(inRange);
    const peakEl = document.getElementById('dash-peak-insights');
    if (peakEl) {
      if (!peaks.sufficient) {
        peakEl.innerHTML = `<span class="text-muted"><i class="bi bi-info-circle me-1"></i><strong>Peak Sales Insights:</strong> Insufficient sales history in this range (${peaks.validTimestamps} transaction${peaks.validTimestamps === 1 ? '' : 's'} across ${peaks.distinctDays} day${peaks.distinctDays === 1 ? '' : 's'}). At least 3 completed transactions across 2+ days are required to identify reliable peak days and hours.</span>`;
      } else {
        peakEl.innerHTML = `
          <span class="badge badge-soft-success"><i class="bi bi-calendar-event me-1"></i>Peak Sales Day: ${Utils.esc(peaks.peakDay.label)} (${Utils.money(peaks.peakDay.revenue)} · ${peaks.peakDay.count} txns)</span>
          <span class="badge badge-soft-info"><i class="bi bi-clock-history me-1"></i>Peak Sales Hour: ${Utils.esc(peaks.peakHour.label)} (${Utils.money(peaks.peakHour.revenue)} · ${peaks.peakHour.count} txns)</span>`;
      }
    }

    // Re-create range charts
    ['chart-daily', 'chart-best'].forEach(id => { const c = Chart.getChart(id); if (c) c.destroy(); });
    let buckets;
    if (this.trendMode === 'weekly') buckets = Stats.groupRange(inRange, from, to, 'week');
    else if (this.trendMode === 'monthly') buckets = Stats.groupRange(inRange, from, to, 'month');
    else buckets = Stats.byDay(inRange, from, to);

    Utils.chart(document.getElementById('chart-daily'), {
      type: this.trendMode === 'monthly' ? 'line' : 'bar',
      data: {
        labels: buckets.map(d => d.label),
        datasets: [{
          data: buckets.map(d => d.revenue),
          backgroundColor: this.trendMode === 'monthly' ? 'rgba(22,163,74,.15)' : 'rgba(22,163,74,.85)',
          borderColor: '#16a34a',
          fill: this.trendMode === 'monthly',
          tension: .3,
          borderRadius: 6,
          maxBarThickness: 32
        }]
      },
      options: this.baseLineOptions()
    });

    // Best-Selling Products (sorted by qty or revenue)
    const isRev = this.bestSort === 'revenue';
    const best = Stats.productSales(inRange, this.bestSort);
    const sortLabel = document.getElementById('best-sort-label');
    if (sortLabel) sortLabel.textContent = isRev ? '(ranked by highest revenue)' : '(ranked by quantity sold)';

    const body = document.getElementById('best-chart-body');
    if (!best.length) {
      body.innerHTML = Utils.emptyState('bar-chart', 'No sales in this period', 'Try selecting a wider date range.');
    } else {
      if (!document.getElementById('chart-best')) body.innerHTML = '<div class="chart-box sm"><canvas id="chart-best"></canvas></div>';
      const top = best.slice(0, 5);
      Utils.chart(document.getElementById('chart-best'), {
        type: 'bar',
        data: {
          labels: top.map(b => b.name),
          datasets: [{
            data: top.map(b => isRev ? b.revenue : b.qty),
            backgroundColor: Utils.palette.slice(0, top.length),
            borderRadius: 6
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => isRev ? ` ${Utils.money(c.parsed.x)}` : ` ${c.parsed.x} sold` } }
          },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0, callback: v => isRev ? Utils.currencySymbol() + Utils.num(v) : v } },
            y: { grid: { display: false } }
          }
        }
      });
    }
    document.getElementById('best-table').innerHTML = best.length
      ? best.slice(0, 6).map((b, i) => `<tr>
          <td><span class="badge ${i < 3 ? 'badge-soft-success' : 'badge-soft-secondary'}">${i + 1}</span></td>
          <td><div class="fw-semibold small">${Utils.esc(b.name)}</div><div class="cell-sub">${Utils.esc(b.category)}</div></td>
          <td class="text-end ${!isRev ? 'fw-bold' : ''}">${Utils.num(b.qty)}</td>
          <td class="text-end ${isRev ? 'fw-bold text-primary' : ''}">${Utils.money(b.revenue)}</td>
          <td class="text-end small text-muted">${(isRev ? b.revenueShare : b.qtyShare).toFixed(1)}%</td>
        </tr>`).join('')
      : Utils.emptyRow(5, 'trophy', 'No best-sellers yet', 'Sales in the selected range will be ranked here.');

    // Slow-Moving Products Table
    const slow = Stats.slowMovers(this.products, inRange, this.categories).slice(0, 6);
    const slowBody = document.getElementById('slow-table');
    if (slowBody) {
      slowBody.innerHTML = slow.length
        ? slow.map(s => {
            const prod = this.products.find(p => p.id === s.productId);
            return `<tr>
              <td><div class="cell-title small">${Utils.esc(s.name)}</div><div class="cell-sub">${Utils.esc(s.category)}</div></td>
              <td class="text-end">${Utils.num(s.stock)} <span class="cell-sub">${Utils.esc(s.unit)}</span></td>
              <td class="text-end">${s.qty === 0 ? '<span class="badge badge-soft-secondary">0 sold</span>' : `${Utils.num(s.qty)} (${s.txns} txn)`}</td>
              <td class="text-end small">${Utils.money(s.stockValueCost)}</td>
              <td>${prod ? Utils.stockBadge(prod) : '—'}</td>
            </tr>`;
          }).join('')
        : Utils.emptyRow(5, 'box', 'No active products to evaluate');
    }
  }
};

/* =========================================================
   reports.js - Sales, Trends, Best-Sellers, Slow-Movers &
   Inventory / Shelf-Life Reports.
   All statistics are derived from stored completed transactions
   and inventory records. Cancelled/voided sales are excluded.
   ========================================================= */
'use strict';

const Reports = {
  title: 'Reports',
  subtitle: 'Analyze sales trends, period comparisons, best-sellers, slow-moving products and shelf-life status',
  state: { type: 'daily', preset: '30', from: '', to: '', search: '', category: '', bestSort: 'qty', page: 1 },

  TYPES: [
    { key: 'daily', label: 'Daily Sales Report', icon: 'calendar-day', usesDate: true },
    { key: 'weekly', label: 'Weekly Sales Report', icon: 'calendar-week', usesDate: true },
    { key: 'monthly', label: 'Monthly Sales Report', icon: 'calendar-month', usesDate: true },
    { key: 'transactions', label: 'Sales Transaction Report', icon: 'receipt', usesDate: true },
    { key: 'product-sales', label: 'Product Sales Report', icon: 'bag-check', usesDate: true },
    { key: 'best-sellers', label: 'Best-Selling Products', icon: 'trophy', usesDate: true },
    { key: 'slow-movers', label: 'Slow-Moving Products', icon: 'turtle', usesDate: true },
    { key: 'inventory', label: 'Inventory Report', icon: 'boxes', usesDate: false },
    { key: 'low-stock', label: 'Low Stock Report', icon: 'exclamation-triangle', usesDate: false },
    { key: 'expiration', label: 'Expiration & Shelf-Life', icon: 'hourglass-split', usesDate: false }
  ],

  async render(el) {
    if (typeof Prefs !== 'undefined' && typeof Prefs.syncProductImages === 'function') {
      await Prefs.syncProductImages();
    }
    const [allProducts, categories, rawTxns] = await Promise.all([
      DB.getAll('products'), DB.getAll('categories'), DB.getAll('transactions')
    ]);
    this.menuProducts = allProducts.filter(p => !p.isIngredient && !String(p.id || '').startsWith('ING-'));
    this.ingredients = allProducts.filter(p => p.isIngredient || String(p.id || '').startsWith('ING-'));
    this.products = this.menuProducts;
    const ingCats = (typeof Prefs !== 'undefined' && Array.isArray(Prefs.INGREDIENT_CATEGORIES)) ? Prefs.INGREDIENT_CATEGORIES : [];
    const catMap = new Map();
    [...categories, ...ingCats].forEach(c => { if (c && c.id) catMap.set(c.id, c); });
    this.categories = Array.from(catMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    this.allTxns = rawTxns;
    this.txns = Stats.completed(rawTxns).sort((a, b) => b.date.localeCompare(a.date));
    this.applyPreset(this.state.preset, false);

    el.innerHTML = `
      <div class="row g-3 mb-3" id="rep-kpis"></div>

      <!-- Sales Trends, Period Comparison & Peak Hours Panel -->
      <div class="card mb-3" id="rep-trends-card">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span><i class="bi bi-graph-up-arrow text-primary me-1"></i>Sales Trends, Period Comparison &amp; Peak Activity</span>
          <span class="small text-muted fw-normal" id="rep-cmp-range"></span>
        </div>
        <div class="card-body">
          <div class="row g-3 align-items-stretch" id="rep-trends-body"></div>
        </div>
      </div>

      <!-- Report selector & filters -->
      <div class="card mb-3">
        <div class="card-body">
          <div class="d-flex flex-wrap gap-1 mb-3" id="rep-tabs">
            ${this.TYPES.map(t => `<button type="button" class="btn btn-sm ${this.state.type === t.key ? 'btn-primary' : 'btn-light'}" data-rtype="${t.key}">
              <i class="bi bi-${t.icon} me-1"></i>${t.label}</button>`).join('')}
          </div>
          <div class="toolbar">
            <div class="search-box"><i class="bi bi-search"></i>
              <input type="search" class="form-control" id="rep-search" placeholder="Search in report…" value="${Utils.esc(this.state.search)}"></div>
            <select class="form-select" id="rep-cat"><option value="">All categories</option>
              ${this.categories.map(c => `<option value="${c.id}">${Utils.esc(c.name)}</option>`).join('')}</select>
            <div class="d-flex flex-wrap gap-2 align-items-center" id="rep-date-controls">
              <select class="form-select" id="rep-preset">
                <option value="today">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option><option value="month">This month</option><option value="year">This year</option>
                <option value="all">All time</option><option value="custom">Custom range</option>
              </select>
              <input type="date" class="form-control" id="rep-from" value="${this.state.from}" title="From date">
              <span class="small text-muted">to</span>
              <input type="date" class="form-control" id="rep-to" value="${this.state.to}" title="To date">
            </div>
            <div class="btn-group btn-group-sm ${this.state.type === 'best-sellers' ? '' : 'd-none'}" id="rep-best-sort-wrap">
              <button type="button" class="btn ${this.state.bestSort === 'qty' ? 'btn-primary' : 'btn-light'}" data-rbsort="qty">Rank by Qty Sold</button>
              <button type="button" class="btn ${this.state.bestSort === 'revenue' ? 'btn-primary' : 'btn-light'}" data-rbsort="revenue">Rank by Revenue</button>
            </div>
            <div class="ms-auto d-flex gap-2">
              <button class="btn btn-light" id="rep-csv"><i class="bi bi-filetype-csv me-1"></i>Export CSV</button>
              <button class="btn btn-primary" id="rep-print"><i class="bi bi-printer me-1"></i>Print Report</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Report chart + table -->
      <div class="card mb-3">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div><span id="rep-title"></span> <span class="text-muted small fw-normal" id="rep-range"></span></div>
          <div class="small text-muted fw-normal" id="rep-sub"></div>
        </div>
        <div class="card-body border-bottom" id="rep-chart-wrap"><div class="chart-box"><canvas id="rep-chart"></canvas></div></div>
        <div class="table-wrap"><table class="table table-hover" id="rep-table"></table></div>
        <div id="rep-pager"></div>
      </div>

      <!-- Best-Selling vs Slow-Moving Products Side-by-Side Analytics -->
      <div class="row g-3" id="rep-bottom-analytics">
        <div class="col-lg-6">
          <div class="card h-100">
            <div class="card-header d-flex justify-content-between align-items-center">
              <span><i class="bi bi-trophy text-success me-1"></i>Best-Selling Products Ranking</span>
              <span class="small text-muted fw-normal">By Quantity &amp; Revenue</span>
            </div>
            <div class="table-wrap">
              <table class="table table-sm table-hover">
                <thead><tr><th>#</th><th>Product</th><th class="text-end">Qty Sold</th><th class="text-end">Revenue</th><th class="text-end">Share</th></tr></thead>
                <tbody id="rep-best-summary"></tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="col-lg-6">
          <div class="card h-100">
            <div class="card-header d-flex justify-content-between align-items-center">
              <span><i class="bi bi-turtle text-secondary me-1"></i>Slow-Moving Products</span>
              <span class="small text-muted fw-normal">Lowest turnover in selected period</span>
            </div>
            <div class="table-wrap">
              <table class="table table-sm table-hover">
                <thead><tr><th>Product</th><th class="text-end">Stock</th><th class="text-end">Units Sold</th><th class="text-end">Revenue</th><th>Stock Status</th></tr></thead>
                <tbody id="rep-slow-summary"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>`;

    const s = this.state;
    el.querySelector('#rep-preset').value = s.preset;
    el.querySelector('#rep-cat').value = s.category;
    el.querySelector('#rep-tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-rtype]');
      if (!b) return;
      s.type = b.dataset.rtype; s.page = 1;
      el.querySelectorAll('#rep-tabs .btn').forEach(x => {
        x.classList.toggle('btn-primary', x === b);
        x.classList.toggle('btn-light', x !== b);
      });
      this.draw();
    });
    el.querySelector('#rep-best-sort-wrap').addEventListener('click', e => {
      const b = e.target.closest('[data-rbsort]');
      if (!b) return;
      s.bestSort = b.dataset.rbsort;
      el.querySelectorAll('#rep-best-sort-wrap .btn').forEach(x => {
        x.classList.toggle('btn-primary', x === b);
        x.classList.toggle('btn-light', x !== b);
      });
      this.draw();
    });
    el.querySelector('#rep-search').addEventListener('input', Utils.debounce(e => { s.search = e.target.value.trim(); s.page = 1; this.drawTableOnly(); }));
    el.querySelector('#rep-cat').addEventListener('change', e => { s.category = e.target.value; s.page = 1; this.draw(); });
    el.querySelector('#rep-preset').addEventListener('change', e => { this.applyPreset(e.target.value, true); this.draw(); });
    ['#rep-from', '#rep-to'].forEach(sel => el.querySelector(sel).addEventListener('change', () => {
      s.from = el.querySelector('#rep-from').value;
      s.to = el.querySelector('#rep-to').value;
      s.preset = 'custom';
      el.querySelector('#rep-preset').value = 'custom';
      s.page = 1;
      this.draw();
    }));
    el.querySelector('#rep-csv').addEventListener('click', () => this.exportCurrentCSV());
    el.querySelector('#rep-print').addEventListener('click', () => this.printCurrent());
    Utils.bindPager(el.querySelector('#rep-pager'), p => { s.page = p; this.drawTableOnly(); });

    this.draw();
  },

  catName(id, item) {
    if (item && item.categoryName) return item.categoryName;
    const c = (this.categories || []).find(x => x.id === id);
    return c ? c.name : 'Uncategorized';
  },

  applyPreset(preset, updateInputs = true) {
    const now = new Date();
    let from = '', to = Utils.dateKey(now);
    if (preset === 'today') from = to;
    else if (preset === '7') from = Utils.dateKey(Utils.addDays(now, -6));
    else if (preset === '30') from = Utils.dateKey(Utils.addDays(now, -29));
    else if (preset === '90') from = Utils.dateKey(Utils.addDays(now, -89));
    else if (preset === 'month') from = Utils.dateKey(Utils.startOfMonth(now));
    else if (preset === 'year') from = `${now.getFullYear()}-01-01`;
    else if (preset === 'all') { from = ''; to = ''; }
    else return;
    this.state.preset = preset;
    this.state.from = from;
    this.state.to = to;
    if (updateInputs) {
      const f = document.getElementById('rep-from'), t = document.getElementById('rep-to');
      if (f) f.value = from;
      if (t) t.value = to;
    }
  },

  dateBounds() {
    const s = this.state;
    let from = s.from ? Utils.startOfDay(Utils.parseDate(s.from)) : null;
    let to = s.to ? Utils.endOfDay(Utils.parseDate(s.to)) : null;
    if (from && to && from > to) [from, to] = [Utils.startOfDay(to), Utils.endOfDay(from)];
    if (!from) {
      const oldest = this.txns.length ? new Date(this.txns[this.txns.length - 1].date) : new Date();
      from = Utils.startOfDay(oldest);
    }
    if (!to) to = Utils.endOfDay(new Date());
    return [from, to];
  },

  /** Completed transactions filtered by date range (and category if selected). */
  txnsInScope() {
    const [from, to] = this.dateBounds();
    const cat = this.state.category ? this.catName(this.state.category) : '';
    const list = Stats.between(this.txns, from, to);
    if (!cat) return list;
    return list.map(t => {
      const items = t.items.filter(i => i.category === cat);
      if (!items.length) return null;
      const ratio = t.subtotal > 0 ? t.total / t.subtotal : 1;
      const sub = Utils.round2(items.reduce((s, i) => s + i.subtotal, 0));
      const tot = Utils.round2(sub * ratio);
      return { ...t, items, itemCount: items.reduce((s, i) => s + i.qty, 0), subtotal: sub, discount: Utils.round2(sub - tot), total: tot };
    }).filter(Boolean);
  },

  fmtDeltaBadge(val) {
    if (val === null || val === undefined || isNaN(val)) return '<span class="text-muted">No prior baseline</span>';
    const up = val >= 0;
    return `<span class="${up ? 'text-success' : 'text-danger'} fw-semibold"><i class="bi bi-arrow-${up ? 'up' : 'down'}-short"></i>${Math.abs(val).toFixed(1)}%</span> vs prev period`;
  },

  renderKPIs(txns) {
    const [from, to] = this.dateBounds();
    const cmp = Stats.comparePeriods(this.txns, from, to);
    const tot = Stats.totals(txns);
    const bestByQty = Stats.productSales(txns, 'qty')[0];
    const bestByRev = Stats.productSales(txns, 'revenue')[0];
    const ings = this.state.category ? this.ingredients.filter(p => p.categoryId === this.state.category) : this.ingredients;
    let low = 0, out = 0, invCost = 0, expUnits = 0;
    ings.forEach(p => {
      const st = Utils.stockStatus(p).key;
      if (st === 'low') low++;
      if (st === 'out') out++;
      invCost += p.stock * p.cost;
      expUnits += Utils.productShelfSummary(p).expiredQty;
    });
    const menuRetail = (this.state.category ? this.menuProducts.filter(p => p.categoryId === this.state.category) : this.menuProducts)
      .reduce((s, p) => s + p.stock * p.price, 0);
    document.getElementById('rep-kpis').innerHTML = `
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'cash-coin', tone: 'green', label: 'Total Sales Revenue', value: Utils.money(tot.revenue), sub: `Est. profit ${Utils.money(tot.profit)}` })}</div>
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'receipt', tone: 'blue', label: 'Transactions & Avg', value: Utils.num(tot.count), sub: `Avg. order ${Utils.money(tot.avgOrder)}` })}</div>
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'bag-check', tone: 'purple', label: 'Products Sold', value: Utils.num(tot.items), sub: this.fmtDeltaBadge(cmp.deltas.items) })}</div>
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'trophy', tone: 'teal', label: 'Best-Seller (Qty)', value: bestByQty ? Utils.esc(bestByQty.name) : '—', sub: bestByQty ? `${Utils.num(bestByQty.qty)} sold · Top rev: ${Utils.esc(bestByRev.name)}` : 'No sales in range' })}</div>
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'exclamation-triangle', tone: 'amber', label: 'Low / Out / Expired', value: `${low} / ${out} / ${expUnits}`, sub: `${low} low · ${out} out · ${expUnits} exp units` })}</div>
      <div class="col-6 col-md-4 col-xl-2">${Utils.statCard({ icon: 'box-seam', tone: 'gray', label: 'Inventory Value', value: Utils.money(invCost), sub: `Menu retail ${Utils.money(menuRetail)}` })}</div>`;
  },

  renderTrendsAndBottom(txns, from, to) {
    const cmp = Stats.comparePeriods(this.txns, from, to);
    const peaks = Stats.peakPatterns(txns);
    const voidedCount = (this.allTxns || []).filter(t => t.status === 'voided' || t.status === 'cancelled').length;

    const cmpRangeEl = document.getElementById('rep-cmp-range');
    if (cmpRangeEl) {
      cmpRangeEl.textContent = `Comparing ${Utils.fmtDate(from)} – ${Utils.fmtDate(to)} (${cmp.days}d) vs ${Utils.fmtDate(cmp.prevFrom)} – ${Utils.fmtDate(cmp.prevTo)}`;
    }

    const bodyEl = document.getElementById('rep-trends-body');
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="col-lg-7">
          <div class="p-3 border rounded-3 h-100 bg-light">
            <div class="fw-semibold small mb-2"><i class="bi bi-arrows-angle-expand me-1"></i>Period-over-Period Comparison (${cmp.days} day window)</div>
            <div class="row g-2 small">
              <div class="col-sm-3">
                <div class="text-muted">Revenue</div>
                <div class="fw-bold">${Utils.money(cmp.current.revenue)}</div>
                <div class="cell-sub">Prev: ${Utils.money(cmp.previous.revenue)}</div>
                <div>${this.fmtDeltaBadge(cmp.deltas.revenue)}</div>
              </div>
              <div class="col-sm-3">
                <div class="text-muted">Transactions</div>
                <div class="fw-bold">${Utils.num(cmp.current.count)}</div>
                <div class="cell-sub">Prev: ${Utils.num(cmp.previous.count)}</div>
                <div>${this.fmtDeltaBadge(cmp.deltas.count)}</div>
              </div>
              <div class="col-sm-3">
                <div class="text-muted">Avg. Order Value</div>
                <div class="fw-bold">${Utils.money(cmp.current.avgOrder)}</div>
                <div class="cell-sub">Prev: ${Utils.money(cmp.previous.avgOrder)}</div>
                <div>${this.fmtDeltaBadge(cmp.deltas.avgOrder)}</div>
              </div>
              <div class="col-sm-3">
                <div class="text-muted">Units Sold</div>
                <div class="fw-bold">${Utils.num(cmp.current.items)}</div>
                <div class="cell-sub">Prev: ${Utils.num(cmp.previous.items)}</div>
                <div>${this.fmtDeltaBadge(cmp.deltas.items)}</div>
              </div>
            </div>
            ${!cmp.sufficientForComparison ? `<div class="small text-muted mt-2"><i class="bi bi-info-circle me-1"></i>Note: Insufficient sales history in one of the compared periods to compute all percentage changes. Statistics are never fabricated.</div>` : ''}
          </div>
        </div>
        <div class="col-lg-5">
          <div class="p-3 border rounded-3 h-100 bg-light">
            <div class="fw-semibold small mb-2"><i class="bi bi-clock-history me-1"></i>Peak Sales Days &amp; Hours</div>
            ${peaks.sufficient ? `
              <div class="row g-2 small">
                <div class="col-sm-6">
                  <div class="text-muted">Peak Day of Week</div>
                  <div class="fw-bold text-success fs-6">${Utils.esc(peaks.peakDay.label)}</div>
                  <div class="cell-sub">${Utils.money(peaks.peakDay.revenue)} · ${peaks.peakDay.count} txns (${peaks.peakDay.items} units)</div>
                </div>
                <div class="col-sm-6">
                  <div class="text-muted">Peak Hour of Day</div>
                  <div class="fw-bold text-primary fs-6">${Utils.esc(peaks.peakHour.label)}</div>
                  <div class="cell-sub">${Utils.money(peaks.peakHour.revenue)} · ${peaks.peakHour.count} txns (${peaks.peakHour.items} units)</div>
                </div>
              </div>
              <div class="cell-sub mt-2">Computed from ${peaks.validTimestamps} timestamped completed transactions across ${peaks.distinctDays} distinct days.${voidedCount > 0 ? ` (${voidedCount} voided/cancelled excluded)` : ''}</div>
            ` : `
              <div class="small text-muted">
                <i class="bi bi-exclamation-circle me-1"></i><strong>Insufficient sales history for peak day/hour trends:</strong>
                Only ${peaks.validTimestamps} completed transaction(s) across ${peaks.distinctDays} day(s) in this filter range. Record at least 3 transactions across 2+ days to identify peak sales days and hours.
              </div>
            `}
          </div>
        </div>`;
    }

    // Bottom Best-Selling vs Slow-Moving summaries
    const best = Stats.productSales(txns, this.state.bestSort).slice(0, 6);
    const bestEl = document.getElementById('rep-best-summary');
    if (bestEl) {
      bestEl.innerHTML = best.length ? best.map((b, i) => `<tr>
        <td><span class="badge ${i < 3 ? 'badge-soft-success' : 'badge-soft-secondary'}">${i + 1}</span></td>
        <td><div class="fw-semibold small">${Utils.esc(b.name)}</div><div class="cell-sub">${Utils.esc(b.category)}</div></td>
        <td class="text-end fw-semibold">${Utils.num(b.qty)}</td>
        <td class="text-end text-primary fw-semibold">${Utils.money(b.revenue)}</td>
        <td class="text-end small text-muted">${b.revenueShare.toFixed(1)}%</td>
      </tr>`).join('') : Utils.emptyRow(5, 'trophy', 'No sales in selected period');
    }

    const slow = Stats.slowMovers(
      this.state.category ? this.menuProducts.filter(p => p.categoryId === this.state.category) : this.menuProducts,
      txns,
      this.categories
    ).slice(0, 6);
    const slowEl = document.getElementById('rep-slow-summary');
    if (slowEl) {
      slowEl.innerHTML = slow.length ? slow.map(s => {
        const prod = this.menuProducts.find(p => p.id === s.productId);
        return `<tr>
          <td><div class="fw-semibold small">${Utils.esc(s.name)}</div><div class="cell-sub">${Utils.esc(s.category)}</div></td>
          <td class="text-end">${Utils.num(s.stock)} <span class="cell-sub">${Utils.esc(s.unit)}</span></td>
          <td class="text-end">${s.qty === 0 ? '<span class="badge badge-soft-secondary">0 sold</span>' : Utils.num(s.qty)}</td>
          <td class="text-end small">${Utils.money(s.revenue)}</td>
          <td>${prod ? Utils.stockBadge(prod) : '—'}</td>
        </tr>`;
      }).join('') : Utils.emptyRow(5, 'box', 'No active products');
    }
  },

  draw() {
    const meta = this.TYPES.find(t => t.key === this.state.type);
    document.getElementById('rep-date-controls').classList.toggle('d-none', !meta.usesDate);
    const bestSortWrap = document.getElementById('rep-best-sort-wrap');
    if (bestSortWrap) bestSortWrap.classList.toggle('d-none', this.state.type !== 'best-sellers');

    const txns = this.txnsInScope();
    const [from, to] = this.dateBounds();
    this.renderKPIs(txns);
    this.renderTrendsAndBottom(txns, from, to);

    document.getElementById('rep-title').textContent = meta.label;
    document.getElementById('rep-range').textContent = meta.usesDate ? `(${Utils.fmtDate(from)} – ${Utils.fmtDate(to)})` : '(Current stock snapshot)';

    this.currentSpec = this.buildSpec(this.state.type, txns, from, to);
    this.drawChart(this.currentSpec.chart);
    this.drawTableOnly();
  },

  buildSpec(type, txns, from, to) {
    const catFilter = this.state.category;
    const prodMap = new Map(this.products.map(p => [p.id, p]));

    if (type === 'daily' || type === 'weekly' || type === 'monthly') {
      const mode = type === 'daily' ? 'day' : type === 'weekly' ? 'week' : 'month';
      const capFrom = type === 'daily' && (to - from) / 86400000 > 90 ? Utils.addDays(to, -90) : from;
      const buckets = Stats.groupRange(txns, capFrom, to, mode);
      const rows = buckets.slice().reverse().map(r => ({
        ...r,
        avgOrder: r.count > 0 ? Utils.round2(r.revenue / r.count) : 0
      }));
      return {
        columns: [
          { label: 'Period', key: 'label' },
          { label: 'Transactions', key: 'count', align: 'end' },
          { label: 'Products Sold', key: 'items', align: 'end' },
          { label: 'Avg. Order Value', value: r => Utils.money(r.avgOrder), raw: r => r.avgOrder, align: 'end' },
          { label: 'Gross Sales', value: r => Utils.money(r.gross), raw: r => r.gross, align: 'end' },
          { label: 'Discounts', value: r => Utils.money(r.discount), raw: r => r.discount, align: 'end' },
          { label: 'Sales Revenue (Net)', value: r => Utils.money(r.revenue), raw: r => r.revenue, align: 'end', bold: true },
          { label: 'EstimatedProfit', value: r => Utils.money(r.profit), raw: r => r.profit, align: 'end' }
        ],
        rows,
        searchText: r => r.label,
        chart: {
          type: 'bar',
          labels: buckets.map(b => b.label),
          datasets: [
            { label: 'Sales Revenue', data: buckets.map(b => b.revenue), backgroundColor: '#16a34a', borderRadius: 6 },
            { label: 'Estimated Profit', data: buckets.map(b => b.profit), backgroundColor: '#86efac', borderRadius: 6 }
          ],
          money: true
        }
      };
    }

    if (type === 'transactions') {
      const byDay = Stats.byDay(txns, from, to);
      return {
        columns: [
          { label: 'Transaction ID', key: 'id', mono: true },
          { label: 'Date & Time', value: t => Utils.fmtDateTime(t.date) },
          { label: 'Products Purchased', value: t => t.items.map(i => `${i.name} ×${i.qty}`).join(', ') },
          { label: 'Qty', key: 'itemCount', align: 'end' },
          { label: 'Subtotal', value: t => Utils.money(t.subtotal), raw: t => t.subtotal, align: 'end' },
          { label: 'Discount', value: t => Utils.money(t.discount), raw: t => t.discount, align: 'end' },
          { label: 'Sales Revenue', value: t => Utils.money(t.total), raw: t => t.total, align: 'end', bold: true },
          { label: 'Est. Profit', value: t => Utils.money(t.total - t.items.reduce((s, i) => s + (i.cost || 0) * i.qty, 0)), raw: t => Utils.round2(t.total - t.items.reduce((s, i) => s + (i.cost || 0) * i.qty, 0)), align: 'end' },
          { label: 'Cashier', key: 'cashierName' }
        ],
        rows: txns,
        searchText: t => [t.id, t.cashierName, ...t.items.map(i => i.name)].join(' '),
        chart: { type: 'line', labels: byDay.map(d => d.label), datasets: [{ label: 'Daily Sales Revenue', data: byDay.map(d => d.revenue), borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,.12)', fill: true, tension: .3 }], money: true }
      };
    }

    if (type === 'product-sales' || type === 'best-sellers') {
      const sortMode = type === 'best-sellers' ? this.state.bestSort : 'revenue';
      const ranked = Stats.productSales(txns, sortMode);
      const soldMap = new Map(ranked.map(r => [r.productId, r]));
      const totalRev = ranked.reduce((s, r) => s + r.revenue, 0);
      let rows;
      if (type === 'best-sellers') {
        rows = ranked.map((r, i) => ({
          rank: i + 1, ...r,
          category: r.category || (prodMap.get(r.productId) ? this.catName(prodMap.get(r.productId).categoryId) : '—'),
          share: totalRev > 0 ? ((r.revenue / totalRev) * 100).toFixed(1) + '%' : '0.0%'
        }));
      } else {
        const base = this.products.filter(p => !catFilter || p.categoryId === catFilter);
        rows = base.map(p => {
          const s = soldMap.get(p.id) || { qty: 0, revenue: 0, cost: 0, profit: 0, txns: 0 };
          return {
            productId: p.id, name: p.name, category: this.catName(p.categoryId),
            qty: s.qty, txns: s.txns, revenue: s.revenue, cost: s.cost, profit: s.profit, stock: p.stock, unit: p.unit
          };
        }).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
      }
      const top = rows.filter(r => r.qty > 0).slice(0, 8);
      const useRevChart = type !== 'best-sellers' || this.state.bestSort === 'revenue';
      return {
        columns: type === 'best-sellers' ? [
          { label: 'Rank', key: 'rank' },
          { label: 'Product ID', key: 'productId', mono: true },
          { label: 'Product Name', key: 'name', bold: true },
          { label: 'Category', key: 'category' },
          { label: 'Units Sold', key: 'qty', align: 'end', bold: this.state.bestSort === 'qty' },
          { label: 'Sales Revenue', value: r => Utils.money(r.revenue), raw: r => r.revenue, align: 'end', bold: this.state.bestSort === 'revenue' },
          { label: 'Est. Cost', value: r => Utils.money(r.cost), raw: r => r.cost, align: 'end' },
          { label: 'Est. Profit', value: r => Utils.money(r.profit), raw: r => r.profit, align: 'end' },
          { label: 'Revenue Share', key: 'share', align: 'end' }
        ] : [
          { label: 'Product ID', key: 'productId', mono: true },
          { label: 'Product Name', key: 'name', bold: true },
          { label: 'Category', key: 'category' },
          { label: 'Units Sold', key: 'qty', align: 'end' },
          { label: 'Sales Revenue', value: r => Utils.money(r.revenue), raw: r => r.revenue, align: 'end', bold: true },
          { label: 'Est. Cost', value: r => Utils.money(r.cost), raw: r => r.cost, align: 'end' },
          { label: 'Est. Profit', value: r => Utils.money(r.profit), raw: r => r.profit, align: 'end' },
          { label: 'Current Stock', value: r => `${r.stock} ${r.unit}`, raw: r => r.stock, align: 'end' }
        ],
        rows,
        searchText: r => `${r.productId} ${r.name} ${r.category}`,
        chart: {
          type: 'bar',
          labels: top.map(r => r.name),
          datasets: [{
            label: useRevChart ? 'Sales Revenue' : 'Units Sold',
            data: top.map(r => useRevChart ? r.revenue : r.qty),
            backgroundColor: Utils.palette.slice(0, top.length), borderRadius: 6
          }],
          money: useRevChart
        }
      };
    }

    if (type === 'slow-movers') {
      const baseProds = this.menuProducts.filter(p => !catFilter || p.categoryId === catFilter);
      const rows = Stats.slowMovers(baseProds, txns, this.categories).map((r, idx) => {
        const prod = prodMap.get(r.productId);
        const st = prod ? Utils.stockStatus(prod) : { label: '—' };
        return {
          rank: idx + 1,
          ...r,
          shelfLabel: st.label,
          shelfHtml: prod ? Utils.stockBadge(prod) : '—',
          lastSoldLabel: r.lastSold ? Utils.fmtDate(r.lastSold) : 'No sales in range'
        };
      });
      const topSlow = rows.slice(0, 10);
      return {
        columns: [
          { label: '#', key: 'rank' },
          { label: 'Product ID', key: 'productId', mono: true },
          { label: 'Product Name', key: 'name', bold: true },
          { label: 'Category', key: 'category' },
          { label: 'Units Sold (Period)', key: 'qty', align: 'end', bold: true },
          { label: 'Transactions', key: 'txns', align: 'end' },
          { label: 'Period Revenue', value: r => Utils.money(r.revenue), raw: r => r.revenue, align: 'end' },
          { label: 'Stock on Hand', value: r => `${r.stock} ${r.unit}`, raw: r => r.stock, align: 'end' },
          { label: 'Tied Capital (Cost)', value: r => Utils.money(r.stockValueCost), raw: r => r.stockValueCost, align: 'end' },
          { label: 'Stock Status', html: r => r.shelfHtml, value: r => r.shelfLabel },
          { label: 'Last Sold', key: 'lastSoldLabel' }
        ],
        rows,
        searchText: r => `${r.productId} ${r.name} ${r.category} ${r.shelfLabel}`,
        chart: {
          type: 'bar',
          labels: topSlow.map(r => r.name),
          datasets: [
            { label: 'Stock on Hand', data: topSlow.map(r => r.stock), backgroundColor: '#f59e0b', borderRadius: 6 },
            { label: 'Units Sold in Period', data: topSlow.map(r => r.qty), backgroundColor: '#16a34a', borderRadius: 6 }
          ],
          money: false
        }
      };
    }

    if (type === 'expiration') {
      const rows = [];
      this.ingredients
        .filter(p => !catFilter || p.categoryId === catFilter)
        .forEach(p => {
          const sum = Utils.productShelfSummary(p);
          sum.batches.forEach(b => {
            rows.push({
              productId: p.id,
              name: p.name,
              category: this.catName(p.categoryId, p),
              batchId: b.id,
              dateReceived: Utils.fmtDate(b.dateReceived),
              expirationDate: Utils.fmtDate(b.expirationDate),
              days: b.status.days,
              daysText: b.status.daysText,
              qty: b.qty,
              unit: p.unit,
              costValue: Utils.round2(b.qty * p.cost),
              statusLabel: b.status.label,
              statusHtml: Utils.shelfBadge(b.status)
            });
          });
        });
      rows.sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999) || a.name.localeCompare(b.name));
      const counts = { Expired: 0, 'Expiring Very Soon': 0, 'Nearing Expiration': 0, Safe: 0 };
      rows.forEach(r => { if (counts[r.statusLabel] !== undefined) counts[r.statusLabel] += r.qty; });
      return {
        columns: [
          { label: 'Ingredient ID', key: 'productId', mono: true },
          { label: 'Ingredient Name', key: 'name', bold: true },
          { label: 'Category', key: 'category' },
          { label: 'Batch ID', key: 'batchId', mono: true },
          { label: 'Date Received', key: 'dateReceived' },
          { label: 'Expiration Date', key: 'expirationDate', bold: true },
          { label: 'Remaining Shelf Life', key: 'daysText' },
          { label: 'Batch Qty', value: r => `${Utils.num(r.qty)} ${r.unit}`, raw: r => r.qty, align: 'end', bold: true },
          { label: 'Batch Cost Value', value: r => Utils.money(r.costValue), raw: r => r.costValue, align: 'end' },
          { label: 'Shelf-Life Status', html: r => r.statusHtml, value: r => r.statusLabel }
        ],
        rows,
        searchText: r => `${r.productId} ${r.name} ${r.category} ${r.batchId} ${r.statusLabel}`,
        chart: {
          type: 'bar',
          labels: Object.keys(counts),
          datasets: [{
            label: 'Units by Shelf-Life Status',
            data: Object.values(counts),
            backgroundColor: ['#dc2626', '#ea580c', '#eab308', '#16a34a'],
            borderRadius: 6
          }],
          money: false
        }
      };
    }

    // Inventory & Low Stock reports (Raw Ingredients)
    const list = this.ingredients
      .filter(p => (!catFilter || p.categoryId === catFilter) && (type !== 'low-stock' || Utils.stockStatus(p).key !== 'in'))
      .map(p => {
        const shelf = Utils.productShelfSummary(p);
        return {
          ...p, category: this.catName(p.categoryId, p),
          statusLabel: Utils.stockStatus(p).label,
          shelfLabel: shelf.overallStatus.label,
          shelfHtml: Utils.shelfBadge(shelf.overallStatus),
          shortfall: Math.max(0, p.reorderLevel - p.stock),
          costValue: Utils.round2(p.stock * p.cost)
        };
      })
      .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));

    return {
      columns: [
        { label: 'Ingredient ID', key: 'id', mono: true },
        { label: 'Ingredient Name', key: 'name', bold: true },
        { label: 'Category', key: 'category' },
        { label: 'Available Stock', value: r => `${Utils.num(r.stock)} ${r.unit}`, raw: r => r.stock, align: 'end', bold: true },
        { label: 'Reorder Level', key: 'reorderLevel', align: 'end' },
        ...(type === 'low-stock' ? [{ label: 'Shortfall', key: 'shortfall', align: 'end' }] : []),
        { label: 'Stock Status', html: r => Utils.stockBadge(r), value: r => r.statusLabel },
        { label: 'Shelf-Life Status', html: r => r.shelfHtml, value: r => r.shelfLabel },
        { label: 'Unit Cost', value: r => Utils.money(r.cost), raw: r => r.cost, align: 'end' },
        { label: 'Inventory Value (Cost)', value: r => Utils.money(r.costValue), raw: r => r.costValue, align: 'end', bold: true }
      ],
      rows: list,
      searchText: r => `${r.id} ${r.name} ${r.category} ${r.statusLabel} ${r.shelfLabel}`,
      chart: {
        type: 'bar',
        labels: list.slice(0, 10).map(r => r.name),
        datasets: [
          { label: 'Available Stock', data: list.slice(0, 10).map(r => r.stock), backgroundColor: '#16a34a', borderRadius: 6 },
          { label: 'Reorder Level', data: list.slice(0, 10).map(r => r.reorderLevel), backgroundColor: '#f59e0b', borderRadius: 6 }
        ],
        money: false
      }
    };
  },

  drawChart(cfg) {
    const wrap = document.getElementById('rep-chart-wrap');
    const existing = Chart.getChart('rep-chart');
    if (existing) existing.destroy();
    if (!cfg || !cfg.labels.length) {
      wrap.innerHTML = Utils.emptyState('bar-chart', 'No data to chart for the selected filters');
      return;
    }
    wrap.innerHTML = '<div class="chart-box"><canvas id="rep-chart"></canvas></div>';
    Utils.chart(document.getElementById('rep-chart'), {
      type: cfg.type,
      data: { labels: cfg.labels, datasets: cfg.datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: cfg.datasets.length > 1, position: 'top' },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${cfg.money ? Utils.money(c.parsed.y) : Utils.num(c.parsed.y)}` } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => cfg.money ? Utils.currencySymbol() + Utils.num(v) : v } },
          x: { grid: { display: false } }
        }
      }
    });
  },

  filteredRows() {
    const q = this.state.search.toLowerCase();
    if (!q) return this.currentSpec.rows;
    return this.currentSpec.rows.filter(r => this.currentSpec.searchText(r).toLowerCase().includes(q));
  },

  drawTableOnly() {
    const spec = this.currentSpec;
    const rows = this.filteredRows();
    document.getElementById('rep-sub').textContent = `${rows.length} record(s)`;
    const pg = Utils.paginate(rows, this.state.page, Prefs.get('pageSize'));
    this.state.page = pg.page;
    const cellVal = (c, r) => c.html ? c.html(r) : Utils.esc(typeof c.value === 'function' ? c.value(r) : r[c.key]);
    document.getElementById('rep-table').innerHTML = `
      <thead><tr>${spec.columns.map(c => `<th class="${c.align === 'end' ? 'text-end' : ''}">${Utils.esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${pg.items.length ? pg.items.map(r => `<tr>${spec.columns.map(c =>
        `<td class="${c.align === 'end' ? 'text-end' : ''} ${c.bold ? 'fw-semibold' : ''} ${c.mono ? 'mono' : ''}">${cellVal(c, r)}</td>`
      ).join('')}</tr>`).join('') : Utils.emptyRow(spec.columns.length, 'clipboard-x', 'No records match the current filters')}</tbody>`;
    document.getElementById('rep-pager').innerHTML = Utils.pagerHTML(pg);
  },

  exportCurrentCSV() {
    const spec = this.currentSpec;
    const rows = this.filteredRows();
    const cols = spec.columns.map(c => ({
      label: c.label,
      value: r => c.raw ? c.raw(r) : (typeof c.value === 'function' ? c.value(r) : r[c.key])
    }));
    Utils.exportCSV(`report-${this.state.type}-${Utils.stamp()}.csv`, cols, rows);
  },

  printCurrent() {
    const spec = this.currentSpec;
    const rows = this.filteredRows();
    const meta = this.TYPES.find(t => t.key === this.state.type);
    const canvas = document.getElementById('rep-chart');
    const chartImg = canvas ? `<div style="margin:10px 0;text-align:center"><img src="${canvas.toDataURL('image/png')}" alt="Report chart"></div>` : '';
    const tot = Stats.totals(this.txnsInScope());
    Utils.print(`<div class="print-report">
      <h2>${Utils.esc(App.settings.businessName)} — ${Utils.esc(meta.label)}</h2>
      <div>${Utils.esc(document.getElementById('rep-range').textContent)} · Printed ${Utils.fmtDateTime(new Date().toISOString())}</div>
      <div class="cards">
        <div><strong>Sales Revenue:</strong> ${Utils.money(tot.revenue)}</div>
        <div><strong>Estimated Profit:</strong> ${Utils.money(tot.profit)}</div>
        <div><strong>Transactions:</strong> ${Utils.num(tot.count)} (Avg: ${Utils.money(tot.avgOrder)})</div>
        <div><strong>Products Sold:</strong> ${Utils.num(tot.items)}</div>
      </div>
      ${chartImg}
      <table>
        <thead><tr>${spec.columns.map(c => `<th>${Utils.esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${spec.columns.map(c =>
          `<td>${Utils.esc(typeof c.value === 'function' ? c.value(r) : r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`);
  }
};

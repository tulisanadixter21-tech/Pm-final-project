/* =========================================================
   customers.js - Customer Management & Purchase History
   Purchase history is computed live from actual sales records.
   ========================================================= */
'use strict';

const Customers = {
  title: 'Customers',
  subtitle: 'Manage regular customer profiles and view their purchase history',
  state: { search: '', sort: 'name-asc', page: 1 },
  customers: [],
  txns: [],

  async render(el) {
    el.innerHTML = `
      <div class="card">
        <div class="card-body border-bottom"><div class="toolbar">
          <div class="search-box"><i class="bi bi-search"></i>
            <input type="search" class="form-control" id="cus-search" placeholder="Search ID, name, contact or address…" value="${Utils.esc(this.state.search)}"></div>
          <select class="form-select" id="cus-sort">
            <option value="name-asc">Name (A–Z)</option><option value="name-desc">Name (Z–A)</option>
            <option value="spent-desc">Highest total spent</option><option value="orders-desc">Most orders</option>
            <option value="newest">Recently registered</option></select>
          <div class="ms-auto d-flex gap-2">
            <button class="btn btn-light" id="cus-export"><i class="bi bi-filetype-csv me-1"></i>Export CSV</button>
            <button class="btn btn-primary" id="cus-add"><i class="bi bi-person-plus me-1"></i>Add Customer</button>
          </div>
        </div></div>
        <div class="table-wrap"><table class="table table-hover"><thead><tr>
          <th>Customer ID</th><th>Full Name</th><th>Contact Number</th><th>Email</th><th>Address</th>
          <th>Date Registered</th><th class="text-end">Orders</th><th class="text-end">Total Spent</th><th class="text-end">Actions</th>
        </tr></thead><tbody id="cus-tbody"></tbody></table></div>
        <div id="cus-pager"></div>
      </div>`;
    const s = this.state;
    el.querySelector('#cus-sort').value = s.sort;
    el.querySelector('#cus-search').addEventListener('input', Utils.debounce(e => { s.search = e.target.value.trim(); s.page = 1; this.renderTable(); }));
    el.querySelector('#cus-sort').addEventListener('change', e => { s.sort = e.target.value; s.page = 1; this.renderTable(); });
    el.querySelector('#cus-add').addEventListener('click', () => this.openForm());
    el.querySelector('#cus-export').addEventListener('click', () => this.exportCSV(this.filtered()));
    Utils.bindPager(el.querySelector('#cus-pager'), p => { s.page = p; this.renderTable(); });
    el.querySelector('#cus-tbody').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const c = this.customers.find(x => x.id === b.dataset.id);
      if (!c) return;
      if (b.dataset.act === 'view') this.view(c);
      if (b.dataset.act === 'edit') this.openForm(c);
      if (b.dataset.act === 'delete') this.remove(c);
    });
    await this.load();
  },

  async load() {
    [this.customers, this.txns] = await Promise.all([DB.getAll('customers'), DB.getAll('transactions')]);
    this.statsMap = new Map();
    this.customers.forEach(c => this.statsMap.set(c.id, { orders: 0, spent: 0, lastDate: '' }));
    Stats.completed(this.txns).forEach(t => {
      if (!t.customerId || !this.statsMap.has(t.customerId)) return;
      const st = this.statsMap.get(t.customerId);
      st.orders += 1;
      st.spent = Utils.round2(st.spent + (Number(t.total) || 0));
      if (t.date > st.lastDate) st.lastDate = t.date;
    });
    this.renderTable();
  },

  stats(id) { return (this.statsMap && this.statsMap.get(id)) || { orders: 0, spent: 0, lastDate: '' }; },

  filtered() {
    const s = this.state, q = s.search.toLowerCase();
    const list = this.customers.filter(c => !q || [c.id, c.name, c.phone, c.email, c.address].join(' ').toLowerCase().includes(q));
    list.sort((a, b) => {
      if (s.sort === 'name-desc') return b.name.localeCompare(a.name);
      if (s.sort === 'spent-desc') return this.stats(b.id).spent - this.stats(a.id).spent || a.name.localeCompare(b.name);
      if (s.sort === 'orders-desc') return this.stats(b.id).orders - this.stats(a.id).orders || a.name.localeCompare(b.name);
      if (s.sort === 'newest') return (b.dateRegistered || '').localeCompare(a.dateRegistered || '');
      return a.name.localeCompare(b.name);
    });
    return list;
  },

  renderTable() {
    const tbody = document.getElementById('cus-tbody');
    if (!tbody) return;
    const list = this.filtered();
    const pg = Utils.paginate(list, this.state.page, Prefs.get('pageSize'));
    this.state.page = pg.page;
    tbody.innerHTML = pg.items.length ? pg.items.map(c => {
      const st = this.stats(c.id);
      return `<tr>
        <td class="mono">${Utils.esc(c.id)}</td>
        <td><div class="cell-title">${Utils.esc(c.name)}</div></td>
        <td>${Utils.esc(c.phone || '—')}</td>
        <td class="small">${Utils.esc(c.email || '—')}</td>
        <td class="small"><div class="text-nowrap-ellipsis" title="${Utils.esc(c.address)}">${Utils.esc(c.address || '—')}</div></td>
        <td class="small">${Utils.fmtDate(c.dateRegistered)}</td>
        <td class="text-end">${st.orders}</td>
        <td class="text-end fw-semibold">${Utils.money(st.spent)}</td>
        <td class="text-end text-nowrap">
          <button class="btn btn-light btn-action" data-act="view" data-id="${c.id}" title="View & Purchase History"><i class="bi bi-clock-history"></i></button>
          <button class="btn btn-light btn-action" data-act="edit" data-id="${c.id}" title="Edit"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-light btn-action text-danger" data-act="delete" data-id="${c.id}" title="Delete"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
    }).join('') : Utils.emptyRow(9, 'people', this.customers.length ? 'No matching customers' : 'No customers registered yet',
      'Customers are optional — walk-in orders can use Guest checkout.');
    document.getElementById('cus-pager').innerHTML = Utils.pagerHTML(pg);
  },

  async openForm(customer = null, onSaved = null) {
    if (!this.customers.length) this.customers = await DB.getAll('customers');
    const isEdit = !!customer;
    const c = customer || {
      id: Utils.nextId('CUS-', this.customers.map(x => x.id), 4),
      name: '', phone: '', email: '', address: '', dateRegistered: new Date().toISOString()
    };
    const m = Utils.modal({
      title: isEdit ? '<i class="bi bi-pencil-square me-2"></i>Edit Customer' : '<i class="bi bi-person-plus me-2"></i>Add Customer',
      staticBackdrop: true,
      body: `<form id="cus-form" novalidate><div class="row g-3">
        <div class="col-sm-5"><label class="form-label">Customer ID</label><input class="form-control mono" name="id" value="${Utils.esc(c.id)}" readonly></div>
        <div class="col-sm-7"><label class="form-label required">Full Name</label><input class="form-control" name="name" value="${Utils.esc(c.name)}" maxlength="80" autofocus></div>
        <div class="col-sm-6"><label class="form-label required">Contact Number</label><input class="form-control" name="phone" value="${Utils.esc(c.phone)}" placeholder="e.g. 0917 123 4567" maxlength="20"></div>
        <div class="col-sm-6"><label class="form-label">Email</label><input type="email" class="form-control" name="email" value="${Utils.esc(c.email)}" placeholder="Optional" maxlength="80"></div>
        <div class="col-12"><label class="form-label">Address</label><textarea class="form-control" name="address" rows="2" maxlength="200">${Utils.esc(c.address)}</textarea></div>
      </div></form>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary" id="cus-save"><i class="bi bi-check-lg me-1"></i>${isEdit ? 'Save Changes' : 'Add Customer'}</button>`
    });
    const form = m.el.querySelector('#cus-form');
    form.addEventListener('submit', e => { e.preventDefault(); m.el.querySelector('#cus-save').click(); });
    m.el.querySelector('#cus-save').addEventListener('click', async ev => {
      const d = Utils.formData(form), errors = {};
      if (!d.name || d.name.length < 2) errors.name = 'Full name is required (at least 2 characters).';
      if (!d.phone) errors.phone = 'Contact number is required.';
      else if (!Utils.isPhone(d.phone)) errors.phone = 'Enter a valid phone number (7–15 digits).';
      if (d.email && !Utils.isEmail(d.email)) errors.email = 'Enter a valid email address.';
      if (!Utils.showErrors(form, errors)) return;
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const rec = {
          id: c.id, name: d.name, phone: d.phone, email: d.email || '', address: d.address || '',
          dateRegistered: c.dateRegistered || new Date().toISOString()
        };
        await DB.run(['customers', 'transactions'], 'readwrite', async tx => {
          await DB.req(tx.objectStore('customers').put(rec));
          if (isEdit && rec.name !== customer.name) {
            const ts = tx.objectStore('transactions');
            const all = await DB.req(ts.getAll());
            for (const t of all) if (t.customerId === rec.id) { t.customerName = rec.name; await DB.req(ts.put(t)); }
          }
        });
        Utils.toast(isEdit ? 'Customer updated.' : 'Customer added.');
        m.close();
        if (document.getElementById('cus-tbody')) await this.load();
        if (onSaved) onSaved(rec);
      } catch (err) {
        Utils.toast(DB.friendlyError(err), 'danger');
        btn.disabled = false;
      }
    });
  },

  async view(c) {
    const txns = (await DB.getAll('transactions')).filter(t => t.customerId === c.id).sort((a, b) => b.date.localeCompare(a.date));
    const tot = Stats.totals(txns);
    const favs = Stats.productSales(txns).slice(0, 3);
    const m = Utils.modal({
      title: `<i class="bi bi-person-lines-fill me-2"></i>Customer Profile & Purchase History`,
      size: 'lg',
      body: `
        <div class="d-flex flex-wrap align-items-center gap-3 mb-3">
          <span class="avatar" style="width:52px;height:52px;font-size:1.1rem">${Utils.esc(Utils.initials(c.name))}</span>
          <div class="flex-grow-1">
            <h5 class="mb-0">${Utils.esc(c.name)}</h5>
            <div class="text-muted small"><span class="mono">${Utils.esc(c.id)}</span> · Registered ${Utils.fmtDate(c.dateRegistered)}</div>
          </div>
          <div class="text-end">
            <div class="cell-sub">Total Spent</div>
            <div class="fs-4 fw-bold text-primary">${Utils.money(tot.revenue)}</div>
          </div>
        </div>
        <div class="detail-grid mb-3">
          <div><div class="detail-label">Contact Number</div><div class="detail-value">${Utils.esc(c.phone || '—')}</div></div>
          <div><div class="detail-label">Email</div><div class="detail-value">${Utils.esc(c.email || '—')}</div></div>
          <div><div class="detail-label">Address</div><div class="detail-value">${Utils.esc(c.address || '—')}</div></div>
          <div><div class="detail-label">Orders / Items</div><div class="detail-value">${tot.count} order(s) · ${tot.items} item(s)</div></div>
        </div>
        ${favs.length ? `<div class="mb-3"><span class="detail-label me-2">Frequently ordered:</span>
          ${favs.map(f => `<span class="badge badge-soft-success me-1">${Utils.esc(f.name)} (${f.qty})</span>`).join('')}</div>` : ''}
        <h6 class="fw-semibold">Purchase History (${txns.length})</h6>
        <div class="table-wrap"><table class="table table-sm table-hover">
          <thead><tr><th>Transaction ID</th><th>Date & Time</th><th>Items Purchased</th><th class="text-end">Discount</th><th class="text-end">Total</th><th></th></tr></thead>
          <tbody id="cus-tx-list">${txns.length ? txns.map(t => `<tr>
            <td class="mono">${Utils.esc(t.id)}</td>
            <td class="small text-nowrap">${Utils.fmtDateTime(t.date)}</td>
            <td class="small">${Utils.esc(t.items.map(i => `${i.name} ×${i.qty}`).join(', '))}</td>
            <td class="text-end small">${t.discount > 0 ? '-' + Utils.money(t.discount) : '—'}</td>
            <td class="text-end fw-semibold">${Utils.money(t.total)}</td>
            <td class="text-end"><button class="btn btn-light btn-action" data-rcpt="${t.id}" title="Receipt"><i class="bi bi-receipt"></i></button></td>
          </tr>`).join('') : Utils.emptyRow(6, 'bag', 'No purchases yet', 'Sales linked to this customer will appear here.')}</tbody>
        </table></div>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Close</button>
        <button class="btn btn-primary" id="cus-view-edit"><i class="bi bi-pencil me-1"></i>Edit Customer</button>`
    });
    m.el.querySelector('#cus-view-edit').addEventListener('click', () => { m.close(); setTimeout(() => this.openForm(c), 300); });
    m.el.querySelector('#cus-tx-list').addEventListener('click', e => {
      const b = e.target.closest('[data-rcpt]');
      if (!b) return;
      const t = txns.find(x => x.id === b.dataset.rcpt);
      if (t) Sales.showReceipt(t);
    });
  },

  async remove(c) {
    const st = this.stats(c.id);
    const ok = await Utils.confirm({
      title: 'Delete customer', danger: true, confirmText: 'Delete Customer',
      message: `Delete customer <strong>${Utils.esc(c.name)}</strong> (${Utils.esc(c.id)})?` +
        (st.orders ? `<br><span class="small text-muted">Their ${st.orders} past transaction(s) will be kept in sales history under their name.</span>` : '')
    });
    if (!ok) return;
    try {
      await DB.remove('customers', c.id);
      Utils.toast('Customer deleted.');
      await this.load();
    } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
  },

  async exportCSV(list) {
    if (!list) { await this.load(); list = this.customers; }
    Utils.exportCSV(`customers-${Utils.stamp()}.csv`, [
      { label: 'Customer ID', key: 'id' }, { label: 'Full Name', key: 'name' }, { label: 'Contact Number', key: 'phone' },
      { label: 'Email', key: 'email' }, { label: 'Address', key: 'address' },
      { label: 'Date Registered', value: c => Utils.fmtDate(c.dateRegistered) },
      { label: 'Total Orders', value: c => this.stats(c.id).orders },
      { label: 'Total Spent', value: c => this.stats(c.id).spent }
    ], list);
  }
};

/* =========================================================
   suppliers.js - Supplier Management & Supplied Products
   ========================================================= */
'use strict';

const Suppliers = {
  title: 'Suppliers',
  subtitle: 'Manage food and ingredient suppliers and the products they supply',
  state: { search: '', status: '', product: '', page: 1 },
  suppliers: [],
  products: [],

  async render(el) {
    el.innerHTML = `
      <div class="card">
        <div class="card-body border-bottom"><div class="toolbar">
          <div class="search-box"><i class="bi bi-search"></i>
            <input type="search" class="form-control" id="sup-search" placeholder="Search supplier, contact person or address…" value="${Utils.esc(this.state.search)}"></div>
          <select class="form-select" id="sup-status"><option value="">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
          <select class="form-select" id="sup-prod"><option value="">All supplied products</option></select>
          <div class="ms-auto d-flex gap-2">
            <button class="btn btn-light" id="sup-export"><i class="bi bi-filetype-csv me-1"></i>Export CSV</button>
            <button class="btn btn-primary" id="sup-add"><i class="bi bi-plus-lg me-1"></i>Add Supplier</button>
          </div>
        </div></div>
        <div class="table-wrap"><table class="table table-hover"><thead><tr>
          <th>Supplier ID</th><th>Supplier Name</th><th>Contact Person</th><th>Contact Number</th>
          <th>Email</th><th>Products Supplied</th><th>Status</th><th class="text-end">Actions</th>
        </tr></thead><tbody id="sup-tbody"></tbody></table></div>
        <div id="sup-pager"></div>
      </div>`;
    const s = this.state;
    el.querySelector('#sup-status').value = s.status;
    el.querySelector('#sup-search').addEventListener('input', Utils.debounce(e => { s.search = e.target.value.trim(); s.page = 1; this.renderTable(); }));
    el.querySelector('#sup-status').addEventListener('change', e => { s.status = e.target.value; s.page = 1; this.renderTable(); });
    el.querySelector('#sup-prod').addEventListener('change', e => { s.product = e.target.value; s.page = 1; this.renderTable(); });
    el.querySelector('#sup-add').addEventListener('click', () => this.openForm());
    el.querySelector('#sup-export').addEventListener('click', () => this.exportCSV(this.filtered()));
    Utils.bindPager(el.querySelector('#sup-pager'), p => { s.page = p; this.renderTable(); });
    el.querySelector('#sup-tbody').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const sup = this.suppliers.find(x => x.id === b.dataset.id);
      if (!sup) return;
      if (b.dataset.act === 'view') this.view(sup);
      if (b.dataset.act === 'edit') this.openForm(sup);
      if (b.dataset.act === 'delete') this.remove(sup);
    });
    await this.load();
  },

  async load() {
    [this.suppliers, this.products] = await Promise.all([DB.getAll('suppliers'), DB.getAll('products')]);
    this.suppliers.sort((a, b) => a.name.localeCompare(b.name));
    this.products.sort((a, b) => a.name.localeCompare(b.name));
    const sel = document.getElementById('sup-prod');
    if (sel) {
      sel.innerHTML = '<option value="">All supplied products</option>' +
        this.products.map(p => `<option value="${p.id}">${Utils.esc(p.name)}</option>`).join('');
      sel.value = this.state.product;
    }
    this.renderTable();
  },

  prodNames(ids = []) {
    return ids.map(id => (this.products.find(p => p.id === id) || {}).name).filter(Boolean);
  },

  filtered() {
    const s = this.state, q = s.search.toLowerCase();
    return this.suppliers.filter(sup => {
      if (s.status && sup.status !== s.status) return false;
      if (s.product && !(sup.productIds || []).includes(s.product)) return false;
      if (!q) return true;
      const hay = [sup.id, sup.name, sup.contactPerson, sup.phone, sup.email, sup.address, ...this.prodNames(sup.productIds)].join(' ').toLowerCase();
      return hay.includes(q);
    });
  },

  renderTable() {
    const tbody = document.getElementById('sup-tbody');
    if (!tbody) return;
    const list = this.filtered();
    const pg = Utils.paginate(list, this.state.page, Prefs.get('pageSize'));
    this.state.page = pg.page;
    tbody.innerHTML = pg.items.length ? pg.items.map(s => {
      const names = this.prodNames(s.productIds);
      return `<tr>
        <td class="mono">${Utils.esc(s.id)}</td>
        <td><div class="cell-title">${Utils.esc(s.name)}</div><div class="cell-sub text-nowrap-ellipsis" title="${Utils.esc(s.address)}">${Utils.esc(s.address || '')}</div></td>
        <td>${Utils.esc(s.contactPerson || '—')}</td>
        <td>${Utils.esc(s.phone || '—')}</td>
        <td class="small">${Utils.esc(s.email || '—')}</td>
        <td>${names.length
          ? names.slice(0, 3).map(n => `<span class="badge badge-soft-success me-1">${Utils.esc(n)}</span>`).join('') +
            (names.length > 3 ? `<span class="badge badge-soft-secondary">+${names.length - 3}</span>` : '')
          : '<span class="text-muted small">None assigned</span>'}</td>
        <td><span class="badge badge-soft-${s.status === 'active' ? 'success' : 'secondary'} text-capitalize">${s.status}</span></td>
        <td class="text-end text-nowrap">
          <button class="btn btn-light btn-action" data-act="view" data-id="${s.id}" title="View"><i class="bi bi-eye"></i></button>
          <button class="btn btn-light btn-action" data-act="edit" data-id="${s.id}" title="Edit"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-light btn-action text-danger" data-act="delete" data-id="${s.id}" title="Delete"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
    }).join('') : Utils.emptyRow(8, 'truck', this.suppliers.length ? 'No matching suppliers' : 'No suppliers yet',
      'Add your ingredient and food suppliers to keep contact details and supplied products organized.');
    document.getElementById('sup-pager').innerHTML = Utils.pagerHTML(pg);
  },

  openForm(supplier = null) {
    const isEdit = !!supplier;
    const s = supplier || {
      id: Utils.nextId('SUP-', this.suppliers.map(x => x.id), 3),
      name: '', contactPerson: '', phone: '', email: '', address: '', productIds: [], status: 'active'
    };
    const m = Utils.modal({
      title: isEdit ? '<i class="bi bi-pencil-square me-2"></i>Edit Supplier' : '<i class="bi bi-truck me-2"></i>Add Supplier',
      size: 'lg', staticBackdrop: true,
      body: `<form id="sup-form" novalidate><div class="row g-3">
        <div class="col-sm-4"><label class="form-label">Supplier ID</label><input class="form-control mono" name="id" value="${Utils.esc(s.id)}" readonly></div>
        <div class="col-sm-8"><label class="form-label required">Supplier Name</label><input class="form-control" name="name" value="${Utils.esc(s.name)}" maxlength="80" autofocus></div>
        <div class="col-sm-6"><label class="form-label required">Contact Person</label><input class="form-control" name="contactPerson" value="${Utils.esc(s.contactPerson)}" maxlength="80"></div>
        <div class="col-sm-6"><label class="form-label required">Contact Number</label><input class="form-control" name="phone" value="${Utils.esc(s.phone)}" placeholder="e.g. 0917 111 2233" maxlength="20"></div>
        <div class="col-sm-8"><label class="form-label">Email</label><input type="email" class="form-control" name="email" value="${Utils.esc(s.email)}" maxlength="80"></div>
        <div class="col-sm-4"><label class="form-label">Status</label>
          <select class="form-select" name="status"><option value="active">Active</option><option value="inactive" ${s.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
        <div class="col-12"><label class="form-label required">Business Address</label><textarea class="form-control" name="address" rows="2" maxlength="200">${Utils.esc(s.address)}</textarea></div>
        <div class="col-12">
          <label class="form-label">Products Supplied</label>
          <div class="row g-2 p-2 border rounded-3" style="max-height:200px;overflow-y:auto">
            ${this.products.length ? this.products.map(p => `<div class="col-sm-6">
              <label class="form-check d-flex align-items-center gap-2 mb-0">
                <input type="checkbox" class="form-check-input mt-0" name="productIds" value="${p.id}" ${(s.productIds || []).includes(p.id) ? 'checked' : ''}>
                <span class="small">${Utils.esc(p.name)} <span class="text-muted">(${Utils.esc(p.id)})</span></span>
              </label></div>`).join('') : '<div class="text-muted small">No products available.</div>'}
          </div>
        </div>
      </div></form>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary" id="sup-save"><i class="bi bi-check-lg me-1"></i>${isEdit ? 'Save Changes' : 'Add Supplier'}</button>`
    });
    const form = m.el.querySelector('#sup-form');
    form.addEventListener('submit', e => { e.preventDefault(); m.el.querySelector('#sup-save').click(); });
    m.el.querySelector('#sup-save').addEventListener('click', async ev => {
      const d = Utils.formData(form), errors = {};
      if (!d.name || d.name.length < 2) errors.name = 'Supplier name is required.';
      else if (this.suppliers.some(x => x.name.toLowerCase() === d.name.toLowerCase() && (!isEdit || x.id !== s.id))) errors.name = 'A supplier with this name already exists.';
      if (!d.contactPerson) errors.contactPerson = 'Contact person is required.';
      if (!d.phone) errors.phone = 'Contact number is required.';
      else if (!Utils.isPhone(d.phone)) errors.phone = 'Enter a valid phone number (7–15 digits).';
      if (d.email && !Utils.isEmail(d.email)) errors.email = 'Enter a valid email address.';
      if (!d.address) errors.address = 'Business address is required.';
      if (!Utils.showErrors(form, errors)) return;
      const productIds = d.productIds ? [].concat(d.productIds) : [];
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await DB.put('suppliers', {
          id: s.id, name: d.name, contactPerson: d.contactPerson, phone: d.phone,
          email: d.email || '', address: d.address, productIds,
          status: d.status === 'inactive' ? 'inactive' : 'active',
          createdAt: s.createdAt || new Date().toISOString()
        });
        Utils.toast(isEdit ? 'Supplier updated.' : 'Supplier added.');
        m.close();
        await this.load();
      } catch (err) {
        Utils.toast(DB.friendlyError(err), 'danger');
        btn.disabled = false;
      }
    });
  },

  view(s) {
    const prods = (s.productIds || []).map(id => this.products.find(p => p.id === id)).filter(Boolean);
    const m = Utils.modal({
      title: '<i class="bi bi-truck me-2"></i>Supplier Details', size: 'lg',
      body: `
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
          <h4 class="mb-0">${Utils.esc(s.name)}</h4>
          <span class="badge badge-soft-${s.status === 'active' ? 'success' : 'secondary'} text-capitalize">${s.status}</span>
        </div>
        <div class="detail-grid mb-4">
          <div><div class="detail-label">Supplier ID</div><div class="detail-value mono">${Utils.esc(s.id)}</div></div>
          <div><div class="detail-label">Contact Person</div><div class="detail-value">${Utils.esc(s.contactPerson)}</div></div>
          <div><div class="detail-label">Contact Number</div><div class="detail-value">${Utils.esc(s.phone)}</div></div>
          <div><div class="detail-label">Email</div><div class="detail-value">${Utils.esc(s.email || '—')}</div></div>
          <div style="grid-column:1/-1"><div class="detail-label">Business Address</div><div class="detail-value">${Utils.esc(s.address)}</div></div>
        </div>
        <h6 class="fw-semibold">Supplied Products (${prods.length})</h6>
        <div class="table-wrap"><table class="table table-sm">
          <thead><tr><th>ID</th><th>Product</th><th class="text-end">Cost Price</th><th class="text-end">Current Stock</th><th>Status</th></tr></thead>
          <tbody>${prods.length ? prods.map(p => `<tr>
            <td class="mono">${Utils.esc(p.id)}</td><td class="fw-semibold">${Utils.esc(p.name)}</td>
            <td class="text-end">${Utils.money(p.cost)}</td><td class="text-end">${Utils.num(p.stock)} ${Utils.esc(p.unit)}</td>
            <td>${Utils.stockBadge(p)}</td></tr>`).join('')
          : Utils.emptyRow(5, 'box', 'No products linked to this supplier')}</tbody></table></div>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Close</button>
        <button class="btn btn-primary" id="sup-view-edit"><i class="bi bi-pencil me-1"></i>Edit Supplier</button>`
    });
    m.el.querySelector('#sup-view-edit').addEventListener('click', () => { m.close(); setTimeout(() => this.openForm(s), 300); });
  },

  async remove(s) {
    const ok = await Utils.confirm({
      title: 'Delete supplier', danger: true, confirmText: 'Delete Supplier',
      message: `Delete supplier <strong>${Utils.esc(s.name)}</strong> (${Utils.esc(s.id)})?`
    });
    if (!ok) return;
    try {
      await DB.remove('suppliers', s.id);
      Utils.toast('Supplier deleted.');
      await this.load();
    } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
  },

  async exportCSV(list) {
    if (!list) { await this.load(); list = this.suppliers; }
    Utils.exportCSV(`suppliers-${Utils.stamp()}.csv`, [
      { label: 'Supplier ID', key: 'id' }, { label: 'Supplier Name', key: 'name' },
      { label: 'Contact Person', key: 'contactPerson' }, { label: 'Contact Number', key: 'phone' },
      { label: 'Email', key: 'email' }, { label: 'Business Address', key: 'address' },
      { label: 'Products Supplied', value: s => this.prodNames(s.productIds).join('; ') },
      { label: 'Status', key: 'status' }
    ], list);
  }
};

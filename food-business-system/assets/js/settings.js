/* =========================================================
   settings.js - Business settings, preferences, JSON backup/restore,
   CSV exports and Demo Data reset.
   ========================================================= */
'use strict';

const SettingsPage = {
  title: 'Settings',
  subtitle: 'Configure business details, receipt layout, preferences and local data backups',
  BACKUP_VERSION: 1,

  async render(el) {
    const s = App.settings;
    const p = Prefs.all();
    const counts = await Promise.all(['products', 'categories', 'transactions', 'movements', 'customers', 'suppliers', 'users'].map(k => DB.count(k)));
    const lastBackup = p.lastBackup ? Utils.fmtDateTime(p.lastBackup) : 'Never backed up';

    el.innerHTML = `
      <div class="alert alert-soft-info d-flex gap-2 align-items-center mb-3">
        <i class="bi bi-hdd-stack fs-5"></i>
        <div class="flex-grow-1 small"><strong>Local Browser Storage:</strong> This application runs entirely in your browser with no cloud server. Please export a JSON backup regularly and keep it in a safe folder or USB drive.</div>
        <span class="badge badge-soft-info">Last backup: ${Utils.esc(lastBackup)}</span>
      </div>

      <div class="row g-3">
        <!-- Business & Receipt Settings -->
        <div class="col-lg-7">
          <form id="settings-form" class="card" novalidate>
            <div class="card-header"><i class="bi bi-building me-2"></i>Business, Currency &amp; Receipt Settings</div>
            <div class="card-body"><div class="row g-3">
              <div class="col-md-8"><label class="form-label required">Business Name</label>
                <input class="form-control" name="businessName" value="${Utils.esc(s.businessName)}" maxlength="80"></div>
              <div class="col-md-4"><label class="form-label required">Currency</label>
                <select class="form-select" name="currency">
                  <option value="PHP|₱" ${s.currency === 'PHP' ? 'selected' : ''}>PHP (₱) — Philippine Peso</option>
                  <option value="USD|$" ${s.currency === 'USD' ? 'selected' : ''}>USD ($) — US Dollar</option>
                </select></div>
              <div class="col-12"><label class="form-label required">Business Address</label>
                <input class="form-control" name="address" value="${Utils.esc(s.address)}" maxlength="160"></div>
              <div class="col-sm-6"><label class="form-label required">Contact Number</label>
                <input class="form-control" name="phone" value="${Utils.esc(s.phone)}" maxlength="30"></div>
              <div class="col-sm-6"><label class="form-label">Email</label>
                <input type="email" class="form-control" name="email" value="${Utils.esc(s.email || '')}" maxlength="80"></div>

              <div class="col-sm-6"><label class="form-label required">Default Low Stock Threshold</label>
                <input type="number" class="form-control" name="lowStockThreshold" min="0" step="1" value="${s.lowStockThreshold ?? 10}">
                <div class="form-text">Default reorder level for newly created products.</div></div>
              <div class="col-sm-6 d-flex align-items-end">
                <button type="button" class="btn btn-soft btn-sm mb-1" id="apply-threshold">
                  <i class="bi bi-arrow-repeat me-1"></i>Apply threshold to all existing products
                </button>
              </div>

              <div class="col-12"><hr class="my-1"><h6 class="fw-semibold mb-0">Expiration &amp; Shelf-Life Warning Periods <span class="text-muted fw-normal small">(days before expiration)</span></h6></div>
              <div class="col-sm-4"><label class="form-label required">Nearing Expiration <span class="badge badge-soft-warning ms-1">Yellow</span></label>
                <input type="number" class="form-control" name="expiryNearDays" min="1" max="365" step="1" value="${s.expiryNearDays ?? 7}">
                <div class="form-text">Default: 7 days before expiry.</div></div>
              <div class="col-sm-4"><label class="form-label required">Expiring Very Soon <span class="badge badge-soft-orange ms-1">Orange</span></label>
                <input type="number" class="form-control" name="expiryVerySoonDays" min="1" max="365" step="1" value="${s.expiryVerySoonDays ?? 3}">
                <div class="form-text">Default: 3 days before expiry.</div></div>
              <div class="col-sm-4"><label class="form-label required">Immediate Alert <span class="badge badge-soft-danger ms-1">1-Day</span></label>
                <input type="number" class="form-control" name="expiryCriticalDays" min="0" max="365" step="1" value="${s.expiryCriticalDays ?? 1}">
                <div class="form-text">Default: 1 day before expiry.</div></div>

              <div class="col-12"><hr class="my-1"><h6 class="fw-semibold mb-0">Receipt Information</h6></div>
              <div class="col-12"><label class="form-label">Receipt Header Message</label>
                <input class="form-control" name="receiptHeader" value="${Utils.esc(s.receiptHeader || '')}" maxlength="120"></div>
              <div class="col-12"><label class="form-label">Receipt Footer Message</label>
                <input class="form-control" name="receiptFooter" value="${Utils.esc(s.receiptFooter || '')}" maxlength="120"></div>
              <div class="col-sm-6">
                <label class="form-check"><input type="checkbox" class="form-check-input" name="receiptShowCustomer" ${s.receiptShowCustomer !== false ? 'checked' : ''}>
                  <span class="form-check-label">Show customer name on receipt</span></label></div>
              <div class="col-sm-6">
                <label class="form-check"><input type="checkbox" class="form-check-input" name="receiptShowCashier" ${s.receiptShowCashier !== false ? 'checked' : ''}>
                  <span class="form-check-label">Show cashier name on receipt</span></label></div>

              <div class="col-12"><hr class="my-1"><h6 class="fw-semibold mb-0">Application Preferences <span class="text-muted fw-normal small">(saved in LocalStorage)</span></h6></div>
              <div class="col-sm-6"><label class="form-label">Table rows per page</label>
                <select class="form-select" name="pageSize">
                  ${[5, 10, 20, 50].map(n => `<option value="${n}" ${Number(p.pageSize) === n ? 'selected' : ''}>${n} rows</option>`).join('')}
                </select></div>
              <div class="col-sm-6 d-flex flex-column justify-content-end gap-1">
                <label class="form-check"><input type="checkbox" class="form-check-input" name="showPosImages" ${p.showPosImages !== false ? 'checked' : ''}>
                  <span class="form-check-label">Show product images in POS</span></label>
                <label class="form-check"><input type="checkbox" class="form-check-input" name="autoPrintReceipt" ${p.autoPrintReceipt ? 'checked' : ''}>
                  <span class="form-check-label">Automatically open print dialog after checkout</span></label>
                <label class="form-check"><input type="checkbox" class="form-check-input" name="lowStockAlerts" ${p.lowStockAlerts !== false ? 'checked' : ''}>
                  <span class="form-check-label">Show low-stock notifications</span></label>
                <label class="form-check"><input type="checkbox" class="form-check-input" name="expiryAlerts" ${p.expiryAlerts !== false ? 'checked' : ''}>
                  <span class="form-check-label">Show expiration &amp; shelf-life notifications</span></label>
              </div>
            </div></div>
            <div class="card-footer d-flex justify-content-end">
              <button class="btn btn-primary" type="submit"><i class="bi bi-check-lg me-1"></i>Save Settings</button>
            </div>
          </form>
        </div>

        <!-- Backup, Restore, CSV Exports & Reset -->
        <div class="col-lg-5 d-flex flex-column gap-3">
          <!-- JSON Backup & Restore -->
          <div class="card">
            <div class="card-header"><i class="bi bi-shield-check me-2"></i>Backup &amp; Restore (JSON)</div>
            <div class="card-body">
              <p class="small text-muted mb-3">A JSON backup contains all products, categories, transactions, inventory movements, customers, suppliers, user accounts and settings.</p>
              <div class="row g-2 text-center mb-3 small">
                <div class="col-4"><div class="p-2 border rounded-3"><div class="fw-bold">${counts[0]}</div><div class="text-muted">Products</div></div></div>
                <div class="col-4"><div class="p-2 border rounded-3"><div class="fw-bold">${counts[2]}</div><div class="text-muted">Sales</div></div></div>
                <div class="col-4"><div class="p-2 border rounded-3"><div class="fw-bold">${counts[3]}</div><div class="text-muted">Movements</div></div></div>
              </div>
              <div class="d-grid gap-2">
                <button class="btn btn-primary" id="btn-backup"><i class="bi bi-download me-1"></i>Export Full JSON Backup</button>
                <label class="btn btn-outline-primary mb-0" for="backup-file"><i class="bi bi-upload me-1"></i>Import / Restore Backup (JSON)</label>
                <input type="file" id="backup-file" accept=".json,application/json" class="d-none">
              </div>
            </div>
          </div>

          <!-- CSV Exports -->
          <div class="card">
            <div class="card-header"><i class="bi bi-filetype-csv me-2"></i>Spreadsheet Exports (CSV)</div>
            <div class="card-body">
              <p class="small text-muted mb-2">Download individual modules as CSV files for Excel or Google Sheets.</p>
              <div class="d-flex flex-wrap gap-2">
                <button class="btn btn-light btn-sm" data-csv="products"><i class="bi bi-box-seam me-1"></i>Products</button>
                <button class="btn btn-light btn-sm" data-csv="inventory"><i class="bi bi-clipboard-data me-1"></i>Inventory</button>
                <button class="btn btn-light btn-sm" data-csv="batches"><i class="bi bi-hourglass-split me-1"></i>Batches &amp; Expiry</button>
                <button class="btn btn-light btn-sm" data-csv="movements"><i class="bi bi-clock-history me-1"></i>Movements</button>
                <button class="btn btn-light btn-sm" data-csv="sales"><i class="bi bi-receipt me-1"></i>Sales</button>
                <button class="btn btn-light btn-sm" data-csv="customers"><i class="bi bi-people me-1"></i>Customers</button>
                <button class="btn btn-light btn-sm" data-csv="suppliers"><i class="bi bi-truck me-1"></i>Suppliers</button>
                <a class="btn btn-light btn-sm" href="#/reports"><i class="bi bi-bar-chart-line me-1"></i>Reports</a>
              </div>
            </div>
          </div>

          <!-- Reset Demo Data -->
          <div class="card border-danger-subtle">
            <div class="card-header text-danger"><i class="bi bi-exclamation-octagon me-2"></i>Reset Demo Data</div>
            <div class="card-body">
              <p class="small text-muted mb-3">Replaces all current records with a fresh set of sample food products, inventory, customers, suppliers, staff accounts and transactions.</p>
              <button class="btn btn-outline-danger w-100" id="btn-reset"><i class="bi bi-arrow-counterclockwise me-1"></i>Reset to Sample Demo Data</button>
            </div>
          </div>
        </div>
      </div>`;

    // Settings form submit
    const form = el.querySelector('#settings-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const d = Utils.formData(form), errors = {};
      if (!d.businessName || d.businessName.length < 2) errors.businessName = 'Business name is required.';
      if (!d.address) errors.address = 'Business address is required.';
      if (!d.phone || !Utils.isPhone(d.phone)) errors.phone = 'Enter a valid contact number.';
      if (d.email && !Utils.isEmail(d.email)) errors.email = 'Enter a valid email address.';
      if (!Utils.isWholeNumber(d.lowStockThreshold)) errors.lowStockThreshold = 'Enter a whole number of 0 or more.';
      if (!Utils.isWholeNumber(d.expiryNearDays) || parseInt(d.expiryNearDays, 10) < 1) errors.expiryNearDays = 'Enter days (1 or more).';
      if (!Utils.isWholeNumber(d.expiryVerySoonDays) || parseInt(d.expiryVerySoonDays, 10) < 1) errors.expiryVerySoonDays = 'Enter days (1 or more).';
      if (!Utils.isWholeNumber(d.expiryCriticalDays) || parseInt(d.expiryCriticalDays, 10) < 0) errors.expiryCriticalDays = 'Enter days (0 or more).';
      if (!Utils.showErrors(form, errors)) return;

      const [currency, currencySymbol] = String(d.currency || 'PHP|₱').split('|');
      const verySoon = Math.max(1, parseInt(d.expiryVerySoonDays, 10) || 3);
      const near = Math.max(verySoon + 1, parseInt(d.expiryNearDays, 10) || 7);
      const critical = Math.min(verySoon, Math.max(0, parseInt(d.expiryCriticalDays, 10) || 1));
      const next = {
        businessName: d.businessName, address: d.address, phone: d.phone, email: d.email || '',
        currency, currencySymbol, lowStockThreshold: parseInt(d.lowStockThreshold, 10),
        expiryNearDays: near,
        expiryVerySoonDays: verySoon,
        expiryCriticalDays: critical,
        receiptHeader: d.receiptHeader || '', receiptFooter: d.receiptFooter || '',
        receiptShowCustomer: !!form.receiptShowCustomer.checked,
        receiptShowCashier: !!form.receiptShowCashier.checked
      };
      try {
        await DB.setSetting('business', next);
        Prefs.setMany({
          pageSize: parseInt(d.pageSize, 10) || 10,
          showPosImages: !!form.showPosImages.checked,
          autoPrintReceipt: !!form.autoPrintReceipt.checked,
          lowStockAlerts: !!form.lowStockAlerts.checked,
          expiryAlerts: !!form.expiryAlerts.checked
        });
        await App.loadSettings();
        await App.dataChanged();
        Utils.toast('Settings saved successfully.');
      } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
    });

    // Apply threshold to all products
    el.querySelector('#apply-threshold').addEventListener('click', async () => {
      const val = parseInt(form.lowStockThreshold.value, 10);
      if (isNaN(val) || val < 0) { Utils.toast('Enter a valid threshold first.', 'warning'); return; }
      const ok = await Utils.confirm({
        title: 'Update reorder level on all products',
        confirmText: 'Update All Products',
        message: `Set the reorder level of all existing products to <strong>${val}</strong>?`
      });
      if (!ok) return;
      try {
        await DB.run(['products'], 'readwrite', async tx => {
          const ps = tx.objectStore('products');
          const all = await DB.req(ps.getAll());
          for (const p of all) { p.reorderLevel = val; await DB.req(ps.put(p)); }
        });
        await App.dataChanged();
        Utils.toast(`Reorder level set to ${val} for all products.`);
      } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
    });

    // Backup & restore
    el.querySelector('#btn-backup').addEventListener('click', () => this.exportBackup());
    el.querySelector('#backup-file').addEventListener('change', e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) this.importBackup(file);
    });

    // CSV buttons
    el.querySelectorAll('[data-csv]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.csv;
      if (k === 'products') Products.exportCSV();
      if (k === 'inventory') Inventory.exportStockCSV();
      if (k === 'batches') Inventory.exportBatchesCSV();
      if (k === 'movements') Inventory.exportMovementsCSV();
      if (k === 'sales') Sales.exportCSV();
      if (k === 'customers') Customers.exportCSV();
      if (k === 'suppliers') Suppliers.exportCSV();
    }));

    // Reset demo data
    el.querySelector('#btn-reset').addEventListener('click', () => this.resetDemo());
  },

  async exportBackup() {
    try {
      const data = await DB.exportAll();
      const payload = {
        app: 'FoodBusinessIMS',
        backupVersion: this.BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        preferences: Prefs.all(),
        data
      };
      const file = `food-business-backup-${Utils.stamp()}.json`;
      Utils.download(file, JSON.stringify(payload, null, 2), 'application/json');
      Prefs.set('lastBackup', payload.createdAt);
      await App.dataChanged();
      this.render(document.getElementById('page-content'));
      Utils.toast(`Backup exported to ${file}`);
    } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
  },

  validateBackup(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('The selected file is not a valid JSON object.');
    if (payload.app !== 'FoodBusinessIMS' || !payload.data || typeof payload.data !== 'object') {
      throw new Error('This file is not a Food Business IMS backup.');
    }
    if (!Number.isInteger(payload.backupVersion) || payload.backupVersion > this.BACKUP_VERSION) {
      throw new Error('Unsupported backup version.');
    }
    const d = payload.data;
    const requiredStores = ['products', 'categories', 'transactions', 'movements', 'customers', 'suppliers', 'users', 'settings'];
    for (const name of requiredStores) {
      if (!Array.isArray(d[name])) throw new Error(`Backup is missing the "${name}" store.`);
      const key = DB.STORES[name];
      for (const rec of d[name]) {
        if (!rec || typeof rec !== 'object' || !rec[key]) throw new Error(`Invalid record in "${name}" (missing "${key}").`);
      }
    }
    for (const p of d.products) {
      if (!p.name || isNaN(p.price) || isNaN(p.stock) || Number(p.stock) < 0) throw new Error(`Invalid product record (${p.id}).`);
    }
    if (!d.users.some(u => u.role === 'admin' && u.status === 'active')) {
      throw new Error('Backup must contain at least one active Administrator account.');
    }
    return true;
  },

  async importBackup(file) {
    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
      this.validateBackup(payload);
    } catch (err) {
      Utils.toast('Invalid backup file: ' + (err.message || 'Could not parse JSON.'), 'danger');
      return;
    }
    const d = payload.data;
    const ok = await Utils.confirm({
      title: 'Restore backup', danger: true, confirmText: 'Replace Data & Restore',
      message: `Replace all current application data with backup from <strong>${Utils.fmtDateTime(payload.createdAt)}</strong>?<br>
        <div class="small text-muted mt-2">Contains ${d.products.length} products, ${d.transactions.length} transactions, ${d.movements.length} movements, ${d.customers.length} customers, ${d.suppliers.length} suppliers and ${d.users.length} users.</div>`
    });
    if (!ok) return;
    try {
      await DB.replaceAll(d);
      if (payload.preferences && typeof payload.preferences === 'object') Prefs.setMany(payload.preferences);
      Prefs.set('lastBackup', new Date().toISOString());
      await App.loadSettings();
      const restored = await Auth.refresh();
      if (!restored) {
        const admin = d.users.find(u => u.role === 'admin' && u.status === 'active');
        Auth.user = admin;
        Prefs.setSession(admin.id);
      }
      App.renderUser();
      App.buildSidebar();
      await App.dataChanged();
      await this.render(document.getElementById('page-content'));
      Utils.toast('Backup restored successfully!');
    } catch (err) { Utils.toast('Restore failed: ' + DB.friendlyError(err), 'danger'); }
  },

  async resetDemo() {
    const ok = await Utils.confirm({
      title: 'Reset all data to sample demo records',
      danger: true,
      confirmText: 'Reset Everything',
      requireText: 'RESET',
      message: 'This will permanently erase all current products, inventory movements, sales transactions, customers, suppliers, users and settings, and reload the default sample data.'
    });
    if (!ok) return;
    try {
      const fresh = SampleData.build(new Date());
      await DB.replaceAll(fresh);
      Prefs.reset();
      await App.loadSettings();
      const admin = fresh.users.find(u => u.role === 'admin');
      Auth.user = admin;
      Prefs.setSession(admin.id);
      App.renderUser();
      App.buildSidebar();
      await App.dataChanged();
      await this.render(document.getElementById('page-content'));
      Utils.toast('Sample demonstration data has been restored.');
    } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
  }
};

/* =========================================================
   app.js - Application bootstrap, layout, routing, notifications
   ========================================================= */
'use strict';

const App = {
  settings: {},
  current: null,
  shellBound: false,

  modules() {
    return {
      dashboard: Dashboard, products: Products, inventory: Inventory, sales: Sales,
      suppliers: Suppliers, reports: Reports, users: Users, settings: SettingsPage
    };
  },

  async init() {
    const bootMsg = document.getElementById('boot-message');
    try {
      await DB.open();
      bootMsg.textContent = 'Preparing data…';
      const seeded = await SampleData.seedIfNeeded();
      if (seeded) console.info('Sample data initialized (first launch).');
      await this.loadSettings();
    } catch (err) {
      console.error(err);
      document.getElementById('boot-screen').innerHTML = `<div class="card p-4 text-center" style="max-width:460px">
        <div class="stat-icon tone-red mx-auto mb-3"><i class="bi bi-database-x"></i></div>
        <h5>Unable to start the application</h5><p class="text-muted">${Utils.esc(DB.friendlyError(err))}</p>
        <button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
      return;
    }
    this.setupNetworkStatus();
    this.registerServiceWorker();
    this.bindLogin();
    const user = await Auth.restore().catch(() => null);
    document.getElementById('boot-screen').remove();
    if (user) this.showApp(); else this.showLogin();
  },

  async loadSettings() {
    this.settings = Object.assign(SampleData.defaultSettings(), await DB.getSetting('business', {}));
    document.querySelectorAll('.js-business-name').forEach(el => { el.textContent = this.settings.businessName; });
    document.title = `${this.settings.businessName} · Inventory & Sales`;
  },

  /* ---------------- Login ---------------- */
  async showLogin() {
    document.getElementById('app-shell').classList.add('d-none');
    document.getElementById('login-screen').classList.remove('d-none');
    document.getElementById('login-form').reset();
    document.getElementById('login-error').classList.add('d-none');
    // Demo account shortcuts (from the users store, active accounts only)
    const users = (await DB.getAll('users')).filter(u => u.status === 'active').slice(0, 4);
    const holder = document.getElementById('demo-accounts');
    holder.innerHTML = users.map(u => `<button type="button" class="demo-chip" data-u="${Utils.esc(u.username)}" data-p="${Utils.esc(u.password)}">
      <i class="bi bi-${u.role === 'admin' ? 'shield-lock' : 'person'} me-1"></i>${Utils.esc(u.username)} <span class="text-muted">· ${u.role === 'admin' ? 'Admin' : 'Staff'}</span></button>`).join('')
      || '<span class="small text-muted">No active accounts.</span>';
    setTimeout(() => document.getElementById('login-username').focus(), 50);
  },

  bindLogin() {
    const form = document.getElementById('login-form');
    const err = document.getElementById('login-error');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      err.classList.add('d-none');
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await Auth.login(form.username.value, form.password.value);
        this.showApp();
        Utils.toast(`Welcome, ${Auth.user.fullName}!`);
      } catch (ex) {
        err.textContent = ex.message;
        err.classList.remove('d-none');
      } finally { btn.disabled = false; }
    });
    document.getElementById('demo-accounts').addEventListener('click', e => {
      const chip = e.target.closest('.demo-chip');
      if (!chip) return;
      form.username.value = chip.dataset.u;
      form.password.value = chip.dataset.p;
      form.requestSubmit();
    });
    document.getElementById('login-toggle-pw').addEventListener('click', e => {
      const input = document.getElementById('login-password');
      input.type = input.type === 'password' ? 'text' : 'password';
      e.currentTarget.innerHTML = `<i class="bi bi-eye${input.type === 'password' ? '' : '-slash'}"></i>`;
    });
  },

  /* ---------------- Shell ---------------- */
  showApp() {
    document.getElementById('login-screen').classList.add('d-none');
    document.getElementById('app-shell').classList.remove('d-none');
    if (Prefs.get('sidebarCollapsed')) document.body.classList.add('sidebar-collapsed');
    this.bindShell();
    this.renderUser();
    this.buildSidebar();
    this.route();
    this.refreshNotifications();
  },

  bindShell() {
    if (this.shellBound) return;
    this.shellBound = true;
    window.addEventListener('hashchange', () => { if (Auth.user) this.route(); });
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      if (window.innerWidth < 992) {
        document.body.classList.toggle('sidebar-open');
      } else {
        const collapsed = document.body.classList.toggle('sidebar-collapsed');
        Prefs.set('sidebarCollapsed', collapsed);
      }
    });
    document.getElementById('sidebar-backdrop').addEventListener('click', () => document.body.classList.remove('sidebar-open'));
    document.getElementById('menu-logout').addEventListener('click', async () => {
      const ok = await Utils.confirm({ title: 'Sign out', message: 'Are you sure you want to sign out?', confirmText: 'Sign Out' });
      if (!ok) return;
      Auth.logout();
      Utils.destroyCharts();
      document.getElementById('page-content').innerHTML = '';
      this.current = null;
      history.replaceState(null, '', location.pathname);
      this.showLogin();
    });
    document.getElementById('menu-profile').addEventListener('click', () => this.showProfile());
  },

  renderUser() {
    const u = Auth.user;
    document.getElementById('user-name').textContent = u.fullName;
    document.getElementById('user-role').textContent = Auth.roleLabel(u.role);
    document.getElementById('user-avatar').textContent = Utils.initials(u.fullName);
    document.getElementById('menu-settings-li').classList.toggle('d-none', !Auth.can('settings'));
  },

  buildSidebar() {
    let html = '', section = '';
    Auth.MODULES.filter(m => Auth.can(m.key)).forEach(m => {
      if (m.section !== section) { section = m.section; html += `<div class="nav-section">${section}</div>`; }
      html += `<a href="#/${m.key}" class="sidebar-link" data-route="${m.key}" title="${m.label}">
        <i class="bi bi-${m.icon}"></i><span class="nav-label">${m.label}</span>
        ${m.key === 'inventory' ? '<span class="badge bg-danger rounded-pill nav-badge d-none" id="nav-low-badge"></span>' : ''}</a>`;
    });
    document.getElementById('sidebar-nav').innerHTML = html;
  },

  route() {
    const mods = this.modules();
    let key = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
    if (!mods[key]) key = Auth.firstAllowed();
    if (!key) { Utils.toast('Your account has no module permissions.', 'danger'); return; }
    if (!Auth.can(key)) {
      Utils.toast('You do not have permission to access that module.', 'warning');
      key = Auth.firstAllowed();
    }
    if (location.hash !== '#/' + key) history.replaceState(null, '', '#/' + key);
    this.navigate(key);
  },

  async navigate(key) {
    const mod = this.modules()[key];
    Utils.destroyCharts();
    if (this.current && this.current.destroy) this.current.destroy();
    this.current = mod;
    this.currentKey = key;
    document.body.classList.remove('sidebar-open');
    document.querySelectorAll('.sidebar-link').forEach(a => a.classList.toggle('active', a.dataset.route === key));
    const meta = Auth.MODULES.find(m => m.key === key);
    document.getElementById('page-title').textContent = mod.title || meta.label;
    document.getElementById('page-subtitle').textContent = mod.subtitle || '';
    document.getElementById('breadcrumb').innerHTML = key === 'dashboard'
      ? '<li class="breadcrumb-item active"><i class="bi bi-house-door me-1"></i>Home</li>'
      : `<li class="breadcrumb-item"><a href="#/${Auth.firstAllowed()}"><i class="bi bi-house-door me-1"></i>Home</a></li>
         <li class="breadcrumb-item active">${meta.section}</li><li class="breadcrumb-item active" aria-current="page">${meta.label}</li>`;
    const container = document.getElementById('page-content');
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
    try {
      await mod.render(container);
    } catch (err) {
      console.error(err);
      container.innerHTML = `<div class="card">${Utils.emptyState('exclamation-octagon', 'Something went wrong', DB.friendlyError(err))}</div>`;
    }
    window.scrollTo(0, 0);
  },

  /** Called by modules after any data change, keeps all modules in sync. */
  async dataChanged() {
    await this.refreshNotifications();
  },

  /* ---------------- Notifications ---------------- */
  async refreshNotifications() {
    try {
      const allActive = (await DB.getAll('products')).filter(p => p.status === 'active');
      const ingredients = allActive.filter(p => p.isIngredient || String(p.id || '').startsWith('ING-'));
      const out = ingredients.filter(p => Utils.stockStatus(p).key === 'out');
      const low = ingredients.filter(p => Utils.stockStatus(p).key === 'low');
      const items = [];
      let expAlertCount = 0;

      if (Auth.can('inventory') && Prefs.get('expiryAlerts') !== false) {
        ingredients.forEach(p => {
          const sum = Utils.productShelfSummary(p);
          if (sum.expiredQty > 0) {
            expAlertCount++;
            items.push({
              icon: 'calendar-x', tone: 'red',
              title: `${p.name}: ${Utils.num(sum.expiredQty)} ${p.unit} expired`,
              text: 'Discard expired ingredient batch(es) in Inventory.',
              href: '#/inventory'
            });
          }
          const verySoonBatches = sum.batches.filter(b => b.status.key === 'very-soon');
          const nearBatches = sum.batches.filter(b => b.status.key === 'nearing');
          if (verySoonBatches.length) {
            expAlertCount++;
            const b = verySoonBatches[0];
            items.push({
              icon: 'hourglass-bottom', tone: 'orange',
              title: `${p.name} expiring very soon (${b.status.daysText})`,
              text: `${Utils.num(sum.expiringVerySoonQty)} ${p.unit} across ${verySoonBatches.length} batch(es) · Exp ${Utils.fmtDate(b.expirationDate)}`,
              href: '#/inventory'
            });
          } else if (nearBatches.length) {
            expAlertCount++;
            const b = nearBatches[0];
            items.push({
              icon: 'hourglass-split', tone: 'amber',
              title: `${p.name} nearing expiration (${b.status.daysText})`,
              text: `${Utils.num(sum.nearingQty)} ${p.unit} · Exp ${Utils.fmtDate(b.expirationDate)}`,
              href: '#/inventory'
            });
          }
        });
      }

      if (Auth.can('inventory') && Prefs.get('lowStockAlerts')) {
        out.forEach(p => items.push({ icon: 'x-octagon', tone: 'red', title: `${p.name} is out of stock`, text: 'Restock this item as soon as possible.', href: '#/inventory' }));
        low.forEach(p => items.push({ icon: 'exclamation-triangle', tone: 'amber', title: `${p.name} is low on stock`, text: `${Utils.num(p.stock)} ${p.unit} left (reorder at ${p.reorderLevel})`, href: '#/inventory' }));
      }
      const last = Prefs.get('lastBackup');
      const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
      if (Auth.can('settings') && (days === null || days >= 7)) {
        items.push({ icon: 'cloud-arrow-down', tone: 'blue', title: 'Back up your records', text: last ? `Last backup was ${days} day(s) ago.` : 'No backup has been made yet.', href: '#/settings' });
      }
      document.getElementById('notif-list').innerHTML = items.length
        ? items.map(n => `<a class="notif-item" href="${n.href}"><span class="notif-icon tone-${n.tone}"><i class="bi bi-${n.icon}"></i></span>
            <span><span class="d-block fw-semibold">${Utils.esc(n.title)}</span><span class="text-muted small">${Utils.esc(n.text)}</span></span></a>`).join('')
        : Utils.emptyState('bell-slash', 'All caught up', 'No notifications right now.');
      const badge = document.getElementById('notif-count');
      badge.textContent = items.length > 99 ? '99+' : items.length;
      badge.classList.toggle('d-none', items.length === 0);
      const navBadge = document.getElementById('nav-low-badge');
      const navCount = Auth.can('inventory') ? (low.length + out.length + expAlertCount) : 0;
      if (navBadge) {
        navBadge.textContent = navCount;
        navBadge.classList.toggle('d-none', navCount === 0);
      }
    } catch (e) { console.warn('Notifications failed', e); }
  },

  /* ---------------- Profile ---------------- */
  showProfile() {
    const u = Auth.user;
    const m = Utils.modal({
      title: '<i class="bi bi-person-circle me-2"></i>My Profile',
      body: `<div class="d-flex align-items-center gap-3 mb-4"><span class="avatar" style="width:56px;height:56px;font-size:1.2rem">${Utils.esc(Utils.initials(u.fullName))}</span>
          <div><div class="fw-bold fs-5">${Utils.esc(u.fullName)}</div><div class="text-muted">${Auth.roleLabel(u.role)} · @${Utils.esc(u.username)}</div></div></div>
        <div class="detail-grid mb-4">
          <div><div class="detail-label">User ID</div><div class="detail-value">${Utils.esc(u.id)}</div></div>
          <div><div class="detail-label">Contact</div><div class="detail-value">${Utils.esc(u.phone || '—')}</div></div>
          <div><div class="detail-label">Status</div><div class="detail-value text-capitalize">${Utils.esc(u.status)}</div></div>
        </div>
        <div class="detail-label mb-2">Module access</div>
        <div class="d-flex flex-wrap gap-1 mb-4">${Auth.MODULES.filter(x => Auth.can(x.key)).map(x => `<span class="badge badge-soft-success">${x.label}</span>`).join('')}</div>
        <form id="pw-form" novalidate><div class="detail-label mb-2">Change demo password</div>
          <div class="row g-2"><div class="col-sm-6"><input type="password" class="form-control" name="current" placeholder="Current password"></div>
          <div class="col-sm-6"><input type="password" class="form-control" name="next" placeholder="New password (min. 4 chars)"></div></div>
          <div class="form-text">Demo passwords are stored locally in plain form. Never reuse a real password.</div>
          <button class="btn btn-soft btn-sm mt-2" type="submit"><i class="bi bi-key me-1"></i>Update Password</button></form>`
    });
    m.el.querySelector('#pw-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, d = Utils.formData(f), errors = {};
      if (d.current !== Auth.user.password) errors.current = 'Current password is incorrect.';
      if (!d.next || d.next.length < 4) errors.next = 'New password must be at least 4 characters.';
      if (!Utils.showErrors(f, errors)) return;
      try {
        const rec = await DB.get('users', Auth.user.id);
        rec.password = d.next;
        rec.updatedAt = new Date().toISOString();
        await DB.put('users', rec);
        Auth.user = rec;
        Utils.toast('Password updated.');
        m.close();
      } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
    });
  },

  /* ---------------- Offline / PWA ---------------- */
  setupNetworkStatus() {
    const el = document.getElementById('network-status');
    const update = () => {
      const online = navigator.onLine;
      el.className = `badge rounded-pill network-badge ${online ? 'online' : 'offline'}`;
      el.innerHTML = `<i class="bi bi-${online ? 'wifi' : 'wifi-off'}"></i> <span class="d-none d-sm-inline">${online ? 'Online' : 'Offline mode'}</span>`;
      el.title = online ? 'Connected. All data is still stored locally.' : 'No internet connection. The app keeps working offline.';
    };
    window.addEventListener('online', () => { update(); Utils.toast('Back online.', 'info'); });
    window.addEventListener('offline', () => { update(); Utils.toast('You are offline. The app will keep working.', 'warning'); });
    update();
  },

  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) {
      if (location.protocol === 'file:') console.info('Service Worker requires http(s)://. Serve the folder with a local web server for offline/PWA support.');
      return;
    }
    navigator.serviceWorker.register('sw.js').then(reg => {
      console.info('Service Worker registered:', reg.scope);
    }).catch(err => console.warn('Service Worker registration failed:', err));
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

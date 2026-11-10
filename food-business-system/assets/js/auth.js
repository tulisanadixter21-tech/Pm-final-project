/* =========================================================
   auth.js - Local DEMONSTRATION login & role permissions
   NOTE: This is not secure authentication. Accounts live only in
   this browser's IndexedDB. Never use real passwords here.
   ========================================================= */
'use strict';

const Auth = {
  user: null,

  MODULES: [
    { key: 'dashboard', label: 'Dashboard', icon: 'speedometer2', section: 'Overview' },
    { key: 'products', label: 'Products', icon: 'box-seam', section: 'Operations' },
    { key: 'inventory', label: 'Inventory', icon: 'clipboard-data', section: 'Operations' },
    { key: 'sales', label: 'Sales', icon: 'cart3', section: 'Operations' },
    { key: 'suppliers', label: 'Suppliers', icon: 'truck', section: 'Records' },
    { key: 'reports', label: 'Reports', icon: 'bar-chart-line', section: 'Records' },
    { key: 'users', label: 'User Management', icon: 'person-badge', section: 'Administration' },
    { key: 'settings', label: 'Settings', icon: 'gear', section: 'Administration' }
  ],
  /** Permissions that only an Administrator may grant to staff. */
  ADMIN_GRANTED: ['users', 'settings'],

  async login(username, password) {
    username = String(username || '').trim().toLowerCase();
    if (!username || !password) throw new Error('Please enter your username and password.');
    const users = await DB.getAll('users');
    const user = users.find(u => u.username.toLowerCase() === username);
    if (!user || user.password !== password) throw new Error('Invalid username or password.');
    if (user.status !== 'active') throw new Error('This account is deactivated. Please contact the administrator.');
    this.user = user;
    Prefs.setSession(user.id);
    return user;
  },

  async restore() {
    const id = Prefs.getSession();
    if (!id) return null;
    const user = await DB.get('users', id);
    if (!user || user.status !== 'active') { Prefs.clearSession(); return null; }
    this.user = user;
    return user;
  },

  /** Reload the current user's record (after edits to permissions etc.). */
  async refresh() {
    if (!this.user) return null;
    const user = await DB.get('users', this.user.id);
    if (!user || user.status !== 'active') { this.logout(); return null; }
    this.user = user;
    return user;
  },

  logout() {
    this.user = null;
    Prefs.clearSession();
  },

  isAdmin() { return !!this.user && this.user.role === 'admin'; },

  can(moduleKey) {
    if (!this.user) return false;
    if (this.isAdmin()) return true;
    return (this.user.permissions || []).includes(moduleKey);
  },

  /** Staff with the "users" permission may manage staff accounts but never administrators. */
  canManageUser(target) {
    if (this.isAdmin()) return true;
    return this.can('users') && (!target || target.role !== 'admin');
  },

  firstAllowed() {
    const m = this.MODULES.find(x => this.can(x.key));
    return m ? m.key : null;
  },

  roleLabel(role) { return role === 'admin' ? 'Administrator' : 'Authorized Staff'; }
};

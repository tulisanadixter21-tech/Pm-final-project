/* =========================================================
   users.js - User Management (Admin & Authorized Staff)
   NOTE: Local demonstration authentication only. Never store
   real passwords or sensitive personal information.
   ========================================================= */
'use strict';

const Users = {
  title: 'User Management',
  subtitle: 'Manage administrator and staff demonstration accounts and module permissions',
  state: { search: '', role: '', status: '', page: 1 },
  users: [],

  async render(el) {
    el.innerHTML = `
      <div class="alert alert-soft-warning d-flex gap-2 align-items-center mb-3">
        <i class="bi bi-shield-exclamation fs-5"></i>
        <div class="small"><strong>Local Demonstration Authentication:</strong> Accounts and demo passwords are stored locally in this browser for role demonstration only. Do not use real passwords.</div>
      </div>
      <div class="card">
        <div class="card-body border-bottom"><div class="toolbar">
          <div class="search-box"><i class="bi bi-search"></i>
            <input type="search" class="form-control" id="usr-search" placeholder="Search ID, full name or username…" value="${Utils.esc(this.state.search)}"></div>
          <select class="form-select" id="usr-role"><option value="">All roles</option><option value="admin">Administrator</option><option value="staff">Authorized Staff</option></select>
          <select class="form-select" id="usr-status"><option value="">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
          <div class="ms-auto">
            <button class="btn btn-primary" id="usr-add"><i class="bi bi-person-plus me-1"></i>Add User</button>
          </div>
        </div></div>
        <div class="table-wrap"><table class="table table-hover"><thead><tr>
          <th>User ID</th><th>Full Name</th><th>Username</th><th>Role</th><th>Contact</th>
          <th>Assigned Access</th><th>Status</th><th class="text-end">Actions</th>
        </tr></thead><tbody id="usr-tbody"></tbody></table></div>
        <div id="usr-pager"></div>
      </div>`;
    const s = this.state;
    el.querySelector('#usr-role').value = s.role;
    el.querySelector('#usr-status').value = s.status;
    el.querySelector('#usr-search').addEventListener('input', Utils.debounce(e => { s.search = e.target.value.trim(); s.page = 1; this.renderTable(); }));
    el.querySelector('#usr-role').addEventListener('change', e => { s.role = e.target.value; s.page = 1; this.renderTable(); });
    el.querySelector('#usr-status').addEventListener('change', e => { s.status = e.target.value; s.page = 1; this.renderTable(); });
    el.querySelector('#usr-add').addEventListener('click', () => this.openForm());
    Utils.bindPager(el.querySelector('#usr-pager'), p => { s.page = p; this.renderTable(); });
    el.querySelector('#usr-tbody').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const u = this.users.find(x => x.id === b.dataset.id);
      if (!u) return;
      if (b.dataset.act === 'view') this.view(u);
      if (b.dataset.act === 'edit') this.openForm(u);
      if (b.dataset.act === 'toggle') this.toggleStatus(u);
      if (b.dataset.act === 'delete') this.remove(u);
    });
    await this.load();
  },

  async load() {
    this.users = (await DB.getAll('users')).sort((a, b) => a.id.localeCompare(b.id));
    this.renderTable();
  },

  filtered() {
    const s = this.state, q = s.search.toLowerCase();
    return this.users.filter(u =>
      (!q || [u.id, u.fullName, u.username, u.phone].join(' ').toLowerCase().includes(q)) &&
      (!s.role || u.role === s.role) &&
      (!s.status || u.status === s.status));
  },

  activeAdminCount() {
    return this.users.filter(u => u.role === 'admin' && u.status === 'active').length;
  },

  renderTable() {
    const tbody = document.getElementById('usr-tbody');
    if (!tbody) return;
    const list = this.filtered();
    const pg = Utils.paginate(list, this.state.page, Prefs.get('pageSize'));
    this.state.page = pg.page;
    tbody.innerHTML = pg.items.length ? pg.items.map(u => {
      const canManage = Auth.canManageUser(u);
      const isSelf = Auth.user && Auth.user.id === u.id;
      const perms = u.role === 'admin'
        ? '<span class="badge badge-soft-purple">Full Access (All Modules)</span>'
        : (u.permissions || []).map(k => {
            const m = Auth.MODULES.find(x => x.key === k);
            return m ? `<span class="badge badge-soft-success me-1">${m.label}</span>` : '';
          }).join('') || '<span class="text-muted small">None</span>';
      return `<tr>
        <td class="mono">${Utils.esc(u.id)}</td>
        <td><div class="cell-title">${Utils.esc(u.fullName)} ${isSelf ? '<span class="badge badge-soft-info ms-1">You</span>' : ''}</div></td>
        <td class="mono">@${Utils.esc(u.username)}</td>
        <td><span class="badge badge-soft-${u.role === 'admin' ? 'purple' : 'info'}">${Auth.roleLabel(u.role)}</span></td>
        <td>${Utils.esc(u.phone || '—')}</td>
        <td>${perms}</td>
        <td><span class="badge badge-soft-${u.status === 'active' ? 'success' : 'secondary'} text-capitalize">${u.status}</span></td>
        <td class="text-end text-nowrap">
          <button class="btn btn-light btn-action" data-act="view" data-id="${u.id}" title="View"><i class="bi bi-eye"></i></button>
          ${canManage ? `
            <button class="btn btn-light btn-action" data-act="edit" data-id="${u.id}" title="Edit"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-light btn-action" data-act="toggle" data-id="${u.id}" title="${u.status === 'active' ? 'Deactivate' : 'Activate'}">
              <i class="bi bi-${u.status === 'active' ? 'person-slash text-warning' : 'person-check text-success'}"></i></button>
            <button class="btn btn-light btn-action text-danger" data-act="delete" data-id="${u.id}" title="Delete" ${isSelf ? 'disabled' : ''}><i class="bi bi-trash"></i></button>
          ` : ''}
        </td>
      </tr>`;
    }).join('') : Utils.emptyRow(8, 'person-badge', 'No users match your filters');
    document.getElementById('usr-pager').innerHTML = Utils.pagerHTML(pg);
  },

  openForm(user = null) {
    if (user && !Auth.canManageUser(user)) {
      Utils.toast('Only an Administrator can edit administrator accounts.', 'warning');
      return;
    }
    const isEdit = !!user;
    const u = user || {
      id: Utils.nextId('U', this.users.map(x => x.id), 3),
      fullName: '', username: '', password: '', role: 'staff', phone: '', status: 'active',
      permissions: ['dashboard', 'sales', 'customers']
    };
    const isAdminActor = Auth.isAdmin();
    const m = Utils.modal({
      title: isEdit ? '<i class="bi bi-pencil-square me-2"></i>Edit User Account' : '<i class="bi bi-person-plus me-2"></i>Add User Account',
      size: 'lg', staticBackdrop: true,
      body: `<form id="usr-form" novalidate><div class="row g-3">
        <div class="col-sm-4"><label class="form-label">User ID</label><input class="form-control mono" name="id" value="${Utils.esc(u.id)}" readonly></div>
        <div class="col-sm-8"><label class="form-label required">Full Name</label><input class="form-control" name="fullName" value="${Utils.esc(u.fullName)}" maxlength="80" autofocus></div>
        <div class="col-sm-6"><label class="form-label required">Username</label><input class="form-control mono" name="username" value="${Utils.esc(u.username)}" maxlength="30"></div>
        <div class="col-sm-6"><label class="form-label required">Demo Password</label>
          <input type="text" class="form-control" name="password" value="${Utils.esc(u.password)}" maxlength="40" placeholder="Demo password (min. 4 chars)">
          <div class="form-text">Plain demo password for local testing only.</div></div>
        <div class="col-sm-4"><label class="form-label required">Role</label>
          <select class="form-select" name="role" id="usr-form-role" ${!isAdminActor ? 'disabled' : ''}>
            ${isAdminActor ? `<option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option>` : ''}
            <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Authorized Staff</option>
          </select></div>
        <div class="col-sm-4"><label class="form-label">Contact Number</label><input class="form-control" name="phone" value="${Utils.esc(u.phone || '')}" maxlength="20"></div>
        <div class="col-sm-4"><label class="form-label">Account Status</label>
          <select class="form-select" name="status"><option value="active">Active</option><option value="inactive" ${u.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
        <div class="col-12" id="perm-box">
          <label class="form-label">Assigned Module Permissions <span class="text-muted small">(Authorized Staff)</span></label>
          <div class="row g-2 p-2 border rounded-3">
            ${Auth.MODULES.map(mod => {
              const adminOnly = Auth.ADMIN_GRANTED.includes(mod.key);
              const disabled = adminOnly && !isAdminActor;
              const checked = (u.permissions || []).includes(mod.key);
              return `<div class="col-sm-6"><label class="form-check d-flex align-items-center gap-2 mb-0">
                <input type="checkbox" class="form-check-input mt-0" name="permissions" value="${mod.key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                <span class="small"><i class="bi bi-${mod.icon} me-1"></i>${mod.label} ${adminOnly ? '<span class="text-muted">(admin permission)</span>' : ''}</span>
              </label></div>`;
            }).join('')}
          </div>
          <div class="form-text">Administrators automatically have full access to all modules.</div>
        </div>
      </div></form>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary" id="usr-save"><i class="bi bi-check-lg me-1"></i>${isEdit ? 'Save Changes' : 'Create User'}</button>`
    });
    const form = m.el.querySelector('#usr-form');
    const roleSel = m.el.querySelector('#usr-form-role');
    const permBox = m.el.querySelector('#perm-box');
    const syncRole = () => { permBox.classList.toggle('opacity-50', roleSel.value === 'admin'); };
    roleSel.addEventListener('change', syncRole);
    syncRole();
    form.addEventListener('submit', e => { e.preventDefault(); m.el.querySelector('#usr-save').click(); });

    m.el.querySelector('#usr-save').addEventListener('click', async ev => {
      const d = Utils.formData(form), errors = {};
      const role = isAdminActor ? (d.role || u.role) : 'staff';
      const uname = (d.username || '').toLowerCase();
      if (!d.fullName || d.fullName.length < 2) errors.fullName = 'Full name is required.';
      if (!uname || !/^[a-z0-9._-]{3,30}$/.test(uname)) errors.username = 'Use 3–30 lowercase letters, numbers, dots, dashes or underscores.';
      else if (this.users.some(x => x.username.toLowerCase() === uname && (!isEdit || x.id !== u.id))) errors.username = 'This username is already taken.';
      if (!d.password || d.password.length < 4) errors.password = 'Demo password must be at least 4 characters.';
      if (d.phone && !Utils.isPhone(d.phone)) errors.phone = 'Enter a valid contact number.';

      // Prevent removing or deactivating the last active administrator
      if (isEdit && u.role === 'admin' && u.status === 'active' && (role !== 'admin' || d.status === 'inactive') && this.activeAdminCount() <= 1) {
        errors.status = 'At least one active Administrator account must remain.';
      }
      if (isEdit && Auth.user.id === u.id && d.status === 'inactive') {
        errors.status = 'You cannot deactivate the account you are currently signed in with.';
      }

      let permissions = d.permissions ? [].concat(d.permissions) : [];
      if (!isAdminActor && isEdit) {
        // Preserve any admin-granted permissions that a non-admin cannot edit
        Auth.ADMIN_GRANTED.forEach(k => { if ((u.permissions || []).includes(k) && !permissions.includes(k)) permissions.push(k); });
      }
      if (role === 'admin') permissions = Auth.MODULES.map(x => x.key);
      if (role === 'staff' && !permissions.length) {
        Utils.toast('Please assign at least one module permission for this staff account.', 'warning');
        return;
      }
      if (!Utils.showErrors(form, errors)) return;

      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const rec = {
          id: u.id, fullName: d.fullName, username: uname, password: d.password,
          role, phone: d.phone || '', status: d.status === 'inactive' ? 'inactive' : 'active',
          permissions, createdAt: u.createdAt || new Date().toISOString()
        };
        await DB.put('users', rec);
        if (Auth.user && Auth.user.id === rec.id) {
          await Auth.refresh();
          App.renderUser();
          App.buildSidebar();
        }
        Utils.toast(isEdit ? 'User account updated.' : 'User account created.');
        m.close();
        await this.load();
      } catch (err) {
        Utils.toast(DB.friendlyError(err), 'danger');
        btn.disabled = false;
      }
    });
  },

  view(u) {
    const canSeePw = Auth.canManageUser(u) || (Auth.user && Auth.user.id === u.id);
    const m = Utils.modal({
      title: '<i class="bi bi-person-badge me-2"></i>User Account Details',
      body: `
        <div class="d-flex align-items-center gap-3 mb-3">
          <span class="avatar" style="width:52px;height:52px;font-size:1.1rem">${Utils.esc(Utils.initials(u.fullName))}</span>
          <div>
            <h5 class="mb-0">${Utils.esc(u.fullName)}</h5>
            <div class="text-muted small"><span class="mono">${Utils.esc(u.id)}</span> · @${Utils.esc(u.username)}</div>
          </div>
        </div>
        <div class="detail-grid mb-3">
          <div><div class="detail-label">Role</div><div class="detail-value">${Auth.roleLabel(u.role)}</div></div>
          <div><div class="detail-label">Account Status</div><div class="detail-value text-capitalize">${u.status}</div></div>
          <div><div class="detail-label">Contact Number</div><div class="detail-value">${Utils.esc(u.phone || '—')}</div></div>
          ${canSeePw ? `<div><div class="detail-label">Demo Password</div><div class="detail-value mono">${Utils.esc(u.password)}</div></div>` : ''}
        </div>
        <div class="detail-label mb-2">Assigned Permissions</div>
        <div class="d-flex flex-wrap gap-1">
          ${u.role === 'admin'
            ? Auth.MODULES.map(x => `<span class="badge badge-soft-purple">${x.label}</span>`).join('')
            : (u.permissions || []).map(k => {
                const mod = Auth.MODULES.find(x => x.key === k);
                return mod ? `<span class="badge badge-soft-success">${mod.label}</span>` : '';
              }).join('') || '<span class="text-muted small">None</span>'}
        </div>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">Close</button>
        ${Auth.canManageUser(u) ? '<button class="btn btn-primary" id="usr-view-edit"><i class="bi bi-pencil me-1"></i>Edit</button>' : ''}`
    });
    const editBtn = m.el.querySelector('#usr-view-edit');
    if (editBtn) editBtn.addEventListener('click', () => { m.close(); setTimeout(() => this.openForm(u), 300); });
  },

  async toggleStatus(u) {
    if (!Auth.canManageUser(u)) { Utils.toast('Only an Administrator can modify administrator accounts.', 'warning'); return; }
    if (Auth.user.id === u.id) { Utils.toast('You cannot deactivate your own active session.', 'warning'); return; }
    if (u.role === 'admin' && u.status === 'active' && this.activeAdminCount() <= 1) {
      Utils.toast('Cannot deactivate the only active Administrator account.', 'warning'); return;
    }
    const next = u.status === 'active' ? 'inactive' : 'active';
    const ok = await Utils.confirm({
      title: `${next === 'active' ? 'Activate' : 'Deactivate'} account`,
      confirmText: next === 'active' ? 'Activate' : 'Deactivate',
      danger: next === 'inactive',
      message: `${next === 'active' ? 'Activate' : 'Deactivate'} user <strong>${Utils.esc(u.fullName)}</strong> (@${Utils.esc(u.username)})?`
    });
    if (!ok) return;
    try {
      u.status = next;
      await DB.put('users', u);
      Utils.toast(`Account ${next === 'active' ? 'activated' : 'deactivated'}.`);
      await this.load();
    } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
  },

  async remove(u) {
    if (!Auth.canManageUser(u)) { Utils.toast('Only an Administrator can delete administrator accounts.', 'warning'); return; }
    if (Auth.user.id === u.id) { Utils.toast('You cannot delete the account you are signed in with.', 'warning'); return; }
    if (u.role === 'admin' && u.status === 'active' && this.activeAdminCount() <= 1) {
      Utils.toast('Cannot delete the only active Administrator account.', 'warning'); return;
    }
    const ok = await Utils.confirm({
      title: 'Delete user account', danger: true, confirmText: 'Delete User',
      message: `Delete user account <strong>${Utils.esc(u.fullName)}</strong> (@${Utils.esc(u.username)})?`
    });
    if (!ok) return;
    try {
      await DB.remove('users', u.id);
      Utils.toast('User deleted.');
      await this.load();
    } catch (err) { Utils.toast(DB.friendlyError(err), 'danger'); }
  }
};

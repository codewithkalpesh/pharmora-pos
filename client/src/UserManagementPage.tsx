import { useEffect, useState, type FormEvent } from 'react';
import { useAuth, type User, type UserRole } from './AuthContext.js';
import { API_BASE as apiBase } from './config.js';
import './auth.css';

const ROLES: UserRole[] = ['OWNER', 'MANAGER', 'CASHIER', 'PHARMACIST', 'STAFF'];

export function UserManagementPage() {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resettingUser, setResettingUser] = useState<User | null>(null);

  // Create form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roleName, setRoleName] = useState<UserRole>('STAFF');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRoleName, setEditRoleName] = useState<UserRole>('STAFF');

  // Reset password form state
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [confirmStaffPassword, setConfirmStaffPassword] = useState('');

  useEffect(() => {
    loadUsers();
  }, [token]);

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.message || 'Failed to load users');
      }
      setUsers(payload.users || []);
    } catch (err: any) {
      setError(err?.message || 'Error connecting to user service');
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg: string) {
    setSuccessNotice(msg);
    setTimeout(() => setSuccessNotice(''), 3500);
  }

  async function handleCreateUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError('');

    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setFormBusy(true);

    try {
      const res = await fetch(`${apiBase}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || undefined,
          roleName,
          password,
        }),
      });

      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.message || 'Failed to create user');
      }

      showToast(`User "${payload.user.name}" created successfully!`);
      setShowCreateModal(false);
      setName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setConfirmPassword('');
      setRoleName('STAFF');
      loadUsers();
    } catch (err: any) {
      setFormError(err?.message || 'Error creating user');
    } finally {
      setFormBusy(false);
    }
  }

  async function handleUpdateUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingUser) return;
    setFormError('');
    setFormBusy(true);

    try {
      const res = await fetch(`${apiBase}/api/users/${editingUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editName.trim(),
          phone: editPhone.trim() || undefined,
          roleName: editRoleName,
        }),
      });

      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.message || 'Failed to update user');
      }

      showToast(`User "${payload.user.name}" updated successfully!`);
      setEditingUser(null);
      loadUsers();
    } catch (err: any) {
      setFormError(err?.message || 'Error updating user');
    } finally {
      setFormBusy(false);
    }
  }

  async function handleToggleStatus(targetUser: User) {
    const nextStatus = !targetUser.isActive;
    const actionText = nextStatus ? 'activate' : 'deactivate';

    if (!window.confirm(`Are you sure you want to ${actionText} user "${targetUser.name}"?`)) {
      return;
    }

    try {
      const res = await fetch(`${apiBase}/api/users/${targetUser.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: nextStatus }),
      });

      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.message || `Failed to ${actionText} user`);
      }

      showToast(`User "${targetUser.name}" has been ${nextStatus ? 'activated' : 'deactivated'}.`);
      loadUsers();
    } catch (err: any) {
      setError(err?.message || `Error updating user status`);
    }
  }

  async function handleResetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!resettingUser) return;
    setFormError('');

    if (newStaffPassword.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }

    if (newStaffPassword !== confirmStaffPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setFormBusy(true);

    try {
      const res = await fetch(`${apiBase}/api/users/${resettingUser.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword: newStaffPassword }),
      });

      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.message || 'Failed to reset user password');
      }

      showToast(`Password reset successfully for "${resettingUser.name}"!`);
      setResettingUser(null);
      setNewStaffPassword('');
      setConfirmStaffPassword('');
    } catch (err: any) {
      setFormError(err?.message || 'Error resetting password');
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">SETTINGS & PERMISSIONS</p>
          <h1>User Management</h1>
        </div>
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            setFormError('');
            setShowCreateModal(true);
          }}
        >
          + Add New User
        </button>
      </div>

      {error && (
        <div className="badge danger" style={{ padding: '10px 14px', borderRadius: 8 }} role="alert">
          {error}
        </div>
      )}

      {successNotice && (
        <div className="badge success" style={{ padding: '10px 14px', borderRadius: 8 }}>
          {successNotice}
        </div>
      )}

      {/* Users Table */}
      <section className="panel" style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Staff & Roles ({users.length})</h2>
          <button type="button" className="secondary-btn" onClick={loadUsers} style={{ minHeight: 34, padding: '4px 12px' }}>
            🔄 Refresh
          </button>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Loading staff users…</p>
        ) : (
          <div className="table-responsive-container">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Contact</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>
                        <small style={{ display: 'block', color: 'var(--muted)' }}>{u.email}</small>
                      </td>
                      <td>{u.phone || '—'}</td>
                      <td>
                        <span className="user-role-tag" style={{ background: u.role?.name === 'OWNER' ? '#0284c7' : '#475569' }}>
                          {u.role?.name || 'STAFF'}
                        </span>
                      </td>
                      <td>
                        <span className={`user-status-tag ${u.isActive ? 'active' : 'inactive'}`}>
                          {u.isActive ? '● Active' : '○ Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="action-btn-group">
                          <button
                            type="button"
                            className="action-btn-sm"
                            onClick={() => {
                              setEditingUser(u);
                              setEditName(u.name);
                              setEditPhone(u.phone || '');
                              setEditRoleName(u.role?.name || 'STAFF');
                              setFormError('');
                            }}
                            title="Edit user"
                          >
                            ✏️ Edit
                          </button>

                          <button
                            type="button"
                            className="action-btn-sm"
                            onClick={() => {
                              setResettingUser(u);
                              setNewStaffPassword('');
                              setConfirmStaffPassword('');
                              setFormError('');
                            }}
                            title="Set password"
                          >
                            🔑 Password
                          </button>

                          {!isSelf && (
                            <button
                              type="button"
                              className={`action-btn-sm ${u.isActive ? 'danger' : ''}`}
                              onClick={() => handleToggleStatus(u)}
                            >
                              {u.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                      No staff users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="pos-modal-overlay" role="dialog" aria-modal="true">
          <div className="pos-modal" style={{ maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Create New User</h3>
              <button
                type="button"
                className="secondary-btn"
                style={{ minHeight: 30, padding: '2px 8px', border: 'none' }}
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="badge danger" style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 10 }} role="alert">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateUser} style={{ display: 'grid', gap: 12 }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Full Name:
                <input
                  type="text"
                  required
                  className="login-input"
                  style={{ marginTop: 4 }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  autoFocus
                />
              </label>

              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Email Address (Username):
                <input
                  type="email"
                  required
                  className="login-input"
                  style={{ marginTop: 4 }}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. ramesh@pharmora.local"
                />
              </label>

              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Phone Number (WhatsApp):
                <input
                  type="tel"
                  className="login-input"
                  style={{ marginTop: 4 }}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                />
              </label>

              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                System Role:
                <select
                  className="login-input"
                  style={{ marginTop: 4 }}
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value as UserRole)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  Password:
                  <input
                    type="password"
                    required
                    className="login-input"
                    style={{ marginTop: 4 }}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 chars"
                  />
                </label>
                <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  Confirm:
                  <input
                    type="password"
                    required
                    className="login-input"
                    style={{ marginTop: 4 }}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter"
                  />
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="submit" className="primary-btn" style={{ flex: 1 }} disabled={formBusy}>
                  {formBusy ? 'Creating User…' : 'Create User'}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowCreateModal(false)}
                  disabled={formBusy}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="pos-modal-overlay" role="dialog" aria-modal="true">
          <div className="pos-modal" style={{ maxWidth: 440 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Edit User</h3>
              <button
                type="button"
                className="secondary-btn"
                style={{ minHeight: 30, padding: '2px 8px', border: 'none' }}
                onClick={() => setEditingUser(null)}
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="badge danger" style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 10 }} role="alert">
                {formError}
              </div>
            )}

            <form onSubmit={handleUpdateUser} style={{ display: 'grid', gap: 12 }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Full Name:
                <input
                  type="text"
                  required
                  className="login-input"
                  style={{ marginTop: 4 }}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>

              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Email (Read-only):
                <input
                  type="email"
                  disabled
                  className="login-input"
                  style={{ marginTop: 4, opacity: 0.7 }}
                  value={editingUser.email}
                />
              </label>

              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Phone Number:
                <input
                  type="tel"
                  className="login-input"
                  style={{ marginTop: 4 }}
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </label>

              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Role:
                <select
                  className="login-input"
                  style={{ marginTop: 4 }}
                  value={editRoleName}
                  onChange={(e) => setEditRoleName(e.target.value as UserRole)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="submit" className="primary-btn" style={{ flex: 1 }} disabled={formBusy}>
                  {formBusy ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setEditingUser(null)}
                  disabled={formBusy}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resettingUser && (
        <div className="pos-modal-overlay" role="dialog" aria-modal="true">
          <div className="pos-modal" style={{ maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Set Password for {resettingUser.name}</h3>
              <button
                type="button"
                className="secondary-btn"
                style={{ minHeight: 30, padding: '2px 8px', border: 'none' }}
                onClick={() => setResettingUser(null)}
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="badge danger" style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 10 }} role="alert">
                {formError}
              </div>
            )}

            <form onSubmit={handleResetPassword} style={{ display: 'grid', gap: 12 }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                New Password:
                <input
                  type="password"
                  required
                  className="login-input"
                  style={{ marginTop: 4 }}
                  value={newStaffPassword}
                  onChange={(e) => setNewStaffPassword(e.target.value)}
                  placeholder="Min 6 chars"
                  autoFocus
                />
              </label>

              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Confirm New Password:
                <input
                  type="password"
                  required
                  className="login-input"
                  style={{ marginTop: 4 }}
                  value={confirmStaffPassword}
                  onChange={(e) => setConfirmStaffPassword(e.target.value)}
                  placeholder="Re-enter password"
                />
              </label>

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="submit" className="primary-btn" style={{ flex: 1 }} disabled={formBusy}>
                  {formBusy ? 'Resetting…' : 'Update User Password'}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setResettingUser(null)}
                  disabled={formBusy}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

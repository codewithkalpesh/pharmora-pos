import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthContext.js';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const { token } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentPassword) {
      setError('Please enter your current password.');
      return;
    }

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setBusy(true);

    try {
      const res = await fetch(`${apiBase}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.message || 'Failed to update password.');
      }

      setSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        onClose();
        setSuccess('');
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Error updating password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-modal-overlay" role="dialog" aria-modal="true">
      <div className="pos-modal" style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Change Password</h3>
          <button
            type="button"
            className="secondary-btn"
            style={{ minHeight: 30, padding: '2px 8px', border: 'none', fontSize: '1.1rem' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="badge danger" style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}

        {success && (
          <div className="badge success" style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            Current Password:
            <input
              type="password"
              className="login-input"
              style={{ marginTop: 4 }}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={busy}
              autoFocus
            />
          </label>

          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            New Password:
            <input
              type="password"
              className="login-input"
              style={{ marginTop: 4 }}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              disabled={busy}
              placeholder="Min 6 characters"
            />
          </label>

          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            Confirm New Password:
            <input
              type="password"
              className="login-input"
              style={{ marginTop: 4 }}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={busy}
              placeholder="Re-enter new password"
            />
          </label>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              type="submit"
              className="primary-btn"
              style={{ flex: 1 }}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Update Password'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

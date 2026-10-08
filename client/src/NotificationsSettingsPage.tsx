import { useState, useEffect } from 'react';
import './pos.css';
import { API_BASE as apiBase } from './config.js';

type TelegramConfig = {
  configured: boolean;
  enabled: boolean;
  chatId: string | null;
  hasToken: boolean;
  preferences: {
    dailySummary: boolean;
    purchaseNotifications: boolean;
    expenseNotifications: boolean;
    dailyClosing: boolean;
    lowStockAlert: boolean;
    expiryAlert: boolean;
    customerDues: boolean;
    supplierDues: boolean;
    monthlySummary: boolean;
  };
};

type TelegramEvent = {
  id: string;
  eventType: string;
  message: string;
  status: string;
  sentAt?: string | null;
  createdAt: string;
};

export function NotificationsSettingsPage({ token }: { token: string }) {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [history, setHistory] = useState<TelegramEvent[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Form states
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [prefs, setPrefs] = useState({
    dailySummary: true,
    purchaseNotifications: true,
    expenseNotifications: true,
    dailyClosing: true,
    lowStockAlert: true,
    expiryAlert: true,
    customerDues: true,
    supplierDues: true,
    monthlySummary: true,
  });

  useEffect(() => {
    if (!token) return;
    loadConfig();
    loadHistory();
  }, [token]);

  async function loadConfig() {
    try {
      const res = await fetch(`${apiBase}/api/notifications/telegram/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setConfig(json.data);
        setChatId(json.data.chatId || '');
        setEnabled(json.data.enabled);
        if (json.data.preferences) {
          setPrefs(json.data.preferences);
        }
      }
    } catch {
      setMessage({ text: 'Failed to load Telegram configuration', type: 'error' });
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch(`${apiBase}/api/notifications/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setHistory(json.data || []);
      }
    } catch {
      // Silently ignore history fetch errors
    }
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setBusyAction('saveConfig');
    setMessage(null);

    const payload: any = {
      chatId: chatId.trim() || undefined,
      enabled,
      preferences: prefs,
    };
    if (botToken.trim()) {
      payload.botToken = botToken.trim();
    }

    try {
      const res = await fetch(`${apiBase}/api/notifications/telegram/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        setConfig(json.data);
        setBotToken(''); // Clear sensitive token input after saving
        setMessage({ text: 'Telegram configuration saved successfully!', type: 'success' });
        loadHistory();
      } else {
        setMessage({ text: json.message || 'Failed to save configuration', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Network error saving configuration', type: 'error' });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTestConnection() {
    setBusyAction('test');
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/notifications/telegram/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setMessage({ text: 'Test message sent successfully to Telegram!', type: 'success' });
      } else {
        setMessage({ text: `Test failed: ${json.data?.error || json.message || 'Unknown error'}`, type: 'error' });
      }
      loadHistory();
    } catch {
      setMessage({ text: 'Network error testing Telegram connection', type: 'error' });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTriggerAction(actionName: string, endpoint: string) {
    setBusyAction(actionName);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/notifications/telegram/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setMessage({ text: `Notification "${actionName}" dispatched successfully!`, type: 'success' });
      } else {
        setMessage({ text: `Failed: ${json.data?.error || json.message || 'Error triggering notification'}`, type: 'error' });
      }
      loadHistory();
    } catch {
      setMessage({ text: `Network error triggering ${actionName}`, type: 'error' });
    } finally {
      setBusyAction(null);
    }
  }

  const isConfigured = config?.configured ?? false;
  const isEnabled = config?.enabled ?? false;

  return (
    <div className="container" style={{ padding: '24px 16px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>Communications & Notifications</h1>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0', fontSize: '0.9rem' }}>
            Safe Telegram business alerts & user-triggered WhatsApp customer sharing.
          </p>
        </div>
      </div>

      {/* Alert / Feedback message */}
      {message && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 18,
            fontWeight: 500,
            fontSize: '0.9rem',
            backgroundColor: message.type === 'success' ? '#dcfce7' : message.type === 'error' ? '#fee2e2' : '#e0e7ff',
            color: message.type === 'success' ? '#15803d' : message.type === 'error' ? '#b91c1c' : '#3730a3',
            border: `1px solid ${message.type === 'success' ? '#86efac' : message.type === 'error' ? '#fca5a5' : '#a5b4fc'}`,
          }}
        >
          {message.text}
        </div>
      )}

      {/* Channel Status Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 24 }}>
        {/* Telegram Card */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                ✈️ Telegram Notifications
              </h3>
              <span
                className={`badge ${isConfigured ? (isEnabled ? 'success' : 'warning') : 'danger'}`}
                style={{ fontSize: '0.8rem' }}
              >
                {isConfigured ? (isEnabled ? '● Active' : '● Disabled') : '○ Not Configured'}
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0 }}>
              Automated business summaries, low-stock warnings, expiry alerts, and daily closing digests sent directly to the store manager Telegram group/chat.
            </p>
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
              Chat ID: {config?.chatId ? config.chatId : 'None'}
            </span>
            {isConfigured && (
              <button
                type="button"
                className="secondary-btn"
                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                onClick={handleTestConnection}
                disabled={busyAction === 'test'}
              >
                {busyAction === 'test' ? 'Testing…' : 'Ping Test'}
              </button>
            )}
          </div>
        </div>

        {/* WhatsApp Card */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                💬 WhatsApp Sharing
              </h3>
              <span className="badge success" style={{ fontSize: '0.8rem' }}>
                ● Ready (Client)
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0 }}>
              User-triggered sharing for invoices, customer payment receipts, credit balance reminders, and purchase orders. Zero bulk spam, no API key needed.
            </p>
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 600 }}>
              ✓ 100% Financial Isolation Safe
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Standard wa.me URLs</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 20 }}>
        {/* Telegram Configuration Form */}
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginBottom: 14, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
            ⚙️ Telegram Configuration
          </h2>
          <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                Bot Token {config?.hasToken && <span style={{ color: '#059669', fontWeight: 400 }}>(✓ Saved in DB/Env)</span>}
              </label>
              <input
                type="password"
                placeholder={config?.hasToken ? '•••••••••••••••••••••••• (Leave blank to keep current)' : 'Enter Bot Token from @BotFather'}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--line)' }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                Create a bot via Telegram @BotFather to get the token. Never exposed in API responses.
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                Target Chat / Channel ID
              </label>
              <input
                type="text"
                placeholder="e.g. -1001234567890 or @your_channel"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--line)' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="enableTelegram"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <label htmlFor="enableTelegram" style={{ fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}>
                Enable Telegram Dispatch
              </label>
            </div>

            {/* Notification Preferences */}
            <div style={{ marginTop: 8, padding: 12, backgroundColor: 'var(--bg-subtle, #f8fafc)', borderRadius: 8 }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', fontWeight: 700 }}>
                Notification Preferences
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '0.85rem' }}>
                {[
                  { key: 'dailySummary', label: 'Daily Business Summary' },
                  { key: 'purchaseNotifications', label: 'Purchase Inward Alerts' },
                  { key: 'expenseNotifications', label: 'Expense Recording Alerts' },
                  { key: 'dailyClosing', label: 'Daily Closing Reports' },
                  { key: 'lowStockAlert', label: 'Low Stock Alerts' },
                  { key: 'expiryAlert', label: 'Expiry & Aging Alerts' },
                  { key: 'customerDues', label: 'Customer Dues Summaries' },
                  { key: 'supplierDues', label: 'Supplier Payables' },
                  { key: 'monthlySummary', label: 'Monthly Business P&L' },
                ].map(({ key, label }) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={(prefs as any)[key]}
                      onChange={(e) => setPrefs({ ...prefs, [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="submit"
                className="primary-btn"
                disabled={busyAction === 'saveConfig'}
                style={{ padding: '8px 18px', fontSize: '0.9rem' }}
              >
                {busyAction === 'saveConfig' ? 'Saving…' : 'Save Configuration'}
              </button>
            </div>
          </form>
        </section>

        {/* Manual Actions Panel */}
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem', marginBottom: 14, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
            🚀 Manual Telegram Triggers
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 16 }}>
            Managers can trigger instant Telegram summaries and alerts at any time. Values are computed dynamically from active database records.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { id: 'daily-summary', label: '📊 Send Daily Summary', endpoint: 'daily-summary', desc: 'Reconciled sales, payments, purchases, expenses & drawer cash' },
              { id: 'monthly-summary', label: '📈 Send Monthly P&L Summary', endpoint: 'monthly-summary', desc: 'Net sales, COGS, gross/net profit, margins, and GST summary' },
              { id: 'low-stock', label: '⚠️ Send Low Stock Alert', endpoint: 'low-stock', desc: 'Grouped summary of out-of-stock and low-stock products' },
              { id: 'expiry', label: '📅 Send Batch Expiry Alert', endpoint: 'expiry', desc: 'Breakdown of expired and 0-30d near-expiry stock' },
              { id: 'customer-dues', label: '👥 Send Customer Dues Summary', endpoint: 'customer-dues', desc: 'Total receivables and top customer balances' },
              { id: 'supplier-dues', label: '🏢 Send Supplier Dues Summary', endpoint: 'supplier-dues', desc: 'Total payables and top supplier balances' },
            ].map((action) => (
              <div
                key={action.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 12px',
                  backgroundColor: 'var(--bg-subtle, #f8fafc)',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{action.label}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{action.desc}</div>
                </div>
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ padding: '6px 12px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                  onClick={() => handleTriggerAction(action.label, action.endpoint)}
                  disabled={!isConfigured || busyAction !== null}
                >
                  {busyAction === action.label ? 'Sending…' : 'Trigger'}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Notification Activity History */}
      <section className="panel" style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>📜 Notification Dispatch Log</h2>
          <button
            type="button"
            className="secondary-btn"
            style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            onClick={loadHistory}
          >
            Refresh Logs
          </button>
        </div>

        <div className="table-scroll" style={{ maxHeight: 260 }}>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>Status</th>
                <th>Message Snippet</th>
              </tr>
            </thead>
            <tbody>
              {history.map((ev) => (
                <tr key={ev.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                    {new Date(ev.createdAt).toLocaleString('en-IN')}
                  </td>
                  <td>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{ev.eventType}</span>
                  </td>
                  <td>
                    <span className={`badge ${ev.status === 'SENT' ? 'success' : 'danger'}`}>
                      {ev.status}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--muted)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.message}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 18, color: 'var(--muted)' }}>
                    No notification events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

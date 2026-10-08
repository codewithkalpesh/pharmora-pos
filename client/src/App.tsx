import { useEffect, useState, type FormEvent } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './cashbook.css'
import './auth.css'
import { API_BASE as apiBase } from './config.js'
import { AuthProvider, useAuth } from './AuthContext.js'
import { LoginPage } from './LoginPage.js'
import { SignupPage } from './SignupPage.js'
import { ProtectedRoute } from './ProtectedRoute.js'
import { UserManagementPage } from './UserManagementPage.js'
import { ChangePasswordModal } from './ChangePasswordModal.js'
import { InventoryPage as InventoryScreen, ProductDetailPage, ProductsPage } from './InventoryPages.js'
import { PurchasesPage, SuppliersPage } from './PurchasePages.js'
import { POSPage } from './POSPage.js'
import { SalesPage } from './SalesPage.js'
import { CustomersPage } from './CustomersPage.js'
import { DailySalesPage } from './DailySalesPage.js'
import { PurchaseOrdersPage } from './PurchaseOrderPages.js'
import { ReturnsPage } from './ReturnsPages.js'
import { ExpiryManagementPage } from './ExpiryPages.js'
import { ReportsPage } from './ReportsPages.js'
import { ReceiptPage } from './ReceiptPages.js'
import { NotificationsSettingsPage } from './NotificationsSettingsPage.js'

type Stat = {
  label: string
  value: string
  tone?: 'success' | 'warning' | 'danger' | 'neutral'
}

interface NavItem {
  label: string
  path: string
  icon: string
  ownerOnly?: boolean
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: '📊' },
  { label: 'POS Billing', path: '/pos', icon: '🛒' },
  { label: 'Daily Sales', path: '/daily-sales', icon: '📅' },
  { label: 'Sales & Invoices', path: '/sales', icon: '🧾' },
  { label: 'Returns & Refunds', path: '/returns', icon: '🔄' },
  { label: 'Customers & Credit', path: '/customers', icon: '👥' },
  { label: 'Cashbook', path: '/cashbook', icon: '💰' },
  { label: 'Daily Closing', path: '/daily-closing', icon: '🔒' },
  { label: 'Products', path: '/products', icon: '🏷️' },
  { label: 'Expiry Management', path: '/expiry', icon: '⏳' },
  { label: 'Suppliers', path: '/suppliers', icon: '🏢' },
  { label: 'Purchase Orders', path: '/purchase-orders', icon: '📝' },
  { label: 'Purchases', path: '/purchases', icon: '📥' },
  { label: 'Inventory', path: '/inventory', icon: '📦' },
  { label: 'Reports & Profit', path: '/reports', icon: '📈' },
  { label: 'Notifications', path: '/notifications', icon: '🔔' },
  { label: 'User Management', path: '/settings/users', icon: '👤', ownerOnly: true },
]

type CashbookSummary = {
  businessDate: string
  openingCash: string
  openingCashSet: boolean
  openingSource: 'PREVIOUS_CLOSING' | 'MANUAL' | 'UNSET'
  cashInflows: string
  cashOutflows: string
  expectedDrawerCash: string
  actualDrawerCash: string | null
  difference: string | null
  closingStatus: 'BALANCED' | 'CASH_SHORT' | 'CASH_EXCESS' | null
  isClosed: boolean
}

type CashbookRecord = {
  id: string
  entryType: string
  direction: 'IN' | 'OUT'
  amount: string
  paymentMethod: string | null
  businessDate: string
  sourceType: string | null
  sourceId: string | null
  notes: string | null
  createdAt: string
  createdBy?: { name: string } | null
}

type DailyClosingRecord = {
  closingDate: string
  openingCash: string
  cashInflows: string
  cashOutflows: string
  expectedCash: string
  actualCash: string
  difference: string
  status: 'BALANCED' | 'CASH_SHORT' | 'CASH_EXCESS'
  notes: string | null
  closedBy?: { name: string } | null
}

function localDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value))
}

async function cashbookRequest<T>(path: string, token: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBase}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.message ?? 'Request failed')
  return payload.data as T
}

function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
  return isOnline
}

function StatusBadge({ status }: { status: CashbookSummary['closingStatus'] | DailyClosingRecord['status'] }) {
  if (!status) return <span className="badge neutral">Open</span>
  const label = status === 'BALANCED' ? 'Balanced' : status === 'CASH_SHORT' ? 'Cash Short' : 'Cash Excess'
  const tone = status === 'BALANCED' ? 'success' : status === 'CASH_SHORT' ? 'danger' : 'warning'
  return <span className={`badge ${tone}`}>{label}</span>
}

type DashboardData = {
  businessDate: string
  sales: {
    totalSales: number
    posSales: number
    nonPosSales: number
    cashSales: number
    upiSales: number
    creditSales: number
    reconciliationStatus: string
  }
  purchases: {
    totalPurchases: number
    cashPurchases: number
  }
  expenses: {
    totalExpenses: number
  }
  cashbook: {
    openingCash: string
    cashInflows: string
    cashOutflows: string
    expectedDrawerCash: string
    actualDrawerCash: string | null
    difference: string | null
    closingStatus: string | null
    isClosed: boolean
  }
  dues: {
    customerDues: number
    supplierDues: number
  }
  alerts: {
    expiredProducts: number
    nearExpiryProducts: number
    lowStockProducts: number
    customerDues: number
    supplierDues: number
  }
}

function StatCard({ label, value, tone = 'neutral' }: Stat) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DashboardPage() {
  const { token } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    if (!token) return
    let active = true
    fetch(`${apiBase}/api/dashboard/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((res) => {
        if (active && res.success && res.data) {
          setData(res.data)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [token])

  const priorityStats: Stat[] = data
    ? [
        { label: 'Today Sales', value: formatMoney(data.sales.totalSales), tone: 'success' },
        { label: 'Cash Sales', value: formatMoney(data.sales.cashSales), tone: 'neutral' },
        { label: 'UPI Sales', value: formatMoney(data.sales.upiSales), tone: 'neutral' },
        { label: 'Expected Cash', value: formatMoney(data.cashbook.expectedDrawerCash), tone: 'success' },
        { label: 'Actual Cash', value: formatMoney(data.cashbook.actualDrawerCash), tone: 'neutral' },
        { label: 'Difference', value: formatMoney(data.cashbook.difference), tone: data.cashbook.closingStatus === 'CASH_SHORT' ? 'danger' : 'neutral' },
      ]
    : [
        { label: 'Today Sales', value: '₹0.00', tone: 'success' },
        { label: 'Cash Sales', value: '₹0.00', tone: 'neutral' },
        { label: 'UPI Sales', value: '₹0.00', tone: 'neutral' },
        { label: 'Expected Cash', value: '₹0.00', tone: 'neutral' },
        { label: 'Actual Cash', value: '—', tone: 'neutral' },
        { label: 'Difference', value: '—', tone: 'neutral' },
      ]

  const liveAlerts = data
    ? [
        { label: 'Low Stock', value: `${data.alerts.lowStockProducts} products`, level: data.alerts.lowStockProducts > 0 ? 'warning' : 'neutral', link: '/inventory' },
        { label: 'Out of Stock', value: `${data.alerts.lowStockProducts > 0 ? 'Action Needed' : '0'}`, level: data.alerts.lowStockProducts > 0 ? 'danger' : 'neutral', link: '/purchase-orders' },
        { label: 'Expiry Alert (30d)', value: `${data.alerts.nearExpiryProducts} items`, level: data.alerts.nearExpiryProducts > 0 ? 'warning' : 'neutral', link: '/expiry' },
        { label: 'Customer Dues', value: formatMoney(data.dues.customerDues), level: data.dues.customerDues > 0 ? 'danger' : 'neutral', link: '/customers' },
        { label: 'Supplier Dues', value: formatMoney(data.dues.supplierDues), level: data.dues.supplierDues > 0 ? 'warning' : 'neutral', link: '/suppliers' },
      ]
    : []

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">PHARMORA POS / DASHBOARD</p>
          <h1>Overview</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="badge neutral">
            {data ? `Date: ${data.businessDate}` : new Date().toLocaleDateString('en-IN')}
          </span>
        </div>
      </div>

      {/* Quick Action Navigation Grid */}
      <section className="quick-actions-section">
        <div className="quick-actions-grid">
          <Link to="/pos" className="quick-action-btn" style={{ borderColor: '#0284c7' }}>
            <span className="icon">🛒</span>
            <span>POS Billing</span>
          </Link>
          <Link to="/cashbook" className="quick-action-btn">
            <span className="icon">💰</span>
            <span>Cashbook</span>
          </Link>
          <Link to="/daily-closing" className="quick-action-btn">
            <span className="icon">🔒</span>
            <span>Daily Closing</span>
          </Link>
          <Link to="/purchases" className="quick-action-btn">
            <span className="icon">📥</span>
            <span>Purchase</span>
          </Link>
          <Link to="/inventory" className="quick-action-btn">
            <span className="icon">📦</span>
            <span>Inventory</span>
          </Link>
        </div>
      </section>

      {/* Priority Financial KPI Cards */}
      <div className="stats-grid">
        {priorityStats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <div className="content-grid">
        {/* Alerts Panel */}
        <section className="panel">
          <h2>Store Alerts</h2>
          <div className="list-stack">
            {liveAlerts.map((alert) => (
              <Link key={alert.label} to={alert.link} className="row-item" style={{ textDecoration: 'none' }}>
                <span style={{ fontWeight: 500 }}>{alert.label}</span>
                <span className={`badge ${alert.level}`}>{alert.value}</span>
              </Link>
            ))}
            {liveAlerts.length === 0 && (
              <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>
                No active store alerts.
              </p>
            )}
          </div>
        </section>

        {/* Cash Position Widget */}
        <CashbookDashboardWidget />
      </div>
    </div>
  )
}

function CashbookDashboardWidget() {
  const { token } = useAuth()
  const [summary, setSummary] = useState<CashbookSummary | null>(null)
  useEffect(() => {
    if (!token) return
    cashbookRequest<CashbookSummary>(`/cashbook/summary?date=${localDate()}`, token)
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [token])

  return (
    <section className="panel dashboard-cashbook">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <p className="eyebrow">TODAY DRAWER</p>
          <h2 style={{ margin: 0 }}>Cash Position</h2>
        </div>
        <Link to="/daily-closing" className="secondary-btn" style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
          Close Day →
        </Link>
      </div>
      {summary ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <div className="stat-card">
            <span>Expected Drawer</span>
            <strong>{formatMoney(summary.expectedDrawerCash)}</strong>
          </div>
          <div className="stat-card">
            <span>Actual Drawer</span>
            <strong>{formatMoney(summary.actualDrawerCash)}</strong>
          </div>
          <div className="stat-card">
            <span>Difference</span>
            <strong>{formatMoney(summary.difference)}</strong>
          </div>
          <div className="stat-card">
            <span>Status</span>
            <StatusBadge status={summary.closingStatus} />
          </div>
        </div>
      ) : (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>
          {token ? 'Cashbook summary unavailable.' : 'Sign in to view drawer.'}
        </p>
      )}
    </section>
  )
}

function CashbookPage() {
  const { token } = useAuth()
  const [date, setDate] = useState(localDate)
  const [summary, setSummary] = useState<CashbookSummary | null>(null)
  const [entries, setEntries] = useState<CashbookRecord[]>([])
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN')
  const [openingAmount, setOpeningAmount] = useState('')
  const [openingReason, setOpeningReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    Promise.all([
      cashbookRequest<CashbookSummary>(`/cashbook/summary?date=${date}`, token),
      cashbookRequest<CashbookRecord[]>(`/cashbook?date=${date}`, token),
    ])
      .then(([nextSummary, nextEntries]) => {
        if (!active) return
        setSummary(nextSummary)
        setEntries(nextEntries)
        setOpeningAmount(nextSummary.openingCash)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load cashbook')
      })
    return () => {
      active = false
    }
  }, [date, token])

  async function submitOpeningCash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const updated = await cashbookRequest<CashbookSummary>('/cashbook/opening', token, {
        method: 'POST',
        body: JSON.stringify({ businessDate: date, openingCash: openingAmount, reason: openingReason || undefined }),
      })
      setSummary(updated)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to set opening cash')
    } finally {
      setBusy(false)
    }
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const endpoint = direction === 'IN' ? '/cashbook/cash-in' : '/cashbook/cash-out'
      await cashbookRequest(endpoint, token, {
        method: 'POST',
        body: JSON.stringify({ businessDate: date, amount, reason, entryType: direction === 'IN' ? 'DIRECT_IN' : 'DIRECT_OUT' }),
      })
      const [nextSummary, nextEntries] = await Promise.all([
        cashbookRequest<CashbookSummary>(`/cashbook/summary?date=${date}`, token),
        cashbookRequest<CashbookRecord[]>(`/cashbook?date=${date}`, token),
      ])
      setSummary(nextSummary)
      setEntries(nextEntries)
      setAmount('')
      setReason('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to record adjustment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-shell cashbook-page">
      <header className="page-header cashbook-header">
        <div>
          <p className="eyebrow">PHARMORA POS / CASHBOOK</p>
          <h1>Cash Register</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }}
          />
          <Link className="primary-btn" to="/daily-closing">
            Daily Closing
          </Link>
        </div>
      </header>

      {error && <div className="badge danger" style={{ padding: '10px 14px', borderRadius: 8 }} role="alert">{error}</div>}

      {/* Summary Cards */}
      {summary && (
        <div className="stats-grid">
          <StatCard label="Opening Cash" value={formatMoney(summary.openingCash)} tone="neutral" />
          <StatCard label="Cash In (+)" value={formatMoney(summary.cashInflows)} tone="success" />
          <StatCard label="Cash Out (-)" value={formatMoney(summary.cashOutflows)} tone="danger" />
          <StatCard label="Expected Drawer" value={formatMoney(summary.expectedDrawerCash)} tone="success" />
        </div>
      )}

      <div className="content-grid">
        {/* Entries Table */}
        <section className="panel" style={{ overflowX: 'auto' }}>
          <h2>Today's Cash Ledger</h2>
          <div className="table-responsive-container">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Direction</th>
                  <th>Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td><span className="badge neutral">{entry.entryType}</span></td>
                    <td>
                      <span className={`badge ${entry.direction === 'IN' ? 'success' : 'danger'}`}>
                        {entry.direction}
                      </span>
                    </td>
                    <td><strong>{formatMoney(entry.amount)}</strong></td>
                    <td style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{entry.notes || '—'}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                      No cash entries recorded for this date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Opening Cash or Cash Adjustments Form */}
        <section className="panel">
          {summary && !summary.openingCashSet ? (
            <div>
              <h2>Set Opening Cash Balance</h2>
              <form className="cash-form" onSubmit={submitOpeningCash} style={{ display: 'grid', gap: 12 }}>
                <label style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                  Opening Physical Cash (₹)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={openingAmount}
                    onChange={(event) => setOpeningAmount(event.target.value)}
                    required
                    style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 }}
                  />
                </label>
                <label style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                  Note / Reason
                  <input
                    value={openingReason}
                    onChange={(event) => setOpeningReason(event.target.value)}
                    placeholder="e.g. Morning drawer float"
                    style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 }}
                  />
                </label>
                <button className="primary-btn" disabled={busy} style={{ marginTop: 8 }}>
                  {busy ? 'Setting Opening Cash…' : 'Set Opening Cash'}
                </button>
              </form>
            </div>
          ) : (
            <div>
              <h2>Quick Cash In / Cash Out</h2>
              <form className="cash-form" onSubmit={submitAdjustment} style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    className={`secondary-btn ${direction === 'IN' ? 'primary-btn' : ''}`}
                    onClick={() => setDirection('IN')}
                  >
                    💵 Cash In (+)
                  </button>
                  <button
                    type="button"
                    className={`secondary-btn ${direction === 'OUT' ? 'primary-btn' : ''}`}
                    onClick={() => setDirection('OUT')}
                  >
                    📤 Cash Out (-)
                  </button>
                </div>
                <label style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                  Amount (₹)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                    style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 }}
                  />
                </label>
                <label style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                  Reason / Memo
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    required
                    maxLength={250}
                    placeholder="e.g. Tea/Coffee expense, Petrol, Drawer top-up"
                    style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 }}
                  />
                </label>
                <button className="primary-btn" disabled={busy || summary?.isClosed} style={{ marginTop: 8 }}>
                  Record Cash Movement
                </button>
              </form>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function DailyClosingPage() {
  const { token } = useAuth()
  const [date, setDate] = useState(localDate)
  const [summary, setSummary] = useState<CashbookSummary | null>(null)
  const [closing, setClosing] = useState<DailyClosingRecord | null>(null)
  const [actualCash, setActualCash] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    Promise.all([
      cashbookRequest<CashbookSummary>(`/cashbook/summary?date=${date}`, token),
      cashbookRequest<DailyClosingRecord | null>(`/cashbook/closing?date=${date}`, token),
    ])
      .then(([nextSummary, nextClosing]) => {
        if (!active) return
        setSummary(nextSummary)
        setClosing(nextClosing)
        setActualCash(nextClosing?.actualCash ?? '')
        setNotes(nextClosing?.notes ?? '')
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load daily closing')
      })
    return () => {
      active = false
    }
  }, [date, token])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await cashbookRequest<DailyClosingRecord>('/cashbook/closing', token, {
        method: 'POST',
        body: JSON.stringify({ businessDate: date, actualCash, notes: notes || undefined }),
      })
      setClosing(result)
      setSummary(await cashbookRequest<CashbookSummary>(`/cashbook/summary?date=${date}`, token))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to close business day')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-shell closing-page">
      <header className="page-header cashbook-header">
        <div>
          <p className="eyebrow">PHARMORA POS / RECONCILIATION</p>
          <h1>Daily Closing</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }}
          />
          <Link className="secondary-btn" to="/cashbook">
            Cashbook
          </Link>
        </div>
      </header>

      {error && <div className="badge danger" style={{ padding: '10px 14px', borderRadius: 8 }} role="alert">{error}</div>}

      {summary && (
        <div className="content-grid">
          {/* Drawer Reconciliation Equation */}
          <section className="panel">
            <h2>Drawer Calculation</h2>
            <div className="list-stack" style={{ fontSize: '0.95rem' }}>
              <div className="row-item">
                <span>Opening Cash</span>
                <strong>{formatMoney(summary.openingCash)}</strong>
              </div>
              <div className="row-item">
                <span>+ Cash Inflows</span>
                <strong style={{ color: '#16a34a' }}>+{formatMoney(summary.cashInflows)}</strong>
              </div>
              <div className="row-item">
                <span>− Cash Outflows</span>
                <strong style={{ color: '#dc2626' }}>−{formatMoney(summary.cashOutflows)}</strong>
              </div>
              <div className="row-item" style={{ borderTop: '2px solid var(--line)', paddingTop: 12 }}>
                <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>Expected Physical Cash:</span>
                <strong style={{ fontSize: '1.25rem', color: '#0284c7' }}>{formatMoney(summary.expectedDrawerCash)}</strong>
              </div>
            </div>

            <form className="cash-form" onSubmit={submit} style={{ display: 'grid', gap: 12, marginTop: 20 }}>
              <label style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                Enter Actual Physical Cash Counted (₹):
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={actualCash}
                  onChange={(event) => setActualCash(event.target.value)}
                  required
                  disabled={Boolean(closing)}
                  placeholder="e.g. 5200.00"
                  style={{ width: '100%', padding: '12px', fontSize: '1.1rem', fontWeight: 700, border: '2px solid #0284c7', borderRadius: 8, marginTop: 4 }}
                />
              </label>

              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Closing Note (Optional):
                <textarea
                  rows={2}
                  maxLength={500}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  disabled={Boolean(closing)}
                  placeholder="Notes on discrepancy, drawer handover, etc."
                  style={{ width: '100%', padding: '8px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 }}
                />
              </label>

              {!closing && (
                <button className="primary-btn" disabled={busy} style={{ width: '100%', padding: 14, fontSize: '1.05rem' }}>
                  {busy ? 'Saving Close…' : '🔒 Close Business Day'}
                </button>
              )}
            </form>
          </section>

          {/* Result Card */}
          <section className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2>Closing Result</h2>
              <StatusBadge status={closing?.status ?? null} />
            </div>

            <div className="list-stack">
              <div className="row-item">
                <span>Expected Cash</span>
                <strong>{formatMoney(closing?.expectedCash ?? summary.expectedDrawerCash)}</strong>
              </div>
              <div className="row-item">
                <span>Actual Cash Counted</span>
                <strong>{formatMoney(closing?.actualCash ?? (actualCash || null))}</strong>
              </div>
              <div className="row-item" style={{ borderTop: '2px solid var(--line)', paddingTop: 10 }}>
                <span style={{ fontWeight: 700 }}>Difference</span>
                <strong style={{ fontSize: '1.2rem', color: closing?.status === 'CASH_SHORT' ? '#dc2626' : '#16a34a' }}>
                  {formatMoney(closing?.difference ?? (actualCash ? Number(actualCash) - Number(summary.expectedDrawerCash) : '0'))}
                </strong>
              </div>
            </div>

            <p style={{ marginTop: 20, fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.4 }}>
              {closing
                ? '✅ This day is closed and locked. The counted cash carries forward as tomorrow’s opening balance.'
                : 'ℹ️ Saving daily closing reconciles today’s cash drawer and carries this physical count forward to the next business day.'}
            </p>
          </section>
        </div>
      )}
    </div>
  )
}

function Layout() {
  const { user, logout, token } = useAuth()
  const isOnline = useOnlineStatus()
  const location = useLocation()
  const navigate = useNavigate()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)

  // Close drawer on route navigation
  useEffect(() => {
    setIsDrawerOpen(false)
  }, [location.pathname])

  const isOwner = user?.role?.name === 'OWNER'
  const visibleNavItems = navItems.filter((item) => !item.ownerOnly || isOwner)

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      {/* Safe Offline Warning Banner */}
      {!isOnline && (
        <div className="offline-banner" role="alert">
          <span className="offline-banner-icon">⚠️</span>
          <span>OFFLINE: Financial transactions (Sales, Purchases, Cashbook) require an active internet connection.</span>
        </div>
      )}

      {/* Mobile Top App Bar */}
      <header className="mobile-top-bar">
        <div className="mobile-brand">
          <div className="brand-mark" style={{ width: 28, height: 28, fontSize: '0.9rem' }}>P</div>
          <span>Pharmora POS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`mobile-status-badge ${isOnline ? 'online' : 'offline'}`}>
            {isOnline ? '● Online' : '▲ Offline'}
          </span>
          {user && (
            <button
              type="button"
              className="user-logout-btn"
              onClick={handleLogout}
              title="Sign Out"
            >
              Logout
            </button>
          )}
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Open Navigation Menu"
          >
            ☰
          </button>
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-mark">P</div>
          <div>
            <strong>PHARMORA</strong>
            <small>Production POS</small>
          </div>
        </div>

        {/* User Account Box */}
        {user && (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              padding: '12px 14px',
              borderRadius: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: '#fff' }}>{user.name}</strong>
                <small style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem' }}>{user.email}</small>
              </div>
              <span className="user-role-tag">{user.role?.name || 'STAFF'}</span>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button
                type="button"
                className="secondary-btn"
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  fontSize: '0.75rem',
                  minHeight: 28,
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  border: 'none',
                }}
                onClick={() => setShowPasswordModal(true)}
              >
                🔑 Password
              </button>
              <button
                type="button"
                className="user-logout-btn"
                style={{ padding: '4px 8px', fontSize: '0.75rem', minHeight: 28 }}
                onClick={handleLogout}
              >
                🚪 Logout
              </button>
            </div>
          </div>
        )}

        <nav className="nav" style={{ marginTop: 8 }}>
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Mobile Drawer Overlay */}
      {isDrawerOpen && (
        <div
          className="mobile-drawer-backdrop"
          onClick={() => setIsDrawerOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="mobile-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-drawer-header">
              <div className="mobile-brand">
                <div className="brand-mark" style={{ width: 28, height: 28, fontSize: '0.9rem' }}>P</div>
                <span className="mobile-drawer-title">Pharmora POS</span>
              </div>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setIsDrawerOpen(false)}
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>

            {/* Mobile User Profile Section */}
            {user && (
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  padding: '10px 12px',
                  borderRadius: 10,
                  marginBottom: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong style={{ fontSize: '0.9rem', color: '#fff' }}>{user.name}</strong>
                  <small style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem' }}>{user.email}</small>
                </div>
                <span className="user-role-tag">{user.role?.name || 'STAFF'}</span>
              </div>
            )}

            <nav className="nav" style={{ flex: 1 }}>
              {visibleNavItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setIsDrawerOpen(false)}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>

            <div style={{ borderTop: '1px solid #1e293b', paddingTop: 14, marginTop: 14, display: 'grid', gap: 8 }}>
              {user && (
                <>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ width: '100%' }}
                    onClick={() => {
                      setIsDrawerOpen(false)
                      setShowPasswordModal(true)
                    }}
                  >
                    🔑 Change Password
                  </button>
                  <button
                    type="button"
                    className="user-logout-btn"
                    style={{ width: '100%' }}
                    onClick={() => {
                      setIsDrawerOpen(false)
                      handleLogout()
                    }}
                  >
                    🚪 Sign Out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <main className="main-panel">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/pos" element={<POSPage token={token} onSignIn={() => {}} />} />
          <Route path="/daily-sales" element={<DailySalesPage token={token} onSignIn={() => {}} />} />
          <Route path="/sales" element={<SalesPage token={token} onSignIn={() => {}} />} />
          <Route path="/returns" element={<ReturnsPage token={token} onSignIn={() => {}} onSignOut={handleLogout} />} />
          <Route path="/customers" element={<CustomersPage token={token} onSignIn={() => {}} />} />
          <Route path="/cashbook" element={<CashbookPage />} />
          <Route path="/daily-closing" element={<DailyClosingPage />} />
          <Route path="/products" element={<ProductsPage token={token} onSignIn={() => {}} onSignOut={handleLogout} />} />
          <Route path="/products/:id" element={<ProductDetailPage token={token} onSignIn={() => {}} onSignOut={handleLogout} />} />
          <Route path="/expiry" element={<ExpiryManagementPage token={token} onSignIn={() => {}} onSignOut={handleLogout} />} />
          <Route path="/suppliers" element={<SuppliersPage token={token} onSignIn={() => {}} onSignOut={handleLogout} />} />
          <Route path="/purchase-orders" element={<PurchaseOrdersPage token={token} onSignIn={() => {}} onSignOut={handleLogout} />} />
          <Route path="/purchase-list" element={<PurchaseOrdersPage token={token} onSignIn={() => {}} onSignOut={handleLogout} />} />
          <Route path="/purchase" element={<PurchasesPage token={token} onSignIn={() => {}} onSignOut={handleLogout} />} />
          <Route path="/purchases" element={<PurchasesPage token={token} onSignIn={() => {}} onSignOut={handleLogout} />} />
          <Route path="/inventory" element={<InventoryScreen token={token} onSignIn={() => {}} onSignOut={handleLogout} />} />
          <Route path="/reports" element={<ReportsPage token={token} />} />
          <Route path="/sales/:id/receipt" element={<ReceiptPage token={token} />} />
          <Route path="/notifications" element={<NotificationsSettingsPage token={token} />} />
          <Route
            path="/settings/users"
            element={
              <ProtectedRoute allowedRoles={['OWNER']}>
                <UserManagementPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>

      {/* Mobile Fixed Bottom Navigation Bar (< 768px) */}
      <nav className="mobile-bottom-nav">
        <NavLink
          to="/pos"
          className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">🛒</span>
          <span>POS</span>
        </NavLink>
        <NavLink
          to="/"
          end
          className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">📊</span>
          <span>Dashboard</span>
        </NavLink>
        <NavLink
          to="/cashbook"
          className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">💰</span>
          <span>Cashbook</span>
        </NavLink>
        <NavLink
          to="/inventory"
          className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">📦</span>
          <span>Inventory</span>
        </NavLink>
        <button
          type="button"
          className="mobile-nav-item"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          onClick={() => setIsDrawerOpen(true)}
        >
          <span className="nav-icon">☰</span>
          <span>More</span>
        </button>
      </nav>

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public Login & Signup Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* All other routes protected */}
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

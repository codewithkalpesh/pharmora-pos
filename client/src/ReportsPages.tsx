import { useEffect, useState } from 'react'
import './cashbook.css'
import './inventory.css'
import './pos.css'
import { API_BASE as apiBase } from './config.js'

function formatMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value))
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function ReportsPage({ token }: { token: string }) {
  const [tab, setTab] = useState<'overview' | 'sales' | 'purchases' | 'expenses' | 'profit' | 'gst' | 'inventory' | 'dues'>('overview')
  const [preset, setPreset] = useState<string>('today')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  // Report States
  const [overviewData, setOverviewData] = useState<any>(null)
  const [salesData, setSalesData] = useState<any>(null)
  const [purchaseData, setPurchaseData] = useState<any>(null)
  const [expenseData, setExpenseData] = useState<any>(null)
  const [profitData, setProfitData] = useState<any>(null)
  const [gstData, setGstData] = useState<any>(null)
  const [inventoryData, setInventoryData] = useState<any>(null)
  const [customerDues, setCustomerDues] = useState<any>(null)
  const [supplierDues, setSupplierDues] = useState<any>(null)
  const [salesTarget, setSalesTarget] = useState<any>(null)

  const [editTargetModal, setEditTargetModal] = useState<boolean>(false)
  const [newTargetAmount, setNewTargetAmount] = useState<string>('')

  const getFilterQuery = () => {
    const params = new URLSearchParams()
    if (preset === 'custom') {
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
    } else {
      params.set('preset', preset)
    }
    return params.toString()
  }

  const fetchCurrentTabReport = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    const query = getFilterQuery()

    try {
      if (tab === 'overview') {
        const [dashRes, targetRes] = await Promise.all([
          fetch(`${apiBase}/api/reports/dashboard`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${apiBase}/api/reports/monthly-target`, { headers: { Authorization: `Bearer ${token}` } }),
        ])
        const dashJson = await dashRes.json()
        const targetJson = await targetRes.json()
        if (dashJson.success) setOverviewData(dashJson.data)
        if (targetJson.success) setSalesTarget(targetJson.data)
      } else if (tab === 'sales') {
        const res = await fetch(`${apiBase}/api/reports/sales?${query}`, { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json()
        if (json.success) setSalesData(json.data)
        else setError(json.message ?? 'Failed to load sales report')
      } else if (tab === 'purchases') {
        const res = await fetch(`${apiBase}/api/reports/purchases?${query}`, { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json()
        if (json.success) setPurchaseData(json.data)
        else setError(json.message ?? 'Failed to load purchase report')
      } else if (tab === 'expenses') {
        const res = await fetch(`${apiBase}/api/reports/expenses?${query}`, { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json()
        if (json.success) setExpenseData(json.data)
        else setError(json.message ?? 'Failed to load expense report')
      } else if (tab === 'profit') {
        const res = await fetch(`${apiBase}/api/reports/profit?${query}`, { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json()
        if (json.success) setProfitData(json.data)
        else setError(json.message ?? 'Failed to load profit report')
      } else if (tab === 'gst') {
        const res = await fetch(`${apiBase}/api/reports/gst?${query}`, { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json()
        if (json.success) setGstData(json.data)
        else setError(json.message ?? 'Failed to load GST report')
      } else if (tab === 'inventory') {
        const res = await fetch(`${apiBase}/api/reports/inventory-valuation`, { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json()
        if (json.success) setInventoryData(json.data)
        else setError(json.message ?? 'Failed to load inventory valuation')
      } else if (tab === 'dues') {
        const [custRes, suppRes] = await Promise.all([
          fetch(`${apiBase}/api/reports/customer-outstanding`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${apiBase}/api/reports/supplier-outstanding`, { headers: { Authorization: `Bearer ${token}` } }),
        ])
        const custJson = await custRes.json()
        const suppJson = await suppRes.json()
        if (custJson.success) setCustomerDues(custJson.data)
        if (suppJson.success) setSupplierDues(suppJson.data)
      }
    } catch (err: any) {
      setError(err.message ?? 'Network error fetching report data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCurrentTabReport()
  }, [tab, preset, startDate, endDate, token])

  const handleUpdateTarget = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTargetAmount || Number(newTargetAmount) <= 0) return
    try {
      const res = await fetch(`${apiBase}/api/reports/monthly-target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ monthlyTarget: newTargetAmount }),
      })
      const json = await res.json()
      if (json.success) {
        setSalesTarget(json.data)
        setEditTargetModal(false)
        fetchCurrentTabReport()
      } else {
        alert(json.message ?? 'Failed to update target')
      }
    } catch (err: any) {
      alert(err.message)
    }
  }

  // Export to CSV Helper
  const exportToCsv = (filename: string, rows: (string | number)[][]) => {
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.map((val) => `"${val}"`).join(',')).join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="cashbook-container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main, #1e293b)' }}>
            📊 Financial Reports & Analytics
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted, #64748b)', fontSize: '0.9rem' }}>
            Audited, read-only financial intelligence derived directly from transactional ledgers.
          </p>
        </div>

        {/* Global Date Range Selector */}
        {tab !== 'inventory' && tab !== 'dues' && tab !== 'overview' && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>Period:</span>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              style={{ padding: '0.35rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="previous_month">Previous Month</option>
              <option value="this_year">This Year</option>
              <option value="custom">Custom Range</option>
            </select>

            {preset === 'custom' && (
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{ padding: '0.3rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                />
                <span style={{ fontSize: '0.8rem' }}>to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{ padding: '0.3rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                />
              </div>
            )}

            <button
              onClick={fetchCurrentTabReport}
              style={{ padding: '0.35rem 0.75rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '1.5rem', overflowX: 'auto' }}>
        {[
          { id: 'overview', label: '📊 Dashboard Overview' },
          { id: 'sales', label: '💰 Sales Report' },
          { id: 'purchases', label: '📦 Purchases' },
          { id: 'expenses', label: '🧾 Expenses' },
          { id: 'profit', label: '📈 Profit & Loss (COGS)' },
          { id: 'gst', label: '🏛️ GST Summary' },
          { id: 'inventory', label: '🏷️ Inventory Valuation' },
          { id: 'dues', label: '👥 Outstanding Dues' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            style={{
              padding: '0.6rem 1rem',
              borderRadius: '6px 6px 0 0',
              border: 'none',
              borderBottom: tab === t.id ? '3px solid #2563eb' : '3px solid transparent',
              background: tab === t.id ? '#eff6ff' : 'transparent',
              color: tab === t.id ? '#1d4ed8' : '#64748b',
              fontWeight: tab === t.id ? 700 : 500,
              fontSize: '0.9rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '0.75rem 1rem', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', marginBottom: '1rem', border: '1px solid #f87171' }}>
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>Calculating financial analytics...</div>
          <div style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Aggregating transaction records with zero double-counting</div>
        </div>
      )}

      {!loading && (
        <>
          {/* ========================================================================= */}
          {/* 1. OVERVIEW / DASHBOARD TAB */}
          {/* ========================================================================= */}
          {tab === 'overview' && overviewData && (
            <div>
              {/* Today's Metrics */}
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: '#0f172a' }}>
                  ⚡ Today's Live Performance
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '1.25rem' }}>
                    <div style={{ fontSize: '0.85rem', color: '#166534', fontWeight: 600 }}>Gross Business Sales</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#15803d', marginTop: '0.35rem' }}>
                      {formatMoney(overviewData.today.totalSales)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: '0.25rem' }}>
                      POS: {formatMoney(overviewData.today.posSales)} | Non-POS: {formatMoney(overviewData.today.nonPosSales)}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.25rem' }}>
                    <div style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>Net Sales (After Returns)</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f172a', marginTop: '0.35rem' }}>
                      {formatMoney(overviewData.today.netSales)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.25rem' }}>
                      Returns: -{formatMoney(overviewData.today.salesReturns)}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.25rem' }}>
                    <div style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>Cash vs Digital Sales</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', marginTop: '0.5rem' }}>
                      💵 {formatMoney(overviewData.today.cashSales)}
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#2563eb', marginTop: '0.25rem' }}>
                      📱 {formatMoney(overviewData.today.upiSales)}
                    </div>
                  </div>

                  <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '10px', padding: '1.25rem' }}>
                    <div style={{ fontSize: '0.85rem', color: '#9f1239', fontWeight: 600 }}>Purchases & Expenses</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#be123c', marginTop: '0.5rem' }}>
                      📦 Purchases: {formatMoney(overviewData.today.purchases)}
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#9f1239', marginTop: '0.25rem' }}>
                      🧾 Expenses: {formatMoney(overviewData.today.expenses)}
                    </div>
                  </div>

                  <div style={{ background: overviewData.today.cashDifference === 0 ? '#f0fdf4' : '#fef2f2', border: `1px solid ${overviewData.today.cashDifference === 0 ? '#bbf7d0' : '#fecaca'}`, borderRadius: '10px', padding: '1.25rem' }}>
                    <div style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>Physical Cash Drawer</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginTop: '0.35rem' }}>
                      {formatMoney(overviewData.today.expectedDrawer)}
                    </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: overviewData.today.cashDifference >= 0 ? '#16a34a' : '#dc2626', marginTop: '0.25rem' }}>
                      Diff: {formatMoney(overviewData.today.cashDifference)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Monthly Target & Performance */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>🎯 Monthly Sales Target</h3>
                    <button
                      onClick={() => {
                        setNewTargetAmount(salesTarget?.target?.toString() ?? '500000')
                        setEditTargetModal(true)
                      }}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      Set Target
                    </button>
                  </div>

                  {salesTarget && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                        <span>Progress ({salesTarget.progressPercentage}%)</span>
                        <span style={{ fontWeight: 700 }}>{formatMoney(salesTarget.completedSales)} / {formatMoney(salesTarget.target)}</span>
                      </div>
                      <div style={{ width: '100%', height: '12px', background: '#e2e8f0', borderRadius: '6px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                        <div
                          style={{
                            width: `${Math.min(100, salesTarget.progressPercentage)}%`,
                            height: '100%',
                            background: salesTarget.progressPercentage >= 100 ? '#16a34a' : '#2563eb',
                            borderRadius: '6px',
                            transition: 'width 0.5s ease',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        Remaining to achieve target: <strong style={{ color: '#0f172a' }}>{formatMoney(salesTarget.remainingSales)}</strong>
                      </div>
                    </div>
                  )}
                </div>

                {/* Critical Alerts */}
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                    🚨 Actionable Alerts
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
                    <div style={{ background: '#fef2f2', padding: '0.75rem', borderRadius: '8px', border: '1px solid #fecaca' }}>
                      <div style={{ fontSize: '0.8rem', color: '#991b1b', fontWeight: 600 }}>Expired Stock</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#dc2626' }}>{overviewData.alerts.expiredBatches} batches</div>
                    </div>
                    <div style={{ background: '#fffbeb', padding: '0.75rem', borderRadius: '8px', border: '1px solid #fde68a' }}>
                      <div style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 600 }}>Near Expiry (&le;30d)</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#d97706' }}>{overviewData.alerts.nearExpiryBatches} batches</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>Customer Outstanding</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>{formatMoney(overviewData.alerts.customerDuesTotal)}</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>Supplier Payables</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>{formatMoney(overviewData.alerts.supplierDuesTotal)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 2. SALES REPORT TAB */}
          {/* ========================================================================= */}
          {tab === 'sales' && salesData && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>💰 Reconciled Sales Summary</h2>
                <button
                  onClick={() => {
                    const rows = [
                      ['Date', 'POS Cash', 'POS UPI', 'Daily Cash', 'Daily UPI', 'Reconciled Cash', 'Reconciled UPI', 'Total Sales'],
                      ...salesData.dailyBreakdown.map((d: any) => [
                        d.date,
                        d.posCash,
                        d.posUpi,
                        d.dailyCash,
                        d.dailyUpi,
                        d.reconciledCash,
                        d.reconciledUpi,
                        d.totalSales,
                      ]),
                    ]
                    exportToCsv('sales_report', rows)
                  }}
                  style={{ padding: '0.4rem 0.8rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  📥 Export CSV
                </button>
              </div>

              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Gross Sales</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{formatMoney(salesData.summary.grossSales)}</div>
                </div>
                <div style={{ background: '#fef2f2', padding: '1rem', borderRadius: '8px', border: '1px solid #fecaca' }}>
                  <div style={{ fontSize: '0.8rem', color: '#991b1b' }}>Less: Sales Returns</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#dc2626' }}>-{formatMoney(salesData.summary.salesReturns)}</div>
                </div>
                <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#166534' }}>Net Sales</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#15803d' }}>{formatMoney(salesData.summary.netSales)}</div>
                </div>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>POS Invoices / Items</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>
                    {salesData.summary.invoiceCount} / {salesData.summary.itemCount}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Avg Invoice: {formatMoney(salesData.summary.averageInvoiceValue)}</div>
                </div>
              </div>

              {/* Zero Double-Count Breakdown Table */}
              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Daily Reconciled Records (Zero Double-Count)</h3>
              <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '0.75rem 1rem' }}>Date</th>
                      <th style={{ padding: '0.75rem 1rem' }}>POS Sales</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Non-POS (Daily Aggregate)</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Reconciled Cash</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Reconciled UPI</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Total Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesData.dailyBreakdown.map((d: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{d.date}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{formatMoney(d.posCash + d.posUpi)}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{formatMoney(d.reconciledCash + d.reconciledUpi - (d.posCash + d.posUpi))}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{formatMoney(d.reconciledCash)}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{formatMoney(d.reconciledUpi)}</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#15803d' }}>
                          {formatMoney(d.totalSales)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 3. PURCHASES REPORT TAB */}
          {/* ========================================================================= */}
          {tab === 'purchases' && purchaseData && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>📦 Purchase & Supplier Inflows</h2>
                <button
                  onClick={() => {
                    const rows = [
                      ['Supplier', 'Purchases', 'Total Cost'],
                      ...purchaseData.supplierBreakdown.map((s: any) => [s.supplierName, s.purchaseCount, s.totalAmount]),
                    ]
                    exportToCsv('purchases_report', rows)
                  }}
                  style={{ padding: '0.4rem 0.8rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  📥 Export CSV
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Gross Purchases</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{formatMoney(purchaseData.summary.grossPurchases)}</div>
                </div>
                <div style={{ background: '#fef2f2', padding: '1rem', borderRadius: '8px', border: '1px solid #fecaca' }}>
                  <div style={{ fontSize: '0.8rem', color: '#991b1b' }}>Less: Purchase Returns</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#dc2626' }}>-{formatMoney(purchaseData.summary.purchaseReturns)}</div>
                </div>
                <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#166534' }}>Net Purchases</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#15803d' }}>{formatMoney(purchaseData.summary.netPurchases)}</div>
                </div>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Payment Methods</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: '0.35rem' }}>
                    Cash: {formatMoney(purchaseData.summary.cashPurchases)} | UPI: {formatMoney(purchaseData.summary.upiPurchases)} | Credit: {formatMoney(purchaseData.summary.creditPurchases)}
                  </div>
                </div>
              </div>

              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Supplier-Wise Purchases</h3>
              <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '0.75rem 1rem' }}>Supplier Name</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Purchases Count</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Total Invoiced Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseData.supplierBreakdown.map((s: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{s.supplierName}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{s.purchaseCount}</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700 }}>{formatMoney(s.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 4. EXPENSES REPORT TAB */}
          {/* ========================================================================= */}
          {tab === 'expenses' && expenseData && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>🧾 Operating Expense Breakdown</h2>
                <button
                  onClick={() => {
                    const rows = [
                      ['Category', 'Count', 'Total Amount', 'Percentage'],
                      ...expenseData.categories.map((c: any) => [c.category, c.count, c.totalAmount, `${c.percentage}%`]),
                    ]
                    exportToCsv('expense_report', rows)
                  }}
                  style={{ padding: '0.4rem 0.8rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  📥 Export CSV
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ background: '#fef2f2', padding: '1rem', borderRadius: '8px', border: '1px solid #fecaca' }}>
                  <div style={{ fontSize: '0.8rem', color: '#991b1b' }}>Total Operating Expenses</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#dc2626' }}>{formatMoney(expenseData.summary.totalExpenses)}</div>
                </div>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Cash Expenses</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{formatMoney(expenseData.summary.cashExpenses)}</div>
                </div>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>UPI / Bank Expenses</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#2563eb' }}>{formatMoney(expenseData.summary.upiExpenses)}</div>
                </div>
              </div>

              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Expenses by Category</h3>
              <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '0.75rem 1rem' }}>Category</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Vouchers</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Share %</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Total Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseData.categories.map((c: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{c.category}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{c.count}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{c.percentage}%</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700 }}>{formatMoney(c.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 5. PROFIT & COGS REPORT TAB */}
          {/* ========================================================================= */}
          {tab === 'profit' && profitData && (
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>📈 Profit & Loss Statement (Batch FEFO COGS)</h2>

              {/* Profit Statement Waterfall */}
              <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem', maxWidth: '800px', margin: '0 auto', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontWeight: 600 }}>Gross Business Sales</span>
                  <span style={{ fontWeight: 700 }}>{formatMoney(profitData.summary.grossSales)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9', color: '#dc2626' }}>
                  <span>Less: Customer Sales Returns</span>
                  <span style={{ fontWeight: 700 }}>-{formatMoney(profitData.summary.salesReturns)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '2px solid #e2e8f0', background: '#f8fafc', paddingLeft: '0.5rem', paddingRight: '0.5rem' }}>
                  <span style={{ fontWeight: 700, color: '#0f172a' }}>= Net Sales</span>
                  <span style={{ fontWeight: 800, color: '#0f172a' }}>{formatMoney(profitData.summary.netSales)}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9', color: '#b45309' }}>
                  <span>Less: Cost of Goods Sold (Sold Batches)</span>
                  <span>-{formatMoney(profitData.summary.cogs.soldBatchCogs)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9', color: '#15803d' }}>
                  <span>Add: Sales Return COGS Reversal</span>
                  <span>+{formatMoney(profitData.summary.cogs.salesReturnCogsReversal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '2px solid #e2e8f0', background: '#fffbeb', paddingLeft: '0.5rem', paddingRight: '0.5rem' }}>
                  <span style={{ fontWeight: 700, color: '#92400e' }}>= Net COGS</span>
                  <span style={{ fontWeight: 800, color: '#92400e' }}>{formatMoney(profitData.summary.cogs.totalCogs)}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 0', borderBottom: '2px solid #e2e8f0', background: '#f0fdf4', paddingLeft: '0.5rem', paddingRight: '0.5rem' }}>
                  <div>
                    <span style={{ fontWeight: 800, color: '#166534', fontSize: '1.1rem' }}>🏆 Gross Profit</span>
                    <span style={{ fontSize: '0.85rem', color: '#166534', marginLeft: '0.5rem' }}>({profitData.summary.grossMarginPercentage}%)</span>
                  </div>
                  <span style={{ fontWeight: 800, color: '#15803d', fontSize: '1.2rem' }}>{formatMoney(profitData.summary.grossProfit)}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9', color: '#dc2626' }}>
                  <span>Less: Operating Expenses (Rent, Electricity, Salary, etc.)</span>
                  <span style={{ fontWeight: 700 }}>-{formatMoney(profitData.summary.operatingExpenses)}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1.25rem 0', background: '#eff6ff', borderRadius: '8px', marginTop: '1rem', paddingLeft: '1rem', paddingRight: '1rem', border: '1px solid #bfdbfe' }}>
                  <div>
                    <span style={{ fontWeight: 800, color: '#1e40af', fontSize: '1.25rem' }}>⭐ Net Profit</span>
                    <span style={{ fontSize: '0.9rem', color: '#1e40af', marginLeft: '0.5rem', fontWeight: 600 }}>({profitData.summary.netMarginPercentage}%)</span>
                  </div>
                  <span style={{ fontWeight: 800, color: '#1d4ed8', fontSize: '1.4rem' }}>{formatMoney(profitData.summary.netProfit)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 6. GST REPORT TAB */}
          {/* ========================================================================= */}
          {tab === 'gst' && gstData && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>🏛️ GST Summary / Management Report</h2>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Calculated from actual sale and purchase line items and returns</span>
                </div>
                <button
                  onClick={() => {
                    const rows = [
                      ['Type', 'Rate', 'Taxable Base', 'CGST', 'SGST', 'Total GST'],
                      ...gstData.salesRatesBreakdown.map((r: any) => ['Sales Output', r.rate, r.taxable, r.cgst, r.sgst, r.totalGst]),
                      ...gstData.purchaseRatesBreakdown.map((r: any) => ['Purchase Input', r.rate, r.taxable, r.cgst, r.sgst, r.totalGst]),
                    ]
                    exportToCsv('gst_report', rows)
                  }}
                  style={{ padding: '0.4rem 0.8rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  📥 Export CSV
                </button>
              </div>

              {/* GST Net Balance */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ background: '#eff6ff', padding: '1.25rem', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                  <div style={{ fontSize: '0.85rem', color: '#1e40af', fontWeight: 600 }}>Net Output GST (Sales)</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1d4ed8', marginTop: '0.25rem' }}>
                    {formatMoney(gstData.summary.outputGst.netOutputGst)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                    CGST: {formatMoney(gstData.summary.outputGst.cgst)} | SGST: {formatMoney(gstData.summary.outputGst.sgst)}
                  </div>
                </div>

                <div style={{ background: '#f0fdf4', padding: '1.25rem', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: '0.85rem', color: '#166534', fontWeight: 600 }}>Net Input Tax Credit (Purchases)</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#15803d', marginTop: '0.25rem' }}>
                    {formatMoney(gstData.summary.inputGst.netInputGst)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                    CGST: {formatMoney(gstData.summary.inputGst.cgst)} | SGST: {formatMoney(gstData.summary.inputGst.sgst)}
                  </div>
                </div>

                <div style={{ background: gstData.summary.netGstPayable > 0 ? '#fef2f2' : '#f0fdf4', padding: '1.25rem', borderRadius: '8px', border: `1px solid ${gstData.summary.netGstPayable > 0 ? '#fecaca' : '#bbf7d0'}` }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: gstData.summary.netGstPayable > 0 ? '#991b1b' : '#166534' }}>
                    {gstData.summary.netGstPayable > 0 ? 'Net GST Payable' : 'ITC Balance Carried Forward'}
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: gstData.summary.netGstPayable > 0 ? '#dc2626' : '#15803d', marginTop: '0.25rem' }}>
                    {formatMoney(gstData.summary.netGstPayable > 0 ? gstData.summary.netGstPayable : gstData.summary.inputTaxCreditBalance)}
                  </div>
                </div>
              </div>

              {/* Rates Breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
                <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Sales (Output GST) by Rate</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <tr>
                        <th style={{ padding: '0.5rem' }}>Rate</th>
                        <th style={{ padding: '0.5rem' }}>Taxable Base</th>
                        <th style={{ padding: '0.5rem', textAlign: 'right' }}>Total GST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gstData.salesRatesBreakdown.map((r: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.5rem', fontWeight: 600 }}>{r.rate}</td>
                          <td style={{ padding: '0.5rem' }}>{formatMoney(r.taxable)}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 700 }}>{formatMoney(r.totalGst)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Purchases (Input GST) by Rate</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <tr>
                        <th style={{ padding: '0.5rem' }}>Rate</th>
                        <th style={{ padding: '0.5rem' }}>Taxable Base</th>
                        <th style={{ padding: '0.5rem', textAlign: 'right' }}>Total GST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gstData.purchaseRatesBreakdown.map((r: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.5rem', fontWeight: 600 }}>{r.rate}</td>
                          <td style={{ padding: '0.5rem' }}>{formatMoney(r.taxable)}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 700 }}>{formatMoney(r.totalGst)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 7. INVENTORY VALUATION TAB */}
          {/* ========================================================================= */}
          {tab === 'inventory' && inventoryData && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>🏷️ Batch Inventory Valuation & Margin Potential</h2>
                <button
                  onClick={() => {
                    const rows = [
                      ['Product', 'Batch', 'Qty', 'Purchase Rate', 'MRP', 'Cost Valuation', 'MRP Valuation', 'Expiry'],
                      ...inventoryData.topValuedBatches.map((b: any) => [
                        b.productName,
                        b.batchNumber,
                        b.quantity,
                        b.purchaseRate,
                        b.mrp ?? '—',
                        b.totalCostValue,
                        b.totalMrpValue ?? '—',
                        b.expiryDate ? formatDate(b.expiryDate) : '—',
                      ]),
                    ]
                    exportToCsv('inventory_valuation', rows)
                  }}
                  style={{ padding: '0.4rem 0.8rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  📥 Export CSV
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Inventory Cost Valuation</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{formatMoney(inventoryData.summary.costValuation)}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Across {inventoryData.summary.totalUnits} units</div>
                </div>

                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Inventory MRP Value</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{formatMoney(inventoryData.summary.mrpValuation)}</div>
                </div>

                <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: '0.8rem', color: '#166534' }}>Potential Gross Margin</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#15803d' }}>{formatMoney(inventoryData.summary.potentialGrossMargin)}</div>
                  <div style={{ fontSize: '0.75rem', color: '#166534' }}>({inventoryData.summary.potentialMarginPercent}%)</div>
                </div>

                <div style={{ background: '#fef2f2', padding: '1rem', borderRadius: '8px', border: '1px solid #fecaca' }}>
                  <div style={{ fontSize: '0.8rem', color: '#991b1b' }}>Expired / Near Expiry Cost</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#dc2626' }}>
                    Expired: {formatMoney(inventoryData.summary.expiredStockValuation)}
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#d97706' }}>
                    Near Expiry: {formatMoney(inventoryData.summary.nearExpiryStockValuation)}
                  </div>
                </div>
              </div>

              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Top Valued Stock Batches</h3>
              <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '0.75rem 1rem' }}>Product</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Batch</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Qty</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Purchase Rate</th>
                      <th style={{ padding: '0.75rem 1rem' }}>MRP</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Cost Value</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Expiry Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventoryData.topValuedBatches.map((b: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{b.productName}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{b.batchNumber}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{b.quantity}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{formatMoney(b.purchaseRate)}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{formatMoney(b.mrp)}</td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#0f172a' }}>{formatMoney(b.totalCostValue)}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{b.expiryDate ? formatDate(b.expiryDate) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 8. DUES & OUTSTANDING TAB */}
          {/* ========================================================================= */}
          {tab === 'dues' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '1.5rem' }}>
              {/* Customer Outstanding */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>👥 Customer Outstanding</h3>
                  <span style={{ fontWeight: 800, color: '#dc2626', fontSize: '1.1rem' }}>
                    {formatMoney(customerDues?.summary?.totalOutstanding)}
                  </span>
                </div>

                <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <tr>
                        <th style={{ padding: '0.5rem 0.75rem' }}>Customer</th>
                        <th style={{ padding: '0.5rem 0.75rem' }}>Phone</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Due Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerDues?.customers?.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ padding: '1rem', textAlign: 'center', color: '#64748b' }}>No customers with pending dues</td>
                        </tr>
                      ) : (
                        customerDues?.customers?.map((c: any) => (
                          <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{c.name}</td>
                            <td style={{ padding: '0.5rem 0.75rem', color: '#64748b' }}>{c.phone || '—'}</td>
                            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                              {formatMoney(c.outstanding)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Supplier Payables */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>🏢 Supplier Payables</h3>
                  <span style={{ fontWeight: 800, color: '#b45309', fontSize: '1.1rem' }}>
                    {formatMoney(supplierDues?.summary?.totalPayable)}
                  </span>
                </div>

                <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <tr>
                        <th style={{ padding: '0.5rem 0.75rem' }}>Supplier</th>
                        <th style={{ padding: '0.5rem 0.75rem' }}>Phone</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Payable Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierDues?.suppliers?.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ padding: '1rem', textAlign: 'center', color: '#64748b' }}>No suppliers with pending payables</td>
                        </tr>
                      ) : (
                        supplierDues?.suppliers?.map((s: any) => (
                          <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{s.name}</td>
                            <td style={{ padding: '0.5rem 0.75rem', color: '#64748b' }}>{s.phone || '—'}</td>
                            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#b45309' }}>
                              {formatMoney(s.outstanding)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Target Edit Modal */}
      {editTargetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', width: '100%', maxWidth: '400px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.15rem', fontWeight: 700 }}>Set Monthly Sales Target</h3>
            <form onSubmit={handleUpdateTarget}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                  Target Amount (₹)
                </label>
                <input
                  type="number"
                  step="1000"
                  required
                  value={newTargetAmount}
                  onChange={(e) => setNewTargetAmount(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '1rem' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setEditTargetModal(false)}
                  style={{ padding: '0.4rem 0.8rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '0.4rem 0.8rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                >
                  Save Target
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

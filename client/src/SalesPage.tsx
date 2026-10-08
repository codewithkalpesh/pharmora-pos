import { useState, useEffect } from 'react'
import './pos.css'
import { ReceiptModal } from './ReceiptModal.js'
import { API_BASE as apiBase } from './config.js'

type SaleRecord = {
  id: string
  saleNumber?: string | null
  saleDate: string
  paymentMethod: string
  totalAmount: number | string
  paidAmount: number | string
  status: string
  customer?: { id: string; name: string; phone?: string | null } | null
  items: Array<{
    id: string
    quantity: number
    sellingPrice: number | string
    discount?: number | string | null
    gst?: number | string | null
    product: { id: string; name: string; brand?: string | null }
    batch?: { batchNumber: string; expiryDate?: string | null } | null
  }>
  payments: Array<{
    id: string
    amount: number | string
    paymentMethod: string
    paidAt: string
  }>
}

function formatINR(amount: number | string | null | undefined) {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return '₹0.00'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(amount))
}

export function SalesPage({ token, onSignIn }: { token: string; onSignIn: (t: string) => void }) {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [search, setSearch] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [selectedSale, setSelectedSale] = useState<SaleRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    loadSales()
  }, [token])

  async function loadSales() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiBase}/api/sales`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setSales(data.data || [])
      } else {
        setError(data.message || 'Failed to load sales')
      }
    } catch {
      setError('Network error fetching sales')
    } finally {
      setLoading(false)
    }
  }

  const filteredSales = sales.filter((sale) => {
    const term = search.toLowerCase()
    const matchesSearch =
      !term ||
      (sale.saleNumber && sale.saleNumber.toLowerCase().includes(term)) ||
      (sale.customer && sale.customer.name.toLowerCase().includes(term)) ||
      (sale.customer && sale.customer.phone && sale.customer.phone.includes(term)) ||
      sale.id.toLowerCase().includes(term)

    const matchesMethod = !filterMethod || sale.paymentMethod === filterMethod
    return matchesSearch && matchesMethod
  })

  const totalSalesVolume = filteredSales.reduce((sum, s) => sum + Number(s.totalAmount || 0), 0)
  const totalPaidVolume = filteredSales.reduce((sum, s) => sum + Number(s.paidAmount || 0), 0)
  const totalCreditOutstanding = totalSalesVolume - totalPaidVolume

  if (!token) {
    return (
      <div className="page-shell">
        <div className="panel" style={{ maxWidth: 400, margin: '60px auto', textAlign: 'center' }}>
          <h2>Sign in Required</h2>
          <p style={{ color: 'var(--muted)', margin: '10px 0 20px' }}>Please sign in to view sales history.</p>
          <button className="primary-btn" onClick={() => onSignIn('')}>Go to Sign In</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">INVOICE REGISTRY</p>
          <h1>Sales & Invoices</h1>
        </div>
        <button className="secondary-btn" onClick={loadSales}>
          ↻ Refresh
        </button>
      </div>

      {error && <div className="cash-error" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="cashbook-metrics" style={{ marginBottom: 16 }}>
        <div className="metric-card">
          <span>Invoices</span>
          <strong>{filteredSales.length}</strong>
        </div>
        <div className="metric-card positive">
          <span>Total Sales</span>
          <strong>{formatINR(totalSalesVolume)}</strong>
        </div>
        <div className="metric-card positive">
          <span>Total Collected</span>
          <strong>{formatINR(totalPaidVolume)}</strong>
        </div>
        <div className="metric-card" style={{ color: totalCreditOutstanding > 0 ? '#b91c1c' : 'inherit' }}>
          <span>Customer Receivables</span>
          <strong>{formatINR(totalCreditOutstanding)}</strong>
        </div>
      </div>

      <section className="panel">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 10, marginBottom: 14, alignItems: 'center' }}>
          <input
            type="text"
            className="pos-search-input"
            placeholder="Search invoice number, customer name, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={filterMethod}
            onChange={(e) => setFilterMethod(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8 }}
          >
            <option value="">All Payment Methods</option>
            <option value="CASH">CASH</option>
            <option value="UPI">UPI</option>
            <option value="BOTH">BOTH (Split)</option>
            <option value="CREDIT">CREDIT</option>
          </select>
          <div style={{ display: 'flex', alignItems: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Showing {filteredSales.length} of {sales.length}
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date & Time</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Method</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Paid</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((sale) => {
                const balance = Number(sale.totalAmount) - Number(sale.paidAmount)
                return (
                  <tr key={sale.id}>
                    <td>
                      <strong>{sale.saleNumber || sale.id.slice(0, 8)}</strong>
                    </td>
                    <td>{new Date(sale.saleDate).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>
                      {sale.customer ? (
                        <div>
                          <strong>{sale.customer.name}</strong>
                          {sale.customer.phone && <small style={{ display: 'block', color: 'var(--muted)' }}>{sale.customer.phone}</small>}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>Walk-in</span>
                      )}
                    </td>
                    <td>{sale.items?.length || 0} items</td>
                    <td>
                      <span className="badge neutral">{sale.paymentMethod}</span>
                    </td>
                    <td>
                      {balance <= 0 ? (
                        <span className="badge success">Paid</span>
                      ) : Number(sale.paidAmount) > 0 ? (
                        <span className="badge warning">Partial</span>
                      ) : (
                        <span className="badge danger">Credit</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatINR(sale.totalAmount)}</td>
                    <td style={{ textAlign: 'right', color: '#10b981' }}>{formatINR(sale.paidAmount)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="secondary-btn"
                        style={{ padding: '3px 8px', fontSize: '0.78rem' }}
                        onClick={() => setSelectedSale(sale)}
                      >
                        🧾 Receipt / Print
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filteredSales.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                    {loading ? 'Loading sales records…' : 'No sales records found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sale Detail & Invoice Receipt Modal */}
      {selectedSale && (
        <ReceiptModal
          saleId={selectedSale.id}
          token={token}
          onClose={() => setSelectedSale(null)}
        />
      )}
    </div>
  )
}

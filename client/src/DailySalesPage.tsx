import { useState, useEffect, type FormEvent } from 'react'
import './pos.css'
import { API_BASE as apiBase } from './config.js'

type ReconciliationData = {
  businessDate: string
  posCashSales: number
  posUpiSales: number
  posCreditSales: number
  posTotalSales: number
  recordedDailyCash: number
  recordedDailyUpi: number
  recordedDailyOther: number
  recordedDailyTotal: number
  nonPosCashSales: number
  nonPosUpiSales: number
  nonPosOtherSales: number
  nonPosTotalSales: number
  totalSales: number
  reconciliationStatus: 'NOT_ENTERED' | 'BALANCED' | 'PENDING' | 'INVALID'
  isClosed: boolean
  dailySaleId?: string
}

function formatINR(amount: number | string | null | undefined) {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return '₹0.00'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(amount))
}

function localDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function DailySalesPage({ token }: { token: string; onSignIn?: (t: string) => void }) {
  const [selectedDate, setSelectedDate] = useState(localDate)
  const [reconciliation, setReconciliation] = useState<ReconciliationData | null>(null)
  const [cashSalesInput, setCashSalesInput] = useState('')
  const [upiSalesInput, setUpiSalesInput] = useState('')
  const [otherSalesInput, setOtherSalesInput] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!token) return
    loadData(selectedDate)
  }, [token, selectedDate])

  async function loadData(date: string) {
    setError('')
    try {
      const res = await fetch(`${apiBase}/api/daily-sales/reconciliation?date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success && data.data) {
        setReconciliation(data.data)
        if (data.data.dailySaleId) {
          setCashSalesInput(String(data.data.recordedDailyCash || ''))
          setUpiSalesInput(String(data.data.recordedDailyUpi || ''))
          setOtherSalesInput(data.data.recordedDailyOther ? String(data.data.recordedDailyOther) : '')
        } else {
          // Pre-populate with POS sales as default starting point
          setCashSalesInput(data.data.posCashSales ? String(data.data.posCashSales) : '')
          setUpiSalesInput(data.data.posUpiSales ? String(data.data.posUpiSales) : '')
          setOtherSalesInput('')
        }
      } else {
        setError(data.message || 'Failed to load reconciliation data')
      }
    } catch (err: any) {
      setError(err.message || 'Error loading daily sales')
    }
  }

  // Real-time calculation of non-POS breakdown
  const posCash = reconciliation?.posCashSales ?? 0
  const posUpi = reconciliation?.posUpiSales ?? 0
  const posCredit = reconciliation?.posCreditSales ?? 0
  const posTotal = reconciliation?.posTotalSales ?? 0

  const enteredCash = parseFloat(cashSalesInput) || 0
  const enteredUpi = parseFloat(upiSalesInput) || 0
  const enteredOther = parseFloat(otherSalesInput) || 0

  const nonPosCash = Math.max(0, enteredCash - posCash)
  const nonPosUpi = Math.max(0, enteredUpi - posUpi)
  const nonPosTotal = nonPosCash + nonPosUpi + enteredOther
  const totalRecordedSales = posTotal + nonPosTotal

  const hasCashDeficit = enteredCash > 0 && enteredCash < posCash
  const hasUpiDeficit = enteredUpi > 0 && enteredUpi < posUpi

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    setError('')
    setSuccess('')

    if (hasCashDeficit) {
      setError(`Daily cash sales (₹${enteredCash}) cannot be less than POS cash sales (₹${posCash})`)
      return
    }
    if (hasUpiDeficit) {
      setError(`Daily UPI sales (₹${enteredUpi}) cannot be less than POS UPI sales (₹${posUpi})`)
      return
    }

    setSaving(true)
    try {
      const idempotencyKey = `daily-sales-${selectedDate}-${Date.now()}`
      const isUpdate = !!reconciliation?.dailySaleId

      const url = isUpdate
        ? `${apiBase}/api/daily-sales/${reconciliation.dailySaleId}`
        : `${apiBase}/api/daily-sales`
      const method = isUpdate ? 'PATCH' : 'POST'

      const body = {
        businessDate: selectedDate,
        cashSales: enteredCash,
        upiSales: enteredUpi,
        otherSales: enteredOther,
        notes: notes.trim() || undefined,
      }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
      })

      const result = await res.json()
      if (!res.ok || !result.success) {
        throw new Error(result.message || 'Failed to save daily sales')
      }

      setSuccess(`Daily sales successfully ${isUpdate ? 'updated' : 'recorded'} for ${selectedDate}`)
      await loadData(selectedDate)
    } catch (err: any) {
      setError(err.message || 'Error saving daily sales')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pos-shell">
      <header className="pos-header">
        <div className="pos-title">
          <p className="pos-eyebrow">PHARMORA SALES</p>
          <h1>Daily Sales & POS Reconciliation</h1>
        </div>
        <div className="pos-actions" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.9rem', color: '#94a3b8', fontWeight: 600 }}>
            Business Date:
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{
                marginLeft: '0.5rem',
                background: '#1e293b',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '0.4rem 0.6rem',
              }}
            />
          </label>
        </div>
      </header>

      {error && (
        <div className="pos-alert error" style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.75rem 1rem', borderRadius: '8px', margin: '1rem 0' }}>
          {error}
        </div>
      )}

      {success && (
        <div className="pos-alert success" style={{ background: '#14532d', color: '#86efac', padding: '0.75rem 1rem', borderRadius: '8px', margin: '1rem 0' }}>
          {success}
        </div>
      )}

      {reconciliation?.isClosed && (
        <div className="pos-alert warning" style={{ background: '#78350f', color: '#fde68a', padding: '0.75rem 1rem', borderRadius: '8px', margin: '1rem 0' }}>
          🔒 This business date ({selectedDate}) is closed. Daily sales are locked to protect audit and financial integrity.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', margin: '1rem 0' }}>
        <div className="panel" style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Individual POS Sales</span>
            <span className="badge info" style={{ background: '#1e3a8a', color: '#93c5fd', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem' }}>Billed</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#38bdf8' }}>{formatINR(posTotal)}</div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.85rem', color: '#94a3b8' }}>
            <div>Cash: <strong style={{ color: '#fff' }}>{formatINR(posCash)}</strong></div>
            <div>UPI: <strong style={{ color: '#fff' }}>{formatINR(posUpi)}</strong></div>
            <div>Credit: <strong style={{ color: '#fff' }}>{formatINR(posCredit)}</strong></div>
          </div>
        </div>

        <div className="panel" style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Non-POS Daily Sales</span>
            <span className="badge warning" style={{ background: '#78350f', color: '#fde68a', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem' }}>Derived</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f59e0b' }}>{formatINR(nonPosTotal)}</div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.85rem', color: '#94a3b8' }}>
            <div>Cash: <strong style={{ color: '#fff' }}>{formatINR(nonPosCash)}</strong></div>
            <div>UPI: <strong style={{ color: '#fff' }}>{formatINR(nonPosUpi)}</strong></div>
            {enteredOther > 0 && <div>Other: <strong style={{ color: '#fff' }}>{formatINR(enteredOther)}</strong></div>}
          </div>
        </div>

        <div className="panel" style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Recorded Sales</span>
            <span
              className="badge"
              style={{
                background: reconciliation?.reconciliationStatus === 'BALANCED' ? '#14532d' : '#334155',
                color: reconciliation?.reconciliationStatus === 'BALANCED' ? '#86efac' : '#cbd5e1',
                padding: '0.2rem 0.6rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
              }}
            >
              {reconciliation?.reconciliationStatus || 'PENDING'}
            </span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#10b981' }}>{formatINR(totalRecordedSales)}</div>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.75rem' }}>
            POS ({formatINR(posTotal)}) + Non-POS ({formatINR(nonPosTotal)})
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '1.5rem', marginTop: '1rem' }}>
        {/* Entry Form */}
        <section className="panel" style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', color: '#fff' }}>
            {reconciliation?.dailySaleId ? 'Edit Aggregate Daily Sales' : 'Record Aggregate Daily Sales'}
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            Enter the store's aggregate total sales for the entire day. The system automatically computes the non-POS portion to ensure Cashbook accuracy without double-counting.
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '0.35rem' }}>
                Total Cash Sales for Day (₹)*
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                disabled={reconciliation?.isClosed || saving}
                value={cashSalesInput}
                onChange={(e) => setCashSalesInput(e.target.value)}
                placeholder="0.00"
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  background: '#1e293b',
                  color: '#fff',
                  border: hasCashDeficit ? '1px solid #ef4444' : '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '1rem',
                }}
              />
              {hasCashDeficit && (
                <span style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '0.2rem', display: 'block' }}>
                  Cannot be less than POS cash sales ({formatINR(posCash)})
                </span>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '0.35rem' }}>
                Total UPI Sales for Day (₹)*
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                disabled={reconciliation?.isClosed || saving}
                value={upiSalesInput}
                onChange={(e) => setUpiSalesInput(e.target.value)}
                placeholder="0.00"
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  background: '#1e293b',
                  color: '#fff',
                  border: hasUpiDeficit ? '1px solid #ef4444' : '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '1rem',
                }}
              />
              {hasUpiDeficit && (
                <span style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '0.2rem', display: 'block' }}>
                  Cannot be less than POS UPI sales ({formatINR(posUpi)})
                </span>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '0.35rem' }}>
                Other Aggregate Sales (Optional, ₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                disabled={reconciliation?.isClosed || saving}
                value={otherSalesInput}
                onChange={(e) => setOtherSalesInput(e.target.value)}
                placeholder="0.00"
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  background: '#1e293b',
                  color: '#fff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '1rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '0.35rem' }}>
                Notes / Reconciliation Remarks
              </label>
              <textarea
                disabled={reconciliation?.isClosed || saving}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g., General counter sales without individual receipts"
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  background: '#1e293b',
                  color: '#fff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={reconciliation?.isClosed || saving || hasCashDeficit || hasUpiDeficit}
              className="primary-btn"
              style={{
                marginTop: '0.5rem',
                padding: '0.75rem',
                fontSize: '1rem',
                fontWeight: 600,
                background: reconciliation?.isClosed ? '#475569' : '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: reconciliation?.isClosed ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : reconciliation?.dailySaleId ? 'Update Daily Sales' : 'Save Daily Sales'}
            </button>
          </form>
        </section>

        {/* Live Reconciliation Breakdown Card */}
        <section className="panel" style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: '#fff' }}>Reconciliation Summary</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #334155', paddingBottom: '0.5rem' }}>
              <span style={{ color: '#94a3b8' }}>Total Aggregate Cash Sales</span>
              <strong style={{ color: '#fff' }}>{formatINR(enteredCash)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '1rem', color: '#94a3b8' }}>
              <span>Less: POS Cash Billed</span>
              <span>- {formatINR(posCash)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '1rem', color: '#38bdf8', fontWeight: 600 }}>
              <span>Net Non-POS Cash (Cashbook Inflow)</span>
              <span>+ {formatINR(nonPosCash)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #334155', paddingBottom: '0.5rem', paddingTop: '0.5rem' }}>
              <span style={{ color: '#94a3b8' }}>Total Aggregate UPI Sales</span>
              <strong style={{ color: '#fff' }}>{formatINR(enteredUpi)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '1rem', color: '#94a3b8' }}>
              <span>Less: POS UPI Billed</span>
              <span>- {formatINR(posUpi)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '1rem', color: '#a855f7', fontWeight: 600 }}>
              <span>Net Non-POS UPI (Bank Inflow)</span>
              <span>+ {formatINR(nonPosUpi)}</span>
            </div>

            {posCredit > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #334155', paddingBottom: '0.5rem', paddingTop: '0.5rem' }}>
                <span style={{ color: '#94a3b8' }}>POS Customer Credit (Unpaid)</span>
                <strong style={{ color: '#f87171' }}>{formatINR(posCredit)}</strong>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #334155', paddingTop: '0.75rem', marginTop: '0.5rem', fontSize: '1rem', fontWeight: 700 }}>
              <span style={{ color: '#fff' }}>Total Effective Store Sales</span>
              <span style={{ color: '#10b981' }}>{formatINR(totalRecordedSales)}</span>
            </div>
          </div>

          <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#1e293b', borderRadius: '6px', borderLeft: '4px solid #3b82f6' }}>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
              ℹ️ <strong>Financial Safety Guarantee:</strong> POS receipts already created Cashbook movements. Saving Daily Sales only posts the net Non-POS portion (+{formatINR(nonPosCash)} cash, +{formatINR(nonPosUpi)} UPI). Physical drawer count will increase by exactly {formatINR(enteredCash)}.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

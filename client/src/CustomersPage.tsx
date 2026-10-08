import { useState, useEffect, type FormEvent } from 'react'
import './pos.css'
import { createUUID } from './utils/uuid'
import { API_BASE as apiBase } from './config.js'

type Customer = {
  id: string
  name: string
  phone?: string | null
  address?: string | null
  notes?: string | null
  outstanding?: number
}

type CustomerDetail = Customer & {
  sales: Array<{
    id: string
    saleNumber?: string | null
    saleDate: string
    totalAmount: number | string
    paidAmount: number | string
    paymentMethod: string
    items: Array<{ id: string; quantity: number; sellingPrice: number | string }>
  }>
  customerCredits: Array<{
    id: string
    description: string
    amount: number | string
    paidAmount: number | string
    balanceAmount: number | string
    status: string
    createdAt: string
  }>
  payments: Array<{
    id: string
    amount: number | string
    paymentMethod: string
    paymentDate: string
    notes?: string | null
  }>
}

function formatINR(amount: number | string | null | undefined) {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return '₹0.00'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(amount))
}

export function CustomersPage({ token, onSignIn }: { token: string; onSignIn: (t: string) => void }) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Customer Form Modal
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')

  // Payment Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'BOTH'>('CASH')
  const [cashSplit, setCashSplit] = useState('')
  const [upiSplit, setUpiSplit] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')

  useEffect(() => {
    if (!token) return
    loadCustomers()
  }, [token])

  useEffect(() => {
    if (selectedCustomerId) {
      loadCustomerDetail(selectedCustomerId)
    } else {
      setCustomerDetail(null)
    }
  }, [selectedCustomerId])

  async function loadCustomers() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiBase}/api/customers`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setCustomers(data.data || [])
      } else {
        setError(data.message || 'Failed to load customers')
      }
    } catch {
      setError('Network error fetching customers')
    } finally {
      setLoading(false)
    }
  }

  async function loadCustomerDetail(id: string) {
    try {
      const res = await fetch(`${apiBase}/api/customers/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setCustomerDetail(data.data)
      }
    } catch {
      // ignore
    }
  }

  function openCreateCustomer() {
    setEditingCustomer(null)
    setName('')
    setPhone('')
    setAddress('')
    setNotes('')
    setShowCustomerModal(true)
  }

  function openEditCustomer(c: Customer) {
    setEditingCustomer(c)
    setName(c.name)
    setPhone(c.phone || '')
    setAddress(c.address || '')
    setNotes(c.notes || '')
    setShowCustomerModal(true)
  }

  async function handleCustomerSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')

    try {
      const url = editingCustomer
        ? `${apiBase}/api/customers/${editingCustomer.id}`
        : `${apiBase}/api/customers`
      const method = editingCustomer ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (data.success) {
        setShowCustomerModal(false)
        await loadCustomers()
        if (selectedCustomerId) {
          await loadCustomerDetail(selectedCustomerId)
        }
      } else {
        setError(data.message || 'Failed to save customer')
      }
    } catch {
      setError('Network error saving customer')
    } finally {
      setBusy(false)
    }
  }

  function openPaymentModal() {
    if (!customerDetail) return
    const outstanding = Number(customerDetail.outstanding || 0)
    setPaymentAmount(String(outstanding))
    setPaymentMethod('CASH')
    setCashSplit('')
    setUpiSplit('')
    setPaymentNotes('')
    setShowPaymentModal(true)
  }

  async function handlePaymentSubmit(e: FormEvent) {
    e.preventDefault()
    if (!customerDetail || !paymentAmount) return
    setBusy(true)
    setError('')

    try {
      const payload: any = {
        amount: Number(paymentAmount),
        paymentMethod,
        notes: paymentNotes || undefined,
      }

      if (paymentMethod === 'BOTH') {
        payload.cashAmount = Number(cashSplit)
        payload.upiAmount = Number(upiSplit)
      }

      const res = await fetch(`${apiBase}/api/payments/customers/${customerDetail.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': createUUID(),
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (data.success) {
        setShowPaymentModal(false)
        await loadCustomers()
        await loadCustomerDetail(customerDetail.id)
      } else {
        setError(data.message || 'Payment settlement failed')
      }
    } catch {
      setError('Network error recording payment')
    } finally {
      setBusy(false)
    }
  }

  const filteredCustomers = customers.filter((c) => {
    const term = search.toLowerCase()
    return !term || c.name.toLowerCase().includes(term) || (c.phone && c.phone.includes(term))
  })

  const totalReceivables = customers.reduce((sum, c) => sum + Number(c.outstanding || 0), 0)

  if (!token) {
    return (
      <div className="page-shell">
        <div className="panel" style={{ maxWidth: 400, margin: '60px auto', textAlign: 'center' }}>
          <h2>Sign in Required</h2>
          <p style={{ color: 'var(--muted)', margin: '10px 0 20px' }}>Please sign in to manage customers.</p>
          <button className="primary-btn" onClick={() => onSignIn('')}>Go to Sign In</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">CUSTOMER & CREDIT REGISTRY</p>
          <h1>Customer Management</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="secondary-btn" onClick={loadCustomers}>
            ↻ Refresh
          </button>
          <button className="primary-btn" onClick={openCreateCustomer}>
            + Add Customer
          </button>
        </div>
      </div>

      {error && <div className="cash-error" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="cashbook-metrics" style={{ marginBottom: 16 }}>
        <div className="metric-card">
          <span>Registered Customers</span>
          <strong>{customers.length}</strong>
        </div>
        <div className="metric-card" style={{ color: totalReceivables > 0 ? '#b91c1c' : 'inherit' }}>
          <span>Total Customer Receivables</span>
          <strong>{formatINR(totalReceivables)}</strong>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedCustomerId ? '1.2fr 1.8fr' : '1fr', gap: 16 }}>
        {/* Customer List */}
        <section className="panel">
          <div style={{ marginBottom: 12 }}>
            <input
              type="text"
              className="pos-search-input"
              placeholder="Search customer by name or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th style={{ textAlign: 'right' }}>Credit Due</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((c) => {
                  const due = Number(c.outstanding || 0)
                  const isSelected = c.id === selectedCustomerId
                  return (
                    <tr
                      key={c.id}
                      style={{ background: isSelected ? 'rgba(28, 124, 109, 0.08)' : 'transparent', cursor: 'pointer' }}
                      onClick={() => setSelectedCustomerId(c.id)}
                    >
                      <td>
                        <strong>{c.name}</strong>
                      </td>
                      <td>{c.phone || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {due > 0 ? (
                          <span className="badge danger">{formatINR(due)}</span>
                        ) : (
                          <span className="badge neutral">₹0</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ padding: '2px 6px', fontSize: '0.75rem', marginRight: 4 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            openEditCustomer(c)
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {filteredCustomers.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                      {loading ? 'Loading customers…' : 'No customers found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Customer Detail & Credit Ledger */}
        {customerDetail && (
          <section className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 14 }}>
              <div>
                <h2>{customerDetail.name}</h2>
                <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                  {customerDetail.phone && <span>📞 {customerDetail.phone} </span>}
                  {customerDetail.address && <span>📍 {customerDetail.address}</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Outstanding Due</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: Number(customerDetail.outstanding || 0) > 0 ? '#b91c1c' : '#10b981' }}>
                  {formatINR(customerDetail.outstanding)}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
                  {Number(customerDetail.outstanding || 0) > 0 && (
                    <>
                      <button
                        type="button"
                        className="primary-btn"
                        style={{ padding: '5px 12px', fontSize: '0.85rem' }}
                        onClick={openPaymentModal}
                      >
                        Collect Payment
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        style={{ padding: '5px 10px', fontSize: '0.85rem', color: '#059669', borderColor: '#059669' }}
                        onClick={async () => {
                          try {
                            const res = await fetch(`${apiBase}/api/whatsapp/due-reminder/${customerDetail.id}`, {
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            const json = await res.json();
                            if (json.data?.shareUrl) {
                              window.open(json.data.shareUrl, '_blank');
                            }
                          } catch {
                            alert('Failed to generate WhatsApp reminder link');
                          }
                        }}
                      >
                        💬 WhatsApp Due
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Credit Invoices History */}
            <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Credit Ledger & Balance</h3>
            <div className="table-scroll" style={{ maxHeight: 180, marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th style={{ textAlign: 'right' }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {customerDetail.customerCredits?.map((credit) => (
                    <tr key={credit.id}>
                      <td>{new Date(credit.createdAt).toLocaleDateString('en-IN')}</td>
                      <td>{credit.description}</td>
                      <td>
                        <span className={`badge ${credit.status === 'PAID' ? 'success' : credit.status === 'PARTIAL' ? 'warning' : 'danger'}`}>
                          {credit.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatINR(credit.amount)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatINR(credit.balanceAmount)}</td>
                    </tr>
                  ))}
                  {(!customerDetail.customerCredits || customerDetail.customerCredits.length === 0) && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 12, color: 'var(--muted)' }}>
                        No credit history on record.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Payment Receipts History */}
            <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Payment Settlement History</h3>
            <div className="table-scroll" style={{ maxHeight: 180 }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Notes</th>
                    <th style={{ textAlign: 'right' }}>Amount Settled</th>
                    <th style={{ textAlign: 'center' }}>WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {customerDetail.payments?.map((pmt) => (
                    <tr key={pmt.id}>
                      <td>{new Date(pmt.paymentDate).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>
                        <span className="badge neutral">{pmt.paymentMethod}</span>
                      </td>
                      <td>{pmt.notes || '—'}</td>
                      <td style={{ textAlign: 'right', color: '#10b981', fontWeight: 600 }}>
                        {formatINR(pmt.amount)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="secondary-btn"
                          style={{ padding: '3px 8px', fontSize: '0.75rem', color: '#059669', borderColor: '#059669' }}
                          title="Share Payment Receipt on WhatsApp"
                          onClick={async () => {
                            try {
                              const res = await fetch(`${apiBase}/api/whatsapp/payment/${pmt.id}`, {
                                headers: { Authorization: `Bearer ${token}` },
                              });
                              const json = await res.json();
                              if (json.data?.shareUrl) {
                                window.open(json.data.shareUrl, '_blank');
                              }
                            } catch {
                              alert('Failed to generate WhatsApp payment receipt');
                            }
                          }}
                        >
                          💬 Share
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!customerDetail.payments || customerDetail.payments.length === 0) && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 12, color: 'var(--muted)' }}>
                        No payments recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* Customer Form Modal */}
      {showCustomerModal && (
        <div className="pos-modal-overlay" onClick={() => setShowCustomerModal(false)}>
          <div className="pos-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2>{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</h2>
              <button type="button" className="pos-remove-btn" onClick={() => setShowCustomerModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCustomerSubmit}>
              <label style={{ display: 'block', marginBottom: 10, fontSize: '0.85rem' }}>
                Customer Name *
                <input
                  type="text"
                  required
                  style={{ width: '100%', padding: '8px 10px', marginTop: 4, border: '1px solid var(--line)', borderRadius: 6 }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ramesh Patel"
                />
              </label>
              <label style={{ display: 'block', marginBottom: 10, fontSize: '0.85rem' }}>
                Phone Number
                <input
                  type="tel"
                  style={{ width: '100%', padding: '8px 10px', marginTop: 4, border: '1px solid var(--line)', borderRadius: 6 }}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                />
              </label>
              <label style={{ display: 'block', marginBottom: 10, fontSize: '0.85rem' }}>
                Address
                <input
                  type="text"
                  style={{ width: '100%', padding: '8px 10px', marginTop: 4, border: '1px solid var(--line)', borderRadius: 6 }}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. 123 Main Street"
                />
              </label>
              <label style={{ display: 'block', marginBottom: 16, fontSize: '0.85rem' }}>
                Notes
                <textarea
                  rows={2}
                  style={{ width: '100%', padding: '8px 10px', marginTop: 4, border: '1px solid var(--line)', borderRadius: 6 }}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional customer notes"
                />
              </label>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="secondary-btn" onClick={() => setShowCustomerModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={busy}>{busy ? 'Saving…' : 'Save Customer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Customer Payment Modal */}
      {showPaymentModal && customerDetail && (
        <div className="pos-modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="pos-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2>Record Customer Payment</h2>
              <button type="button" className="pos-remove-btn" onClick={() => setShowPaymentModal(false)}>✕</button>
            </div>
            <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 8, marginBottom: 14 }}>
              <div>Customer: <strong>{customerDetail.name}</strong></div>
              <div style={{ color: '#b91c1c', fontWeight: 600, marginTop: 4 }}>
                Outstanding Balance: {formatINR(customerDetail.outstanding)}
              </div>
            </div>
            <form onSubmit={handlePaymentSubmit}>
              <label style={{ display: 'block', marginBottom: 10, fontSize: '0.85rem' }}>
                Settlement Amount (₹) *
                <input
                  type="number"
                  min="0.01"
                  max={Number(customerDetail.outstanding || 0)}
                  step="0.01"
                  required
                  style={{ width: '100%', padding: '8px 10px', marginTop: 4, border: '1px solid var(--line)', borderRadius: 6 }}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
              </label>

              <label style={{ display: 'block', marginBottom: 10, fontSize: '0.85rem' }}>
                Payment Method *
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    className={`pos-payment-btn ${paymentMethod === 'CASH' ? 'active' : ''}`}
                    onClick={() => setPaymentMethod('CASH')}
                  >
                    💵 Cash
                  </button>
                  <button
                    type="button"
                    className={`pos-payment-btn ${paymentMethod === 'UPI' ? 'active' : ''}`}
                    onClick={() => setPaymentMethod('UPI')}
                  >
                    📱 UPI
                  </button>
                  <button
                    type="button"
                    className={`pos-payment-btn ${paymentMethod === 'BOTH' ? 'active' : ''}`}
                    onClick={() => {
                      setPaymentMethod('BOTH')
                      const total = Number(paymentAmount) || 0
                      setCashSplit(String(Math.round(total / 2)))
                      setUpiSplit(String(total - Math.round(total / 2)))
                    }}
                  >
                    ⚖️ Split
                  </button>
                </div>
              </label>

              {paymentMethod === 'BOTH' && (
                <div className="pos-split-inputs" style={{ marginBottom: 10 }}>
                  <div>
                    <label>Cash Amount (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cashSplit}
                      onChange={(e) => setCashSplit(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label>UPI Amount (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={upiSplit}
                      onChange={(e) => setUpiSplit(e.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              <label style={{ display: 'block', marginBottom: 16, fontSize: '0.85rem' }}>
                Payment Notes
                <input
                  type="text"
                  style={{ width: '100%', padding: '8px 10px', marginTop: 4, border: '1px solid var(--line)', borderRadius: 6 }}
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="e.g. Receipt #1234 or GPay Ref"
                />
              </label>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="secondary-btn" onClick={() => setShowPaymentModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={busy}>
                  {busy ? 'Recording…' : 'Confirm Payment & Settle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import './inventory.css'
import { createUUID } from './utils/uuid'

type SessionProps = {
  token: string
  onSignIn: (token: string) => void
  onSignOut: () => void
}

type Supplier = {
  id: string
  name: string
  phone: string | null
  gstin: string | null
  address: string | null
  paymentTerms: string | null
  creditLimit: number | string | null
  outstanding: number
  totalPurchases?: number
  purchases?: Purchase[]
  supplierPayments?: SupplierPaymentRecord[]
}

type Product = {
  id: string
  name: string
  genericName: string | null
  brand: string | null
  barcode: string | null
  sku: string | null
  sellingPrice: string | null
  purchasePrice: string | null
}

type PurchaseItem = {
  id?: string
  productId: string
  product?: Product
  batchNumber: string
  quantity: number
  freeQty: number
  purchaseRate: number | string
  mrp?: number | string
  sellingPrice?: number | string
  gst?: number | string
  discount?: number | string
  expiryDate?: string
  total?: number
}

type Purchase = {
  id: string
  supplierId: string
  supplier?: Supplier
  invoiceNumber: string
  invoiceDate: string
  paymentMethod: 'CASH' | 'UPI' | 'BANK' | 'BOTH' | 'CREDIT' | null
  totalAmount: number | string
  paidAmount: number | string
  outstandingAmount: number | string
  status: string
  items: PurchaseItem[]
  supplierPayments?: SupplierPaymentRecord[]
}

type SupplierPaymentRecord = {
  id: string
  supplierId: string
  purchaseId?: string | null
  amount: number | string
  paymentMethod: string
  paymentDate: string
  notes?: string | null
}

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? 'Request failed')
  return body.data as T
}

function PageTop({ title, token, onSignOut, right }: { title: string; token: string; onSignOut: () => void; right?: React.ReactNode }) {
  return (
    <header className="page-top">
      <div>
        <p className="eyebrow">PHARMORA POS</p>
        <h1>{title}</h1>
      </div>
      <div className="top-right-group">
        {right}
        {token ? (
          <button className="ghost-btn" onClick={onSignOut}>Sign out</button>
        ) : (
          <span className="badge">Guest</span>
        )}
      </div>
    </header>
  )
}

function Money({ value }: { value: number | string | null | undefined }) {
  if (value === null || value === undefined) return <span>—</span>
  return <span>₹{Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toUpperCase()
  let tone = 'neutral'
  if (['PAID', 'NORMAL', 'COMPLETED'].includes(normalized)) tone = 'success'
  if (['PARTIAL', 'LOW_STOCK', 'PENDING'].includes(normalized)) tone = 'warning'
  if (['UNPAID', 'OUT_OF_STOCK', 'EXPIRED'].includes(normalized)) tone = 'danger'
  return <span className={`status-pill ${tone}`}>{value.replaceAll('_', ' ')}</span>
}

// --- SUPPLIERS PAGE ---
export function SuppliersPage({ token, onSignOut }: SessionProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [draft, setDraft] = useState({ name: '', phone: '', gstin: '', address: '', paymentTerms: '', creditLimit: '' })
  const [payDraft, setPayDraft] = useState({ purchaseId: '', amount: '', paymentMethod: 'CASH', notes: '' })

  async function loadSuppliers() {
    try {
      const data = await request<Supplier[]>(`/suppliers${search ? `?search=${encodeURIComponent(search)}` : ''}`, token)
      setSuppliers(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load suppliers')
    }
  }

  useEffect(() => {
    if (token) loadSuppliers()
  }, [token, search])

  async function loadSupplierDetail(id: string) {
    try {
      const data = await request<Supplier>(`/suppliers/${id}`, token)
      setSelectedSupplier(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load supplier detail')
    }
  }

  async function handleAddSupplier(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await request('/suppliers', token, {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name,
          phone: draft.phone || undefined,
          gstin: draft.gstin || undefined,
          address: draft.address || undefined,
          paymentTerms: draft.paymentTerms || undefined,
          creditLimit: draft.creditLimit ? Number(draft.creditLimit) : undefined,
        }),
      })
      setShowAddModal(false)
      setDraft({ name: '', phone: '', gstin: '', address: '', paymentTerms: '', creditLimit: '' })
      await loadSuppliers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add supplier')
    } finally {
      setBusy(false)
    }
  }

  async function handleRecordPayment(event: FormEvent) {
    event.preventDefault()
    if (!selectedSupplier) return
    const amt = Number(payDraft.amount)
    if (!amt || amt <= 0) return setError('Enter a valid payment amount')
    if (!payDraft.purchaseId) return setError('Select a purchase to apply payment')

    setBusy(true)
    setError('')
    try {
      await request(`/payments/suppliers/${selectedSupplier.id}/purchases/${payDraft.purchaseId}`, token, {
        method: 'POST',
        headers: { 'Idempotency-Key': createUUID() },
        body: JSON.stringify({
          amount: amt,
          paymentMethod: payDraft.paymentMethod,
          notes: payDraft.notes || undefined,
        }),
      })
      setShowPayModal(false)
      setPayDraft({ purchaseId: '', amount: '', paymentMethod: 'CASH', notes: '' })
      await loadSupplierDetail(selectedSupplier.id)
      await loadSuppliers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to record payment')
    } finally {
      setBusy(false)
    }
  }

  const totalOutstanding = suppliers.reduce((sum, s) => sum + Number(s.outstanding ?? 0), 0)

  if (!token) return <div className="page-shell"><PageTop title="Suppliers" token={token} onSignOut={onSignOut} /></div>

  return (
    <div className="page-shell">
      <PageTop title="Supplier Management" token={token} onSignOut={onSignOut} right={
        <button className="primary-btn" onClick={() => setShowAddModal(true)}>+ Add supplier</button>
      } />

      {error && <p className="inventory-error" role="alert">{error}</p>}

      <section className="inventory-summary-grid">
        <div className="metric-card"><span>Total Suppliers</span><strong>{suppliers.length}</strong></div>
        <div className="metric-card"><span>Total Outstanding Liability</span><strong><Money value={totalOutstanding} /></strong></div>
      </section>

      <section className="panel inventory-table-panel">
        <div className="table-controls">
          <input
            className="search-input"
            type="search"
            placeholder="Search by supplier name, phone, or GSTIN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Phone</th>
                <th>GSTIN</th>
                <th>Payment Terms</th>
                <th>Credit Limit</th>
                <th>Outstanding</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td><strong>{supplier.name}</strong><br /><small>{supplier.address ?? 'No address'}</small></td>
                  <td>{supplier.phone ?? '—'}</td>
                  <td>{supplier.gstin ?? '—'}</td>
                  <td>{supplier.paymentTerms ?? 'Standard'}</td>
                  <td><Money value={supplier.creditLimit} /></td>
                  <td><strong style={{ color: Number(supplier.outstanding) > 0 ? '#dc2626' : 'inherit' }}><Money value={supplier.outstanding} /></strong></td>
                  <td>
                    <button className="ghost-btn" onClick={() => loadSupplierDetail(supplier.id)}>View detail</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {suppliers.length === 0 && <p className="empty-state">No suppliers found.</p>}
        </div>
      </section>

      {/* ADD SUPPLIER MODAL */}
      {showAddModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h2>Add New Supplier</h2>
            <form className="inventory-form" onSubmit={handleAddSupplier}>
              <label>Supplier Name *<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
              <label>Phone Number<input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
              <label>GSTIN<input value={draft.gstin} onChange={(e) => setDraft({ ...draft, gstin: e.target.value })} placeholder="22AAAAA0000A1Z5" /></label>
              <label>Address<textarea value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} rows={2} /></label>
              <label>Payment Terms<input value={draft.paymentTerms} onChange={(e) => setDraft({ ...draft, paymentTerms: e.target.value })} placeholder="Net 30, COD, etc." /></label>
              <label>Credit Limit (₹)<input type="number" min="0" step="0.01" value={draft.creditLimit} onChange={(e) => setDraft({ ...draft, creditLimit: e.target.value })} /></label>

              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={busy}>{busy ? 'Saving…' : 'Save Supplier'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUPPLIER DETAIL MODAL / DRAWER */}
      {selectedSupplier && (
        <div className="modal-backdrop">
          <div className="modal-content large">
            <div className="section-heading">
              <div>
                <p className="eyebrow">SUPPLIER PROFILE</p>
                <h2>{selectedSupplier.name}</h2>
              </div>
              <button className="ghost-btn" onClick={() => setSelectedSupplier(null)}>Close</button>
            </div>

            <div className="inventory-summary-grid">
              <div className="metric-card"><span>Phone</span><strong>{selectedSupplier.phone ?? '—'}</strong></div>
              <div className="metric-card"><span>GSTIN</span><strong>{selectedSupplier.gstin ?? '—'}</strong></div>
              <div className="metric-card"><span>Total Outstanding</span><strong style={{ color: '#dc2626' }}><Money value={selectedSupplier.outstanding} /></strong></div>
            </div>

            {Number(selectedSupplier.outstanding) > 0 && (
              <div style={{ margin: '1rem 0', display: 'flex', justifyContent: 'flex-end' }}>
                <button className="primary-btn" onClick={() => setShowPayModal(true)}>Record Supplier Payment</button>
              </div>
            )}

            <h3>Purchase History</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Invoice #</th><th>Date</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {(selectedSupplier.purchases ?? []).map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.invoiceNumber}</strong></td>
                      <td>{new Date(p.invoiceDate).toLocaleDateString()}</td>
                      <td><Money value={p.totalAmount} /></td>
                      <td><Money value={p.paidAmount} /></td>
                      <td><Money value={p.outstandingAmount} /></td>
                      <td><StatusBadge value={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(selectedSupplier.purchases ?? []).length === 0 && <p className="empty-state">No purchase history recorded.</p>}
            </div>

            <h3 style={{ marginTop: '1.5rem' }}>Payment History</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Date</th><th>Amount</th><th>Method</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {(selectedSupplier.supplierPayments ?? []).map((pay) => (
                    <tr key={pay.id}>
                      <td>{new Date(pay.paymentDate).toLocaleDateString()}</td>
                      <td><Money value={pay.amount} /></td>
                      <td><StatusBadge value={pay.paymentMethod} /></td>
                      <td>{pay.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(selectedSupplier.supplierPayments ?? []).length === 0 && <p className="empty-state">No payments recorded.</p>}
            </div>
          </div>
        </div>
      )}

      {/* RECORD PAYMENT MODAL */}
      {showPayModal && selectedSupplier && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h2>Record Payment to {selectedSupplier.name}</h2>
            <form className="inventory-form" onSubmit={handleRecordPayment}>
              <label>Select Purchase Invoice *
                <select value={payDraft.purchaseId} onChange={(e) => {
                  const p = (selectedSupplier.purchases ?? []).find(item => item.id === e.target.value)
                  setPayDraft({ ...payDraft, purchaseId: e.target.value, amount: p ? String(p.outstandingAmount) : '' })
                }} required>
                  <option value="">-- Choose Invoice --</option>
                  {(selectedSupplier.purchases ?? []).filter(p => Number(p.outstandingAmount) > 0).map(p => (
                    <option key={p.id} value={p.id}>INV #{p.invoiceNumber} — Due: ₹{p.outstandingAmount}</option>
                  ))}
                </select>
              </label>

              <label>Payment Amount (₹) *<input type="number" min="0.01" step="0.01" value={payDraft.amount} onChange={(e) => setPayDraft({ ...payDraft, amount: e.target.value })} required /></label>
              <label>Payment Method *
                <select value={payDraft.paymentMethod} onChange={(e) => setPayDraft({ ...payDraft, paymentMethod: e.target.value })}>
                  <option value="CASH">CASH (Physical Drawer Outflow)</option>
                  <option value="UPI">UPI / BANK (Bank Outflow)</option>
                </select>
              </label>
              <label>Notes<input value={payDraft.notes} onChange={(e) => setPayDraft({ ...payDraft, notes: e.target.value })} placeholder="Reference / Cheque # / Note" /></label>

              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setShowPayModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={busy}>{busy ? 'Processing…' : 'Record Payment'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// --- PURCHASES PAGE ---
export function PurchasesPage({ token, onSignOut }: SessionProps) {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null)
  const [successReceipt, setSuccessReceipt] = useState<Purchase | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Form draft state
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK' | 'BOTH' | 'CREDIT'>('CASH')
  const [paidAmountInput, setPaidAmountInput] = useState('')
  const [cashAmountInput, setCashAmountInput] = useState('')
  const [upiAmountInput, setUpiAmountInput] = useState('')
  const [notes, setNotes] = useState('')

  const [lineItems, setLineItems] = useState<Array<{
    productId: string
    batchNumber: string
    expiryDate: string
    quantity: number
    freeQty: number
    purchaseRate: string
    mrp: string
    sellingPrice: string
    gst: string
    discount: string
  }>>([
    { productId: '', batchNumber: '', expiryDate: '', quantity: 1, freeQty: 0, purchaseRate: '', mrp: '', sellingPrice: '', gst: '0', discount: '0' }
  ])

  async function loadData() {
    try {
      const [purchasesData, suppliersData, productsData] = await Promise.all([
        request<Purchase[]>('/purchases', token),
        request<Supplier[]>('/suppliers', token),
        request<{ items: Product[] }>('/inventory?pageSize=100', token).then(r => r.items ?? []),
      ])
      setPurchases(purchasesData)
      setSuppliers(suppliersData)
      setProducts(productsData)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load purchase data')
    }
  }

  useEffect(() => {
    if (token) loadData()
  }, [token])

  function addLineItem() {
    setLineItems([
      ...lineItems,
      { productId: '', batchNumber: '', expiryDate: '', quantity: 1, freeQty: 0, purchaseRate: '', mrp: '', sellingPrice: '', gst: '0', discount: '0' }
    ])
  }

  function removeLineItem(index: number) {
    if (lineItems.length === 1) return
    setLineItems(lineItems.filter((_, i) => i !== index))
  }

  function updateLineItem(index: number, field: string, value: any) {
    const next = [...lineItems]
    next[index] = { ...next[index]!, [field]: value }
    setLineItems(next)
  }

  // Calculations
  const calculatedSubtotal = lineItems.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0
    const rate = Number(item.purchaseRate) || 0
    const disc = Number(item.discount) || 0
    const gst = Number(item.gst) || 0
    const lineBase = qty * rate * (1 - disc / 100)
    const lineWithGst = lineBase * (1 + gst / 100)
    return sum + lineWithGst
  }, 0)

  const totalAmount = Math.round(calculatedSubtotal * 100) / 100

  let effectivePaid = 0
  if (paymentMethod === 'CREDIT') effectivePaid = 0
  else if (paymentMethod === 'BOTH') effectivePaid = (Number(cashAmountInput) || 0) + (Number(upiAmountInput) || 0)
  else effectivePaid = paidAmountInput !== '' ? Number(paidAmountInput) : totalAmount

  const effectiveOutstanding = Math.max(0, Math.round((totalAmount - effectivePaid) * 100) / 100)

  async function handleCreatePurchase(event: FormEvent) {
    event.preventDefault()
    if (!supplierId) return setError('Select a supplier')
    if (!invoiceNumber.trim()) return setError('Enter invoice number')
    if (lineItems.some(item => !item.productId || !item.batchNumber.trim() || !Number(item.purchaseRate))) {
      return setError('Complete all product line items with product, batch number, and purchase rate')
    }
    if (paymentMethod === 'BOTH' && (Number(cashAmountInput) + Number(upiAmountInput)) !== effectivePaid) {
      return setError('Cash and UPI amounts must sum exactly to paid amount')
    }
    if (effectivePaid > totalAmount) {
      return setError('Paid amount cannot exceed total purchase invoice amount')
    }

    const selectedSupplierName = suppliers.find(s => s.id === supplierId)?.name ?? 'Supplier'
    const confirmMsg = `Confirm creating Purchase Invoice #${invoiceNumber} from ${selectedSupplierName} for ₹${totalAmount.toFixed(2)}?\n\nPaid: ₹${effectivePaid.toFixed(2)} (${paymentMethod})\nOutstanding: ₹${effectiveOutstanding.toFixed(2)}\n\nThis will automatically update Inventory Stock, Batches, Cashbook, and Supplier Liability.`
    if (!window.confirm(confirmMsg)) return

    setBusy(true)
    setError('')
    try {
      const payload = {
        supplierId,
        invoiceNumber,
        invoiceDate,
        paymentMethod,
        paidAmount: effectivePaid,
        cashAmount: paymentMethod === 'BOTH' ? Number(cashAmountInput) : undefined,
        upiAmount: paymentMethod === 'BOTH' ? Number(upiAmountInput) : undefined,
        notes: notes || undefined,
        items: lineItems.map(item => ({
          productId: item.productId,
          batchNumber: item.batchNumber.trim(),
          expiryDate: item.expiryDate ? new Date(item.expiryDate).toISOString() : undefined,
          quantity: Number(item.quantity),
          freeQty: Number(item.freeQty) || 0,
          purchaseRate: Number(item.purchaseRate),
          mrp: item.mrp ? Number(item.mrp) : undefined,
          sellingPrice: item.sellingPrice ? Number(item.sellingPrice) : undefined,
          gst: Number(item.gst) || 0,
          discount: Number(item.discount) || 0,
        })),
      }

      const created = await request<Purchase>('/purchases', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': createUUID() },
        body: JSON.stringify(payload),
      })

      setShowCreateModal(false)
      setSuccessReceipt(created)
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save purchase')
    } finally {
      setBusy(false)
    }
  }

  if (!token) return <div className="page-shell"><PageTop title="Purchases" token={token} onSignOut={onSignOut} /></div>

  return (
    <div className="page-shell">
      <PageTop title="Purchase Management" token={token} onSignOut={onSignOut} right={
        <button className="primary-btn" onClick={() => {
          setShowCreateModal(true)
          setSupplierId('')
          setInvoiceNumber('')
          setLineItems([{ productId: '', batchNumber: '', expiryDate: '', quantity: 1, freeQty: 0, purchaseRate: '', mrp: '', sellingPrice: '', gst: '0', discount: '0' }])
        }}>+ New Purchase Invoice</button>
      } />

      {error && <p className="inventory-error" role="alert">{error}</p>}

      <section className="panel inventory-table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Supplier</th>
                <th>Items</th>
                <th>Total Amount</th>
                <th>Paid Amount</th>
                <th>Outstanding</th>
                <th>Payment Method</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.invoiceNumber}</strong></td>
                  <td>{new Date(p.invoiceDate).toLocaleDateString()}</td>
                  <td>{p.supplier?.name ?? '—'}</td>
                  <td>{p.items?.length ?? 0} line(s)</td>
                  <td><Money value={p.totalAmount} /></td>
                  <td><Money value={p.paidAmount} /></td>
                  <td><strong style={{ color: Number(p.outstandingAmount) > 0 ? '#dc2626' : 'inherit' }}><Money value={p.outstandingAmount} /></strong></td>
                  <td><StatusBadge value={p.paymentMethod ?? 'CREDIT'} /></td>
                  <td><StatusBadge value={p.status} /></td>
                  <td><button className="ghost-btn" onClick={() => setSelectedPurchase(p)}>View detail</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {purchases.length === 0 && <p className="empty-state">No purchases recorded.</p>}
        </div>
      </section>

      {/* NEW PURCHASE INVOICE FORM MODAL */}
      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal-content large" style={{ maxWidth: '950px' }}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">SINGLE TRANSACTION ENTRY</p>
                <h2>New Purchase Invoice</h2>
              </div>
              <button className="ghost-btn" onClick={() => setShowCreateModal(false)}>Close</button>
            </div>

            <form onSubmit={handleCreatePurchase} className="inventory-form">
              <div className="form-row-3">
                <label>Supplier *
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                    <option value="">-- Select Supplier --</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.phone ?? 'No phone'})</option>)}
                  </select>
                </label>
                <label>Invoice Number *<input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-2026-001" required /></label>
                <label>Invoice Date *<input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required /></label>
              </div>

              <h3 style={{ marginTop: '1.5rem' }}>Line Items (Products & Batches)</h3>

              {/* Desktop View: Full Data Table */}
              <div className="table-scroll purchase-desktop-table">
                <table style={{ width: '100%', fontSize: '0.9rem' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '22%' }}>Product *</th>
                      <th style={{ width: '14%' }}>Batch # *</th>
                      <th style={{ width: '13%' }}>Expiry Date</th>
                      <th style={{ width: '8%' }}>Qty *</th>
                      <th style={{ width: '8%' }}>Free</th>
                      <th style={{ width: '12%' }}>Rate (₹) *</th>
                      <th style={{ width: '10%' }}>MRP (₹)</th>
                      <th style={{ width: '8%' }}>GST %</th>
                      <th>Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, idx) => {
                      const qty = Number(item.quantity) || 0
                      const rate = Number(item.purchaseRate) || 0
                      const gst = Number(item.gst) || 0
                      const lTotal = Math.round(qty * rate * (1 + gst / 100) * 100) / 100

                      return (
                        <tr key={idx}>
                          <td>
                            <select value={item.productId} onChange={(e) => updateLineItem(idx, 'productId', e.target.value)} required>
                              <option value="">-- Product --</option>
                              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </td>
                          <td><input value={item.batchNumber} onChange={(e) => updateLineItem(idx, 'batchNumber', e.target.value)} placeholder="Batch #" required /></td>
                          <td><input type="date" value={item.expiryDate} onChange={(e) => updateLineItem(idx, 'expiryDate', e.target.value)} /></td>
                          <td><input type="number" min="1" value={item.quantity} onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)} required /></td>
                          <td><input type="number" min="0" value={item.freeQty} onChange={(e) => updateLineItem(idx, 'freeQty', e.target.value)} /></td>
                          <td><input type="number" min="0" step="0.01" value={item.purchaseRate} onChange={(e) => updateLineItem(idx, 'purchaseRate', e.target.value)} required /></td>
                          <td><input type="number" min="0" step="0.01" value={item.mrp} onChange={(e) => updateLineItem(idx, 'mrp', e.target.value)} /></td>
                          <td><input type="number" min="0" step="1" value={item.gst} onChange={(e) => updateLineItem(idx, 'gst', e.target.value)} /></td>
                          <td><strong>₹{lTotal.toFixed(2)}</strong></td>
                          <td><button type="button" className="ghost-btn" onClick={() => removeLineItem(idx)}>✕</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile View: Clean Card Rows */}
              <div className="purchase-mobile-cards">
                {lineItems.map((item, idx) => {
                  const qty = Number(item.quantity) || 0
                  const rate = Number(item.purchaseRate) || 0
                  const gst = Number(item.gst) || 0
                  const lTotal = Math.round(qty * rate * (1 + gst / 100) * 100) / 100

                  return (
                    <div key={idx} className="purchase-item-card">
                      <div className="purchase-item-card-header">
                        <strong>Line Item #{idx + 1}</strong>
                        {lineItems.length > 1 && (
                          <button
                            type="button"
                            className="ghost-btn"
                            style={{ color: '#dc2626', borderColor: '#fca5a5', padding: '4px 8px', minHeight: '32px' }}
                            onClick={() => removeLineItem(idx)}
                          >
                            ✕ Remove
                          </button>
                        )}
                      </div>

                      <label>
                        Product *
                        <select value={item.productId} onChange={(e) => updateLineItem(idx, 'productId', e.target.value)} required>
                          <option value="">-- Select Product --</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </label>

                      <div className="purchase-card-grid-2">
                        <label>
                          Batch # *
                          <input value={item.batchNumber} onChange={(e) => updateLineItem(idx, 'batchNumber', e.target.value)} placeholder="Batch #" required />
                        </label>
                        <label>
                          Expiry Date
                          <input type="date" value={item.expiryDate} onChange={(e) => updateLineItem(idx, 'expiryDate', e.target.value)} />
                        </label>
                      </div>

                      <div className="purchase-card-grid-2">
                        <label>
                          Quantity *
                          <input type="number" min="1" value={item.quantity} onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)} required />
                        </label>
                        <label>
                          Free Qty
                          <input type="number" min="0" value={item.freeQty} onChange={(e) => updateLineItem(idx, 'freeQty', e.target.value)} />
                        </label>
                      </div>

                      <div className="purchase-card-grid-2">
                        <label>
                          Purchase Rate (₹) *
                          <input type="number" min="0" step="0.01" value={item.purchaseRate} onChange={(e) => updateLineItem(idx, 'purchaseRate', e.target.value)} required />
                        </label>
                        <label>
                          MRP (₹)
                          <input type="number" min="0" step="0.01" value={item.mrp} onChange={(e) => updateLineItem(idx, 'mrp', e.target.value)} />
                        </label>
                      </div>

                      <div className="purchase-card-grid-2">
                        <label>
                          GST %
                          <input type="number" min="0" step="1" value={item.gst} onChange={(e) => updateLineItem(idx, 'gst', e.target.value)} />
                        </label>
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Line Total</span>
                          <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>₹{lTotal.toFixed(2)}</strong>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <button type="button" className="secondary-btn" onClick={addLineItem} style={{ marginTop: '0.5rem', width: '100%' }}>+ Add Product Line</button>

              <h3 style={{ marginTop: '1.5rem' }}>Payment & Settlement</h3>
              <div className="form-row-3" style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px' }}>
                <label>Payment Method *
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)}>
                    <option value="CASH">CASH (Paid Full via Cashbook)</option>
                    <option value="UPI">UPI / BANK (Paid Full via Bank)</option>
                    <option value="BOTH">BOTH (Split Cash & UPI)</option>
                    <option value="CREDIT">CREDIT (Pay Later — ₹0 Paid)</option>
                  </select>
                </label>

                {paymentMethod === 'BOTH' && (
                  <>
                    <label>Cash Amount (₹)<input type="number" min="0" step="0.01" value={cashAmountInput} onChange={(e) => setCashAmountInput(e.target.value)} required /></label>
                    <label>UPI/Bank Amount (₹)<input type="number" min="0" step="0.01" value={upiAmountInput} onChange={(e) => setUpiAmountInput(e.target.value)} required /></label>
                  </>
                )}

                {paymentMethod !== 'CREDIT' && paymentMethod !== 'BOTH' && (
                  <label>Amount Paid (₹)<input type="number" min="0" step="0.01" value={paidAmountInput} onChange={(e) => setPaidAmountInput(e.target.value)} placeholder={`Default: Full ₹${totalAmount.toFixed(2)}`} /></label>
                )}
                <label style={{ gridColumn: '1 / -1' }}>Notes / Remarks<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Supplier invoice notes, reference details, etc." /></label>
              </div>

              <div style={{ marginTop: '1rem', padding: '1rem', background: '#e0f2fe', borderRadius: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span>Total Purchase: <strong>₹{totalAmount.toFixed(2)}</strong></span> &nbsp; | &nbsp;
                  <span>Paid: <strong>₹{effectivePaid.toFixed(2)}</strong></span>
                </div>
                <div style={{ color: effectiveOutstanding > 0 ? '#b91c1c' : '#15803d' }}>
                  <span>Outstanding: <strong>₹{effectiveOutstanding.toFixed(2)}</strong></span>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={busy}>{busy ? 'Processing Purchase…' : 'Save Purchase Transaction'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUCCESS RECEIPT / RESULT MODAL */}
      {successReceipt && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h2 style={{ color: '#15803d' }}>✓ Purchase Created Successfully</h2>
            <p>Purchase Invoice <strong>#{successReceipt.invoiceNumber}</strong> has been saved.</p>
            <div className="inventory-summary-grid" style={{ margin: '1rem 0' }}>
              <div className="metric-card"><span>Total Invoice</span><strong><Money value={successReceipt.totalAmount} /></strong></div>
              <div className="metric-card"><span>Paid Amount</span><strong><Money value={successReceipt.paidAmount} /></strong></div>
              <div className="metric-card"><span>Outstanding</span><strong style={{ color: Number(successReceipt.outstandingAmount) > 0 ? '#dc2626' : 'inherit' }}><Money value={successReceipt.outstandingAmount} /></strong></div>
            </div>
            <p className="quiet-label">✓ Product batches, inventory stock movements, cashbook outflow, and supplier liability updated in a single atomic transaction.</p>
            <div className="modal-actions">
              <button className="primary-btn" onClick={() => setSuccessReceipt(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW PURCHASE DETAIL MODAL */}
      {selectedPurchase && (
        <div className="modal-backdrop">
          <div className="modal-content large">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PURCHASE DETAILS</p>
                <h2>Invoice #{selectedPurchase.invoiceNumber}</h2>
              </div>
              <button className="ghost-btn" onClick={() => setSelectedPurchase(null)}>Close</button>
            </div>

            <div className="inventory-summary-grid">
              <div className="metric-card"><span>Supplier</span><strong>{selectedPurchase.supplier?.name ?? '—'}</strong></div>
              <div className="metric-card"><span>Invoice Date</span><strong>{new Date(selectedPurchase.invoiceDate).toLocaleDateString()}</strong></div>
              <div className="metric-card"><span>Total Amount</span><strong><Money value={selectedPurchase.totalAmount} /></strong></div>
              <div className="metric-card"><span>Outstanding</span><strong style={{ color: Number(selectedPurchase.outstandingAmount) > 0 ? '#dc2626' : 'inherit' }}><Money value={selectedPurchase.outstandingAmount} /></strong></div>
            </div>

            <h3 style={{ marginTop: '1.5rem' }}>Purchased Items & Batches</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Product</th><th>Batch Number</th><th>Expiry</th><th>Qty</th><th>Free</th><th>Purchase Rate</th><th>MRP</th></tr>
                </thead>
                <tbody>
                  {(selectedPurchase.items ?? []).map((item) => (
                    <tr key={item.id ?? item.batchNumber}>
                      <td>{item.product?.name ?? '—'}</td>
                      <td><strong>{item.batchNumber}</strong></td>
                      <td>{item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : '—'}</td>
                      <td>{item.quantity}</td>
                      <td>{item.freeQty}</td>
                      <td><Money value={item.purchaseRate} /></td>
                      <td><Money value={item.mrp} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

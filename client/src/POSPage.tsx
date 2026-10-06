import { useState, useEffect, useRef, type FormEvent } from 'react'
import './pos.css'
import { ReceiptModal } from './ReceiptModal.js'
import { BarcodeScannerModal } from './BarcodeScannerModal.js'
import { createUUID } from './utils/uuid'

type Product = {
  id: string
  name: string
  genericName?: string | null
  brand?: string | null
  barcode?: string | null
  sku?: string | null
  sellingPrice: number | string | null
  mrp: number | string | null
  gst: number | string | null
  totalStock?: number
}

export type Batch = {
  id: string
  batchNumber: string
  quantity: number
  expiryDate: string | null
  sellingPrice: number | string | null
  mrp: number | string | null
  gst: number | string | null
}

type Customer = {
  id: string
  name: string
  phone?: string | null
  outstanding?: number
}

type CartItem = {
  product: Product
  batchId?: string
  quantity: number
  unitPrice: number
  discount: number
  gst: number
}

type CompletedSale = {
  id: string
  saleNumber?: string | null
  saleDate: string
  totalAmount: number | string
  paidAmount: number | string
  paymentMethod: string
  customer?: Customer | null
  items: Array<{
    id: string
    quantity: number
    sellingPrice: number | string
    discount?: number | string | null
    gst?: number | string | null
    product: { name: string }
    batch?: { batchNumber: string; expiryDate?: string | null } | null
  }>
}

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

function formatINR(amount: number | string | null | undefined) {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return '₹0.00'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(amount))
}

export function POSPage({ token, onSignIn }: { token: string; onSignIn: (t: string) => void }) {
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'BOTH' | 'CREDIT'>('CASH')
  const [cashAmount, setCashAmount] = useState<string>('')
  const [upiAmount, setUpiAmount] = useState<string>('')
  const [paidAmount, setPaidAmount] = useState<string>('')
  const [isPartial, setIsPartial] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [successNotice, setSuccessNotice] = useState('')
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null)
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [mobileTab, setMobileTab] = useState<'catalog' | 'cart'>('catalog')

  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) return
    loadProducts()
    loadCustomers()
  }, [token])

  async function loadProducts(query = '') {
    try {
      const res = await fetch(`${apiBase}/api/products?pageSize=50&search=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setProducts(data.data.items || [])
      }
    } catch {
      // ignore
    }
  }

  async function loadCustomers() {
    try {
      const res = await fetch(`${apiBase}/api/customers`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setCustomers(data.data || [])
      }
    } catch {
      // ignore
    }
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setSearch(val)
    loadProducts(val)
  }

  function addToCart(product: Product) {
    const price = Number(product.sellingPrice || product.mrp || 0)
    const existingIndex = cart.findIndex((i) => i.product.id === product.id)
    if (existingIndex > -1) {
      const updated = [...cart]
      updated[existingIndex].quantity += 1
      setCart(updated)
    } else {
      setCart([
        ...cart,
        {
          product,
          quantity: 1,
          unitPrice: price,
          discount: 0,
          gst: Number(product.gst || 0),
        },
      ])
    }
    setSuccessNotice(`Added "${product.name}" to cart`)
    setTimeout(() => setSuccessNotice(''), 3000)
  }

  async function handleBarcodeScanned(barcode: string) {
    setError('')
    try {
      const res = await fetch(`${apiBase}/api/products?pageSize=50&search=${encodeURIComponent(barcode)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success && data.data.items && data.data.items.length > 0) {
        // Look for exact barcode match first
        const exactMatch = data.data.items.find(
          (p: Product) => p.barcode?.toLowerCase() === barcode.toLowerCase() || p.sku?.toLowerCase() === barcode.toLowerCase()
        )
        const matchedProduct = exactMatch || data.data.items[0]
        addToCart(matchedProduct)
      } else {
        setError(`Product not found for scanned barcode: "${barcode}".`)
      }
    } catch {
      setError(`Failed to search barcode: "${barcode}".`)
    }
  }

  function updateQuantity(index: number, quantity: number) {
    if (quantity <= 0) {
      removeFromCart(index)
      return
    }
    const updated = [...cart]
    updated[index].quantity = quantity
    setCart(updated)
  }

  function updateDiscount(index: number, discount: number) {
    const updated = [...cart]
    updated[index].discount = Math.max(0, discount)
    setCart(updated)
  }

  function removeFromCart(index: number) {
    const updated = [...cart]
    updated.splice(index, 1)
    setCart(updated)
  }

  function clearCart() {
    setCart([])
    setSelectedCustomer(null)
    setCashAmount('')
    setUpiAmount('')
    setPaidAmount('')
    setIsPartial(false)
    setError('')
  }

  // Calculate totals
  const subtotal = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const totalDiscount = cart.reduce((sum, item) => sum + item.discount, 0)
  const totalTax = cart.reduce((sum, item) => {
    const base = item.quantity * item.unitPrice - item.discount
    return sum + (base > 0 ? (base * item.gst) / 100 : 0)
  }, 0)
  const grandTotal = Math.round((subtotal - totalDiscount + totalTax) * 100) / 100

  // Handle Split Autofill
  function handlePaymentMethodChange(method: 'CASH' | 'UPI' | 'BOTH' | 'CREDIT') {
    setPaymentMethod(method)
    if (method === 'BOTH') {
      setCashAmount(String(Math.round(grandTotal / 2)))
      setUpiAmount(String(Math.round(grandTotal - Math.round(grandTotal / 2))))
    }
  }

  async function handleQuickAddCustomer(e: FormEvent) {
    e.preventDefault()
    if (!newCustomerName.trim()) return
    try {
      const res = await fetch(`${apiBase}/api/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newCustomerName, phone: newCustomerPhone || undefined }),
      })
      const data = await res.json()
      if (data.success) {
        setCustomers([...customers, data.data])
        setSelectedCustomer(data.data)
        setNewCustomerName('')
        setNewCustomerPhone('')
        setShowAddCustomer(false)
      } else {
        setError(data.message || 'Failed to create customer')
      }
    } catch {
      setError('Network error adding customer')
    }
  }

  async function handleCheckout() {
    if (cart.length === 0) return
    setError('')
    setBusy(true)

    try {
      const payload: any = {
        paymentMethod,
        customerId: selectedCustomer?.id || undefined,
        items: cart.map((item) => ({
          productId: item.product.id,
          batchId: item.batchId || undefined,
          quantity: item.quantity,
          sellingPrice: item.unitPrice,
          discount: item.discount > 0 ? item.discount : undefined,
          gst: item.gst > 0 ? item.gst : undefined,
        })),
      }

      if (paymentMethod === 'BOTH') {
        payload.cashAmount = Number(cashAmount)
        payload.upiAmount = Number(upiAmount)
      }

      if (isPartial && paidAmount) {
        payload.paidAmount = Number(paidAmount)
      }

      const res = await fetch(`${apiBase}/api/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': createUUID(),
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Checkout failed')
      }

      setCompletedSale(data.data)
      clearCart()
      loadProducts(search)
      setMobileTab('catalog')
    } catch (err: any) {
      setError(err.message || 'Checkout failed')
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <div className="page-shell">
        <div className="panel" style={{ maxWidth: 400, margin: '60px auto', textAlign: 'center' }}>
          <h2>Sign in Required</h2>
          <p style={{ color: 'var(--muted)', margin: '10px 0 20px' }}>Please sign in to access the POS terminal.</p>
          <button className="primary-btn" onClick={() => onSignIn('')}>Go to Sign In</button>
        </div>
      </div>
    )
  }

  const totalCartItems = cart.reduce((acc, i) => acc + i.quantity, 0)

  return (
    <div className="page-shell">
      <div className="page-header" style={{ marginBottom: 10 }}>
        <div>
          <p className="eyebrow">BILLING COUNTER</p>
          <h1>Point of Sale (POS)</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
      </div>

      {error && (
        <div className="badge danger" style={{ padding: '10px 14px', borderRadius: 8, fontSize: '0.9rem', marginBottom: 10 }} role="alert">
          {error}
        </div>
      )}

      {successNotice && (
        <div className="badge success" style={{ padding: '10px 14px', borderRadius: 8, fontSize: '0.9rem', marginBottom: 10 }}>
          {successNotice}
        </div>
      )}

      {/* Mobile View Switcher (Visible on < 768px screens) */}
      <div className="pos-mobile-view-tabs">
        <button
          type="button"
          className={`pos-view-tab ${mobileTab === 'catalog' ? 'active' : ''}`}
          onClick={() => setMobileTab('catalog')}
        >
          📦 Catalog ({products.length})
        </button>
        <button
          type="button"
          className={`pos-view-tab ${mobileTab === 'cart' ? 'active' : ''}`}
          onClick={() => setMobileTab('cart')}
        >
          🛒 Cart ({totalCartItems}) • {formatINR(grandTotal)}
        </button>
      </div>

      <div className="pos-grid-container">
        {/* Left Side: Product Search & Catalog */}
        <section
          className="panel"
          style={{
            display: mobileTab === 'catalog' ? 'flex' : undefined,
            flexDirection: 'column',
            height: '100%',
          }}
        >
          <div className="pos-product-search-bar">
            <input
              ref={searchInputRef}
              type="text"
              className="pos-search-input"
              placeholder="Search name, brand, barcode (F2)..."
              value={search}
              onChange={handleSearchChange}
              autoFocus
            />
            <button
              type="button"
              className="pos-scan-btn"
              onClick={() => setIsScannerOpen(true)}
              title="Open Camera Barcode Scanner"
            >
              📷 Scan
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => loadProducts(search)}
            >
              Search
            </button>
          </div>

          <div className="pos-catalog-grid">
            {products.map((prod) => {
              const price = Number(prod.sellingPrice || prod.mrp || 0)
              return (
                <button
                  key={prod.id}
                  className="pos-catalog-item"
                  onClick={() => addToCart(prod)}
                  type="button"
                >
                  <div>
                    <div className="pos-item-header">{prod.name}</div>
                    {prod.genericName && <div className="pos-item-generic">{prod.genericName}</div>}
                    {prod.brand && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{prod.brand}</div>}
                  </div>
                  <div className="pos-item-footer">
                    <span className="pos-item-price">{formatINR(price)}</span>
                    <span className="pos-item-stock">Add +</span>
                  </div>
                </button>
              )
            })}
            {products.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                No active products found matching "{search}".
              </div>
            )}
          </div>

          {/* Quick Floating Cart Bar for Mobile Screen */}
          {cart.length > 0 && mobileTab === 'catalog' && (
            <div
              className="pos-mobile-cart-bar"
              onClick={() => setMobileTab('cart')}
            >
              <span>🛒 {totalCartItems} items in cart</span>
              <strong>{formatINR(grandTotal)} → Pay</strong>
            </div>
          )}
        </section>

        {/* Right Side: Cart & Checkout */}
        <aside
          className="panel pos-cart-panel"
          style={{
            display: mobileTab === 'cart' || window.innerWidth > 768 ? 'flex' : 'none',
          }}
        >
          {/* Customer Selection */}
          <div className="pos-customer-selector">
            <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>Customer:</span>
            <select
              value={selectedCustomer?.id || ''}
              onChange={(e) => {
                const found = customers.find((c) => c.id === e.target.value)
                setSelectedCustomer(found || null)
              }}
            >
              <option value="">Walk-in Customer (General)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `(${c.phone})` : ''} {Number(c.outstanding || 0) > 0 ? `— Due: ₹${c.outstanding}` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary-btn"
              style={{ padding: '4px 10px', fontSize: '0.8rem', minHeight: 34 }}
              onClick={() => setShowAddCustomer(true)}
            >
              + New
            </button>
          </div>

          {/* Cart Table */}
          <div className="pos-cart-table-wrapper">
            <table className="pos-cart-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ width: 90 }}>Qty</th>
                  <th>Price</th>
                  <th>Disc</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item, idx) => {
                  const lineNet = item.quantity * item.unitPrice - item.discount
                  const lineTax = lineNet > 0 ? (lineNet * item.gst) / 100 : 0
                  const lineGrand = lineNet + lineTax

                  return (
                    <tr key={`${item.product.id}-${idx}`}>
                      <td>
                        <strong style={{ display: 'block', fontSize: '0.85rem' }}>{item.product.name}</strong>
                        <small style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                          GST {item.gst}%
                        </small>
                      </td>
                      <td>
                        <div className="pos-qty-control">
                          <button
                            type="button"
                            className="pos-qty-btn"
                            onClick={() => updateQuantity(idx, item.quantity - 1)}
                            aria-label="Decrease quantity"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            className="pos-qty-input"
                            value={item.quantity}
                            onChange={(e) => updateQuantity(idx, parseInt(e.target.value) || 1)}
                          />
                          <button
                            type="button"
                            className="pos-qty-btn"
                            onClick={() => updateQuantity(idx, item.quantity + 1)}
                            aria-label="Increase quantity"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td>{formatINR(item.unitPrice)}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          style={{ width: 48, padding: '4px 4px', fontSize: '0.85rem', border: '1px solid var(--line)', borderRadius: 4 }}
                          value={item.discount || ''}
                          placeholder="₹0"
                          onChange={(e) => updateDiscount(idx, parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td>
                        <strong>{formatINR(lineGrand)}</strong>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="pos-remove-btn"
                          onClick={() => removeFromCart(idx)}
                          aria-label="Remove item"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--muted)' }}>
                      Cart is empty. Tap items from the catalog or scan barcodes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals Box */}
          <div className="pos-totals-box">
            <div className="pos-totals-row">
              <span>Subtotal:</span>
              <span>{formatINR(subtotal)}</span>
            </div>
            {totalDiscount > 0 && (
              <div className="pos-totals-row" style={{ color: '#16a34a' }}>
                <span>Discount:</span>
                <span>-{formatINR(totalDiscount)}</span>
              </div>
            )}
            <div className="pos-totals-row">
              <span>Estimated Tax (GST):</span>
              <span>+{formatINR(totalTax)}</span>
            </div>
            <div className="pos-totals-row grand">
              <span>Total Amount:</span>
              <span>{formatINR(grandTotal)}</span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="pos-pay-actions">
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>
              Payment Method:
            </label>
            <div className="pos-payment-methods">
              {(['CASH', 'UPI', 'BOTH', 'CREDIT'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`pos-payment-btn ${paymentMethod === m ? 'active' : ''}`}
                  onClick={() => handlePaymentMethodChange(m)}
                >
                  {m === 'CASH' && '💵 Cash'}
                  {m === 'UPI' && '📱 UPI / QR'}
                  {m === 'BOTH' && '⚖️ Split'}
                  {m === 'CREDIT' && '📒 Credit'}
                </button>
              ))}
            </div>

            {/* Split Details */}
            {paymentMethod === 'BOTH' && (
              <div className="pos-split-inputs">
                <label>
                  Cash (₹):
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashAmount}
                    onChange={(e) => {
                      setCashAmount(e.target.value)
                      const val = parseFloat(e.target.value) || 0
                      setUpiAmount(String(Math.max(0, Math.round((grandTotal - val) * 100) / 100)))
                    }}
                  />
                </label>
                <label>
                  UPI (₹):
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={upiAmount}
                    onChange={(e) => {
                      setUpiAmount(e.target.value)
                      const val = parseFloat(e.target.value) || 0
                      setCashAmount(String(Math.max(0, Math.round((grandTotal - val) * 100) / 100)))
                    }}
                  />
                </label>
              </div>
            )}

            {/* Partial Payment Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
              <input
                type="checkbox"
                id="partialCheck"
                checked={isPartial}
                onChange={(e) => {
                  setIsPartial(e.target.checked)
                  if (!e.target.checked) setPaidAmount('')
                }}
              />
              <label htmlFor="partialCheck" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                Partial payment / Credit balance
              </label>
            </div>

            {isPartial && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Amount Paid (₹):</label>
                <input
                  type="number"
                  min="0"
                  max={grandTotal}
                  step="0.01"
                  style={{ flex: 1, padding: '8px', border: '1px solid var(--line)', borderRadius: 6, fontWeight: 700 }}
                  value={paidAmount}
                  placeholder={`Max ${grandTotal}`}
                  onChange={(e) => setPaidAmount(e.target.value)}
                />
              </div>
            )}

            {/* Checkout Action Button */}
            <button
              type="button"
              className="pos-checkout-btn"
              disabled={busy || cart.length === 0}
              onClick={handleCheckout}
            >
              {busy ? 'Processing Sale…' : `Complete Sale • ${formatINR(grandTotal)}`}
            </button>

            {cart.length > 0 && (
              <button
                type="button"
                className="secondary-btn"
                style={{ width: '100%', color: '#ef4444', borderColor: '#fca5a5' }}
                onClick={clearCart}
              >
                Clear Cart
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* Barcode Camera Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleBarcodeScanned}
        title="Scan Barcode / SKU"
      />

      {/* Quick Add Customer Modal */}
      {showAddCustomer && (
        <div className="pos-modal-overlay" role="dialog" aria-modal="true">
          <div className="pos-modal" style={{ maxWidth: 380 }}>
            <h3>Add New Customer</h3>
            <form onSubmit={handleQuickAddCustomer} style={{ display: 'grid', gap: 12, marginTop: 14 }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Customer Name:
                <input
                  type="text"
                  required
                  style={{ width: '100%', padding: '8px', border: '1px solid var(--line)', borderRadius: 6, marginTop: 4 }}
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  autoFocus
                />
              </label>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Phone Number (WhatsApp):
                <input
                  type="tel"
                  style={{ width: '100%', padding: '8px', border: '1px solid var(--line)', borderRadius: 6, marginTop: 4 }}
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                />
              </label>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button type="submit" className="primary-btn" style={{ flex: 1 }}>
                  Save Customer
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowAddCustomer(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Completed Sale Receipt Modal */}
      {completedSale && (
        <ReceiptModal
          onClose={() => setCompletedSale(null)}
          saleId={completedSale.id}
          token={token}
        />
      )}
    </div>
  )
}

import { useEffect, useState, useMemo } from 'react'
import './inventory.css'

type SessionProps = {
  token: string
  onSignIn?: (token: string) => void
  onSignOut?: () => void
}

type PurchaseListItem = {
  id: string
  name: string
  genericName: string | null
  brand: string | null
  barcode: string | null
  sku: string | null
  supplierId: string | null
  supplierName: string
  currentStock: number
  reorderLevel: number
  minStock: number
  maxStock: number | null
  stockStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'NORMAL'
  suggestedQuantity: number
  latestPurchasePrice: number | null
  previousPurchasePrice: number | null
  lastPurchaseDate: string | null
  productPurchasePrice: number | null
  sellingPrice: number | null
}

type Supplier = {
  id: string
  name: string
  phone: string | null
}

type OrderItemInput = {
  productId: string
  productName: string
  genericName?: string | null
  brand?: string | null
  quantity: number
  unitPrice: number
  notes?: string
}

type PurchaseOrder = {
  id: string
  orderNumber: string
  supplier: string
  supplierId: string | null
  status: 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED'
  orderDate: string
  expectedDate: string | null
  totalAmount: number | null
  totalQuantity: number | null
  notes: string | null
  createdAt: string
  supplierRel?: { phone: string | null } | null
  items: Array<{
    id: string
    productId: string
    quantity: number
    unitPrice: number | null
    currentStockSnapshot?: number | null
    reorderLevelSnapshot?: number | null
    notes?: string | null
    product: {
      name: string
      genericName: string | null
      brand: string | null
      sku: string | null
      barcode: string | null
    }
  }>
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

function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value))
}

function formatDate(val: string | null | undefined) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function PurchaseOrdersPage({ token }: SessionProps) {
  const [activeTab, setActiveTab] = useState<'PURCHASE_LIST' | 'BUILDER' | 'HISTORY'>('PURCHASE_LIST')

  // Purchase List State
  const [purchaseList, setPurchaseList] = useState<PurchaseListItem[]>([])
  const [listFilter, setListFilter] = useState<'ALL' | 'LOW_STOCK' | 'OUT_OF_STOCK'>('LOW_STOCK')
  const [supplierFilter, setSupplierFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [loadingList, setLoadingList] = useState(false)

  // Order Quantities inside Purchase List
  const [orderQtys, setOrderQtys] = useState<Record<string, number>>({})

  // Current Order Builder State
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('')
  const [supplierNameInput, setSupplierNameInput] = useState<string>('')
  const [expectedDateInput, setExpectedDateInput] = useState<string>('')
  const [orderNotes, setOrderNotes] = useState<string>('')
  const [orderItems, setOrderItems] = useState<OrderItemInput[]>([])

  // Manual Product Search in Builder
  const [manualSearch, setManualSearch] = useState('')
  const [manualResults, setManualResults] = useState<PurchaseListItem[]>([])

  // History State
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [historyFilter, setHistoryFilter] = useState<string>('')
  const [loadingOrders, setLoadingOrders] = useState(false)

  // Modals & UI Feedback
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null)
  const [printModalOrder, setPrintModalOrder] = useState<PurchaseOrder | null>(null)
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null)

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setStatusMessage({ text, type })
    setTimeout(() => setStatusMessage(null), 4000)
  }

  // Load Suppliers
  useEffect(() => {
    if (!token) return
    request<Supplier[]>('/suppliers', token)
      .then((data) => setSuppliers(data))
      .catch(() => {})
  }, [token])

  // Load Purchase List
  const loadPurchaseList = () => {
    if (!token) return
    setLoadingList(true)
    const params = new URLSearchParams()
    if (listFilter !== 'ALL') params.set('filter', listFilter)
    if (supplierFilter) params.set('supplierId', supplierFilter)
    if (searchQuery) params.set('search', searchQuery)

    request<PurchaseListItem[]>(`/purchase-orders/purchase-list?${params.toString()}`, token)
      .then((items) => {
        setPurchaseList(items)
        // Set default order quantities to suggestedQuantity if > 0
        const initialQtys: Record<string, number> = {}
        items.forEach((item) => {
          initialQtys[item.id] = item.suggestedQuantity > 0 ? item.suggestedQuantity : 10
        })
        setOrderQtys((prev) => ({ ...initialQtys, ...prev }))
      })
      .catch((err) => showToast(err.message, 'error'))
      .finally(() => setLoadingList(false))
  }

  useEffect(() => {
    loadPurchaseList()
  }, [token, listFilter, supplierFilter, searchQuery])

  // Load Orders History
  const loadOrders = () => {
    if (!token) return
    setLoadingOrders(true)
    const params = new URLSearchParams()
    if (historyFilter) params.set('status', historyFilter)

    request<{ items: PurchaseOrder[] }>(`/purchase-orders?${params.toString()}`, token)
      .then((res) => setOrders(res.items))
      .catch((err) => showToast(err.message, 'error'))
      .finally(() => setLoadingOrders(false))
  }

  useEffect(() => {
    if (activeTab === 'HISTORY') {
      loadOrders()
    }
  }, [token, activeTab, historyFilter])

  // Search manual products
  useEffect(() => {
    if (!token || !manualSearch.trim()) {
      setManualResults([])
      return
    }
    const timer = setTimeout(() => {
      request<PurchaseListItem[]>(`/purchase-orders/purchase-list?search=${encodeURIComponent(manualSearch.trim())}`, token)
        .then((items) => setManualResults(items))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [token, manualSearch])

  // Add Item to Current Order Builder (With duplicate protection)
  const addItemToOrder = (item: PurchaseListItem, customQty?: number) => {
    const qty = customQty ?? orderQtys[item.id] ?? (item.suggestedQuantity > 0 ? item.suggestedQuantity : 10)
    const unitPrice = item.latestPurchasePrice ?? item.productPurchasePrice ?? 0

    setOrderItems((prev) => {
      const existingIndex = prev.findIndex((i) => i.productId === item.id)
      if (existingIndex >= 0) {
        // Increase existing quantity instead of creating duplicate line
        const updated = [...prev]
        updated[existingIndex] = {
          ...updated[existingIndex]!,
          quantity: updated[existingIndex]!.quantity + qty,
        }
        showToast(`Increased quantity for ${item.name} to ${updated[existingIndex]!.quantity}`)
        return updated
      } else {
        showToast(`Added ${item.name} (${qty} pcs) to order`)
        return [
          ...prev,
          {
            productId: item.id,
            productName: item.name,
            genericName: item.genericName,
            brand: item.brand,
            quantity: qty,
            unitPrice,
          },
        ]
      }
    })

    // Auto-select supplier if none selected
    if (!selectedSupplierId && item.supplierId) {
      setSelectedSupplierId(item.supplierId)
      setSupplierNameInput(item.supplierName)
    } else if (!supplierNameInput && item.supplierName && item.supplierName !== 'Supplier not assigned') {
      setSupplierNameInput(item.supplierName)
    }
  }

  // Remove Item from Order
  const removeItemFromOrder = (productId: string) => {
    setOrderItems((prev) => prev.filter((i) => i.productId !== productId))
  }

  // Update Item in Order
  const updateOrderItem = (productId: string, updates: Partial<OrderItemInput>) => {
    setOrderItems((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, ...updates } : i)),
    )
  }

  // Estimated Totals
  const orderSummary = useMemo(() => {
    const totalQty = orderItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
    const totalAmount = orderItems.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
      0,
    )
    return {
      totalItems: orderItems.length,
      totalQty,
      totalAmount,
    }
  }, [orderItems])

  // Save / Submit Order
  const handleSaveOrder = async (status: 'DRAFT' | 'ORDERED') => {
    if (!token) return
    const supplierName = supplierNameInput.trim() || suppliers.find((s) => s.id === selectedSupplierId)?.name
    if (!supplierName) {
      showToast('Please specify a supplier name or select a supplier', 'error')
      return
    }
    if (orderItems.length === 0) {
      showToast('Please add at least one product to the order', 'error')
      return
    }

    try {
      if (editingDraftId) {
        // Update existing draft
        await request(`/purchase-orders/${editingDraftId}`, token, {
          method: 'PATCH',
          body: JSON.stringify({
            supplier: supplierName,
            supplierId: selectedSupplierId || null,
            expectedDate: expectedDateInput || null,
            notes: orderNotes,
            items: orderItems.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              notes: i.notes,
            })),
          }),
        })

        if (status === 'ORDERED') {
          await request(`/purchase-orders/${editingDraftId}/status`, token, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'ORDERED' }),
          })
        }
        showToast(status === 'ORDERED' ? 'Purchase order marked as ORDERED!' : 'Draft purchase order updated!')
      } else {
        // Create new purchase order
        const created = await request<PurchaseOrder>('/purchase-orders', token, {
          method: 'POST',
          headers: {
            'Idempotency-Key': `po-${Date.now()}-${Math.random()}`,
          },
          body: JSON.stringify({
            supplier: supplierName,
            supplierId: selectedSupplierId || null,
            expectedDate: expectedDateInput || null,
            notes: orderNotes,
            items: orderItems.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              notes: i.notes,
            })),
          }),
        })

        if (status === 'ORDERED') {
          await request(`/purchase-orders/${created.id}/status`, token, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'ORDERED' }),
          })
        }
        showToast(status === 'ORDERED' ? 'Purchase order created and marked ORDERED!' : 'Purchase order draft saved!')
      }

      // Reset builder
      clearCurrentOrder()
      setActiveTab('HISTORY')
      loadOrders()
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  const clearCurrentOrder = () => {
    setOrderItems([])
    setSelectedSupplierId('')
    setSupplierNameInput('')
    setExpectedDateInput('')
    setOrderNotes('')
    setEditingDraftId(null)
  }

  // Edit draft from history
  const editDraftOrder = (order: PurchaseOrder) => {
    if (order.status !== 'DRAFT') {
      showToast('Only DRAFT orders can be edited', 'error')
      return
    }
    setEditingDraftId(order.id)
    setSelectedSupplierId(order.supplierId || '')
    setSupplierNameInput(order.supplier)
    setExpectedDateInput(order.expectedDate ? order.expectedDate.slice(0, 10) : '')
    setOrderNotes(order.notes || '')
    setOrderItems(
      order.items.map((i) => ({
        productId: i.productId,
        productName: i.product.name,
        genericName: i.product.genericName,
        brand: i.product.brand,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice) || 0,
        notes: i.notes || undefined,
      })),
    )
    setActiveTab('BUILDER')
    showToast(`Loaded draft #${order.orderNumber} for editing`)
  }

  // Reorder from history
  const handleReorder = async (orderId: string) => {
    if (!token) return
    try {
      const newOrder = await request<PurchaseOrder>(`/purchase-orders/${orderId}/reorder`, token, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `reorder-${Date.now()}-${Math.random()}`,
        },
      })
      showToast(`Created new draft order #${newOrder.orderNumber} from historical order!`)
      loadOrders()
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  // Cancel order
  const handleCancelOrder = async (orderId: string) => {
    if (!token) return
    const reason = window.prompt('Enter cancellation reason (optional):')
    if (reason === null) return

    try {
      await request(`/purchase-orders/${orderId}/cancel`, token, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      showToast('Purchase order cancelled')
      loadOrders()
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  // Generate WhatsApp text
  const getOrderWhatsAppText = (order: PurchaseOrder | { supplier: string; orderNumber?: string; items: OrderItemInput[]; totalQuantity?: number; totalAmount?: number; notes?: string }) => {
    const itemsList = 'items' in order && order.items.length > 0 && 'productName' in order.items[0]!
      ? (order.items as OrderItemInput[]).map((i, idx) => `${idx + 1}. ${i.productName} - ${i.quantity} pcs${i.notes ? ` (${i.notes})` : ''}`)
      : (order as PurchaseOrder).items.map((i, idx) => `${idx + 1}. ${i.product.name} - ${i.quantity} pcs${i.notes ? ` (${i.notes})` : ''}`)

    const totalQty = order.totalQuantity ?? (order.items as any[]).reduce((s, i) => s + i.quantity, 0)
    const totalVal = order.totalAmount ? `\nEst. Value: ${formatMoney(order.totalAmount)}` : ''
    const notesText = order.notes ? `\nNotes: ${order.notes}` : ''

    return [
      `*Order for ${order.supplier}*`,
      `PO#: ${order.orderNumber || 'Draft'} | Date: ${new Date().toISOString().slice(0, 10)}`,
      '',
      ...itemsList,
      '',
      `Total Items: ${order.items.length} | Total Qty: ${totalQty}${totalVal}${notesText}`,
    ].join('\n')
  }

  // Copy text to clipboard
  const copyOrderText = (order: any) => {
    const text = getOrderWhatsAppText(order)
    navigator.clipboard.writeText(text).then(
      () => showToast('Order details copied to clipboard! (WhatsApp friendly)'),
      () => showToast('Could not copy to clipboard', 'error'),
    )
  }

  // Open WhatsApp URL
  const openWhatsApp = (order: PurchaseOrder | { supplier: string; items: OrderItemInput[]; supplierId?: string }) => {
    const text = getOrderWhatsAppText(order as any)
    const supplier = suppliers.find((s) => s.id === (order as any).supplierId)
    const phone = supplier?.phone ? supplier.phone.replace(/\D/g, '') : ''
    const encoded = encodeURIComponent(text)

    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank')
    } else {
      window.open(`https://wa.me/?text=${encoded}`, '_blank')
      showToast('Supplier phone not found. WhatsApp opened with order message; select contact.', 'success')
    }
  }

  return (
    <div className="page-shell">
      {statusMessage && (
        <div className={`notification-toast ${statusMessage.type === 'error' ? 'toast-error' : 'toast-success'}`}>
          {statusMessage.text}
        </div>
      )}

      <header className="page-header flex-between">
        <div>
          <p className="eyebrow">PROCUREMENT & REORDERING</p>
          <h1>Purchase Orders & Stock Checker</h1>
          <p className="subtitle">
            Smart reorder suggestions, WhatsApp ordering, supplier grouping, and purchase order tracking.
          </p>
        </div>
        <div className="tab-buttons">
          <button
            className={`btn ${activeTab === 'PURCHASE_LIST' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveTab('PURCHASE_LIST')}
          >
            📋 Purchase List / Stock Checker ({purchaseList.length})
          </button>
          <button
            className={`btn ${activeTab === 'BUILDER' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveTab('BUILDER')}
          >
            🛒 Order Builder ({orderItems.length})
          </button>
          <button
            className={`btn ${activeTab === 'HISTORY' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setActiveTab('HISTORY')}
          >
            📜 Order History
          </button>
        </div>
      </header>

      {/* TAB 1: PURCHASE LIST / STOCK CHECKER */}
      {activeTab === 'PURCHASE_LIST' && (
        <section className="panel">
          <div className="filter-bar">
            <div className="search-field">
              <input
                type="text"
                placeholder="Search products by name, generic, brand, barcode, SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="filter-controls">
              <select
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value as any)}
                className="select-input"
              >
                <option value="LOW_STOCK">⚠️ Low Stock & Out of Stock</option>
                <option value="OUT_OF_STOCK">🚨 Out of Stock Only</option>
                <option value="ALL">📦 All Products</option>
              </select>

              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="select-input"
              >
                <option value="">All Suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <button className="btn btn-outline" onClick={loadPurchaseList}>
                🔄 Refresh
              </button>
            </div>
          </div>

          {loadingList ? (
            <div className="loading-state">Loading purchase list...</div>
          ) : purchaseList.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">All products are currently above reorder level.</p>
              <p className="empty-subtitle">Switch filter to "All Products" to manually add items to a purchase order.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product & Details</th>
                    <th>Supplier</th>
                    <th>Stock / Reorder / Max</th>
                    <th>Status</th>
                    <th>Purchase History</th>
                    <th>Suggested Qty</th>
                    <th>Order Qty</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseList.map((item) => {
                    const currentQty = orderQtys[item.id] ?? (item.suggestedQuantity > 0 ? item.suggestedQuantity : 10)
                    const isSelected = orderItems.some((i) => i.productId === item.id)

                    return (
                      <tr key={item.id} className={isSelected ? 'row-selected' : ''}>
                        <td>
                          <strong>{item.name}</strong>
                          {item.genericName && <div className="text-muted text-small">{item.genericName}</div>}
                          {item.brand && <span className="tag tag-sm">{item.brand}</span>}
                          {item.barcode && <span className="text-muted text-small"> | Barcode: {item.barcode}</span>}
                        </td>
                        <td>
                          <span className="badge badge-neutral">{item.supplierName}</span>
                        </td>
                        <td>
                          <div>
                            <strong>Stock: {item.currentStock}</strong>
                          </div>
                          <div className="text-small text-muted">
                            Reorder: {item.reorderLevel} | Max: {item.maxStock ?? '—'}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              item.stockStatus === 'OUT_OF_STOCK'
                                ? 'badge-danger'
                                : item.stockStatus === 'LOW_STOCK'
                                ? 'badge-warning'
                                : 'badge-success'
                            }`}
                          >
                            {item.stockStatus === 'OUT_OF_STOCK'
                              ? 'OUT OF STOCK'
                              : item.stockStatus === 'LOW_STOCK'
                              ? 'LOW STOCK'
                              : 'NORMAL'}
                          </span>
                        </td>
                        <td>
                          <div>
                            Latest: <strong>{formatMoney(item.latestPurchasePrice)}</strong>
                          </div>
                          {item.previousPurchasePrice && (
                            <div className="text-small text-muted">
                              Prev: {formatMoney(item.previousPurchasePrice)}
                            </div>
                          )}
                          {item.lastPurchaseDate && (
                            <div className="text-small text-muted">Date: {formatDate(item.lastPurchaseDate)}</div>
                          )}
                        </td>
                        <td>
                          <span className="suggested-tag">{item.suggestedQuantity}</span>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            value={currentQty}
                            onChange={(e) =>
                              setOrderQtys((prev) => ({
                                ...prev,
                                [item.id]: Math.max(1, parseInt(e.target.value, 10) || 1),
                              }))
                            }
                            className="qty-input"
                          />
                        </td>
                        <td>
                          <button
                            className={`btn btn-sm ${isSelected ? 'btn-secondary' : 'btn-primary'}`}
                            onClick={() => addItemToOrder(item)}
                          >
                            {isSelected ? '✓ Added (+)' : '+ Add to Order'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: CURRENT ORDER BUILDER */}
      {activeTab === 'BUILDER' && (
        <div className="builder-layout">
          <section className="panel builder-main">
            <h2>{editingDraftId ? `Edit Draft Purchase Order` : `Create Purchase Order`}</h2>

            <div className="form-grid">
              <div className="form-group">
                <label>Select Supplier</label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => {
                    const id = e.target.value
                    setSelectedSupplierId(id)
                    const s = suppliers.find((sup) => sup.id === id)
                    if (s) setSupplierNameInput(s.name)
                  }}
                  className="select-input"
                >
                  <option value="">-- Choose Existing Supplier --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.phone ? `(${s.phone})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Supplier / Distributor Name (or Custom)</label>
                <input
                  type="text"
                  placeholder="e.g. Mahavir Pharma / Distributor A"
                  value={supplierNameInput}
                  onChange={(e) => setSupplierNameInput(e.target.value)}
                  className="text-input"
                  required
                />
              </div>

              <div className="form-group">
                <label>Expected Delivery Date (Optional)</label>
                <input
                  type="date"
                  value={expectedDateInput}
                  onChange={(e) => setExpectedDateInput(e.target.value)}
                  className="text-input"
                />
              </div>

              <div className="form-group">
                <label>Order Notes / Special Instructions</label>
                <input
                  type="text"
                  placeholder="e.g. Urgent morning dispatch / Check batch expiry"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  className="text-input"
                />
              </div>
            </div>

            {/* Manual Product Search & Add */}
            <div className="manual-add-box">
              <h3>🔍 Search & Add Products Manually</h3>
              <input
                type="text"
                placeholder="Type product name, generic, brand, barcode, SKU..."
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
                className="text-input"
              />
              {manualResults.length > 0 && (
                <div className="search-dropdown">
                  {manualResults.map((p) => (
                    <div key={p.id} className="search-result-item" onClick={() => { addItemToOrder(p); setManualSearch(''); setManualResults([]); }}>
                      <div>
                        <strong>{p.name}</strong> {p.genericName && <span className="text-muted">({p.genericName})</span>}
                        <div className="text-small text-muted">Stock: {p.currentStock} | Price: {formatMoney(p.latestPurchasePrice ?? p.productPurchasePrice)}</div>
                      </div>
                      <button className="btn btn-sm btn-primary">+ Add</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Items Table */}
            <h3>Order Items ({orderItems.length})</h3>
            {orderItems.length === 0 ? (
              <div className="empty-box">
                <p>No products in current order.</p>
                <p className="text-muted">Add products from the Purchase List or search manually above.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product</th>
                      <th>Quantity</th>
                      <th>Est. Unit Price (₹)</th>
                      <th>Est. Line Total (₹)</th>
                      <th>Notes</th>
                      <th>Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderItems.map((item, idx) => {
                      const lineTotal = item.quantity * item.unitPrice
                      return (
                        <tr key={item.productId}>
                          <td>{idx + 1}</td>
                          <td>
                            <strong>{item.productName}</strong>
                            {item.genericName && <div className="text-muted text-small">{item.genericName}</div>}
                          </td>
                          <td>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) =>
                                updateOrderItem(item.productId, {
                                  quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                                })
                              }
                              className="qty-input"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) =>
                                updateOrderItem(item.productId, {
                                  unitPrice: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="qty-input"
                            />
                          </td>
                          <td>
                            <strong>{formatMoney(lineTotal)}</strong>
                          </td>
                          <td>
                            <input
                              type="text"
                              placeholder="e.g. 500mg strip"
                              value={item.notes || ''}
                              onChange={(e) => updateOrderItem(item.productId, { notes: e.target.value })}
                              className="text-input text-small"
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => removeItemFromOrder(item.productId)}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Sticky Summary & Actions Sidebar */}
          <aside className="panel builder-summary">
            <h3>Order Summary</h3>
            <div className="summary-card">
              <div className="summary-row">
                <span>Supplier:</span>
                <strong>{supplierNameInput || 'Not specified'}</strong>
              </div>
              <div className="summary-row">
                <span>Total Items:</span>
                <strong>{orderSummary.totalItems}</strong>
              </div>
              <div className="summary-row">
                <span>Total Quantity:</span>
                <strong>{orderSummary.totalQty} pcs</strong>
              </div>
              <div className="summary-row total-highlight">
                <span>Estimated Value:</span>
                <strong>{formatMoney(orderSummary.totalAmount)}</strong>
              </div>
            </div>

            <div className="builder-actions-stack">
              <button
                className="btn btn-success btn-block"
                onClick={() => handleSaveOrder('ORDERED')}
                disabled={orderItems.length === 0}
              >
                🚀 Mark as ORDERED
              </button>

              <button
                className="btn btn-primary btn-block"
                onClick={() => handleSaveOrder('DRAFT')}
                disabled={orderItems.length === 0}
              >
                💾 Save as Draft
              </button>

              <button
                className="btn btn-outline btn-block"
                onClick={() => copyOrderText({ supplier: supplierNameInput || 'Supplier', items: orderItems, notes: orderNotes })}
                disabled={orderItems.length === 0}
              >
                📋 Copy WhatsApp Text
              </button>

              <button
                className="btn btn-outline btn-block"
                onClick={() => openWhatsApp({ supplier: supplierNameInput || 'Supplier', supplierId: selectedSupplierId, items: orderItems, notes: orderNotes })}
                disabled={orderItems.length === 0}
              >
                💬 Send via WhatsApp
              </button>

              <button
                className="btn btn-outline btn-block"
                onClick={() =>
                  setPrintModalOrder({
                    id: 'preview',
                    orderNumber: 'PREVIEW-PO',
                    supplier: supplierNameInput || 'Supplier',
                    supplierId: selectedSupplierId || null,
                    status: 'DRAFT',
                    orderDate: new Date().toISOString(),
                    expectedDate: expectedDateInput || null,
                    totalAmount: orderSummary.totalAmount,
                    totalQuantity: orderSummary.totalQty,
                    notes: orderNotes || null,
                    createdAt: new Date().toISOString(),
                    items: orderItems.map((i) => ({
                      id: i.productId,
                      productId: i.productId,
                      quantity: i.quantity,
                      unitPrice: i.unitPrice,
                      notes: i.notes || null,
                      product: {
                        name: i.productName,
                        genericName: i.genericName || null,
                        brand: i.brand || null,
                        sku: null,
                        barcode: null,
                      },
                    })),
                  })
                }
                disabled={orderItems.length === 0}
              >
                🖨️ Print Preview
              </button>

              <button className="btn btn-danger-outline btn-block" onClick={clearCurrentOrder}>
                🗑️ Clear Order List
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* TAB 3: ORDER HISTORY */}
      {activeTab === 'HISTORY' && (
        <section className="panel">
          <div className="filter-bar">
            <div className="filter-controls">
              <select
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
                className="select-input"
              >
                <option value="">All Statuses</option>
                <option value="DRAFT">DRAFT</option>
                <option value="ORDERED">ORDERED</option>
                <option value="PARTIALLY_RECEIVED">PARTIALLY_RECEIVED</option>
                <option value="RECEIVED">RECEIVED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
              <button className="btn btn-outline" onClick={loadOrders}>
                🔄 Refresh History
              </button>
            </div>
          </div>

          {loadingOrders ? (
            <div className="loading-state">Loading purchase orders...</div>
          ) : orders.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">No purchase orders yet.</p>
              <p className="empty-subtitle">Use the Purchase List or Order Builder to create an order.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>PO Number</th>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th>Items / Qty</th>
                    <th>Est. Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((po) => (
                    <tr key={po.id}>
                      <td>
                        <strong>{po.orderNumber}</strong>
                        {po.notes && <div className="text-muted text-small">{po.notes}</div>}
                      </td>
                      <td>{formatDate(po.orderDate || po.createdAt)}</td>
                      <td>
                        <strong>{po.supplier}</strong>
                        {po.supplierRel?.phone && (
                          <div className="text-small text-muted">📞 {po.supplierRel.phone}</div>
                        )}
                      </td>
                      <td>
                        {po.items.length} items ({po.totalQuantity ?? '—'} pcs)
                      </td>
                      <td>
                        <strong>{formatMoney(po.totalAmount)}</strong>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            po.status === 'RECEIVED'
                              ? 'badge-success'
                              : po.status === 'ORDERED'
                              ? 'badge-primary'
                              : po.status === 'DRAFT'
                              ? 'badge-neutral'
                              : po.status === 'CANCELLED'
                              ? 'badge-danger'
                              : 'badge-warning'
                          }`}
                        >
                          {po.status}
                        </span>
                      </td>
                      <td>
                        <div className="btn-group">
                          <button
                            className="btn btn-sm btn-outline"
                            title="View / Print Details"
                            onClick={() => setViewingOrder(po)}
                          >
                            👁️ View
                          </button>

                          {po.status === 'DRAFT' && (
                            <button
                              className="btn btn-sm btn-primary"
                              title="Edit Draft"
                              onClick={() => editDraftOrder(po)}
                            >
                              ✏️ Edit
                            </button>
                          )}

                          <button
                            className="btn btn-sm btn-secondary"
                            title="Reorder this order"
                            onClick={() => handleReorder(po.id)}
                          >
                            🔁 Reorder
                          </button>

                          <button
                            className="btn btn-sm btn-outline"
                            title="Copy WhatsApp Text"
                            onClick={() => copyOrderText(po)}
                          >
                            📋 Copy
                          </button>

                          <button
                            className="btn btn-sm btn-outline"
                            title="Send via WhatsApp"
                            onClick={() => openWhatsApp(po)}
                          >
                            💬 WA
                          </button>

                          {po.status !== 'CANCELLED' && po.status !== 'RECEIVED' && (
                            <button
                              className="btn btn-sm btn-danger-outline"
                              title="Cancel Order"
                              onClick={() => handleCancelOrder(po.id)}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* DETAIL MODAL */}
      {viewingOrder && (
        <div className="modal-overlay" onClick={() => setViewingOrder(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Purchase Order #{viewingOrder.orderNumber}</h2>
              <button className="btn-close" onClick={() => setViewingOrder(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="modal-info-grid">
                <div><strong>Supplier:</strong> {viewingOrder.supplier}</div>
                <div><strong>Status:</strong> <span className="badge">{viewingOrder.status}</span></div>
                <div><strong>Date:</strong> {formatDate(viewingOrder.orderDate || viewingOrder.createdAt)}</div>
                <div><strong>Est. Total:</strong> {formatMoney(viewingOrder.totalAmount)}</div>
                {viewingOrder.notes && <div className="span-full"><strong>Notes:</strong> {viewingOrder.notes}</div>}
              </div>

              <h3>Ordered Products ({viewingOrder.items.length})</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Unit Rate</th>
                    <th>Line Total</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingOrder.items.map((it) => (
                    <tr key={it.id}>
                      <td>
                        <strong>{it.product.name}</strong>
                        {it.product.genericName && <div className="text-muted text-small">{it.product.genericName}</div>}
                      </td>
                      <td>{it.quantity} pcs</td>
                      <td>{formatMoney(it.unitPrice)}</td>
                      <td>{formatMoney((it.unitPrice ?? 0) * it.quantity)}</td>
                      <td>{it.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => copyOrderText(viewingOrder)}>📋 Copy Text</button>
              <button className="btn btn-outline" onClick={() => openWhatsApp(viewingOrder)}>💬 Send WhatsApp</button>
              <button className="btn btn-primary" onClick={() => { setPrintModalOrder(viewingOrder); setViewingOrder(null); }}>🖨️ Print</button>
              <button className="btn btn-secondary" onClick={() => setViewingOrder(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* PRINT MODAL */}
      {printModalOrder && (
        <div className="modal-overlay" onClick={() => setPrintModalOrder(null)}>
          <div className="modal-card print-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="print-header">
              <div>
                <h1>PHARMORA PHARMACY</h1>
                <p className="text-muted">Purchase Order / Reorder Sheet</p>
              </div>
              <div className="text-right">
                <h2>PO#: {printModalOrder.orderNumber}</h2>
                <p>Date: {formatDate(printModalOrder.orderDate || printModalOrder.createdAt)}</p>
                <p>Status: {printModalOrder.status}</p>
              </div>
            </div>

            <div className="print-supplier-box">
              <strong>Supplier / Distributor:</strong> {printModalOrder.supplier}
              {printModalOrder.expectedDate && <div><strong>Expected By:</strong> {formatDate(printModalOrder.expectedDate)}</div>}
              {printModalOrder.notes && <div><strong>Notes:</strong> {printModalOrder.notes}</div>}
            </div>

            <table className="print-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item Name & Generic</th>
                  <th>Quantity</th>
                  <th>Est. Rate (₹)</th>
                  <th>Est. Amount (₹)</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {printModalOrder.items.map((it, idx) => (
                  <tr key={it.id || idx}>
                    <td>{idx + 1}</td>
                    <td>
                      <strong>{it.product.name}</strong>
                      {it.product.genericName && <div className="text-muted text-small">{it.product.genericName}</div>}
                    </td>
                    <td><strong>{it.quantity}</strong></td>
                    <td>{it.unitPrice ? Number(it.unitPrice).toFixed(2) : '—'}</td>
                    <td>{it.unitPrice ? (Number(it.unitPrice) * it.quantity).toFixed(2) : '—'}</td>
                    <td>{it.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}><strong>Total:</strong></td>
                  <td><strong>{printModalOrder.totalQuantity ?? printModalOrder.items.reduce((s, i) => s + i.quantity, 0)} pcs</strong></td>
                  <td></td>
                  <td><strong>{formatMoney(printModalOrder.totalAmount)}</strong></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>

            <div className="print-footer">
              <div className="sign-box">Prepared By</div>
              <div className="sign-box">Authorized Signature</div>
            </div>

            <div className="modal-footer no-print">
              <button className="btn btn-primary" onClick={() => window.print()}>🖨️ Print Sheet</button>
              <button className="btn btn-secondary" onClick={() => setPrintModalOrder(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

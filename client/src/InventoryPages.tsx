import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import './inventory.css'
import { createUUID } from './utils/uuid'

type SessionProps = {
  token: string
  onSignIn: (token: string) => void
  onSignOut: () => void
}

type Category = { id: string; name: string; active: boolean; _count?: { products: number } }
type Product = {
  id: string
  name: string
  genericName: string | null
  brand: string | null
  barcode: string | null
  sku: string | null
  hsn: string | null
  gst: string | null
  mrp: string | null
  sellingPrice: string | null
  purchasePrice: string | null
  minStock: number
  maxStock: number | null
  reorderLevel: number
  rackLocation: string | null
  categoryId: string | null
  category: Category | null
  active: boolean
}

type InventoryItem = Product & {
  totalStock: number
  availableStock: number
  stockStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'NORMAL'
  suggestedReorderQuantity: number
  nearestExpiry: string | null
  batchCount: number
  expiryStatuses: string[]
}

type InventoryResponse = {
  items: InventoryItem[]
  pagination: { page: number; pageSize: number; total: number; pages: number }
  businessDate: string
}

type Batch = {
  id: string
  batchNumber: string
  purchaseDate: string | null
  expiryDate: string | null
  purchaseRate: string
  mrp: string | null
  sellingPrice: string | null
  gst: string | null
  quantity: number
  freeQuantity: number
  expiryStatus?: string
}

type Movement = {
  id: string
  quantity: number
  beforeQty: number | null
  afterQty: number | null
  movementType: string
  reason: string | null
  createdAt: string
  createdBy?: { name: string } | null
  batch?: { batchNumber: string } | null
}

type StockSummary = Product & {
  totalStock: number
  availableStock: number
  stockStatus: InventoryItem['stockStatus']
  suggestedReorderQuantity: number
  nearestExpiry: string | null
  batchCount: number
  expiredBatchCount: number
  batches: Batch[]
  stockMovements: Movement[]
}

type FefoResult = { allocations: Array<{ quantity: number; batch: Batch }>; totalAvailable: number }

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

function SignIn({ onSignIn }: Pick<SessionProps, 'onSignIn'>) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await response.json()
      if (!response.ok || !body.token) throw new Error(body.message ?? 'Sign in failed')
      onSignIn(body.token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel inventory-auth">
      <p className="eyebrow">SECURE ACCESS</p>
      <h2>Sign in to manage inventory</h2>
      <form className="inventory-form" onSubmit={submit}>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <p className="inventory-error" role="alert">{error}</p>}
        <button className="primary-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  )
}

function PageTop({ title, token, onSignOut, right }: { title: string; token: string; onSignOut: () => void; right?: React.ReactNode }) {
  return (
    <header className="page-header inventory-header" data-authenticated={Boolean(token)}>
      <div><p className="eyebrow">PHARMORA POS / INVENTORY</p><h1>{title}</h1></div>
      <div className="inventory-header-actions">{right}<button className="icon-text-btn" type="button" onClick={onSignOut}>Sign out</button></div>
    </header>
  )
}

function Money({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined) return <>—</>
  return <>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value))}</>
}

function Status({ value }: { value: string }) {
  const tone = value === 'NORMAL' || value === 'SAFE' || value === 'ACTIVE' ? 'success' : value === 'LOW_STOCK' || value.startsWith('DAYS_') ? 'warning' : 'danger'
  const label = value === 'NORMAL' ? 'Normal' : value === 'OUT_OF_STOCK' ? 'Out of stock' : value === 'LOW_STOCK' ? 'Low stock' : value.replaceAll('_', ' ')
  return <span className={`badge ${tone}`}>{label}</span>
}

const emptyProduct = {
  name: '', genericName: '', brand: '', barcode: '', sku: '', hsn: '', gst: '', mrp: '', sellingPrice: '', purchasePrice: '',
  minStock: '0', maxStock: '', reorderLevel: '0', rackLocation: '', categoryId: '',
}

type ProductDraft = typeof emptyProduct

export function ProductsPage(props: SessionProps) {
  const { token, onSignIn, onSignOut } = props
  const [items, setItems] = useState<InventoryItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [activeFilter, setActiveFilter] = useState('true')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [draft, setDraft] = useState<ProductDraft>(emptyProduct)
  const [editingId, setEditingId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function load() {
    const query = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (search) query.set('search', search)
    if (categoryId) query.set('categoryId', categoryId)
    if (activeFilter) query.set('active', activeFilter)
    const [inventory, categoryRows] = await Promise.all([
      request<InventoryResponse>(`/inventory?${query}`, token),
      request<Category[]>('/categories?active=true', token),
    ])
    setItems(inventory.items)
    setPages(Math.max(1, inventory.pagination.pages))
    setCategories(categoryRows)
  }

  useEffect(() => {
    if (!token) return
    let active = true
    load().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load products') })
    return () => { active = false }
  }, [token, search, categoryId, activeFilter, page])

  function startCreate() {
    setEditingId('')
    setDraft(emptyProduct)
    setShowForm(true)
    setError('')
  }

  function startEdit(item: InventoryItem) {
    setEditingId(item.id)
    setDraft({
      name: item.name,
      genericName: item.genericName ?? '',
      brand: item.brand ?? '',
      barcode: item.barcode ?? '',
      sku: item.sku ?? '',
      hsn: item.hsn ?? '',
      gst: item.gst ?? '',
      mrp: item.mrp ?? '',
      sellingPrice: item.sellingPrice ?? '',
      purchasePrice: item.purchasePrice ?? '',
      minStock: String(item.minStock),
      maxStock: item.maxStock === null ? '' : String(item.maxStock),
      reorderLevel: String(item.reorderLevel),
      rackLocation: item.rackLocation ?? '',
      categoryId: item.categoryId ?? '',
    })
    setShowForm(true)
    setError('')
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const optionalMoney = (value: string) => value.trim() || undefined
    try {
      const payload = {
        ...draft,
        barcode: draft.barcode || undefined,
        sku: draft.sku || undefined,
        categoryId: draft.categoryId || undefined,
        gst: optionalMoney(draft.gst),
        mrp: optionalMoney(draft.mrp),
        sellingPrice: optionalMoney(draft.sellingPrice),
        purchasePrice: optionalMoney(draft.purchasePrice),
        minStock: Number(draft.minStock),
        maxStock: draft.maxStock ? Number(draft.maxStock) : undefined,
        reorderLevel: Number(draft.reorderLevel),
      }
      await request(editingId ? `/products/${editingId}` : '/products', token, {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
      setShowForm(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save product')
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(item: InventoryItem) {
    setError('')
    try {
      await request(`/products/${item.id}/active`, token, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update product status')
    }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    try {
      await request('/categories', token, { method: 'POST', body: JSON.stringify({ name: categoryName }) })
      setCategoryName('')
      setShowCategoryForm(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create category')
    }
  }

  if (!token) return <div className="page-shell"><PageTop title="Products" token={token} onSignOut={onSignOut} /><SignIn onSignIn={onSignIn} /></div>

  return (
    <div className="page-shell">
      <PageTop title="Products" token={token} onSignOut={onSignOut} right={<button className="primary-btn" type="button" onClick={startCreate}>Add product</button>} />
      {error && <p className="inventory-error" role="alert">{error}</p>}
      <section className="inventory-toolbar">
        <label className="inventory-search">Search<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Name, generic, brand, barcode, SKU" /></label>
        <label>Category<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1) }}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Status<select value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value); setPage(1) }}><option value="true">Active</option><option value="false">Inactive</option><option value="">All</option></select></label>
        <button className="secondary-btn" type="button" onClick={() => setShowCategoryForm((value) => !value)}>Categories</button>
      </section>
      {showCategoryForm && <form className="category-inline-form" onSubmit={addCategory}><label>New category<input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required minLength={2} /></label><button className="primary-btn">Create category</button></form>}
      {showForm && <section className="panel product-editor"><div className="section-heading"><div><p className="eyebrow">PRODUCT MASTER</p><h2>{editingId ? 'Edit product' : 'New product'}</h2></div><button className="icon-text-btn" type="button" onClick={() => setShowForm(false)}>Cancel</button></div>
        <form className="product-form-grid" onSubmit={saveProduct}>
          <label>Product name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label>
          <label>Generic name<input value={draft.genericName} onChange={(event) => setDraft({ ...draft, genericName: event.target.value })} /></label>
          <label>Brand<input value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
          <label>Category<select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>Barcode<input value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} /></label>
          <label>SKU<input value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} /></label>
          <label>HSN<input value={draft.hsn} onChange={(event) => setDraft({ ...draft, hsn: event.target.value })} /></label>
          <label>GST %<input type="number" min="0" step="0.01" value={draft.gst} onChange={(event) => setDraft({ ...draft, gst: event.target.value })} /></label>
          <label>MRP<input type="number" min="0" step="0.01" value={draft.mrp} onChange={(event) => setDraft({ ...draft, mrp: event.target.value })} /></label>
          <label>Selling price<input type="number" min="0" step="0.01" value={draft.sellingPrice} onChange={(event) => setDraft({ ...draft, sellingPrice: event.target.value })} /></label>
          <label>Purchase price<input type="number" min="0" step="0.01" value={draft.purchasePrice} onChange={(event) => setDraft({ ...draft, purchasePrice: event.target.value })} /></label>
          <label>Minimum stock<input type="number" min="0" step="1" value={draft.minStock} onChange={(event) => setDraft({ ...draft, minStock: event.target.value })} /></label>
          <label>Maximum stock<input type="number" min="0" step="1" value={draft.maxStock} onChange={(event) => setDraft({ ...draft, maxStock: event.target.value })} /></label>
          <label>Reorder level<input type="number" min="0" step="1" value={draft.reorderLevel} onChange={(event) => setDraft({ ...draft, reorderLevel: event.target.value })} /></label>
          <label>Rack / location<input value={draft.rackLocation} onChange={(event) => setDraft({ ...draft, rackLocation: event.target.value })} /></label>
          <div className="product-form-actions"><button className="primary-btn" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button></div>
        </form>
      </section>}
      <section className="panel inventory-table-panel">
        <div className="table-scroll"><table><thead><tr><th>Product</th><th>Category</th><th>Barcode / SKU</th><th>MRP</th><th>Sell</th><th>Stock</th><th>Reorder</th><th>Status</th><th>Active</th><th /></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id}>
            <td><Link className="product-name-link" to={`/products/${item.id}`}>{item.name}</Link><small>{item.genericName ?? '—'}{item.brand ? ` · ${item.brand}` : ''}</small></td>
            <td>{item.category?.name ?? '—'}</td><td><small>{item.barcode ?? '—'}</small><small>{item.sku ?? '—'}</small></td>
            <td><Money value={item.mrp} /></td><td><Money value={item.sellingPrice} /></td><td>{item.totalStock}</td><td>{item.reorderLevel}</td>
            <td><Status value={item.stockStatus} /></td><td><Status value={item.active ? 'ACTIVE' : 'INACTIVE'} /></td>
            <td className="inventory-row-actions"><button type="button" className="text-action" onClick={() => startEdit(item)}>Edit</button><button type="button" className="text-action" onClick={() => void toggleActive(item)}>{item.active ? 'Deactivate' : 'Activate'}</button></td>
          </tr>)}</tbody></table>{items.length === 0 && <p className="empty-state">No products match these filters.</p>}</div>
        <div className="inventory-pagination"><span>{items.length} shown · page {page} of {pages}</span><div><button className="secondary-btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="secondary-btn" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
      </section>
    </div>
  )
}

export function InventoryPage(props: SessionProps) {
  const { token, onSignIn, onSignOut } = props
  const [inventory, setInventory] = useState<InventoryResponse | null>(null)
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('')
  const [expiryStatus, setExpiryStatus] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    let active = true
    const query = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (search) query.set('search', search)
    if (categoryId) query.set('categoryId', categoryId)
    const endpoint = expiryStatus ? `/inventory/expiry?${new URLSearchParams({ ...Object.fromEntries(query), bucket: expiryStatus })}`
      : status === 'LOW_STOCK' ? `/inventory/low-stock?${query}`
        : status === 'OUT_OF_STOCK' ? `/inventory/out-of-stock?${query}`
          : `/inventory?${query}`
    Promise.all([request<InventoryResponse>(endpoint, token), request<Category[]>('/categories?active=true', token)])
      .then(([result, categoryRows]) => { if (active) { setInventory(result); setCategories(categoryRows) } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load inventory') })
    return () => { active = false }
  }, [token, search, categoryId, status, expiryStatus, page])

  if (!token) return <div className="page-shell"><PageTop title="Inventory" token={token} onSignOut={onSignOut} /><SignIn onSignIn={onSignIn} /></div>

  return (
    <div className="page-shell">
      <PageTop title="Inventory" token={token} onSignOut={onSignOut} right={<Link className="secondary-btn" to="/products">Product master</Link>} />
      {error && <p className="inventory-error" role="alert">{error}</p>}
      <section className="inventory-toolbar">
        <label className="inventory-search">Search<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Product, barcode or SKU" /></label>
        <label>Category<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1) }}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Stock<select value={status} onChange={(event) => { setStatus(event.target.value); setExpiryStatus(''); setPage(1) }}><option value="">All stock</option><option value="LOW_STOCK">Low stock</option><option value="OUT_OF_STOCK">Out of stock</option></select></label>
        <label>Expiry<select value={expiryStatus} onChange={(event) => { setExpiryStatus(event.target.value); setStatus(''); setPage(1) }}><option value="">All expiry</option><option value="EXPIRED">Expired</option><option value="DAYS_0_30">0–30 days</option><option value="DAYS_31_60">31–60 days</option><option value="DAYS_61_90">61–90 days</option><option value="DAYS_91_180">91–180 days</option><option value="SAFE">Safe</option></select></label>
      </section>
      <section className="panel inventory-table-panel">
        <div className="table-scroll"><table><thead><tr><th>Product</th><th>Total</th><th>Available</th><th>Reorder</th><th>Status</th><th>Nearest expiry</th><th>Batches</th></tr></thead>
          <tbody>{inventory?.items.map((item) => <tr key={item.id}>
            <td><Link className="product-name-link" to={`/products/${item.id}`}>{item.name}</Link><small>{item.genericName ?? '—'}{item.brand ? ` · ${item.brand}` : ''}</small></td>
            <td>{item.totalStock}</td><td>{item.availableStock}</td><td>{item.reorderLevel}<small>suggested: {item.suggestedReorderQuantity}</small></td>
            <td><Status value={item.stockStatus} /></td><td>{item.nearestExpiry ? new Date(item.nearestExpiry).toLocaleDateString() : '—'}</td><td>{item.batchCount}</td>
          </tr>)}</tbody></table>{inventory?.items.length === 0 && <p className="empty-state">No inventory matches these filters.</p>}</div>
        <div className="inventory-pagination"><span>{inventory?.pagination.total ?? 0} products · page {page} of {inventory?.pagination.pages ?? 1}</span><div><button className="secondary-btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="secondary-btn" disabled={page >= (inventory?.pagination.pages ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
      </section>
    </div>
  )
}

export function ProductDetailPage({ token, onSignIn, onSignOut }: SessionProps) {
  const { id = '' } = useParams()
  const [product, setProduct] = useState<StockSummary | null>(null)
  const [fefo, setFefo] = useState<FefoResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [adjustment, setAdjustment] = useState({ batchId: '', quantityChange: '', reason: 'COUNT_CORRECTION', note: '' })
  const [batchDraft, setBatchDraft] = useState({ batchNumber: '', purchaseDate: '', expiryDate: '', purchaseRate: '', mrp: '', sellingPrice: '', gst: '' })

  async function load() {
    const [summary, fefoResult] = await Promise.all([
      request<StockSummary>(`/inventory/products/${id}/stock-summary`, token),
      request<FefoResult>(`/inventory/products/${id}/fefo`, token),
    ])
    setProduct(summary)
    setFefo(fefoResult)
  }

  useEffect(() => {
    if (!token || !id) return
    let active = true
    load().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load product') })
    return () => { active = false }
  }, [id, token])

  async function saveBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await request('/batches', token, {
        method: 'POST',
        body: JSON.stringify({
          productId: id,
          batchNumber: batchDraft.batchNumber,
          purchaseDate: batchDraft.purchaseDate || undefined,
          expiryDate: batchDraft.expiryDate || undefined,
          purchaseRate: batchDraft.purchaseRate,
          mrp: batchDraft.mrp || undefined,
          sellingPrice: batchDraft.sellingPrice || undefined,
          gst: batchDraft.gst || undefined,
        }),
      })
      setBatchDraft({ batchNumber: '', purchaseDate: '', expiryDate: '', purchaseRate: '', mrp: '', sellingPrice: '', gst: '' })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add batch')
    } finally {
      setBusy(false)
    }
  }

  async function applyAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const change = Number(adjustment.quantityChange)
    if (!change || !Number.isInteger(change)) return setError('Enter a non-zero whole quantity change')
    const confirmation = `Confirm ${change > 0 ? 'adding' : 'removing'} ${Math.abs(change)} units of ${product?.name}? This creates a permanent stock movement.`
    if (!window.confirm(confirmation)) return
    setBusy(true)
    setError('')
    try {
      await request('/inventory/adjustments', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': createUUID() },
        body: JSON.stringify({ ...adjustment, quantityChange: change, productId: id, batchId: adjustment.batchId || undefined }),
      })
      setAdjustment({ batchId: '', quantityChange: '', reason: 'COUNT_CORRECTION', note: '' })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to adjust stock')
    } finally {
      setBusy(false)
    }
  }

  if (!token) return <div className="page-shell"><PageTop title="Product detail" token={token} onSignOut={onSignOut} /><SignIn onSignIn={onSignIn} /></div>
  if (error && !product) return <div className="page-shell"><PageTop title="Product detail" token={token} onSignOut={onSignOut} /><p className="inventory-error" role="alert">{error}</p></div>
  if (!product) return <div className="page-shell"><PageTop title="Product detail" token={token} onSignOut={onSignOut} /><p className="empty-state">Loading product…</p></div>

  return (
    <div className="page-shell">
      <PageTop title={product.name} token={token} onSignOut={onSignOut} right={<Link className="secondary-btn" to="/products">Back to products</Link>} />
      {error && <p className="inventory-error" role="alert">{error}</p>}
      <section className="inventory-summary-grid">
        <div className="metric-card"><span>Current stock</span><strong>{product.totalStock}</strong></div>
        <div className="metric-card"><span>Available stock</span><strong>{product.availableStock}</strong></div>
        <div className="metric-card"><span>Stock status</span><Status value={product.stockStatus} /></div>
        <div className="metric-card"><span>Nearest expiry</span><strong>{product.nearestExpiry ? new Date(product.nearestExpiry).toLocaleDateString() : '—'}</strong></div>
      </section>
      <section className="panel product-facts">
        <div><span>Generic</span><strong>{product.genericName ?? '—'}</strong></div><div><span>Brand</span><strong>{product.brand ?? '—'}</strong></div>
        <div><span>Category</span><strong>{product.category?.name ?? '—'}</strong></div><div><span>Barcode</span><strong>{product.barcode ?? '—'}</strong></div>
        <div><span>SKU</span><strong>{product.sku ?? '—'}</strong></div><div><span>MRP</span><strong><Money value={product.mrp} /></strong></div>
        <div><span>Selling price</span><strong><Money value={product.sellingPrice} /></strong></div><div><span>Reorder level</span><strong>{product.reorderLevel}</strong></div>
      </section>
      <div className="inventory-detail-grid">
        <section className="panel inventory-table-panel"><div className="section-heading"><div><p className="eyebrow">LOT CONTROL</p><h2>Batches</h2></div><span>{product.batches.length} batches</span></div>
          <div className="table-scroll"><table><thead><tr><th>Batch</th><th>Expiry</th><th>Qty</th><th>Free</th><th>Purchase rate</th><th>Status</th></tr></thead><tbody>
            {product.batches.map((batch) => <tr key={batch.id}><td>{batch.batchNumber}</td><td>{batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : '—'}</td><td>{batch.quantity}</td><td>{batch.freeQuantity}</td><td><Money value={batch.purchaseRate} /></td><td><Status value={batch.expiryStatus ?? 'SAFE'} /></td></tr>)}
          </tbody></table>{product.batches.length === 0 && <p className="empty-state">No batches recorded.</p>}</div>
        </section>
        <section className="panel"><p className="eyebrow">FEFO</p><h2>Next batches to consume</h2><div className="fefo-list">{fefo?.allocations.map(({ batch, quantity }, index) => <div className="fefo-row" key={batch.id}><span>{index + 1}. {batch.batchNumber}<small>{batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : 'No expiry'}</small></span><strong>{quantity} units</strong></div>)}</div><p className="quiet-label">Available: {fefo?.totalAvailable ?? 0} units</p></section>
      </div>
      <div className="inventory-detail-grid">
        <section className="panel inventory-table-panel"><p className="eyebrow">HISTORY</p><h2>Stock movements</h2><div className="table-scroll"><table><thead><tr><th>Date</th><th>Movement</th><th>Batch</th><th>Change</th><th>Before → After</th><th>Actor</th></tr></thead><tbody>
          {product.stockMovements.map((movement) => <tr key={movement.id}><td>{new Date(movement.createdAt).toLocaleString()}</td><td>{movement.movementType.replaceAll('_', ' ')}</td><td>{movement.batch?.batchNumber ?? '—'}</td><td>{movement.quantity}</td><td>{movement.beforeQty ?? '—'} → {movement.afterQty ?? '—'}</td><td>{movement.createdBy?.name ?? 'System'}</td></tr>)}
        </tbody></table>{product.stockMovements.length === 0 && <p className="empty-state">No stock movements recorded.</p>}</div></section>
        <aside className="inventory-detail-side">
          <section className="panel"><p className="eyebrow">BATCH FOUNDATION</p><h2>Add batch</h2><form className="inventory-form" onSubmit={saveBatch}>
            <label>Batch number<input value={batchDraft.batchNumber} onChange={(event) => setBatchDraft({ ...batchDraft, batchNumber: event.target.value })} required /></label>
            <label>Purchase rate<input type="number" min="0" step="0.01" value={batchDraft.purchaseRate} onChange={(event) => setBatchDraft({ ...batchDraft, purchaseRate: event.target.value })} required /></label>
            <label>MRP<input type="number" min="0" step="0.01" value={batchDraft.mrp} onChange={(event) => setBatchDraft({ ...batchDraft, mrp: event.target.value })} /></label>
            <label>Expiry date<input type="date" value={batchDraft.expiryDate} onChange={(event) => setBatchDraft({ ...batchDraft, expiryDate: event.target.value })} /></label>
            <button className="secondary-btn" disabled={busy}>Create empty batch</button>
          </form></section>
          <section className="panel"><p className="eyebrow">AUDITED CHANGE</p><h2>Stock adjustment</h2><form className="inventory-form" onSubmit={applyAdjustment}>
            <label>Batch<select value={adjustment.batchId} onChange={(event) => setAdjustment({ ...adjustment, batchId: event.target.value })}><option value="">Automatic batch allocation</option>{product.batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batchNumber} · {batch.quantity} units</option>)}</select></label>
            <label>Quantity change<input type="number" step="1" value={adjustment.quantityChange} onChange={(event) => setAdjustment({ ...adjustment, quantityChange: event.target.value })} placeholder="+ units in, − units out" required /></label>
            <label>Reason<select value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })}><option value="COUNT_CORRECTION">Count correction</option><option value="DAMAGE">Damage</option><option value="EXPIRED">Expired</option><option value="FOUND">Found</option><option value="OTHER">Other</option></select></label>
            <label>Note<input value={adjustment.note} onChange={(event) => setAdjustment({ ...adjustment, note: event.target.value })} required maxLength={250} /></label>
            <button className="primary-btn" disabled={busy}>{busy ? 'Applying…' : 'Review & apply'}</button>
          </form></section>
        </aside>
      </div>
    </div>
  )
}

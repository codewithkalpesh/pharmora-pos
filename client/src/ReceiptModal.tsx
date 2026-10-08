import { useState, useEffect } from 'react'
import './pos.css'
import { API_BASE as apiBase } from './config.js'

export type ReceiptData = {
  store: {
    storeName: string
    tagline?: string
    address: string
    phone: string
    email: string
    gstin?: string
    dlNumber?: string
    fssaiNumber?: string
    receiptFooter: string
    invoiceTerms: string
  }
  sale: {
    id: string
    invoiceNumber: string
    saleDate: string
    saleType: string
    status: string
    cashierName: string
  }
  customer: {
    id?: string
    name: string
    phone?: string | null
    address?: string | null
    outstanding?: number
  }
  items: Array<{
    srNo: number
    productId: string
    productName: string
    brand?: string | null
    genericName?: string | null
    hsn?: string | null
    batchNumber?: string | null
    expiryDate?: string | null
    quantity: number
    unitPrice: number
    mrp?: number | null
    discount: number
    taxableAmount: number
    gstRate: number
    cgstAmount: number
    sgstAmount: number
    totalGst: number
    lineTotal: number
  }>
  totals: {
    itemCount: number
    totalQuantity: number
    subtotal: number
    totalDiscount: number
    taxableAmount: number
    cgstTotal: number
    sgstTotal: number
    totalGst: number
    grandTotal: number
  }
  payment: {
    paymentMethod: string
    paidAmount: number
    cashAmount?: number
    upiAmount?: number
    creditAmount: number
    balanceDue: number
    isFullyPaid: boolean
  }
  whatsapp: {
    phoneNumber?: string | null
    shareText: string
    shareUrl: string
  }
}

export function ReceiptModal({
  saleId,
  token,
  onClose,
  initialData,
}: {
  saleId: string
  token: string
  onClose: () => void
  initialData?: ReceiptData | null
}) {
  const [data, setData] = useState<ReceiptData | null>(initialData || null)
  const [loading, setLoading] = useState<boolean>(!initialData)
  const [error, setError] = useState<string>('')
  const [widthMode, setWidthMode] = useState<'80mm' | '58mm'>('80mm')
  const [pdfDownloading, setPdfDownloading] = useState<boolean>(false)
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [settingsForm, setSettingsForm] = useState<any>(null)

  useEffect(() => {
    if (!data && saleId && token) {
      loadReceipt()
    }
  }, [saleId, token])

  const loadReceipt = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiBase}/api/sales/${saleId}/receipt`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (json.success) {
        setData(json.data)
      } else {
        setError(json.message || 'Failed to load receipt data')
      }
    } catch (err: any) {
      setError(err.message || 'Error fetching receipt')
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadPdf = async () => {
    setPdfDownloading(true)
    try {
      const res = await fetch(`${apiBase}/api/sales/${saleId}/invoice-pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('PDF generation failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Invoice-${data?.sale.invoiceNumber || saleId}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.message || 'Failed to download PDF')
    } finally {
      setPdfDownloading(false)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const openSettings = () => {
    if (data?.store) {
      setSettingsForm({ ...data.store })
      setShowSettings(true)
    }
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch(`${apiBase}/api/settings/store`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(settingsForm),
      })
      const json = await res.json()
      if (json.success) {
        if (data) {
          setData({ ...data, store: json.data })
        }
        setShowSettings(false)
      } else {
        alert(json.message || 'Failed to update store settings')
      }
    } catch (err: any) {
      alert(err.message || 'Error saving settings')
    }
  }

  return (
    <div className="pos-modal-overlay" onClick={onClose}>
      <div
        className="pos-modal"
        style={{
          maxWidth: widthMode === '58mm' ? '380px' : '480px',
          padding: '18px',
          transition: 'max-width 0.2s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Control Bar (Hidden on Print) */}
        <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>Format:</span>
            <button
              type="button"
              onClick={() => setWidthMode('80mm')}
              style={{
                padding: '3px 8px',
                fontSize: '0.78rem',
                borderRadius: '4px',
                border: widthMode === '80mm' ? '1px solid #2563eb' : '1px solid #cbd5e1',
                background: widthMode === '80mm' ? '#eff6ff' : '#fff',
                color: widthMode === '80mm' ? '#1d4ed8' : '#64748b',
                fontWeight: widthMode === '80mm' ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              80mm Roll
            </button>
            <button
              type="button"
              onClick={() => setWidthMode('58mm')}
              style={{
                padding: '3px 8px',
                fontSize: '0.78rem',
                borderRadius: '4px',
                border: widthMode === '58mm' ? '1px solid #2563eb' : '1px solid #cbd5e1',
                background: widthMode === '58mm' ? '#eff6ff' : '#fff',
                color: widthMode === '58mm' ? '#1d4ed8' : '#64748b',
                fontWeight: widthMode === '58mm' ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              58mm Roll
            </button>
          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={openSettings}
              title="Store Settings & Branding"
              style={{ padding: '3px 8px', fontSize: '0.78rem', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
            >
              ⚙️ Branding
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ border: 'none', background: 'transparent', fontSize: '1.1rem', cursor: 'pointer', color: '#64748b' }}
            >
              ✕
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
            Loading printable receipt...
          </div>
        )}

        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px', borderRadius: '6px', fontSize: '0.85rem' }}>
            ⚠️ {error}
          </div>
        )}

        {data && (
          <div>
            {/* Printable Thermal Receipt Container */}
            <div
              className="pos-printable-receipt"
              style={{
                fontFamily: `'Courier New', Courier, monospace, sans-serif`,
                fontSize: widthMode === '58mm' ? '0.78rem' : '0.86rem',
                lineHeight: 1.25,
                color: '#000',
                background: '#fff',
              }}
            >
              {/* Store Header */}
              <div style={{ textAlign: 'center', borderBottom: '1px dashed #475569', paddingBottom: '6px', marginBottom: '8px' }}>
                <div style={{ fontSize: widthMode === '58mm' ? '1rem' : '1.15rem', fontWeight: 800, textTransform: 'uppercase' }}>
                  {data.store.storeName}
                </div>
                {data.store.tagline && (
                  <div style={{ fontSize: '0.72rem', fontStyle: 'italic' }}>{data.store.tagline}</div>
                )}
                <div style={{ fontSize: '0.72rem', marginTop: '2px' }}>{data.store.address}</div>
                <div style={{ fontSize: '0.72rem' }}>Ph: {data.store.phone}</div>
                {data.store.gstin && (
                  <div style={{ fontSize: '0.72rem', fontWeight: 700 }}>GSTIN: {data.store.gstin}</div>
                )}
                {data.store.dlNumber && (
                  <div style={{ fontSize: '0.7rem' }}>D.L: {data.store.dlNumber}</div>
                )}
              </div>

              {/* Invoice & Customer Info */}
              <div style={{ fontSize: '0.74rem', borderBottom: '1px dashed #475569', paddingBottom: '6px', marginBottom: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Invoice: <strong>#{data.sale.invoiceNumber}</strong></span>
                  <span>{new Date(data.sale.saleDate).toLocaleDateString('en-IN')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Cashier: {data.sale.cashierName}</span>
                  <span>{new Date(data.sale.saleDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {data.customer.name && (
                  <div style={{ marginTop: '2px' }}>
                    Cust: <strong>{data.customer.name}</strong> {data.customer.phone ? `(${data.customer.phone})` : ''}
                  </div>
                )}
              </div>

              {/* Items Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: widthMode === '58mm' ? '0.72rem' : '0.8rem', marginBottom: '8px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px dashed #000' }}>
                    <th style={{ textAlign: 'left', padding: '3px 0' }}>Item</th>
                    <th style={{ textAlign: 'right', padding: '3px 0', width: '32px' }}>Qty</th>
                    <th style={{ textAlign: 'right', padding: '3px 0', width: '50px' }}>Price</th>
                    <th style={{ textAlign: 'right', padding: '3px 0', width: '60px' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px dotted #cbd5e1' }}>
                      <td style={{ padding: '3px 0' }}>
                        <div>{it.productName}</div>
                        {it.batchNumber && (
                          <div style={{ fontSize: '0.68rem', color: '#475569' }}>
                            B:{it.batchNumber} {it.expiryDate ? `Exp:${it.expiryDate.slice(2, 7)}` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', padding: '3px 0', verticalAlign: 'top' }}>{it.quantity}</td>
                      <td style={{ textAlign: 'right', padding: '3px 0', verticalAlign: 'top' }}>{it.unitPrice.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', padding: '3px 0', verticalAlign: 'top', fontWeight: 600 }}>
                        {it.lineTotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals Summary */}
              <div style={{ borderTop: '1px dashed #000', paddingTop: '4px', display: 'grid', gap: '2px', fontSize: widthMode === '58mm' ? '0.74rem' : '0.82rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Items / Qty:</span>
                  <span>{data.totals.itemCount} / {data.totals.totalQuantity}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Subtotal:</span>
                  <span>{data.totals.subtotal.toFixed(2)}</span>
                </div>
                {data.totals.totalDiscount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Discount:</span>
                    <span>-{data.totals.totalDiscount.toFixed(2)}</span>
                  </div>
                )}
                {data.totals.totalGst > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>GST Included:</span>
                    <span>{data.totals.totalGst.toFixed(2)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: widthMode === '58mm' ? '0.9rem' : '1rem', borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '3px 0', margin: '3px 0' }}>
                  <span>GRAND TOTAL:</span>
                  <span>₹{data.totals.grandTotal.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Paid ({data.payment.paymentMethod}):</span>
                  <span>₹{data.payment.paidAmount.toFixed(2)}</span>
                </div>
                {data.payment.cashAmount !== undefined && data.payment.upiAmount !== undefined && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#475569' }}>
                    <span>(Cash: ₹{data.payment.cashAmount.toFixed(2)} | UPI: ₹{data.payment.upiAmount.toFixed(2)})</span>
                  </div>
                )}
                {data.payment.balanceDue > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#dc2626' }}>
                    <span>Balance Due (Credit):</span>
                    <span>₹{data.payment.balanceDue.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Receipt Footer Note */}
              <div style={{ textAlign: 'center', borderTop: '1px dashed #475569', marginTop: '8px', paddingTop: '6px', fontSize: '0.7rem' }}>
                <div>{data.store.receiptFooter}</div>
                <div style={{ fontSize: '0.65rem', marginTop: '3px', color: '#475569' }}>Computer Generated Tax Invoice</div>
              </div>
            </div>

            {/* Action Buttons (Hidden on Print) */}
            <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
              <button
                type="button"
                className="primary-btn"
                onClick={handlePrint}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '9px 12px' }}
              >
                🖨️ Print Receipt
              </button>

              <button
                type="button"
                className="secondary-btn"
                disabled={pdfDownloading}
                onClick={handleDownloadPdf}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '9px 12px', color: '#1e3a8a', borderColor: '#bfdbfe', background: '#eff6ff' }}
              >
                📄 {pdfDownloading ? 'Generating...' : 'A4 PDF Invoice'}
              </button>

              <a
                href={data.whatsapp.shareUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '9px 12px',
                  background: '#22c55e',
                  color: '#fff',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                }}
              >
                💬 Share on WhatsApp
              </a>

              <button
                type="button"
                className="secondary-btn"
                style={{ gridColumn: '1 / -1', padding: '8px 12px' }}
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Store Settings Modal */}
        {showSettings && settingsForm && (
          <div className="pos-modal-overlay" style={{ zIndex: 11000 }}>
            <div className="pos-modal" style={{ maxWidth: '480px' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '1.15rem' }}>⚙️ Receipt & Invoice Branding Settings</h3>
              <form onSubmit={handleSaveSettings} style={{ display: 'grid', gap: '10px', fontSize: '0.85rem' }}>
                <label>
                  Store / Pharmacy Name *
                  <input
                    type="text"
                    required
                    value={settingsForm.storeName}
                    onChange={(e) => setSettingsForm({ ...settingsForm, storeName: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', marginTop: '2px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                  />
                </label>
                <label>
                  Tagline
                  <input
                    type="text"
                    value={settingsForm.tagline || ''}
                    onChange={(e) => setSettingsForm({ ...settingsForm, tagline: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', marginTop: '2px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                  />
                </label>
                <label>
                  Address *
                  <input
                    type="text"
                    required
                    value={settingsForm.address}
                    onChange={(e) => setSettingsForm({ ...settingsForm, address: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', marginTop: '2px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                  />
                </label>
                <div className="form-row-2">
                  <label>
                    Phone *
                    <input
                      type="text"
                      required
                      value={settingsForm.phone}
                      onChange={(e) => setSettingsForm({ ...settingsForm, phone: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', marginTop: '2px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                    />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      value={settingsForm.email}
                      onChange={(e) => setSettingsForm({ ...settingsForm, email: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', marginTop: '2px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                    />
                  </label>
                </div>
                <div className="form-row-2">
                  <label>
                    GSTIN
                    <input
                      type="text"
                      value={settingsForm.gstin || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, gstin: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', marginTop: '2px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                    />
                  </label>
                  <label>
                    Drug License (DL) No
                    <input
                      type="text"
                      value={settingsForm.dlNumber || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, dlNumber: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', marginTop: '2px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                    />
                  </label>
                </div>
                <label>
                  Receipt Footer Note
                  <input
                    type="text"
                    value={settingsForm.receiptFooter || ''}
                    onChange={(e) => setSettingsForm({ ...settingsForm, receiptFooter: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', marginTop: '2px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                  />
                </label>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                  <button type="button" className="secondary-btn" onClick={() => setShowSettings(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-btn">
                    Save Branding
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

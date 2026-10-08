import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ReceiptModal, type ReceiptData } from './ReceiptModal.js'
import { API_BASE as apiBase } from './config.js'

export function ReceiptPage({ token }: { token: string }) {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ReceiptData | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (id && token) {
      loadReceipt()
    }
  }, [id, token])

  const loadReceipt = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiBase}/api/sales/${id}/receipt`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (json.success) {
        setData(json.data)
      } else {
        setError(json.message || 'Failed to load receipt')
      }
    } catch (err: any) {
      setError(err.message || 'Error fetching receipt')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
        Loading Invoice / Receipt...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ color: '#dc2626', marginBottom: '16px' }}>⚠️ {error || 'Receipt not found'}</div>
        <Link to="/sales" className="primary-btn">
          Back to Sales
        </Link>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '20px' }}>
      <div className="no-print" style={{ maxWidth: '500px', margin: '0 auto 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link to="/sales" style={{ color: '#2563eb', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600 }}>
          &larr; Back to Sales History
        </Link>
        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
          Invoice: <strong>#{data.sale.invoiceNumber}</strong>
        </div>
      </div>

      <ReceiptModal
        saleId={id!}
        token={token}
        onClose={() => window.history.back()}
        initialData={data}
      />
    </div>
  )
}

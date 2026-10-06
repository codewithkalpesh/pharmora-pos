import React, { useState, useEffect } from 'react';

type Props = {
  token: string;
  onSignIn?: (token: string) => void;
  onSignOut?: () => void;
};

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value));
}

export function ExpiryManagementPage({ token }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [summary, setSummary] = useState<any>(null);
  const [allBatches, setAllBatches] = useState<any[]>([]);
  const [filterBucket, setFilterBucket] = useState<'ALL' | 'EXPIRED' | 'NEAR_30' | 'NEAR_60' | 'NEAR_90'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Write-off Modal state
  const [writeOffModal, setWriteOffModal] = useState<{
    open: boolean;
    batch: any | null;
    quantity: number;
    reason: 'EXPIRED' | 'DAMAGE';
    note: string;
    submitting: boolean;
  }>({
    open: false,
    batch: null,
    quantity: 1,
    reason: 'EXPIRED',
    note: 'Disposed due to expiry',
    submitting: false,
  });

  const fetchExpiryDashboard = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/batches/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to fetch expiry dashboard');
      setSummary(data.data.summary);
      setAllBatches(data.data.batches.all || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpiryDashboard();
  }, [token]);

  const handleOpenWriteOff = (batch: any) => {
    setWriteOffModal({
      open: true,
      batch,
      quantity: batch.quantity,
      reason: batch.daysUntilExpiry <= 0 ? 'EXPIRED' : 'DAMAGE',
      note: batch.daysUntilExpiry <= 0 ? 'Disposed expired batch' : 'Damaged / expired stock write-off',
      submitting: false,
    });
  };

  const handleSubmitWriteOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writeOffModal.batch) return;
    setError(null);
    setSuccess(null);

    setWriteOffModal((prev) => ({ ...prev, submitting: true }));
    try {
      const idempotencyKey = `adj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const res = await fetch(`${apiBase}/api/inventory/adjustments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          productId: writeOffModal.batch.productId,
          batchId: writeOffModal.batch.id,
          quantityChange: -Math.abs(writeOffModal.quantity),
          reason: writeOffModal.reason,
          note: writeOffModal.note,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to write off batch stock');

      setSuccess(`Successfully wrote off ${writeOffModal.quantity} units of batch ${writeOffModal.batch.batchNumber}!`);
      setWriteOffModal((prev) => ({ ...prev, open: false, batch: null }));
      fetchExpiryDashboard();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setWriteOffModal((prev) => ({ ...prev, submitting: false }));
    }
  };

  const filteredBatches = allBatches.filter((b) => {
    if (filterBucket === 'EXPIRED' && b.status !== 'EXPIRED') return false;
    if (filterBucket === 'NEAR_30' && b.status !== 'NEAR_30') return false;
    if (filterBucket === 'NEAR_60' && b.status !== 'NEAR_60') return false;
    if (filterBucket === 'NEAR_90' && b.status !== 'NEAR_90') return false;

    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      const matchName = b.productName?.toLowerCase().includes(query);
      const matchGeneric = b.genericName?.toLowerCase().includes(query);
      const matchBrand = b.brand?.toLowerCase().includes(query);
      const matchBatch = b.batchNumber?.toLowerCase().includes(query);
      const matchSupplier = b.supplierName?.toLowerCase().includes(query);
      return matchName || matchGeneric || matchBrand || matchBatch || matchSupplier;
    }
    return true;
  });

  return (
    <div className="page-container" style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '700', margin: 0, color: 'var(--text-primary, #1e293b)' }}>
            ⏳ Expiry Management & Action Center
          </h1>
          <p style={{ color: 'var(--text-muted, #64748b)', margin: '4px 0 0 0' }}>
            Monitor near-expiry stock, prevent dispensing expired drugs, and quickly dispose or return stock to suppliers.
          </p>
        </div>
        <button
          onClick={fetchExpiryDashboard}
          disabled={loading}
          style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}
        >
          {loading ? 'Refreshing...' : '🔄 Refresh Expiry Data'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', marginBottom: '16px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {success && (
        <div style={{ padding: '12px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#166534', marginBottom: '16px' }}>
          <strong>Success:</strong> {success}
        </div>
      )}

      {/* Summary KPI Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '28px' }}>
          {/* Expired */}
          <div
            onClick={() => setFilterBucket('EXPIRED')}
            style={{
              background: filterBucket === 'EXPIRED' ? '#fef2f2' : '#fff',
              border: filterBucket === 'EXPIRED' ? '2px solid #ef4444' : '1px solid #fecaca',
              borderRadius: '12px',
              padding: '18px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#991b1b' }}>🚨 Expired Stock</span>
              <span style={{ fontSize: '12px', padding: '2px 8px', background: '#fee2e2', color: '#991b1b', borderRadius: '12px', fontWeight: '700' }}>
                {summary.expired.count} batches
              </span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#dc2626', marginTop: '8px' }}>
              {summary.expired.units} <span style={{ fontSize: '14px', fontWeight: '500' }}>units</span>
            </div>
            <div style={{ fontSize: '13px', color: '#7f1d1d', marginTop: '4px' }}>
              Cost Valuation: <strong>{formatMoney(summary.expired.totalCost)}</strong>
            </div>
          </div>

          {/* Near 30 Days */}
          <div
            onClick={() => setFilterBucket('NEAR_30')}
            style={{
              background: filterBucket === 'NEAR_30' ? '#fffbeb' : '#fff',
              border: filterBucket === 'NEAR_30' ? '2px solid #f59e0b' : '1px solid #fde68a',
              borderRadius: '12px',
              padding: '18px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#92400e' }}>⚠️ Expiring &lt; 30 Days</span>
              <span style={{ fontSize: '12px', padding: '2px 8px', background: '#fef3c7', color: '#92400e', borderRadius: '12px', fontWeight: '700' }}>
                {summary.near30Days.count} batches
              </span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#d97706', marginTop: '8px' }}>
              {summary.near30Days.units} <span style={{ fontSize: '14px', fontWeight: '500' }}>units</span>
            </div>
            <div style={{ fontSize: '13px', color: '#78350f', marginTop: '4px' }}>
              Cost Valuation: <strong>{formatMoney(summary.near30Days.totalCost)}</strong>
            </div>
          </div>

          {/* Near 60 Days */}
          <div
            onClick={() => setFilterBucket('NEAR_60')}
            style={{
              background: filterBucket === 'NEAR_60' ? '#f0fdf4' : '#fff',
              border: filterBucket === 'NEAR_60' ? '2px solid #3b82f6' : '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '18px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#1e40af' }}>📅 Expiring 31-60 Days</span>
              <span style={{ fontSize: '12px', padding: '2px 8px', background: '#dbeafe', color: '#1e40af', borderRadius: '12px', fontWeight: '700' }}>
                {summary.near60Days.count} batches
              </span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#2563eb', marginTop: '8px' }}>
              {summary.near60Days.units} <span style={{ fontSize: '14px', fontWeight: '500' }}>units</span>
            </div>
            <div style={{ fontSize: '13px', color: '#1e3a8a', marginTop: '4px' }}>
              Cost Valuation: <strong>{formatMoney(summary.near60Days.totalCost)}</strong>
            </div>
          </div>

          {/* Near 90 Days */}
          <div
            onClick={() => setFilterBucket('NEAR_90')}
            style={{
              background: filterBucket === 'NEAR_90' ? '#f8fafc' : '#fff',
              border: filterBucket === 'NEAR_90' ? '2px solid #64748b' : '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '18px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#475569' }}>📦 Expiring 61-90 Days</span>
              <span style={{ fontSize: '12px', padding: '2px 8px', background: '#f1f5f9', color: '#475569', borderRadius: '12px', fontWeight: '700' }}>
                {summary.near90Days.count} batches
              </span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#475569', marginTop: '8px' }}>
              {summary.near90Days.units} <span style={{ fontSize: '14px', fontWeight: '500' }}>units</span>
            </div>
            <div style={{ fontSize: '13px', color: '#334155', marginTop: '4px' }}>
              Cost Valuation: <strong>{formatMoney(summary.near90Days.totalCost)}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setFilterBucket('ALL')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: filterBucket === 'ALL' ? '#2563eb' : '#fff',
                color: filterBucket === 'ALL' ? '#fff' : '#334155',
                fontWeight: '600',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              All Batches ({allBatches.length})
            </button>
            <button
              onClick={() => setFilterBucket('EXPIRED')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #fecaca',
                background: filterBucket === 'EXPIRED' ? '#dc2626' : '#fff',
                color: filterBucket === 'EXPIRED' ? '#fff' : '#dc2626',
                fontWeight: '600',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              🚨 Expired
            </button>
            <button
              onClick={() => setFilterBucket('NEAR_30')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #fde68a',
                background: filterBucket === 'NEAR_30' ? '#d97706' : '#fff',
                color: filterBucket === 'NEAR_30' ? '#fff' : '#d97706',
                fontWeight: '600',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              ⚠️ &lt; 30 Days
            </button>
            <button
              onClick={() => setFilterBucket('NEAR_60')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: filterBucket === 'NEAR_60' ? '#2563eb' : '#fff',
                color: filterBucket === 'NEAR_60' ? '#fff' : '#334155',
                fontWeight: '600',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              31-60 Days
            </button>
            <button
              onClick={() => setFilterBucket('NEAR_90')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: filterBucket === 'NEAR_90' ? '#475569' : '#fff',
                color: filterBucket === 'NEAR_90' ? '#fff' : '#334155',
                fontWeight: '600',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              61-90 Days
            </button>
          </div>

          <input
            type="text"
            placeholder="Search product, batch, supplier..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '280px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
          />
        </div>
      </div>

      {/* Batches Table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ padding: '12px 16px' }}>Product</th>
              <th style={{ padding: '12px 16px' }}>Batch #</th>
              <th style={{ padding: '12px 16px' }}>Expiry Date</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
              <th style={{ padding: '12px 16px' }}>Stock Qty</th>
              <th style={{ padding: '12px 16px' }}>Cost / Unit</th>
              <th style={{ padding: '12px 16px' }}>Total Cost Value</th>
              <th style={{ padding: '12px 16px' }}>Supplier</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  Loading expiry batches...
                </td>
              </tr>
            ) : filteredBatches.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  No batches matching this filter criteria.
                </td>
              </tr>
            ) : (
              filteredBatches.map((batch) => {
                const isExpired = batch.daysUntilExpiry <= 0;
                const isNear30 = batch.daysUntilExpiry > 0 && batch.daysUntilExpiry <= 30;
                return (
                  <tr
                    key={batch.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      background: isExpired ? '#fff5f5' : isNear30 ? '#fffdf5' : '#fff',
                    }}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: '600', color: '#1e293b' }}>{batch.productName}</div>
                      {batch.genericName && <div style={{ fontSize: '12px', color: '#64748b' }}>{batch.genericName}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: '600' }}>
                      {batch.batchNumber}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: '500' }}>
                      {new Date(batch.expiryDate).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {isExpired ? (
                        <span style={{ padding: '3px 8px', background: '#fee2e2', color: '#991b1b', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>
                          EXPIRED ({Math.abs(batch.daysUntilExpiry)}d ago)
                        </span>
                      ) : isNear30 ? (
                        <span style={{ padding: '3px 8px', background: '#fef3c7', color: '#92400e', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>
                          {batch.daysUntilExpiry} days left
                        </span>
                      ) : (
                        <span style={{ padding: '3px 8px', background: '#f1f5f9', color: '#475569', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>
                          {batch.daysUntilExpiry} days left
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: '700' }}>{batch.quantity}</td>
                    <td style={{ padding: '12px 16px' }}>{formatMoney(batch.purchaseRate)}</td>
                    <td style={{ padding: '12px 16px', fontWeight: '600' }}>{formatMoney(batch.totalCostValue)}</td>
                    <td style={{ padding: '12px 16px', color: '#64748b', fontSize: '13px' }}>
                      {batch.supplierName || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleOpenWriteOff(batch)}
                        style={{
                          padding: '6px 12px',
                          background: '#fee2e2',
                          color: '#991b1b',
                          border: '1px solid #fecaca',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        🗑️ Write-off
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Write-off / Dispose Modal */}
      {writeOffModal.open && writeOffModal.batch && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#fff',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '480px',
            width: '90%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: '#991b1b' }}>
              🗑️ Dispose / Write-Off Stock
            </h2>
            <p style={{ fontSize: '14px', color: '#475569', marginBottom: '16px' }}>
              Product: <strong>{writeOffModal.batch.productName}</strong> (Batch: {writeOffModal.batch.batchNumber})
            </p>

            <form onSubmit={handleSubmitWriteOff}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                  Quantity to Dispose (Max {writeOffModal.batch.quantity}):
                </label>
                <input
                  type="number"
                  min="1"
                  max={writeOffModal.batch.quantity}
                  value={writeOffModal.quantity}
                  onChange={(e) => setWriteOffModal((prev) => ({ ...prev, quantity: Math.min(writeOffModal.batch.quantity, Math.max(1, parseInt(e.target.value) || 1)) }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  required
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                  Reason:
                </label>
                <select
                  value={writeOffModal.reason}
                  onChange={(e: any) => setWriteOffModal((prev) => ({ ...prev, reason: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="EXPIRED">❌ Expired Product Disposal</option>
                  <option value="DAMAGE">⚠️ Damaged / Broken Packaging</option>
                </select>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                  Disposal Note / Audit Remarks:
                </label>
                <input
                  type="text"
                  value={writeOffModal.note}
                  onChange={(e) => setWriteOffModal((prev) => ({ ...prev, note: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setWriteOffModal((prev) => ({ ...prev, open: false, batch: null }))}
                  style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={writeOffModal.submitting}
                  style={{ padding: '8px 18px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}
                >
                  {writeOffModal.submitting ? 'Disposing...' : 'Confirm Disposal & Deduct Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

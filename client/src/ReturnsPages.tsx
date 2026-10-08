import React, { useState, useEffect } from 'react';
import { API_BASE as apiBase } from './config.js';

type Props = {
  token: string;
  onSignIn?: (token: string) => void;
  onSignOut?: () => void;
};

function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value));
}

export function ReturnsPage({ token }: Props) {
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>('sales');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Sales Returns State
  const [saleReturns, setSaleReturns] = useState<any[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [searchSaleTerm, setSearchSaleTerm] = useState('');
  const [foundSale, setFoundSale] = useState<any | null>(null);
  const [searchingSale, setSearchingSale] = useState(false);
  const [selectedReturnItems, setSelectedReturnItems] = useState<{
    [saleItemId: string]: {
      selected: boolean;
      quantity: number;
      condition: 'RESTOCKABLE' | 'DAMAGED' | 'EXPIRED' | 'OTHER';
      reason: string;
    };
  }>({});
  const [saleRefundMethod, setSaleRefundMethod] = useState<'CASH' | 'UPI' | 'BANK' | 'CREDIT'>('CASH');
  const [saleReturnReason, setSaleReturnReason] = useState('');
  const [submittingSaleReturn, setSubmittingSaleReturn] = useState(false);

  // Purchase Returns State
  const [purchaseReturns, setPurchaseReturns] = useState<any[]>([]);
  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [supplierBatches, setSupplierBatches] = useState<any[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [selectedPRItems, setSelectedPRItems] = useState<{
    [batchId: string]: {
      selected: boolean;
      quantity: number;
      reason: string;
    };
  }>({});
  const [prRefundMethod, setPrRefundMethod] = useState<'CREDIT' | 'CASH' | 'BANK'>('CREDIT');
  const [prReason, setPrReason] = useState('');
  const [submittingPR, setSubmittingPR] = useState(false);

  // Load Sales Returns
  const fetchSaleReturns = async () => {
    if (!token) return;
    setLoadingSales(true);
    try {
      const res = await fetch(`${apiBase}/api/sale-returns`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) setSaleReturns(data.data || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingSales(false);
    }
  };

  // Load Purchase Returns
  const fetchPurchaseReturns = async () => {
    if (!token) return;
    setLoadingPurchases(true);
    try {
      const res = await fetch(`${apiBase}/api/purchase-returns`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) setPurchaseReturns(data.data || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingPurchases(false);
    }
  };

  // Load Suppliers
  const fetchSuppliers = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/api/suppliers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) setSuppliers(data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchSaleReturns();
    fetchPurchaseReturns();
    fetchSuppliers();
  }, [token]);

  // Search Sale for Return
  const handleSearchSale = async () => {
    if (!searchSaleTerm.trim()) return;
    setSearchingSale(true);
    setError(null);
    setFoundSale(null);
    try {
      const res = await fetch(`${apiBase}/api/sales`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to search sales');
      
      const term = searchSaleTerm.trim().toLowerCase();
      const match = (data.data || []).find((s: any) => 
        (s.saleNumber && s.saleNumber.toLowerCase().includes(term)) ||
        (s.id && s.id.toLowerCase().includes(term)) ||
        (s.customer?.name && s.customer.name.toLowerCase().includes(term)) ||
        (s.customer?.phone && s.customer.phone.includes(term))
      );

      if (!match) {
        setError(`No completed sale found matching "${searchSaleTerm}"`);
        return;
      }

      // Fetch detailed sale with return history
      const detailRes = await fetch(`${apiBase}/api/sales/${match.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const detailData = await detailRes.json();
      if (!detailRes.ok) throw new Error(detailData.message || 'Failed to fetch sale details');

      setFoundSale(detailData.data);
      // Initialize return selection map
      const initialMap: any = {};
      (detailData.data.items || []).forEach((item: any) => {
        initialMap[item.id] = {
          selected: false,
          quantity: 1,
          condition: 'RESTOCKABLE',
          reason: 'Customer return',
        };
      });
      setSelectedReturnItems(initialMap);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSearchingSale(false);
    }
  };

  // Submit Sale Return
  const handleSubmitSaleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foundSale) return;
    setError(null);
    setSuccess(null);

    const itemsToReturn: any[] = [];
    Object.entries(selectedReturnItems).forEach(([saleItemId, itemState]) => {
      if (itemState.selected && itemState.quantity > 0) {
        itemsToReturn.push({
          saleItemId,
          quantity: itemState.quantity,
          condition: itemState.condition,
          reason: itemState.reason,
        });
      }
    });

    if (itemsToReturn.length === 0) {
      setError('Please select at least one item to return');
      return;
    }

    setSubmittingSaleReturn(true);
    try {
      const idempotencyKey = `sr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const res = await fetch(`${apiBase}/api/sale-returns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          saleId: foundSale.id,
          items: itemsToReturn,
          refundMethod: saleRefundMethod,
          reason: saleReturnReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to process sales return');

      setSuccess(`Sales Return ${data.data.returnNumber} processed successfully! Refund Amount: ${formatMoney(data.data.totalAmount)}`);
      setFoundSale(null);
      setSearchSaleTerm('');
      fetchSaleReturns();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmittingSaleReturn(false);
    }
  };

  // When supplier selected for Purchase Return, fetch their batches
  const handleSupplierChange = async (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    setSupplierBatches([]);
    setSelectedPRItems({});
    if (!supplierId) return;

    setLoadingBatches(true);
    try {
      const res = await fetch(`${apiBase}/api/batches/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.data?.batches?.all) {
        const matching = data.data.batches.all.filter((b: any) => b.supplierId === supplierId && b.quantity > 0);
        setSupplierBatches(matching);
        const map: any = {};
        matching.forEach((b: any) => {
          map[b.id] = { selected: false, quantity: 1, reason: 'Near expiry / damage return' };
        });
        setSelectedPRItems(map);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBatches(false);
    }
  };

  // Submit Purchase Return
  const handleSubmitPurchaseReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId) return;
    setError(null);
    setSuccess(null);

    const itemsToReturn: any[] = [];
    Object.entries(selectedPRItems).forEach(([batchId, itemState]) => {
      if (itemState.selected && itemState.quantity > 0) {
        const batch = supplierBatches.find((b) => b.id === batchId);
        if (batch) {
          itemsToReturn.push({
            productId: batch.productId,
            batchId: batch.id,
            quantity: itemState.quantity,
            reason: itemState.reason,
          });
        }
      }
    });

    if (itemsToReturn.length === 0) {
      setError('Please select at least one batch to return to supplier');
      return;
    }

    setSubmittingPR(true);
    try {
      const idempotencyKey = `pr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const res = await fetch(`${apiBase}/api/purchase-returns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          supplierId: selectedSupplierId,
          items: itemsToReturn,
          refundMethod: prRefundMethod,
          reason: prReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to process supplier return');

      setSuccess(`Debit Note / Supplier Return ${data.data.returnNumber} created successfully! Total: ${formatMoney(data.data.totalAmount)}`);
      setSelectedSupplierId('');
      setSupplierBatches([]);
      fetchPurchaseReturns();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmittingPR(false);
    }
  };

  return (
    <div className="page-container" style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '700', margin: 0, color: 'var(--text-primary, #1e293b)' }}>
            🔄 Returns & Refunds Management
          </h1>
          <p style={{ color: 'var(--text-muted, #64748b)', margin: '4px 0 0 0' }}>
            Process customer sales refunds and supplier returns (Debit Notes) with automatic stock and financial sync.
          </p>
        </div>
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '12px', borderBottom: '2px solid #e2e8f0', marginBottom: '24px' }}>
        <button
          onClick={() => setActiveTab('sales')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: 'none',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
            borderBottom: activeTab === 'sales' ? '3px solid #2563eb' : '3px solid transparent',
            color: activeTab === 'sales' ? '#2563eb' : '#64748b',
          }}
        >
          🛒 Customer Sales Returns ({saleReturns.length})
        </button>
        <button
          onClick={() => setActiveTab('purchases')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: 'none',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
            borderBottom: activeTab === 'purchases' ? '3px solid #2563eb' : '3px solid transparent',
            color: activeTab === 'purchases' ? '#2563eb' : '#64748b',
          }}
        >
          🏭 Supplier Returns / Debit Notes ({purchaseReturns.length})
        </button>
      </div>

      {/* SALES RETURNS TAB */}
      {activeTab === 'sales' && (
        <div>
          {/* New Sales Return Form Section */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', marginBottom: '32px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Create New Sales Return</h2>
            
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              <input
                type="text"
                placeholder="Search by Bill / Sale Number (e.g. POS-2026...) or Customer Name..."
                value={searchSaleTerm}
                onChange={(e) => setSearchSaleTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchSale()}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }}
              />
              <button
                type="button"
                onClick={handleSearchSale}
                disabled={searchingSale}
                style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
              >
                {searchingSale ? 'Searching...' : 'Find Sale'}
              </button>
            </div>

            {foundSale && (
              <form onSubmit={handleSubmitSaleReturn}>
                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>Invoice: {foundSale.saleNumber || foundSale.id}</strong> | Date: {new Date(foundSale.saleDate).toLocaleDateString()}
                      {foundSale.customer && (
                        <div>Customer: <strong>{foundSale.customer.name}</strong> ({foundSale.customer.phone || 'No phone'})</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div>Total Bill: <strong>{formatMoney(foundSale.totalAmount)}</strong></div>
                      <div>Payment: <span style={{ padding: '2px 8px', background: '#e0f2fe', color: '#0369a1', borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}>{foundSale.paymentMethod}</span></div>
                    </div>
                  </div>
                </div>

                <h3 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px' }}>Select Items to Return:</h3>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', marginBottom: '20px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '10px 14px' }}>Select</th>
                        <th style={{ padding: '10px 14px' }}>Product</th>
                        <th style={{ padding: '10px 14px' }}>Batch</th>
                        <th style={{ padding: '10px 14px' }}>Sold Qty</th>
                        <th style={{ padding: '10px 14px' }}>Return Qty</th>
                        <th style={{ padding: '10px 14px' }}>Condition</th>
                        <th style={{ padding: '10px 14px' }}>Reason</th>
                        <th style={{ padding: '10px 14px' }}>Unit Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {foundSale.items?.map((item: any) => {
                        const itemState = selectedReturnItems[item.id] || { selected: false, quantity: 1, condition: 'RESTOCKABLE', reason: '' };
                        return (
                          <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9', background: itemState.selected ? '#eff6ff' : '#fff' }}>
                            <td style={{ padding: '10px 14px' }}>
                              <input
                                type="checkbox"
                                checked={itemState.selected}
                                onChange={(e) => {
                                  setSelectedReturnItems((prev) => ({
                                    ...prev,
                                    [item.id]: { ...itemState, selected: e.target.checked },
                                  }));
                                }}
                              />
                            </td>
                            <td style={{ padding: '10px 14px', fontWeight: '500' }}>{item.product?.name}</td>
                            <td style={{ padding: '10px 14px' }}>{item.batch?.batchNumber || '—'}</td>
                            <td style={{ padding: '10px 14px' }}>{item.quantity}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <input
                                type="number"
                                min="1"
                                max={item.quantity}
                                value={itemState.quantity}
                                disabled={!itemState.selected}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 1;
                                  setSelectedReturnItems((prev) => ({
                                    ...prev,
                                    [item.id]: { ...itemState, quantity: Math.min(item.quantity, Math.max(1, val)) },
                                  }));
                                }}
                                style={{ width: '60px', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                              />
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              <select
                                value={itemState.condition}
                                disabled={!itemState.selected}
                                onChange={(e: any) => {
                                  setSelectedReturnItems((prev) => ({
                                    ...prev,
                                    [item.id]: { ...itemState, condition: e.target.value },
                                  }));
                                }}
                                style={{ padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                              >
                                <option value="RESTOCKABLE">✅ Restockable (Add to stock)</option>
                                <option value="DAMAGED">⚠️ Damaged (Don't restock)</option>
                                <option value="EXPIRED">❌ Expired (Don't restock)</option>
                              </select>
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              <input
                                type="text"
                                placeholder="Reason..."
                                value={itemState.reason}
                                disabled={!itemState.selected}
                                onChange={(e) => {
                                  setSelectedReturnItems((prev) => ({
                                    ...prev,
                                    [item.id]: { ...itemState, reason: e.target.value },
                                  }));
                                }}
                                style={{ padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '130px' }}
                              />
                            </td>
                            <td style={{ padding: '10px 14px' }}>{formatMoney(item.sellingPrice)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Refund Method & Settlement */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>
                      Refund Method:
                    </label>
                    <select
                      value={saleRefundMethod}
                      onChange={(e: any) => setSaleRefundMethod(e.target.value)}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    >
                      <option value="CASH">💵 Cash (Cashbook Outflow)</option>
                      <option value="UPI">📱 UPI (Digital Outflow)</option>
                      <option value="BANK">🏦 Bank Transfer</option>
                      <option value="CREDIT">🎟️ Store Credit / Customer Balance Reduction</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>
                      General Return Note:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Customer returned unused tablets..."
                      value={saleReturnReason}
                      onChange={(e) => setSaleReturnReason(e.target.value)}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button
                    type="button"
                    onClick={() => setFoundSale(null)}
                    style={{ padding: '10px 20px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingSaleReturn}
                    style={{ padding: '10px 24px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
                  >
                    {submittingSaleReturn ? 'Processing Refund...' : '✅ Process Sales Return & Refund'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Sales Return History */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Sales Return History</h2>
            {loadingSales ? (
              <p>Loading returns...</p>
            ) : saleReturns.length === 0 ? (
              <p style={{ color: '#64748b' }}>No sales returns recorded yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '12px 16px' }}>Return #</th>
                      <th style={{ padding: '12px 16px' }}>Date</th>
                      <th style={{ padding: '12px 16px' }}>Invoice</th>
                      <th style={{ padding: '12px 16px' }}>Customer</th>
                      <th style={{ padding: '12px 16px' }}>Items</th>
                      <th style={{ padding: '12px 16px' }}>Refund Method</th>
                      <th style={{ padding: '12px 16px' }}>Total Refund</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saleReturns.map((ret) => (
                      <tr key={ret.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 16px', fontWeight: '600', color: '#2563eb' }}>{ret.returnNumber}</td>
                        <td style={{ padding: '12px 16px' }}>{new Date(ret.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: '12px 16px' }}>{ret.sale?.saleNumber || '—'}</td>
                        <td style={{ padding: '12px 16px' }}>{ret.customer?.name || 'Walk-in'}</td>
                        <td style={{ padding: '12px 16px' }}>
                          {ret.items?.map((it: any) => (
                            <div key={it.id} style={{ fontSize: '12px' }}>
                              • {it.product?.name} ({it.quantity}x) — <span style={{ color: it.restocked ? '#16a34a' : '#dc2626' }}>{it.condition}</span>
                            </div>
                          ))}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ padding: '4px 8px', background: '#f1f5f9', borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}>
                            {ret.refundMethod}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: '700', color: '#16a34a' }}>
                          {formatMoney(ret.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUPPLIER RETURNS (DEBIT NOTES) TAB */}
      {activeTab === 'purchases' && (
        <div>
          {/* New Supplier Return Form */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', marginBottom: '32px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Create Supplier Return (Debit Note)</h2>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '6px', color: '#334155' }}>
                Select Supplier:
              </label>
              <select
                value={selectedSupplierId}
                onChange={(e) => handleSupplierChange(e.target.value)}
                style={{ width: '100%', maxWidth: '400px', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
              >
                <option value="">-- Choose Supplier --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Outstanding: {formatMoney(s.outstanding)})
                  </option>
                ))}
              </select>
            </div>

            {selectedSupplierId && (
              <form onSubmit={handleSubmitPurchaseReturn}>
                <h3 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px' }}>
                  Select Batches to Return to Supplier:
                </h3>

                {loadingBatches ? (
                  <p>Loading supplier batches...</p>
                ) : supplierBatches.length === 0 ? (
                  <p style={{ color: '#64748b' }}>No active stock batches found for this supplier.</p>
                ) : (
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', marginBottom: '20px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                          <th style={{ padding: '10px 14px' }}>Select</th>
                          <th style={{ padding: '10px 14px' }}>Product</th>
                          <th style={{ padding: '10px 14px' }}>Batch Number</th>
                          <th style={{ padding: '10px 14px' }}>Expiry</th>
                          <th style={{ padding: '10px 14px' }}>Stock Available</th>
                          <th style={{ padding: '10px 14px' }}>Return Qty</th>
                          <th style={{ padding: '10px 14px' }}>Cost Rate</th>
                          <th style={{ padding: '10px 14px' }}>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierBatches.map((batch) => {
                          const itemState = selectedPRItems[batch.id] || { selected: false, quantity: 1, reason: '' };
                          return (
                            <tr key={batch.id} style={{ borderBottom: '1px solid #f1f5f9', background: itemState.selected ? '#eff6ff' : '#fff' }}>
                              <td style={{ padding: '10px 14px' }}>
                                <input
                                  type="checkbox"
                                  checked={itemState.selected}
                                  onChange={(e) => {
                                    setSelectedPRItems((prev) => ({
                                      ...prev,
                                      [batch.id]: { ...itemState, selected: e.target.checked },
                                    }));
                                  }}
                                />
                              </td>
                              <td style={{ padding: '10px 14px', fontWeight: '500' }}>{batch.productName}</td>
                              <td style={{ padding: '10px 14px' }}>{batch.batchNumber}</td>
                              <td style={{ padding: '10px 14px', color: batch.daysUntilExpiry <= 0 ? '#dc2626' : batch.daysUntilExpiry <= 30 ? '#d97706' : '#334155' }}>
                                {new Date(batch.expiryDate).toLocaleDateString()} ({batch.daysUntilExpiry <= 0 ? 'EXPIRED' : `${batch.daysUntilExpiry}d left`})
                              </td>
                              <td style={{ padding: '10px 14px' }}>{batch.quantity}</td>
                              <td style={{ padding: '10px 14px' }}>
                                <input
                                  type="number"
                                  min="1"
                                  max={batch.quantity}
                                  value={itemState.quantity}
                                  disabled={!itemState.selected}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value) || 1;
                                    setSelectedPRItems((prev) => ({
                                      ...prev,
                                      [batch.id]: { ...itemState, quantity: Math.min(batch.quantity, Math.max(1, val)) },
                                    }));
                                  }}
                                  style={{ width: '60px', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                />
                              </td>
                              <td style={{ padding: '10px 14px' }}>{formatMoney(batch.purchaseRate)}</td>
                              <td style={{ padding: '10px 14px' }}>
                                <input
                                  type="text"
                                  placeholder="Reason..."
                                  value={itemState.reason}
                                  disabled={!itemState.selected}
                                  onChange={(e) => {
                                    setSelectedPRItems((prev) => ({
                                      ...prev,
                                      [batch.id]: { ...itemState, reason: e.target.value },
                                    }));
                                  }}
                                  style={{ padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '150px' }}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>
                      Settlement Mode:
                    </label>
                    <select
                      value={prRefundMethod}
                      onChange={(e: any) => setPrRefundMethod(e.target.value)}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    >
                      <option value="CREDIT">🎟️ Debit Note (Deduct from Supplier Outstanding)</option>
                      <option value="CASH">💵 Immediate Cash Refund from Supplier</option>
                      <option value="BANK">🏦 Bank Refund from Supplier</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>
                      Debit Note Reason / Notes:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Expired batch return as per agreement..."
                      value={prReason}
                      onChange={(e) => setPrReason(e.target.value)}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button
                    type="submit"
                    disabled={submittingPR}
                    style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
                  >
                    {submittingPR ? 'Creating Debit Note...' : '📄 Generate Debit Note & Reduce Stock'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Supplier Returns History */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Supplier Returns & Debit Notes History</h2>
            {loadingPurchases ? (
              <p>Loading debit notes...</p>
            ) : purchaseReturns.length === 0 ? (
              <p style={{ color: '#64748b' }}>No supplier returns recorded yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '12px 16px' }}>Debit Note #</th>
                      <th style={{ padding: '12px 16px' }}>Date</th>
                      <th style={{ padding: '12px 16px' }}>Supplier</th>
                      <th style={{ padding: '12px 16px' }}>Items Returned</th>
                      <th style={{ padding: '12px 16px' }}>Settlement</th>
                      <th style={{ padding: '12px 16px' }}>Debit Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseReturns.map((pr) => (
                      <tr key={pr.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 16px', fontWeight: '600', color: '#2563eb' }}>{pr.returnNumber}</td>
                        <td style={{ padding: '12px 16px' }}>{new Date(pr.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: '12px 16px', fontWeight: '500' }}>{pr.supplier?.name}</td>
                        <td style={{ padding: '12px 16px' }}>
                          {pr.items?.map((it: any) => (
                            <div key={it.id} style={{ fontSize: '12px' }}>
                              • {it.product?.name} (Batch: {it.batchNumber || '—'}) × {it.quantity}
                            </div>
                          ))}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ padding: '4px 8px', background: '#f1f5f9', borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}>
                            {pr.refundMethod || 'CREDIT'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: '700', color: '#2563eb' }}>
                          {formatMoney(pr.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

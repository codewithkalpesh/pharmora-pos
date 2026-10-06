import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSuggestedOrderQty,
  createPurchaseOrder,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
  cancelPurchaseOrder,
  reorderPurchaseOrder,
  getPurchaseList,
  listPurchaseOrders,
  getPurchaseOrder,
  generateOrderText,
  generateWhatsAppUrl,
} from '../src/services/purchaseOrderService.js';

type MockState = {
  products: Array<Record<string, any>>;
  batches: Array<Record<string, any>>;
  suppliers: Array<Record<string, any>>;
  purchases: Array<Record<string, any>>;
  purchaseItems: Array<Record<string, any>>;
  purchaseOrders: Array<Record<string, any>>;
  purchaseOrderItems: Array<Record<string, any>>;
  stockMovements: Array<Record<string, any>>;
  cashbookEntries: Array<Record<string, any>>;
  auditLogs: Array<Record<string, any>>;
};

const makePurchaseOrderHarness = (initialState?: Partial<MockState>) => {
  const state: MockState = {
    products: [],
    batches: [],
    suppliers: [],
    purchases: [],
    purchaseItems: [],
    purchaseOrders: [],
    purchaseOrderItems: [],
    stockMovements: [],
    cashbookEntries: [],
    auditLogs: [],
    ...initialState,
  };

  const client: any = {
    $transaction: async (operation: (tx: any) => Promise<unknown>) => {
      const snapPO = state.purchaseOrders.map((o) => ({ ...o }));
      const snapPOI = state.purchaseOrderItems.map((i) => ({ ...i }));
      const snapSM = [...state.stockMovements];
      const snapCB = [...state.cashbookEntries];
      const snapP = [...state.purchases];
      const snapAudits = [...state.auditLogs];
      try {
        return await operation(client);
      } catch (err) {
        state.purchaseOrders = snapPO;
        state.purchaseOrderItems = snapPOI;
        state.stockMovements = snapSM;
        state.cashbookEntries = snapCB;
        state.purchases = snapP;
        state.auditLogs = snapAudits;
        throw err;
      }
    },
    supplier: {
      findUnique: async ({ where }: any) => {
        return state.suppliers.find((s) => s.id === where.id) ?? null;
      },
      findMany: async () => state.suppliers,
    },
    product: {
      findUnique: async ({ where }: any) => {
        return state.products.find((p) => p.id === where.id) ?? null;
      },
      findMany: async ({ where, include }: any) => {
        let results = state.products.filter((p) => {
          if (where?.active !== undefined && p.active !== where.active) return false;
          if (where?.supplierId && p.supplierId !== where.supplierId) return false;
          if (where?.id?.in && !where.id.in.includes(p.id)) return false;
          if (where?.OR) {
            const query = where.OR[0]?.name?.contains?.toLowerCase();
            if (query) {
              const matches =
                p.name.toLowerCase().includes(query) ||
                (p.genericName && p.genericName.toLowerCase().includes(query)) ||
                (p.brand && p.brand.toLowerCase().includes(query)) ||
                (p.barcode && p.barcode.toLowerCase().includes(query)) ||
                (p.sku && p.sku.toLowerCase().includes(query));
              if (!matches) return false;
            }
          }
          return true;
        });

        if (include) {
          results = results.map((p) => ({
            ...p,
            supplier: state.suppliers.find((s) => s.id === p.supplierId) ?? null,
            batches: state.batches.filter((b) => b.productId === p.id),
            purchaseItems: state.purchaseItems
              .filter((pi) => pi.productId === p.id)
              .map((pi) => ({
                ...pi,
                purchase: state.purchases.find((pur) => pur.id === pi.purchaseId) ?? {
                  invoiceDate: new Date(),
                  supplier: state.suppliers.find((s) => s.id === p.supplierId) ?? null,
                },
              }))
              .sort((a, b) => new Date(b.purchase.invoiceDate).getTime() - new Date(a.purchase.invoiceDate).getTime()),
          }));
        }
        return results;
      },
      count: async () => state.products.length,
    },
    purchaseOrder: {
      findUnique: async ({ where, include }: any) => {
        const order = state.purchaseOrders.find((o) =>
          (where.id && o.id === where.id) || (where.idempotencyKey && o.idempotencyKey === where.idempotencyKey)
        );
        if (!order) return null;
        if (!include) return order;

        const items = state.purchaseOrderItems
          .filter((i) => i.purchaseOrderId === order.id)
          .map((i) => {
            const prod = state.products.find((p) => p.id === i.productId);
            return {
              ...i,
              product: include.items?.include?.product ? prod : undefined,
            };
          });

        return {
          ...order,
          items,
          supplierRel: state.suppliers.find((s) => s.id === order.supplierId) ?? null,
          createdBy: order.createdById ? { id: order.createdById, name: 'Test User', email: 'test@example.com' } : null,
        };
      },
      findMany: async ({ where, include, skip, take }: any) => {
        let results = state.purchaseOrders.filter((o) => {
          if (where?.status && o.status !== where.status) return false;
          if (where?.supplierId && o.supplierId !== where.supplierId) return false;
          if (where?.OR) {
            const query = where.OR[0]?.orderNumber?.contains?.toLowerCase();
            if (query && !o.orderNumber?.toLowerCase().includes(query) && !o.supplier.toLowerCase().includes(query)) {
              return false;
            }
          }
          return true;
        });

        if (include) {
          results = results.map((order) => {
            const items = state.purchaseOrderItems
              .filter((i) => i.purchaseOrderId === order.id)
              .map((i) => ({
                ...i,
                product: state.products.find((p) => p.id === i.productId),
              }));
            return {
              ...order,
              items,
              supplierRel: state.suppliers.find((s) => s.id === order.supplierId) ?? null,
            };
          });
        }
        return results.slice(skip ?? 0, (skip ?? 0) + (take ?? results.length));
      },
      count: async () => state.purchaseOrders.length,
      create: async ({ data }: any) => {
        const row = {
          id: `po-${state.purchaseOrders.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.purchaseOrders.push(row);
        return row;
      },
      update: async ({ where, data, include }: any) => {
        const row = state.purchaseOrders.find((o) => o.id === where.id);
        if (!row) return null;
        Object.assign(row, data, { updatedAt: new Date() });
        if (!include) return row;

        const items = state.purchaseOrderItems
          .filter((i) => i.purchaseOrderId === row.id)
          .map((i) => ({
            ...i,
            product: state.products.find((p) => p.id === i.productId),
          }));
        return {
          ...row,
          items,
          supplierRel: state.suppliers.find((s) => s.id === row.supplierId) ?? null,
        };
      },
    },
    purchaseOrderItem: {
      create: async ({ data }: any) => {
        const row = {
          id: `poi-${state.purchaseOrderItems.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.purchaseOrderItems.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        state.purchaseOrderItems = state.purchaseOrderItems.filter((i) => i.purchaseOrderId !== where.purchaseOrderId);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const row = { id: `audit-${state.auditLogs.length + 1}`, ...data };
        state.auditLogs.push(row);
        return row;
      },
    },
  };

  return { state, client };
};

// --- UNIT TESTS ---

test('1. calculateSuggestedOrderQty: handles maxStock, reorder level fallback, and normal stock', () => {
  // Case A: stock <= reorderLevel with maxStock (e.g. current=10, reorder=20, max=50) -> suggested = 40
  assert.equal(calculateSuggestedOrderQty(10, 20, 50), 40);

  // Case B: out of stock (current=0, reorder=10, max=30) -> suggested = 30
  assert.equal(calculateSuggestedOrderQty(0, 10, 30), 30);

  // Case C: stock <= reorderLevel without maxStock (current=5, reorder=10, max=null) -> suggested = 20 - 5 = 15
  assert.equal(calculateSuggestedOrderQty(5, 10, null), 15);

  // Case D: normal stock above reorderLevel (current=25, reorder=20, max=50) -> suggested = 0
  assert.equal(calculateSuggestedOrderQty(25, 20, 50), 0);

  // Case E: zero reorder level with stock=0, max=null -> fallback default 10
  assert.equal(calculateSuggestedOrderQty(0, 0, null), 10);
});

test('2. Purchase Order creation: creates PO with items, snapshots, totals, and audit log', async () => {
  const { state, client } = makePurchaseOrderHarness({
    suppliers: [{ id: 'sup-1', name: 'Distributor A', phone: '9876543210', outstanding: 0 }],
    products: [
      { id: 'p-1', name: 'Paracetamol 500mg', active: true, reorderLevel: 20, maxStock: 50, purchasePrice: 10, sellingPrice: 15, supplierId: 'sup-1' },
      { id: 'p-2', name: 'Amoxicillin 500mg', active: true, reorderLevel: 10, maxStock: 30, purchasePrice: 20, sellingPrice: 28, supplierId: 'sup-1' },
    ],
    batches: [
      { id: 'b-1', productId: 'p-1', quantity: 10, expiryDate: new Date('2027-01-01') },
      { id: 'b-2', productId: 'p-2', quantity: 5, expiryDate: new Date('2027-01-01') },
    ],
  });

  const order = await createPurchaseOrder(
    {
      supplier: 'Distributor A',
      supplierId: 'sup-1',
      notes: 'Urgent delivery',
      items: [
        { productId: 'p-1', quantity: 40, unitPrice: 10 },
        { productId: 'p-2', quantity: 25, unitPrice: 20 },
      ],
      createdById: 'user-1',
    },
    'key-po-create-1',
    client,
  );

  assert.ok(order.id);
  assert.match(order.orderNumber, /^PO-\d{8}-\d{4}$/);
  assert.equal(order.supplier, 'Distributor A');
  assert.equal(order.supplierId, 'sup-1');
  assert.equal(order.status, 'DRAFT');
  assert.equal(order.totalQuantity, 65);
  assert.equal(Number(order.totalAmount), 900); // 40*10 + 25*20 = 400 + 500 = 900
  assert.equal(order.items.length, 2);

  // Check item snapshots
  const item1 = order.items.find((i: any) => i.productId === 'p-1');
  assert.equal(item1.currentStockSnapshot, 10);
  assert.equal(item1.reorderLevelSnapshot, 20);
  assert.equal(Number(item1.unitPrice), 10);

  // Check audit log
  const audit = state.auditLogs.find((a) => a.action === 'PURCHASE_ORDER_CREATED');
  assert.ok(audit);
  assert.equal(audit.entityId, order.id);
});

test('3. CRITICAL FINANCIAL ISOLATION: Creating Purchase Order does NOT affect inventory, cashbook, supplier outstanding, or purchases', async () => {
  const { state, client } = makePurchaseOrderHarness({
    suppliers: [{ id: 'sup-1', name: 'Distributor A', outstanding: 1500 }],
    products: [
      { id: 'p-1', name: 'Paracetamol 500mg', active: true, reorderLevel: 20, maxStock: 50, purchasePrice: 10, supplierId: 'sup-1' },
    ],
    batches: [
      { id: 'b-1', productId: 'p-1', quantity: 10 },
    ],
  });

  const beforeBatchQty = state.batches[0]!.quantity;
  const beforeOutstanding = state.suppliers[0]!.outstanding;

  await createPurchaseOrder(
    {
      supplier: 'Distributor A',
      supplierId: 'sup-1',
      items: [{ productId: 'p-1', quantity: 40, unitPrice: 10 }],
    },
    'key-po-isolation',
    client,
  );

  // Verify inventory is UNTOUCHED
  assert.equal(state.batches[0]!.quantity, beforeBatchQty);
  assert.equal(state.stockMovements.length, 0);

  // Verify cashbook is UNTOUCHED
  assert.equal(state.cashbookEntries.length, 0);

  // Verify supplier outstanding is UNTOUCHED
  assert.equal(state.suppliers[0]!.outstanding, beforeOutstanding);

  // Verify Purchase table is UNTOUCHED
  assert.equal(state.purchases.length, 0);
});

test('4. Duplicate product in the same order is strictly rejected', async () => {
  const { client } = makePurchaseOrderHarness({
    suppliers: [{ id: 'sup-1', name: 'Distributor A' }],
    products: [{ id: 'p-1', name: 'Paracetamol 500mg', active: true, supplierId: 'sup-1' }],
  });

  await assert.rejects(
    () =>
      createPurchaseOrder(
        {
          supplier: 'Distributor A',
          items: [
            { productId: 'p-1', quantity: 10 },
            { productId: 'p-1', quantity: 20 },
          ],
        },
        undefined,
        client,
      ),
    (err: any) => err.message.includes('Duplicate product'),
  );
});

test('5. Non-positive and zero quantities are rejected', async () => {
  const { client } = makePurchaseOrderHarness({
    suppliers: [{ id: 'sup-1', name: 'Distributor A' }],
    products: [{ id: 'p-1', name: 'Paracetamol 500mg', active: true, supplierId: 'sup-1' }],
  });

  await assert.rejects(
    () =>
      createPurchaseOrder(
        {
          supplier: 'Distributor A',
          items: [{ productId: 'p-1', quantity: 0 }],
        },
        undefined,
        client,
      ),
    (err: any) => err.message.includes('positive integer'),
  );

  await assert.rejects(
    () =>
      createPurchaseOrder(
        {
          supplier: 'Distributor A',
          items: [{ productId: 'p-1', quantity: -5 }],
        },
        undefined,
        client,
      ),
    (err: any) => err.message.includes('positive integer'),
  );
});

test('6. Inactive product cannot be added to a purchase order', async () => {
  const { client } = makePurchaseOrderHarness({
    suppliers: [{ id: 'sup-1', name: 'Distributor A' }],
    products: [{ id: 'p-1', name: 'Discontinued Drug', active: false, supplierId: 'sup-1' }],
  });

  await assert.rejects(
    () =>
      createPurchaseOrder(
        {
          supplier: 'Distributor A',
          items: [{ productId: 'p-1', quantity: 10 }],
        },
        undefined,
        client,
      ),
    (err: any) => err.message.includes('inactive'),
  );
});

test('7. Purchase Order update: updates items, recalculates totals, and enforces DRAFT-only status', async () => {
  const { client } = makePurchaseOrderHarness({
    suppliers: [{ id: 'sup-1', name: 'Distributor A' }],
    products: [
      { id: 'p-1', name: 'Paracetamol 500mg', active: true, reorderLevel: 20, maxStock: 50, purchasePrice: 10, supplierId: 'sup-1' },
      { id: 'p-2', name: 'Amoxicillin 500mg', active: true, reorderLevel: 10, maxStock: 30, purchasePrice: 20, supplierId: 'sup-1' },
    ],
    batches: [
      { id: 'b-1', productId: 'p-1', quantity: 10 },
      { id: 'b-2', productId: 'p-2', quantity: 5 },
    ],
  });

  const order = await createPurchaseOrder(
    {
      supplier: 'Distributor A',
      supplierId: 'sup-1',
      items: [{ productId: 'p-1', quantity: 20, unitPrice: 10 }],
    },
    'key-edit-init',
    client,
  );

  assert.equal(order.totalQuantity, 20);
  assert.equal(Number(order.totalAmount), 200);

  // Update draft order
  const updated = await updatePurchaseOrder(
    order.id,
    {
      notes: 'Updated quantities',
      items: [
        { productId: 'p-1', quantity: 30, unitPrice: 10 },
        { productId: 'p-2', quantity: 10, unitPrice: 20 },
      ],
    },
    'user-1',
    client,
  );

  assert.equal(updated.totalQuantity, 40);
  assert.equal(Number(updated.totalAmount), 500); // 30*10 + 10*20 = 500
  assert.equal(updated.notes, 'Updated quantities');
});

test('8. Order status state machine: valid transitions and invalid transition rejections', async () => {
  const { client } = makePurchaseOrderHarness({
    suppliers: [{ id: 'sup-1', name: 'Distributor A' }],
    products: [{ id: 'p-1', name: 'Paracetamol 500mg', active: true, supplierId: 'sup-1' }],
    batches: [{ id: 'b-1', productId: 'p-1', quantity: 10 }],
  });

  const order = await createPurchaseOrder(
    {
      supplier: 'Distributor A',
      items: [{ productId: 'p-1', quantity: 20, unitPrice: 10 }],
    },
    'key-status-test',
    client,
  );

  // 1. DRAFT -> ORDERED: Valid
  const ordered = await updatePurchaseOrderStatus(order.id, 'ORDERED', 'Sent via WhatsApp', 'user-1', client);
  assert.equal(ordered.status, 'ORDERED');

  // 2. ORDERED -> DRAFT: Invalid (cannot revert ordered to draft)
  await assert.rejects(
    () => updatePurchaseOrderStatus(order.id, 'DRAFT', undefined, 'user-1', client),
    (err: any) => err.message.includes('Invalid status transition'),
  );

  // 3. ORDERED -> PARTIALLY_RECEIVED: Valid
  const partiallyReceived = await updatePurchaseOrderStatus(order.id, 'PARTIALLY_RECEIVED', 'Received 10 of 20', 'user-1', client);
  assert.equal(partiallyReceived.status, 'PARTIALLY_RECEIVED');

  // 4. PARTIALLY_RECEIVED -> RECEIVED: Valid
  const received = await updatePurchaseOrderStatus(order.id, 'RECEIVED', 'All goods arrived', 'user-1', client);
  assert.equal(received.status, 'RECEIVED');

  // 5. RECEIVED -> CANCELLED: Invalid (cannot cancel fully received order)
  await assert.rejects(
    () => updatePurchaseOrderStatus(order.id, 'CANCELLED', undefined, 'user-1', client),
    (err: any) => err.message.includes('Invalid status transition'),
  );

  // 6. Non-draft order cannot be edited
  await assert.rejects(
    () => updatePurchaseOrder(order.id, { items: [{ productId: 'p-1', quantity: 50 }] }, 'user-1', client),
    (err: any) => err.message.includes('Only DRAFT purchase orders can be edited'),
  );
});

test('9. Cancel Purchase Order: sets status CANCELLED and writes audit log', async () => {
  const { state, client } = makePurchaseOrderHarness({
    suppliers: [{ id: 'sup-1', name: 'Distributor A' }],
    products: [{ id: 'p-1', name: 'Paracetamol 500mg', active: true, supplierId: 'sup-1' }],
    batches: [{ id: 'b-1', productId: 'p-1', quantity: 10 }],
  });

  const order = await createPurchaseOrder(
    {
      supplier: 'Distributor A',
      items: [{ productId: 'p-1', quantity: 20, unitPrice: 10 }],
    },
    'key-cancel-test',
    client,
  );

  const cancelled = await cancelPurchaseOrder(order.id, 'Supplier out of stock', 'user-1', client);
  assert.equal(cancelled.status, 'CANCELLED');

  const audit = state.auditLogs.find((a) => a.action === 'PURCHASE_ORDER_CANCELLED');
  assert.ok(audit);
  assert.equal(audit.entityId, order.id);
});

test('10. Reorder from history: creates a NEW order without mutating the historical order', async () => {
  const { state, client } = makePurchaseOrderHarness({
    suppliers: [{ id: 'sup-1', name: 'Distributor A' }],
    products: [
      { id: 'p-1', name: 'Paracetamol 500mg', active: true, reorderLevel: 20, maxStock: 50, purchasePrice: 10, supplierId: 'sup-1' },
    ],
    batches: [{ id: 'b-1', productId: 'p-1', quantity: 10 }],
  });

  const originalOrder = await createPurchaseOrder(
    {
      supplier: 'Distributor A',
      supplierId: 'sup-1',
      items: [{ productId: 'p-1', quantity: 40, unitPrice: 10 }],
    },
    'key-orig-order',
    client,
  );

  // Mark original as RECEIVED
  await updatePurchaseOrderStatus(originalOrder.id, 'ORDERED', undefined, 'user-1', client);
  await updatePurchaseOrderStatus(originalOrder.id, 'RECEIVED', undefined, 'user-1', client);

  // Reorder
  const newOrder = await reorderPurchaseOrder(originalOrder.id, 'user-1', 'key-reorder-1', client);

  assert.ok(newOrder.id);
  assert.notEqual(newOrder.id, originalOrder.id);
  assert.equal(newOrder.status, 'DRAFT');
  assert.equal(newOrder.supplier, 'Distributor A');
  assert.equal(newOrder.totalQuantity, 40);

  // Verify historical order is STILL RECEIVED and UNMUTATED
  const hist = state.purchaseOrders.find((o) => o.id === originalOrder.id);
  assert.equal(hist.status, 'RECEIVED');

  // Verify audit log for reordering
  const reorderAudit = state.auditLogs.find((a) => a.action === 'PURCHASE_ORDER_REORDERED');
  assert.ok(reorderAudit);
  assert.equal(reorderAudit.newValue.reorderedFromId, originalOrder.id);
});

test('11. Idempotency: duplicate request returns original; mismatched payload is rejected', async () => {
  const { client } = makePurchaseOrderHarness({
    suppliers: [{ id: 'sup-1', name: 'Distributor A' }],
    products: [
      { id: 'p-1', name: 'Paracetamol 500mg', active: true, purchasePrice: 10, supplierId: 'sup-1' },
      { id: 'p-2', name: 'Amoxicillin 500mg', active: true, purchasePrice: 20, supplierId: 'sup-1' },
    ],
    batches: [{ id: 'b-1', productId: 'p-1', quantity: 10 }],
  });

  const payload = {
    supplier: 'Distributor A',
    items: [{ productId: 'p-1', quantity: 20, unitPrice: 10 }],
  };

  const first = await createPurchaseOrder(payload, 'idemp-key-1', client);
  const retry = await createPurchaseOrder(payload, 'idemp-key-1', client);

  assert.equal(first.id, retry.id);

  // Reusing same idempotency key with different items must throw
  await assert.rejects(
    () =>
      createPurchaseOrder(
        {
          supplier: 'Distributor A',
          items: [{ productId: 'p-2', quantity: 50, unitPrice: 20 }],
        },
        'idemp-key-1',
        client,
      ),
    (err: any) => err.message.includes('Idempotency key reused with different payload'),
  );
});

test('12. getPurchaseList: returns stock context, price history, supplier grouping, and suggestions', async () => {
  const { client } = makePurchaseOrderHarness({
    suppliers: [
      { id: 'sup-1', name: 'Distributor A', phone: '9876543210' },
      { id: 'sup-2', name: 'Distributor B', phone: '9123456780' },
    ],
    products: [
      { id: 'p-1', name: 'Paracetamol 500mg', active: true, reorderLevel: 20, minStock: 10, maxStock: 50, purchasePrice: 10, supplierId: 'sup-1' },
      { id: 'p-2', name: 'Amoxicillin 500mg', active: true, reorderLevel: 15, minStock: 5, maxStock: 40, purchasePrice: 22, supplierId: 'sup-2' },
      { id: 'p-3', name: 'Normal Vitamin C', active: true, reorderLevel: 5, minStock: 2, maxStock: 20, purchasePrice: 5, supplierId: 'sup-1' },
    ],
    batches: [
      { id: 'b-1', productId: 'p-1', quantity: 5 }, // Low stock: 5 <= 20 -> suggested = 50 - 5 = 45
      { id: 'b-2', productId: 'p-2', quantity: 0 }, // Out of stock: 0 <= 15 -> suggested = 40 - 0 = 40
      { id: 'b-3', productId: 'p-3', quantity: 15 }, // Normal: 15 > 5 -> suggested = 0
    ],
    purchases: [
      { id: 'pur-1', invoiceDate: new Date('2026-09-01'), supplier: { name: 'Distributor A' } },
      { id: 'pur-2', invoiceDate: new Date('2026-08-01'), supplier: { name: 'Distributor A' } },
    ],
    purchaseItems: [
      { id: 'pi-1', purchaseId: 'pur-1', productId: 'p-1', purchaseRate: 10.5 },
      { id: 'pi-2', purchaseId: 'pur-2', productId: 'p-1', purchaseRate: 9.8 },
    ],
  });

  const list = await getPurchaseList({}, client);
  assert.equal(list.length, 3);

  const p1 = list.find((item) => item.id === 'p-1')!;
  assert.equal(p1.currentStock, 5);
  assert.equal(p1.stockStatus, 'LOW_STOCK');
  assert.equal(p1.suggestedQuantity, 45);
  assert.equal(p1.latestPurchasePrice, 10.5);
  assert.equal(p1.previousPurchasePrice, 9.8);
  assert.equal(p1.supplierName, 'Distributor A');

  const p2 = list.find((item) => item.id === 'p-2')!;
  assert.equal(p2.currentStock, 0);
  assert.equal(p2.stockStatus, 'OUT_OF_STOCK');
  assert.equal(p2.suggestedQuantity, 40);

  // Filter low stock only
  const lowStockOnly = await getPurchaseList({ filter: 'LOW_STOCK' }, client);
  assert.equal(lowStockOnly.length, 2);
  assert.ok(lowStockOnly.some((i) => i.id === 'p-1'));
  assert.ok(lowStockOnly.some((i) => i.id === 'p-2'));

  // Filter out of stock only
  const outOfStockOnly = await getPurchaseList({ filter: 'OUT_OF_STOCK' }, client);
  assert.equal(outOfStockOnly.length, 1);
  assert.equal(outOfStockOnly[0]!.id, 'p-2');
});

test('13. Copy Order Text & WhatsApp URL formatting', () => {
  const order = {
    orderNumber: 'PO-20261006-1234',
    supplier: 'Distributor A',
    orderDate: new Date('2026-10-06T00:00:00.000Z'),
    totalQuantity: 50,
    totalAmount: 1250,
    notes: 'Please pack in carton',
    items: [
      { quantity: 30, unitPrice: 25, notes: '500mg strip', product: { name: 'Paracetamol' } },
      { quantity: 20, unitPrice: 25, notes: null, product: { name: 'Amoxicillin' } },
    ],
  };

  const text = generateOrderText(order);
  assert.match(text, /\*Order for Distributor A\*/);
  assert.match(text, /PO#: PO-20261006-1234/);
  assert.match(text, /1\. Paracetamol - 30 pcs \(500mg strip\)/);
  assert.match(text, /2\. Amoxicillin - 20 pcs/);
  assert.match(text, /Total Items: 2 \| Total Qty: 50/);
  assert.match(text, /Est\. Value: ₹1250\.00/);
  assert.match(text, /Notes: Please pack in carton/);

  // WhatsApp with valid phone
  const waUrl = generateWhatsAppUrl(text, '+91 98765-43210');
  assert.ok(waUrl.startsWith('https://wa.me/919876543210?text='));

  // WhatsApp fallback with empty phone
  const waUrlNoPhone = generateWhatsAppUrl(text, null);
  assert.ok(waUrlNoPhone.startsWith('https://wa.me/?text='));
});

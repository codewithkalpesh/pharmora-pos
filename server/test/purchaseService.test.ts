import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupplier, updateSupplier, listSuppliers } from '../src/services/supplierService.js';
import { calculatePurchaseTotal, createPurchase } from '../src/services/purchaseService.js';
import { recordSupplierPayment } from '../src/services/paymentService.js';
import { invalid } from '../src/services/domainUtils.js';

const asClient = (value: unknown) => value as never;

// ── Supplier harness ──────────────────────────────────────────────────────────
const makeSupplierHarness = (initial: Record<string, unknown> | null = null) => {
  const state = {
    supplier: initial,
    audits: [] as Array<Record<string, unknown>>,
    suppliers: initial ? [initial] : [] as Array<Record<string, unknown>>,
  };
  const client = asClient({
    supplier: {
      findUnique: async ({ where }: any) => {
        const found = state.suppliers.find((s: any) => s.id === where.id);
        return found ? { ...found } : null; // shallow copy so update doesn't mutate the captured snapshot
      },
      findMany: async ({ where }: any) => {
        if (!where) return state.suppliers.map((s: any) => ({ ...s, purchases: [], supplierPayments: [] }));
        const query = where.OR?.flatMap((o: any) => Object.values(o)).map((c: any) => c.contains?.toLowerCase()).filter(Boolean) ?? [];
        return state.suppliers
          .filter((s: any) => !query.length || query.some((q: string) => s.name?.toLowerCase().includes(q) || s.phone?.includes(q) || s.gstin?.includes(q)))
          .map((s: any) => ({ ...s, purchases: [], supplierPayments: [] }));
      },
      create: async ({ data }: any) => {
        const row = { id: 'supplier-1', outstanding: 0, ...data };
        state.suppliers.push(row);
        state.supplier = row;
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.suppliers.find((s: any) => s.id === where.id) as any;
        if (!row) return null;
        Object.assign(row, data);
        state.supplier = row;
        return row;
      },
    },
    auditLog: { create: async ({ data }: any) => { const row = { id: `audit-${state.audits.length + 1}`, ...data }; state.audits.push(row); return row; } },
  });
  return { client, state };
};

// ── Full purchase harness ─────────────────────────────────────────────────────
const makePurchaseHarness = () => {
  const state = {
    suppliers: [{ id: 'supplier-1', name: 'Test Supplier', outstanding: 0 }] as any[],
    products: [{ id: 'product-1', name: 'Paracetamol 500mg' }] as any[],
    batches: [] as any[],
    purchases: [] as any[],
    purchaseItems: [] as any[],
    movements: [] as any[],
    cashbook: [] as any[],
    audits: [] as any[],
    supplierPayments: [] as any[],
  };

  const client: any = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(client),
    supplier: {
      findUnique: async ({ where }: any) => state.suppliers.find((s: any) => s.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const s = state.suppliers.find((s: any) => s.id === where.id) as any;
        if (!s) return null;
        if (data.outstanding?.increment) s.outstanding += Number(data.outstanding.increment);
        if (data.outstanding?.decrement) s.outstanding -= Number(data.outstanding.decrement);
        return { ...s };
      },
    },
    product: {
      findUnique: async ({ where }: any) => state.products.find((p: any) => p.id === where.id) ?? null,
    },
    productBatch: {
      findUnique: async ({ where }: any) => {
        if (where.id) return state.batches.find((b: any) => b.id === where.id) ?? null;
        if (where.productId_batchNumber) {
          return state.batches.find((b: any) =>
            b.productId === where.productId_batchNumber.productId &&
            b.batchNumber === where.productId_batchNumber.batchNumber
          ) ?? null;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const row = { id: `batch-${state.batches.length + 1}`, quantity: 0, freeQuantity: 0, ...data };
        state.batches.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.batches.find((b: any) => b.id === where.id) as any;
        if (!row) return null;
        if (data.quantity?.increment) row.quantity += data.quantity.increment;
        if (data.quantity?.decrement) row.quantity -= data.quantity.decrement;
        if (data.freeQuantity?.increment) row.freeQuantity += data.freeQuantity.increment;
        for (const [k, v] of Object.entries(data)) {
          if (k !== 'quantity' && k !== 'freeQuantity') row[k] = v;
        }
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const row = state.batches.find((b: any) => b.id === where.id) as any;
        if (!row || row.quantity < where.quantity.gte) return { count: 0 };
        row.quantity -= data.quantity.decrement;
        return { count: 1 };
      },
    },
    purchase: {
      findUnique: async ({ where }: any) =>
        state.purchases.find((p: any) =>
          (where.id && p.id === where.id) ||
          (where.idempotencyKey && p.idempotencyKey === where.idempotencyKey)
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `purchase-${state.purchases.length + 1}`, ...data };
        state.purchases.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.purchases.find((p: any) => p.id === where.id) as any;
        Object.assign(row, data);
        return row;
      },
      findUnique_include: async (args: any) => {
        const p = state.purchases.find((p: any) => p.id === args.where.id) as any;
        return p ? { ...p, items: state.purchaseItems.filter((i: any) => i.purchaseId === p.id), supplier: state.suppliers[0] } : null;
      },
    },
    purchaseItem: {
      create: async ({ data }: any) => {
        const row = { id: `pi-${state.purchaseItems.length + 1}`, ...data };
        state.purchaseItems.push(row);
        return row;
      },
    },
    stockMovement: {
      findUnique: async ({ where }: any) =>
        state.movements.find((m: any) => m.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `movement-${state.movements.length + 1}`, ...data };
        state.movements.push(row);
        return row;
      },
    },
    dailyClosing: {
      findUnique: async () => null,
    },
    bankAccount: {
      findFirst: async () => null,
    },
    bankTransaction: {
      findMany: async () => [],
    },
    cashbookEntry: {
      findUnique: async ({ where }: any) =>
        state.cashbook.find((e: any) => e.idempotencyKey === where.idempotencyKey) ?? null,
      findFirst: async ({ where }: any) => {
        if (where?.entryType === 'OPENING_CASH') return null;
        return null;
      },
      create: async ({ data }: any) => {
        const row = { id: `entry-${state.cashbook.length + 1}`, ...data };
        state.cashbook.push(row);
        return row;
      },
    },
    supplierPayment: {
      findUnique: async ({ where }: any) =>
        state.supplierPayments.find((sp: any) => sp.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `sp-${state.supplierPayments.length + 1}`, ...data };
        state.supplierPayments.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const row = { id: `audit-${state.audits.length + 1}`, ...data };
        state.audits.push(row);
        return row;
      },
    },
  };

  // Patch purchase.findUnique to include items/supplier when include is specified
  const origFindUnique = client.purchase.findUnique.bind(client.purchase);
  client.purchase.findUnique = async (args: any) => {
    const p = await origFindUnique(args);
    if (!p || !args.include) return p;
    return {
      ...p,
      items: state.purchaseItems.filter((i: any) => i.purchaseId === p.id),
      supplier: state.suppliers.find((s: any) => s.id === p.supplierId) ?? null,
      supplierPayments: state.supplierPayments.filter((sp: any) => sp.purchaseId === p.id),
    };
  };

  return { client: asClient(client), state };
};

// ══════════════════════════════════════════════════════════════════════════════
// SUPPLIER TESTS
// ══════════════════════════════════════════════════════════════════════════════

test('supplier create stores name and emits audit record', async () => {
  const { client, state } = makeSupplierHarness();
  const supplier = await createSupplier({ name: 'Pharma Distributor Ltd', gstin: '22AAAAA0000A1Z5', phone: '9876543210' }, client, 'user-1');
  assert.equal(supplier.name, 'Pharma Distributor Ltd');
  assert.equal(supplier.gstin, '22AAAAA0000A1Z5');
  assert.equal(state.audits[0]?.action, 'SUPPLIER_CREATED');
});

test('supplier create trims whitespace from name', async () => {
  const { client } = makeSupplierHarness();
  const supplier = await createSupplier({ name: '  Whitespace Supplier  ' }, client);
  assert.equal(supplier.name, 'Whitespace Supplier');
});

test('supplier update emits audit with old and new values', async () => {
  const initial = { id: 'supplier-1', name: 'Old Name', phone: null, gstin: null, address: null, paymentTerms: null, creditLimit: null, outstanding: 0 };
  const { client, state } = makeSupplierHarness(initial);
  await updateSupplier('supplier-1', { name: 'New Name', paymentTerms: 'Net 30' }, client, 'user-1');
  assert.equal(state.supplier?.name, 'New Name');
  assert.equal(state.audits[0]?.action, 'SUPPLIER_UPDATED');
  assert.equal((state.audits[0]?.oldValue as any)?.name, 'Old Name');
  assert.equal((state.audits[0]?.newValue as any)?.name, 'New Name');
});

test('supplier list searches by name, phone, and GSTIN', async () => {
  const suppliers = [
    { id: 's1', name: 'Alpha Pharma', phone: '9000000001', gstin: 'GSTIN001', outstanding: 0 },
    { id: 's2', name: 'Beta Medical', phone: '9000000002', gstin: 'GSTIN002', outstanding: 0 },
  ];
  const state = { suppliers, audits: [] as any[] };
  const client = asClient({
    supplier: {
      findMany: async ({ where }: any) => {
        const withRelations = (s: typeof suppliers[0]) => ({ ...s, purchases: [], supplierPayments: [] });
        if (!where) return suppliers.map(withRelations);
        const orTerms = where.OR ?? [];
        return suppliers
          .filter((s) =>
            orTerms.some((term: any) => {
              if (term.name?.contains) return s.name.toLowerCase().includes(term.name.contains.toLowerCase());
              if (term.phone?.contains) return s.phone.includes(term.phone.contains);
              if (term.gstin?.contains) return s.gstin.includes(term.gstin.contains);
              return false;
            })
          )
          .map(withRelations);
      },
    },
    auditLog: { create: async () => ({}) },
  });
  const nameResult = await listSuppliers('Alpha', client as any);
  assert.equal(nameResult.length, 1);
  const phoneResult = await listSuppliers('9000000002', client as any);
  assert.equal(phoneResult.length, 1);
  assert.equal((phoneResult[0] as any).name, 'Beta Medical');
});

test('supplier credit limit must be non-negative', async () => {
  const { client } = makeSupplierHarness();
  await assert.rejects(() => createSupplier({ name: 'Bad Supplier', creditLimit: -1 }, client));
});

// ══════════════════════════════════════════════════════════════════════════════
// PURCHASE CALCULATION TESTS
// ══════════════════════════════════════════════════════════════════════════════

test('purchase total calculation: quantity × rate gives correct subtotal', () => {
  const total = calculatePurchaseTotal([{ productId: 'p1', batchNumber: 'B1', quantity: 10, purchaseRate: 100, gst: 0, discount: 0 }]);
  assert.equal(total, 1000);
});

test('purchase total with GST applies percentage correctly', () => {
  const total = calculatePurchaseTotal([{ productId: 'p1', batchNumber: 'B1', quantity: 10, purchaseRate: 100, gst: 18, discount: 0 }]);
  assert.equal(total, 1180);
});

test('purchase total with item discount reduces base before GST', () => {
  // qty=10, rate=100, discount=5% of base=₹50 → base=950, GST 18% → 950*1.18=1121
  const total = calculatePurchaseTotal([{ productId: 'p1', batchNumber: 'B1', quantity: 10, purchaseRate: 100, gst: 18, discount: 50 }]);
  assert.equal(total, Math.round((1000 - 50) * 1.18 * 100) / 100);
});

test('purchase total sums multiple line items', () => {
  const total = calculatePurchaseTotal([
    { productId: 'p1', batchNumber: 'B1', quantity: 10, purchaseRate: 100, gst: 0, discount: 0 },
    { productId: 'p2', batchNumber: 'B2', quantity: 5, purchaseRate: 200, gst: 0, discount: 0 },
  ]);
  assert.equal(total, 2000);
});

test('purchase calculation rejects zero item list', () => {
  assert.throws(() => calculatePurchaseTotal([]), /at least one item/i);
});

// ══════════════════════════════════════════════════════════════════════════════
// PURCHASE CREATION — PAYMENT METHODS
// ══════════════════════════════════════════════════════════════════════════════

const basePurchaseInput = {
  supplierId: 'supplier-1',
  invoiceNumber: 'INV-001',
  invoiceDate: new Date('2026-10-01'),
  items: [{ productId: 'product-1', batchNumber: 'B001', quantity: 100, freeQty: 10, purchaseRate: 100, gst: 0, discount: 0 }],
};

test('CASH purchase: inventory increases, cashbook cash-out created, supplier outstanding = 0', async () => {
  const { client, state } = makePurchaseHarness();
  const purchase = await createPurchase({ ...basePurchaseInput, paymentMethod: 'CASH' }, 'key-cash-001', client as any);
  assert.ok(purchase, 'Purchase created');
  assert.equal(Number((purchase as any).totalAmount), 10000, 'Total = 100 qty × ₹100');
  assert.equal(Number((purchase as any).paidAmount), 10000, 'Fully paid');
  assert.equal(Number((purchase as any).outstandingAmount), 0, 'No outstanding');

  // Batch quantity = 100 (qty) + 10 (free) = 110
  const batch = state.batches[0]!;
  assert.equal(batch.quantity, 110, 'Batch quantity includes free');

  // StockMovement created
  assert.equal(state.movements.length, 1);
  assert.equal(state.movements[0]!.movementType, 'PURCHASE_IN');
  assert.equal(state.movements[0]!.quantity, 110);

  // Cashbook cash-out
  const cashOuts = state.cashbook.filter((e: any) => e.direction === 'OUT' && e.paymentMethod === 'CASH');
  assert.equal(cashOuts.length, 1);
  assert.equal(Number(cashOuts[0]!.amount), 10000);

  // Supplier outstanding not increased
  assert.equal(Number(state.suppliers[0]!.outstanding), 0);

  // Audit created
  assert.ok(state.audits.some((a: any) => a.action === 'PURCHASE_CREATED'));
});

test('CREDIT purchase: inventory increases, no cashbook entry, supplier outstanding increases', async () => {
  const { client, state } = makePurchaseHarness();
  const purchase = await createPurchase({ ...basePurchaseInput, paymentMethod: 'CREDIT', paidAmount: 0 }, 'key-credit-001', client as any);
  assert.equal(Number((purchase as any).paidAmount), 0, 'Paid = 0 for credit');
  assert.equal(Number((purchase as any).outstandingAmount), 10000, 'Full amount outstanding');

  // No cashbook entries created
  assert.equal(state.cashbook.length, 0, 'No cashbook entries for credit purchase');

  // Supplier outstanding increased
  assert.equal(Number(state.suppliers[0]!.outstanding), 10000, 'Supplier outstanding = full purchase');

  // Inventory still updated
  assert.equal(state.movements.length, 1);
  assert.equal(state.movements[0]!.movementType, 'PURCHASE_IN');
});

test('UPI purchase: cashbook UPI outflow, physical cash unchanged', async () => {
  const { client, state } = makePurchaseHarness();
  await createPurchase({ ...basePurchaseInput, paymentMethod: 'UPI', paidAmount: 10000 }, 'key-upi-001', client as any);

  const cashEntries = state.cashbook.filter((e: any) => e.paymentMethod === 'CASH');
  assert.equal(cashEntries.length, 0, 'No physical cash entry for UPI purchase');

  const upiEntries = state.cashbook.filter((e: any) => e.paymentMethod === 'UPI' && e.direction === 'OUT');
  assert.equal(upiEntries.length, 1);
  assert.equal(Number(upiEntries[0]!.amount), 10000);
});

test('BOTH purchase: cash out + UPI out, amounts correct, supplier outstanding = 0', async () => {
  const { client, state } = makePurchaseHarness();
  await createPurchase({
    ...basePurchaseInput,
    paymentMethod: 'BOTH',
    cashAmount: 4000,
    upiAmount: 6000,
  }, 'key-both-001', client as any);

  const cashOut = state.cashbook.find((e: any) => e.paymentMethod === 'CASH' && e.direction === 'OUT');
  const upiOut = state.cashbook.find((e: any) => e.paymentMethod === 'UPI' && e.direction === 'OUT');
  assert.ok(cashOut, 'Cash out entry exists');
  assert.ok(upiOut, 'UPI out entry exists');
  assert.equal(Number(cashOut!.amount), 4000);
  assert.equal(Number(upiOut!.amount), 6000);
  assert.equal(Number(state.suppliers[0]!.outstanding), 0);
});

test('partial CASH purchase: outstanding = total - paid, cashbook only for paid portion', async () => {
  const { client, state } = makePurchaseHarness();
  await createPurchase({
    ...basePurchaseInput,
    paymentMethod: 'CASH',
    paidAmount: 4000,
  }, 'key-partial-001', client as any);

  const cashOut = state.cashbook.find((e: any) => e.direction === 'OUT' && e.paymentMethod === 'CASH');
  assert.ok(cashOut, 'Cash out entry for paid portion');
  assert.equal(Number(cashOut!.amount), 4000, 'Cashbook only records paid amount');
  assert.equal(Number(state.suppliers[0]!.outstanding), 6000, 'Outstanding = 10000 - 4000');
});

test('purchase idempotency: same key returns original, does not duplicate inventory', async () => {
  const { client, state } = makePurchaseHarness();
  const first = await createPurchase({ ...basePurchaseInput, paymentMethod: 'CASH' }, 'key-idem-001', client as any);
  const second = await createPurchase({ ...basePurchaseInput, paymentMethod: 'CASH' }, 'key-idem-001', client as any);

  assert.equal((first as any).id, (second as any).id, 'Same purchase returned');
  assert.equal(state.purchases.length, 1, 'Only one purchase created');
  assert.equal(state.movements.length, 1, 'Only one stock movement');
  assert.equal(state.cashbook.filter((e: any) => e.direction === 'OUT').length, 1, 'Only one cashbook entry');
});

test('purchase batch: same product+batch reuses existing batch, different batch creates new', async () => {
  const { client, state } = makePurchaseHarness();

  // First purchase with batch B001
  await createPurchase({
    ...basePurchaseInput,
    items: [{ productId: 'product-1', batchNumber: 'B001', quantity: 50, purchaseRate: 100 }],
    paymentMethod: 'CASH',
  }, 'key-batch-001', client as any);

  assert.equal(state.batches.length, 1, 'One batch created');

  // Second purchase with same batch B001 - should reuse
  await createPurchase({
    supplierId: 'supplier-1',
    invoiceNumber: 'INV-002',
    invoiceDate: new Date('2026-10-05'),
    items: [{ productId: 'product-1', batchNumber: 'B001', quantity: 30, purchaseRate: 100 }],
    paymentMethod: 'CASH',
  }, 'key-batch-002', client as any);

  assert.equal(state.batches.length, 1, 'Same batch reused, no new batch created');
  assert.equal(state.batches[0]!.quantity, 80, 'Quantity accumulated: 50 + 30');

  // Third purchase with different batch B002 - should create new
  await createPurchase({
    supplierId: 'supplier-1',
    invoiceNumber: 'INV-003',
    invoiceDate: new Date('2026-10-05'),
    items: [{ productId: 'product-1', batchNumber: 'B002', quantity: 20, purchaseRate: 100 }],
    paymentMethod: 'CASH',
  }, 'key-batch-003', client as any);

  assert.equal(state.batches.length, 2, 'New batch created for different batch number');
});

test('purchase inventory convention: qty + freeQty both added to stock, no double counting', async () => {
  const { client, state } = makePurchaseHarness();
  await createPurchase({
    ...basePurchaseInput,
    items: [{ productId: 'product-1', batchNumber: 'B001', quantity: 100, freeQty: 10, purchaseRate: 100 }],
    paymentMethod: 'CASH',
  }, 'key-stock-001', client as any);

  const movement = state.movements[0]!;
  assert.equal(movement.quantity, 110, 'StockMovement records qty + freeQty = 110');
  assert.equal(state.batches[0]!.quantity, 110, 'Batch quantity = 110');
  assert.equal(state.batches[0]!.freeQuantity, 10, 'freeQuantity field tracks free units');
  assert.equal(state.movements.length, 1, 'Exactly one stock movement, no double counting');
});

// ══════════════════════════════════════════════════════════════════════════════
// SUPPLIER PAYMENT TESTS
// ══════════════════════════════════════════════════════════════════════════════

test('supplier payment: reduces purchase outstanding, emits cashbook cash-out and audit', async () => {
  const { client, state } = makePurchaseHarness();

  // Create a credit purchase first to have outstanding
  await createPurchase({
    ...basePurchaseInput,
    paymentMethod: 'CREDIT',
    paidAmount: 0,
  }, 'key-credit-pay-001', client as any);

  const purchase = state.purchases[0]!;
  assert.equal(Number(state.suppliers[0]!.outstanding), 10000);

  // Record supplier payment
  await recordSupplierPayment(
    { supplierId: 'supplier-1', purchaseId: purchase.id, amount: 3000, paymentMethod: 'CASH', createdById: 'user-1' },
    'key-sup-pay-001',
    client as any,
  );

  // Purchase paidAmount updated
  const updatedPurchase = state.purchases[0]!;
  assert.equal(Number(updatedPurchase.paidAmount), 3000);
  assert.equal(Number(updatedPurchase.outstandingAmount), 7000);

  // Supplier outstanding decreased
  assert.equal(Number(state.suppliers[0]!.outstanding), 7000, 'Supplier outstanding reduced');

  // Cashbook cash-out created
  const supPayCashOut = state.cashbook.find((e: any) => e.entryType === 'SUPPLIER_PAYMENT' && e.direction === 'OUT');
  assert.ok(supPayCashOut, 'Supplier payment cashbook entry created');
  assert.equal(Number(supPayCashOut!.amount), 3000);

  // Audit created
  assert.ok(state.audits.some((a: any) => a.action === 'SUPPLIER_PAYMENT_CREATED'), 'Payment audit record created');
});

test('supplier payment rejects amount exceeding outstanding', async () => {
  const { client, state } = makePurchaseHarness();
  await createPurchase({ ...basePurchaseInput, paymentMethod: 'CREDIT', paidAmount: 0 }, 'key-credit-reject-001', client as any);
  const purchase = state.purchases[0]!;

  await assert.rejects(
    () => recordSupplierPayment(
      { supplierId: 'supplier-1', purchaseId: purchase.id, amount: 15000, paymentMethod: 'CASH' },
      'key-sup-pay-overdue',
      client as any,
    ),
    /cannot exceed/i,
  );
});

test('supplier payment idempotency: same key returns original, does not double pay', async () => {
  const { client, state } = makePurchaseHarness();
  await createPurchase({ ...basePurchaseInput, paymentMethod: 'CREDIT', paidAmount: 0 }, 'key-credit-idem', client as any);
  const purchase = state.purchases[0]!;

  const first = await recordSupplierPayment(
    { supplierId: 'supplier-1', purchaseId: purchase.id, amount: 2000, paymentMethod: 'CASH' },
    'key-sup-pay-idem',
    client as any,
  );
  const second = await recordSupplierPayment(
    { supplierId: 'supplier-1', purchaseId: purchase.id, amount: 2000, paymentMethod: 'CASH' },
    'key-sup-pay-idem',
    client as any,
  );

  assert.equal((first as any).id, (second as any).id, 'Same payment returned for same key');
  assert.equal(state.supplierPayments.length, 1, 'Only one supplier payment record');
  assert.equal(state.cashbook.filter((e: any) => e.entryType === 'SUPPLIER_PAYMENT').length, 1, 'Only one cashbook entry');
});

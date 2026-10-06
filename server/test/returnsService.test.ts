import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { createSaleReturn, listSaleReturns, getSaleReturn, createPurchaseReturn, listPurchaseReturns, getPurchaseReturn } from '../src/services/returnsService.js';
import { getExpiryDashboard, listNearExpiryBatches } from '../src/services/batchService.js';

const decimal = (value: number | string) => new Prisma.Decimal(value);

const createMockDb = () => {
  const store = {
    products: [] as any[],
    batches: [] as any[],
    sales: [] as any[],
    saleItems: [] as any[],
    saleReturns: [] as any[],
    saleReturnItems: [] as any[],
    purchases: [] as any[],
    purchaseItems: [] as any[],
    purchaseReturns: [] as any[],
    purchaseReturnItems: [] as any[],
    customers: [] as any[],
    suppliers: [] as any[],
    cashbookEntries: [] as any[],
    stockMovements: [] as any[],
    auditLogs: [] as any[],
    dailyClosings: [] as any[],
  };

  const db: any = {
    $transaction: async (fn: any) => fn(db),

    product: {
      findUnique: async ({ where }: any) => store.products.find((p) => p.id === where.id) ?? null,
      findMany: async ({ where }: any) => store.products.filter((p) => {
        if (where?.id) return p.id === where.id;
        return true;
      }),
      create: async ({ data }: any) => {
        const item = { id: data.id ?? `prod-${store.products.length + 1}`, ...data };
        store.products.push(item);
        return item;
      },
    },

    productBatch: {
      findUnique: async ({ where }: any) => store.batches.find((b) => b.id === where.id) ?? null,
      findFirst: async ({ where }: any) => store.batches.find((b) => b.productId === where.productId) ?? null,
      findMany: async ({ where, orderBy }: any) => {
        let results = [...store.batches];
        if (where?.productId) results = results.filter((b) => b.productId === where.productId);
        if (where?.quantity?.gt !== undefined) results = results.filter((b) => b.quantity > where.quantity.gt);
        if (where?.expiryDate?.not === null) results = results.filter((b) => b.expiryDate !== null);
        if (where?.expiryDate?.gte && where?.expiryDate?.lte) {
          results = results.filter((b) => b.expiryDate && b.expiryDate >= where.expiryDate.gte && b.expiryDate <= where.expiryDate.lte);
        }
        if (orderBy?.expiryDate === 'asc') {
          results.sort((a, b) => (a.expiryDate?.getTime() ?? 0) - (b.expiryDate?.getTime() ?? 0));
        }
        return results.map((b) => ({
          ...b,
          product: store.products.find((p) => p.id === b.productId),
          supplier: store.suppliers.find((s) => s.id === b.supplierId),
        }));
      },
      update: async ({ where, data }: any) => {
        const batch = store.batches.find((b) => b.id === where.id);
        if (!batch) throw new Error('Batch not found');
        if (data.quantity?.increment !== undefined) {
          batch.quantity += data.quantity.increment;
        }
        if (data.quantity?.decrement !== undefined) {
          batch.quantity -= data.quantity.decrement;
        }
        return batch;
      },
      updateMany: async ({ where, data }: any) => {
        const batch = store.batches.find((b) => b.id === where.id && (where.quantity?.gte === undefined || b.quantity >= where.quantity.gte));
        if (!batch) return { count: 0 };
        if (data.quantity?.decrement !== undefined) {
          batch.quantity -= data.quantity.decrement;
        }
        return { count: 1 };
      },
      create: async ({ data }: any) => {
        const batch = {
          id: data.id ?? `batch-${store.batches.length + 1}`,
          ...data,
          purchaseRate: decimal(data.purchaseRate ?? 0),
          mrp: data.mrp ? decimal(data.mrp) : null,
          sellingPrice: data.sellingPrice ? decimal(data.sellingPrice) : null,
          quantity: data.quantity ?? 0,
        };
        store.batches.push(batch);
        return batch;
      },
    },

    sale: {
      findUnique: async ({ where }: any) => {
        const sale = where.id
          ? store.sales.find((s) => s.id === where.id)
          : store.sales.find((s) => s.idempotencyKey === where.idempotencyKey);
        if (!sale) return null;
        const customer = store.customers.find((c) => c.id === sale.customerId) ?? null;
        const items = store.saleItems.filter((i) => i.saleId === sale.id).map((i) => ({
          ...i,
          product: store.products.find((p) => p.id === i.productId),
          batch: store.batches.find((b) => b.id === i.batchId),
          returnItems: store.saleReturnItems.filter((ri) => ri.saleItemId === i.id),
        }));
        return { ...sale, customer, items };
      },
      findMany: async () => store.sales,
      create: async ({ data }: any) => {
        const sale = {
          id: data.id ?? `sale-${store.sales.length + 1}`,
          ...data,
          totalAmount: decimal(data.totalAmount),
          paidAmount: decimal(data.paidAmount ?? 0),
        };
        store.sales.push(sale);
        return sale;
      },
    },

    saleItem: {
      findUnique: async ({ where }: any) => store.saleItems.find((i) => i.id === where.id) ?? null,
      create: async ({ data }: any) => {
        const item = {
          id: data.id ?? `si-${store.saleItems.length + 1}`,
          ...data,
          sellingPrice: decimal(data.sellingPrice),
          discount: data.discount ? decimal(data.discount) : null,
          gst: data.gst ? decimal(data.gst) : null,
        };
        store.saleItems.push(item);
        return item;
      },
    },

    saleReturn: {
      findUnique: async ({ where }: any) => {
        const ret = where.id
          ? store.saleReturns.find((r) => r.id === where.id)
          : store.saleReturns.find((r) => r.idempotencyKey === where.idempotencyKey);
        if (!ret) return null;
        const sale = store.sales.find((s) => s.id === ret.saleId);
        const customer = store.customers.find((c) => c.id === ret.customerId) ?? null;
        const items = store.saleReturnItems.filter((i) => i.saleReturnId === ret.id).map((i) => ({
          ...i,
          product: store.products.find((p) => p.id === i.productId),
          batch: store.batches.find((b) => b.id === i.batchId),
          saleItem: store.saleItems.find((si) => si.id === i.saleItemId),
        }));
        return { ...ret, sale: sale ? { ...sale, customer } : null, customer, items };
      },
      findMany: async ({ where }: any) => {
        return store.saleReturns
          .filter((r) => (!where?.saleId || r.saleId === where.saleId) && (!where?.customerId || r.customerId === where.customerId))
          .map((ret) => ({
            ...ret,
            sale: store.sales.find((s) => s.id === ret.saleId),
            customer: store.customers.find((c) => c.id === ret.customerId),
            items: store.saleReturnItems.filter((i) => i.saleReturnId === ret.id).map((i) => ({
              ...i,
              product: store.products.find((p) => p.id === i.productId),
              batch: store.batches.find((b) => b.id === i.batchId),
            })),
            createdBy: null,
          }));
      },
      create: async ({ data }: any) => {
        const ret = {
          id: data.id ?? `sr-${store.saleReturns.length + 1}`,
          ...data,
          totalAmount: decimal(data.totalAmount),
          createdAt: new Date(),
        };
        store.saleReturns.push(ret);
        return ret;
      },
    },

    saleReturnItem: {
      create: async ({ data }: any) => {
        const item = {
          id: data.id ?? `sri-${store.saleReturnItems.length + 1}`,
          ...data,
          unitPrice: decimal(data.unitPrice),
          totalAmount: decimal(data.totalAmount),
        };
        store.saleReturnItems.push(item);
        return item;
      },
    },

    purchase: {
      findUnique: async ({ where }: any) => store.purchases.find((p) => p.id === where.id) ?? null,
      findMany: async () => store.purchases,
      create: async ({ data }: any) => {
        const purchase = {
          id: data.id ?? `purch-${store.purchases.length + 1}`,
          ...data,
          totalAmount: decimal(data.totalAmount),
          paidAmount: decimal(data.paidAmount ?? 0),
          outstandingAmount: decimal(data.outstandingAmount ?? data.totalAmount),
        };
        store.purchases.push(purchase);
        return purchase;
      },
      update: async ({ where, data }: any) => {
        const purchase = store.purchases.find((p) => p.id === where.id);
        if (!purchase) throw new Error('Purchase not found');
        if (data.outstandingAmount?.decrement !== undefined) {
          purchase.outstandingAmount = purchase.outstandingAmount.minus(decimal(data.outstandingAmount.decrement));
        }
        return purchase;
      },
    },

    purchaseItem: {
      create: async ({ data }: any) => {
        const item = {
          id: data.id ?? `pi-${store.purchaseItems.length + 1}`,
          ...data,
          purchaseRate: decimal(data.purchaseRate),
        };
        store.purchaseItems.push(item);
        return item;
      },
    },

    purchaseReturn: {
      findUnique: async ({ where }: any) => {
        const ret = where.id
          ? store.purchaseReturns.find((r) => r.id === where.id)
          : store.purchaseReturns.find((r) => r.idempotencyKey === where.idempotencyKey);
        if (!ret) return null;
        const supplier = store.suppliers.find((s) => s.id === ret.supplierId) ?? null;
        const purchase = store.purchases.find((p) => p.id === ret.purchaseId) ?? null;
        const items = store.purchaseReturnItems.filter((i) => i.purchaseReturnId === ret.id).map((i) => ({
          ...i,
          product: store.products.find((p) => p.id === i.productId),
          batch: store.batches.find((b) => b.id === i.batchId),
        }));
        return { ...ret, supplier, purchase, items };
      },
      findMany: async ({ where }: any) => {
        return store.purchaseReturns
          .filter((r) => (!where?.supplierId || r.supplierId === where.supplierId) && (!where?.purchaseId || r.purchaseId === where.purchaseId))
          .map((ret) => ({
            ...ret,
            supplier: store.suppliers.find((s) => s.id === ret.supplierId),
            purchase: store.purchases.find((p) => p.id === ret.purchaseId),
            items: store.purchaseReturnItems.filter((i) => i.purchaseReturnId === ret.id),
            createdBy: null,
          }));
      },
      create: async ({ data }: any) => {
        const ret = {
          id: data.id ?? `pr-${store.purchaseReturns.length + 1}`,
          ...data,
          totalAmount: decimal(data.totalAmount),
          createdAt: new Date(),
        };
        store.purchaseReturns.push(ret);
        return ret;
      },
    },

    purchaseReturnItem: {
      create: async ({ data }: any) => {
        const item = {
          id: data.id ?? `pri-${store.purchaseReturnItems.length + 1}`,
          ...data,
          unitPrice: decimal(data.unitPrice),
          totalAmount: decimal(data.totalAmount),
        };
        store.purchaseReturnItems.push(item);
        return item;
      },
    },

    customer: {
      findUnique: async ({ where }: any) => store.customers.find((c) => c.id === where.id) ?? null,
      create: async ({ data }: any) => {
        const c = { id: data.id ?? `cust-${store.customers.length + 1}`, ...data, outstanding: decimal(data.outstanding ?? 0) };
        store.customers.push(c);
        return c;
      },
      update: async ({ where, data }: any) => {
        const customer = store.customers.find((c) => c.id === where.id);
        if (!customer) throw new Error('Customer not found');
        if (data.outstanding?.decrement !== undefined) {
          customer.outstanding = customer.outstanding.minus(decimal(data.outstanding.decrement));
        }
        return customer;
      },
    },

    supplier: {
      findUnique: async ({ where }: any) => store.suppliers.find((s) => s.id === where.id) ?? null,
      create: async ({ data }: any) => {
        const s = { id: data.id ?? `supp-${store.suppliers.length + 1}`, ...data, outstanding: decimal(data.outstanding ?? 0) };
        store.suppliers.push(s);
        return s;
      },
      update: async ({ where, data }: any) => {
        const supplier = store.suppliers.find((s) => s.id === where.id);
        if (!supplier) throw new Error('Supplier not found');
        if (data.outstanding?.decrement !== undefined) {
          supplier.outstanding = supplier.outstanding.minus(decimal(data.outstanding.decrement));
        }
        return supplier;
      },
    },

    cashbookEntry: {
      findUnique: async ({ where }: any) => store.cashbookEntries.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const entry = {
          id: `cb-${store.cashbookEntries.length + 1}`,
          ...data,
          amount: decimal(data.amount),
        };
        store.cashbookEntries.push(entry);
        return entry;
      },
    },

    stockMovement: {
      findUnique: async ({ where }: any) => store.stockMovements.find((m) => m.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const movement = {
          id: `sm-${store.stockMovements.length + 1}`,
          ...data,
        };
        store.stockMovements.push(movement);
        return movement;
      },
    },

    auditLog: {
      create: async ({ data }: any) => {
        const log = { id: `audit-${store.auditLogs.length + 1}`, ...data, createdAt: new Date() };
        store.auditLogs.push(log);
        return log;
      },
    },

    dailyClosing: {
      findUnique: async () => null,
    },
    bankAccount: {
      findFirst: async () => null,
    },
  };

  return { db, store };
};

// ==========================================
// TEST SUITE
// ==========================================

test('1. Sales Return (Restockable): restores batch quantity, creates RETURN_IN stock movement, cash refund cashbook entry, and audit log', async () => {
  const { db, store } = createMockDb();

  const product = await db.product.create({ data: { name: 'Paracetamol 500mg', active: true } });
  const batch = await db.productBatch.create({
    data: { productId: product.id, batchNumber: 'BATCH-001', purchaseRate: 10, sellingPrice: 20, mrp: 25, quantity: 50 },
  });
  const sale = await db.sale.create({
    data: { saleNumber: 'POS-20261006-001', paymentMethod: 'CASH', totalAmount: 100, paidAmount: 100 },
  });
  const saleItem = await db.saleItem.create({
    data: { saleId: sale.id, productId: product.id, batchId: batch.id, quantity: 5, sellingPrice: 20, discount: 0, gst: 0 },
  });

  const returnResult = await createSaleReturn({
    saleId: sale.id,
    items: [
      { saleItemId: saleItem.id, quantity: 2, condition: 'RESTOCKABLE', reason: 'Customer bought extra' },
    ],
    refundMethod: 'CASH',
    reason: 'Extra quantity returned',
    idempotencyKey: 'ret-key-1',
  }, db);

  assert.ok(returnResult);
  assert.equal(returnResult.saleId, sale.id);
  assert.equal(Number(returnResult.totalAmount), 40); // 2 units * ₹20
  assert.equal(returnResult.items.length, 1);
  assert.equal(returnResult.items[0].restocked, true);

  // Verify batch quantity restored from 50 to 52
  const updatedBatch = store.batches.find((b) => b.id === batch.id);
  assert.equal(updatedBatch.quantity, 52);

  // Verify StockMovement RETURN_IN
  const stockMov = store.stockMovements.find((m) => m.referenceId === returnResult.id && m.movementType === 'RETURN_IN');
  assert.ok(stockMov);
  assert.equal(stockMov.quantity, 2);
  assert.equal(stockMov.productId, product.id);

  // Verify CashbookEntry CUSTOMER_REFUND
  const cashbookEntry = store.cashbookEntries.find((c) => c.sourceId === returnResult.id && c.entryType === 'CUSTOMER_REFUND');
  assert.ok(cashbookEntry);
  assert.equal(cashbookEntry.direction, 'OUT');
  assert.equal(Number(cashbookEntry.amount), 40);
  assert.equal(cashbookEntry.paymentMethod, 'CASH');

  // Verify Audit Log
  const audit = store.auditLogs.find((a) => a.entityId === returnResult.id && a.action === 'SALE_RETURN_CREATED');
  assert.ok(audit);
});

test('2. Sales Return (Damaged/Expired): does NOT increase sellable stock, records DAMAGE/EXPIRED movement, pays refund', async () => {
  const { db, store } = createMockDb();

  const product = await db.product.create({ data: { name: 'Amoxicillin 250mg', active: true } });
  const batch = await db.productBatch.create({
    data: { productId: product.id, batchNumber: 'AMOX-01', purchaseRate: 15, sellingPrice: 30, quantity: 40 },
  });
  const sale = await db.sale.create({
    data: { saleNumber: 'POS-20261006-002', paymentMethod: 'CASH', totalAmount: 90, paidAmount: 90 },
  });
  const saleItem = await db.saleItem.create({
    data: { saleId: sale.id, productId: product.id, batchId: batch.id, quantity: 3, sellingPrice: 30, discount: 0, gst: 0 },
  });

  const returnResult = await createSaleReturn({
    saleId: sale.id,
    items: [
      { saleItemId: saleItem.id, quantity: 1, condition: 'DAMAGED', reason: 'Seal broken on bottle' },
    ],
    refundMethod: 'CASH',
    reason: 'Damaged item return',
    idempotencyKey: 'ret-key-dmg-1',
  }, db);

  assert.ok(returnResult);
  assert.equal(Number(returnResult.totalAmount), 30);
  assert.equal(returnResult.items[0].restocked, false);

  // Verify batch quantity is UNCHANGED (still 40, not 41)
  const updatedBatch = store.batches.find((b) => b.id === batch.id);
  assert.equal(updatedBatch.quantity, 40);

  // Verify StockMovement DAMAGE was recorded for audit
  const stockMov = store.stockMovements.find((m) => m.referenceId === returnResult.id && m.movementType === 'DAMAGE');
  assert.ok(stockMov);
  assert.equal(stockMov.quantity, 1);

  // Verify Customer refund still paid out
  const cashbookEntry = store.cashbookEntries.find((c) => c.sourceId === returnResult.id && c.entryType === 'CUSTOMER_REFUND');
  assert.ok(cashbookEntry);
  assert.equal(Number(cashbookEntry.amount), 30);
});

test('3. Sales Return with Store Credit: adjusts customer balance without cashbook outflow', async () => {
  const { db, store } = createMockDb();

  const customer = await db.customer.create({ data: { name: 'Rahul Sharma', outstanding: 500 } });
  const product = await db.product.create({ data: { name: 'Cetirizine 10mg', active: true } });
  const batch = await db.productBatch.create({
    data: { productId: product.id, batchNumber: 'CET-01', purchaseRate: 5, sellingPrice: 10, quantity: 20 },
  });
  const sale = await db.sale.create({
    data: { customerId: customer.id, saleNumber: 'POS-20261006-003', paymentMethod: 'CREDIT', totalAmount: 100, paidAmount: 0 },
  });
  const saleItem = await db.saleItem.create({
    data: { saleId: sale.id, productId: product.id, batchId: batch.id, quantity: 10, sellingPrice: 10, discount: 0, gst: 0 },
  });

  const returnResult = await createSaleReturn({
    saleId: sale.id,
    items: [
      { saleItemId: saleItem.id, quantity: 5, condition: 'RESTOCKABLE' },
    ],
    refundMethod: 'CREDIT',
    idempotencyKey: 'ret-key-credit-1',
  }, db);

  assert.ok(returnResult);
  assert.equal(Number(returnResult.totalAmount), 50);

  // Verify Customer outstanding balance was reduced from 500 to 450
  const updatedCustomer = store.customers.find((c) => c.id === customer.id);
  assert.equal(Number(updatedCustomer.outstanding), 450);

  // Verify NO cashbook entry was created
  const cashbookEntries = store.cashbookEntries.filter((c) => c.sourceId === returnResult.id);
  assert.equal(cashbookEntries.length, 0);
});

test('4. Over-Return Prevention: cannot return more than sold across multiple returns', async () => {
  const { db } = createMockDb();

  const product = await db.product.create({ data: { name: 'Azithromycin 500mg', active: true } });
  const batch = await db.productBatch.create({
    data: { productId: product.id, batchNumber: 'AZ-01', purchaseRate: 40, sellingPrice: 70, quantity: 50 },
  });
  const sale = await db.sale.create({
    data: { saleNumber: 'POS-20261006-004', paymentMethod: 'CASH', totalAmount: 350, paidAmount: 350 },
  });
  const saleItem = await db.saleItem.create({
    data: { saleId: sale.id, productId: product.id, batchId: batch.id, quantity: 5, sellingPrice: 70, discount: 0, gst: 0 },
  });

  // Attempt 1: Return 6 when only 5 were sold -> REJECT
  await assert.rejects(
    async () => {
      await createSaleReturn({
        saleId: sale.id,
        items: [{ saleItemId: saleItem.id, quantity: 6 }],
        idempotencyKey: 'ret-over-1',
      }, db);
    },
    /Cannot return 6 units/
  );

  // Attempt 2: Return 3 units -> SUCCEEDS (2 remaining)
  const return1 = await createSaleReturn({
    saleId: sale.id,
    items: [{ saleItemId: saleItem.id, quantity: 3 }],
    idempotencyKey: 'ret-partial-1',
  }, db);
  assert.ok(return1);

  // Attempt 3: Return 3 units -> REJECT (only 2 remaining)
  await assert.rejects(
    async () => {
      await createSaleReturn({
        saleId: sale.id,
        items: [{ saleItemId: saleItem.id, quantity: 3 }],
        idempotencyKey: 'ret-over-2',
      }, db);
    },
    /Cannot return 3 units/
  );

  // Attempt 4: Return 2 units -> SUCCEEDS (0 remaining)
  const return2 = await createSaleReturn({
    saleId: sale.id,
    items: [{ saleItemId: saleItem.id, quantity: 2 }],
    idempotencyKey: 'ret-partial-2',
  }, db);
  assert.ok(return2);

  // Attempt 5: Return 1 unit when 0 remaining -> REJECT
  await assert.rejects(
    async () => {
      await createSaleReturn({
        saleId: sale.id,
        items: [{ saleItemId: saleItem.id, quantity: 1 }],
        idempotencyKey: 'ret-over-3',
      }, db);
    },
    /Cannot return 1 units/
  );
});

test('5. Sales Return Idempotency: duplicate key returns original return without duplicate movements', async () => {
  const { db, store } = createMockDb();

  const product = await db.product.create({ data: { name: 'Ibuprofen 400mg', active: true } });
  const batch = await db.productBatch.create({
    data: { productId: product.id, batchNumber: 'IBU-01', purchaseRate: 8, sellingPrice: 15, quantity: 10 },
  });
  const sale = await db.sale.create({
    data: { saleNumber: 'POS-20261006-005', paymentMethod: 'CASH', totalAmount: 75, paidAmount: 75 },
  });
  const saleItem = await db.saleItem.create({
    data: { saleId: sale.id, productId: product.id, batchId: batch.id, quantity: 5, sellingPrice: 15, discount: 0, gst: 0 },
  });

  const firstReturn = await createSaleReturn({
    saleId: sale.id,
    items: [{ saleItemId: saleItem.id, quantity: 2, condition: 'RESTOCKABLE' }],
    refundMethod: 'CASH',
    idempotencyKey: 'ret-idem-1',
  }, db);

  assert.equal(store.batches.find((b) => b.id === batch.id).quantity, 12);
  assert.equal(store.cashbookEntries.length, 1);
  assert.equal(store.saleReturns.length, 1);

  // Repeat request with exact same idempotency key
  const secondReturn = await createSaleReturn({
    saleId: sale.id,
    items: [{ saleItemId: saleItem.id, quantity: 2, condition: 'RESTOCKABLE' }],
    refundMethod: 'CASH',
    idempotencyKey: 'ret-idem-1',
  }, db);

  assert.equal(secondReturn.id, firstReturn.id);
  assert.equal(store.batches.find((b) => b.id === batch.id).quantity, 12); // NO duplicate increment
  assert.equal(store.cashbookEntries.length, 1); // NO duplicate refund
  assert.equal(store.saleReturns.length, 1);
});

test('6. Purchase Return (Supplier Debit Note): reduces batch stock, creates RETURN_OUT movement, reduces supplier outstanding', async () => {
  const { db, store } = createMockDb();

  const supplier = await db.supplier.create({ data: { name: 'Apex Pharma Distributors', outstanding: 10000 } });
  const product = await db.product.create({ data: { name: 'Doxycycline 100mg', active: true } });
  const batch = await db.productBatch.create({
    data: {
      productId: product.id,
      supplierId: supplier.id,
      batchNumber: 'DOX-2026',
      purchaseRate: 25,
      quantity: 100,
      expiryDate: new Date('2026-11-01'),
    },
  });
  const purchase = await db.purchase.create({
    data: {
      supplierId: supplier.id,
      invoiceNumber: 'INV-APEX-998',
      invoiceDate: new Date(),
      totalAmount: 2500,
      paidAmount: 1000,
      outstandingAmount: 1500,
    },
  });

  const prResult = await createPurchaseReturn({
    supplierId: supplier.id,
    purchaseId: purchase.id,
    items: [
      { productId: product.id, batchId: batch.id, quantity: 20, reason: 'Near expiry stock return' },
    ],
    refundMethod: 'CREDIT',
    reason: 'Returning near-expiry stock',
    idempotencyKey: 'pr-key-1',
  }, db);

  assert.ok(prResult);
  assert.equal(Number(prResult.totalAmount), 500); // 20 * ₹25
  assert.equal(prResult.items.length, 1);

  // Verify batch quantity was decremented from 100 to 80
  const updatedBatch = store.batches.find((b) => b.id === batch.id);
  assert.equal(updatedBatch.quantity, 80);

  // Verify RETURN_OUT stock movement
  const stockMov = store.stockMovements.find((m) => m.referenceId === prResult.id && m.movementType === 'RETURN_OUT');
  assert.ok(stockMov);
  assert.equal(stockMov.quantity, 20);
  assert.equal(stockMov.productId, product.id);

  // Verify Supplier outstanding reduced from 10000 to 9500
  const updatedSupplier = store.suppliers.find((s) => s.id === supplier.id);
  assert.equal(Number(updatedSupplier.outstanding), 9500);

  // Verify Purchase outstanding reduced from 1500 to 1000
  const updatedPurchase = store.purchases.find((p) => p.id === purchase.id);
  assert.equal(Number(updatedPurchase.outstandingAmount), 1000);

  // Verify Audit Log
  const audit = store.auditLogs.find((a) => a.entityId === prResult.id && a.action === 'PURCHASE_RETURN_CREATED');
  assert.ok(audit);
});

test('7. Purchase Return with CASH refund: creates CASH_RECEIVED cashbook inflow', async () => {
  const { db, store } = createMockDb();

  const supplier = await db.supplier.create({ data: { name: 'MediLife Pharma' } });
  const product = await db.product.create({ data: { name: 'Pantoprazole 40mg', active: true } });
  const batch = await db.productBatch.create({
    data: { productId: product.id, supplierId: supplier.id, batchNumber: 'PAN-01', purchaseRate: 12, quantity: 50 },
  });

  const prResult = await createPurchaseReturn({
    supplierId: supplier.id,
    items: [{ productId: product.id, batchId: batch.id, quantity: 10 }],
    refundMethod: 'CASH',
    idempotencyKey: 'pr-cash-1',
  }, db);

  assert.ok(prResult);
  assert.equal(Number(prResult.totalAmount), 120);

  // Verify CashbookEntry CASH_RECEIVED (IN)
  const cashEntry = store.cashbookEntries.find((c) => c.sourceId === prResult.id && c.entryType === 'CASH_RECEIVED');
  assert.ok(cashEntry);
  assert.equal(cashEntry.direction, 'IN');
  assert.equal(Number(cashEntry.amount), 120);
  assert.equal(cashEntry.paymentMethod, 'CASH');
});

test('8. Purchase Return rejects quantity exceeding available batch stock', async () => {
  const { db } = createMockDb();

  const supplier = await db.supplier.create({ data: { name: 'Zenith Healthcare' } });
  const product = await db.product.create({ data: { name: 'Metformin 500mg', active: true } });
  const batch = await db.productBatch.create({
    data: { productId: product.id, supplierId: supplier.id, batchNumber: 'MET-01', purchaseRate: 8, quantity: 15 },
  });

  await assert.rejects(
    async () => {
      await createPurchaseReturn({
        supplierId: supplier.id,
        items: [{ productId: product.id, batchId: batch.id, quantity: 20 }], // Available is only 15
        idempotencyKey: 'pr-over-1',
      }, db);
    },
    /Insufficient stock in batch MET-01/
  );
});

test('9. Expiry Dashboard: categorizes batches by expired, 30d, 60d, 90d with accurate unit and cost valuations', async () => {
  const { db } = createMockDb();

  const refDate = new Date('2026-10-06T00:00:00.000Z');
  const productA = await db.product.create({ data: { name: 'Expired Syrup', active: true } });
  const productB = await db.product.create({ data: { name: 'Near 30d Tablet', active: true } });
  const productC = await db.product.create({ data: { name: 'Near 60d Capsule', active: true } });
  const productD = await db.product.create({ data: { name: 'Near 90d Drops', active: true } });

  // Expired (yesterday)
  await db.productBatch.create({
    data: { productId: productA.id, batchNumber: 'EXP-1', purchaseRate: 20, quantity: 10, expiryDate: new Date('2026-10-05T00:00:00.000Z') },
  });
  // 15 days from now (Near 30d)
  await db.productBatch.create({
    data: { productId: productB.id, batchNumber: 'NEAR-15', purchaseRate: 50, quantity: 5, expiryDate: new Date('2026-10-21T00:00:00.000Z') },
  });
  // 45 days from now (Near 60d)
  await db.productBatch.create({
    data: { productId: productC.id, batchNumber: 'NEAR-45', purchaseRate: 30, quantity: 8, expiryDate: new Date('2026-11-20T00:00:00.000Z') },
  });
  // 75 days from now (Near 90d)
  await db.productBatch.create({
    data: { productId: productD.id, batchNumber: 'NEAR-75', purchaseRate: 10, quantity: 20, expiryDate: new Date('2026-12-20T00:00:00.000Z') },
  });

  const dashboardData = await getExpiryDashboard(refDate, db);

  assert.equal(dashboardData.summary.expired.count, 1);
  assert.equal(dashboardData.summary.expired.units, 10);
  assert.equal(dashboardData.summary.expired.totalCost, 200); // 10 * 20

  assert.equal(dashboardData.summary.near30Days.count, 1);
  assert.equal(dashboardData.summary.near30Days.units, 5);
  assert.equal(dashboardData.summary.near30Days.totalCost, 250); // 5 * 50

  assert.equal(dashboardData.summary.near60Days.count, 1);
  assert.equal(dashboardData.summary.near60Days.units, 8);
  assert.equal(dashboardData.summary.near60Days.totalCost, 240); // 8 * 30

  assert.equal(dashboardData.summary.near90Days.count, 1);
  assert.equal(dashboardData.summary.near90Days.units, 20);
  assert.equal(dashboardData.summary.near90Days.totalCost, 200); // 20 * 10
});

test('10. listSaleReturns and listPurchaseReturns return comprehensive historical records with relations', async () => {
  const { db } = createMockDb();

  const customer = await db.customer.create({ data: { name: 'Pooja Patel' } });
  const supplier = await db.supplier.create({ data: { name: 'Shree Pharma' } });
  const product = await db.product.create({ data: { name: 'Zinc Tablets', active: true } });
  const batch = await db.productBatch.create({
    data: { productId: product.id, supplierId: supplier.id, batchNumber: 'ZN-01', purchaseRate: 5, sellingPrice: 10, quantity: 100 },
  });
  const sale = await db.sale.create({
    data: { customerId: customer.id, saleNumber: 'POS-20261006-010', paymentMethod: 'CASH', totalAmount: 50, paidAmount: 50 },
  });
  const saleItem = await db.saleItem.create({
    data: { saleId: sale.id, productId: product.id, batchId: batch.id, quantity: 5, sellingPrice: 10 },
  });

  await createSaleReturn({
    saleId: sale.id,
    items: [{ saleItemId: saleItem.id, quantity: 1 }],
    idempotencyKey: 'sr-list-1',
  }, db);

  await createPurchaseReturn({
    supplierId: supplier.id,
    items: [{ productId: product.id, batchId: batch.id, quantity: 5 }],
    idempotencyKey: 'pr-list-1',
  }, db);

  const saleReturns = await listSaleReturns({}, db);
  assert.equal(saleReturns.length, 1);
  assert.equal(saleReturns[0].customer?.name, 'Pooja Patel');

  const purchaseReturns = await listPurchaseReturns({}, db);
  assert.equal(purchaseReturns.length, 1);
  assert.equal(purchaseReturns[0].supplier?.name, 'Shree Pharma');
});

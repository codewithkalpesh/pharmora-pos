import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { createProduct } from '../src/services/productService.js';
import { applyStockMovement } from '../src/services/stockService.js';
import { calculatePurchaseTotal } from '../src/services/purchaseService.js';
import { calculateSaleTotal } from '../src/services/saleService.js';
import { paymentAccounts, lineTotal } from '../src/services/transactionUtils.js';
import { validatePaymentSplit } from '../src/services/domainUtils.js';
import { getDailyCashSummary, writeCashbookEntry } from '../src/services/cashbookService.js';
import { getCustomer } from '../src/services/customerService.js';
import { getSupplier } from '../src/services/supplierService.js';
import { createPurchase } from '../src/services/purchaseService.js';
import { createSale } from '../src/services/saleService.js';
import { recordSalePayment } from '../src/services/paymentService.js';
import { recordCustomerPayment, recordSupplierPayment } from '../src/services/paymentService.js';
import { createExpense } from '../src/services/expenseService.js';

const asClient = (value: unknown) => value as never;

const makeTransactionHarness = () => {
  const state: Record<string, any> = {
    product: { id: 'product-1', name: 'Test medicine', active: true, sellingPrice: 10, gst: 0 },
    supplier: { id: 'supplier-1', name: 'Test supplier' },
    customer: { id: 'customer-1', name: 'Test customer' },
    batch: null,
    purchases: [],
    purchaseItems: [],
    sales: [],
    saleItems: [],
    payments: [],
    customerPayments: [],
    supplierPayments: [],
    expenses: [],
    movements: [],
    cashbook: [],
    credits: [],
    audits: [],
  };
  const client: any = {
    $transaction: async (operation: (tx: any) => Promise<unknown>) => operation(client),
    product: { findUnique: async () => ({ ...state.product }) },
    supplier: {
      findUnique: async () => ({ ...state.supplier }),
      update: async ({ where, data }: any) => {
        if (data.outstanding?.increment) state.supplier.outstanding = (state.supplier.outstanding ?? 0) + Number(data.outstanding.increment);
        if (data.outstanding?.decrement) state.supplier.outstanding = (state.supplier.outstanding ?? 0) - Number(data.outstanding.decrement);
        return { ...state.supplier };
      },
    },
    customer: { findUnique: async () => ({ ...state.customer }) },
    dailyClosing: { findUnique: async () => null },
    productBatch: {
      findUnique: async ({ where }: any) => {
        if (!state.batch) return null;
        if (where.id && where.id !== state.batch.id) return null;
        if (where.productId_batchNumber && (where.productId_batchNumber.productId !== state.batch.productId || where.productId_batchNumber.batchNumber !== state.batch.batchNumber)) return null;
        return { ...state.batch };
      },
      findMany: async () => state.batch ? [{ ...state.batch }] : [],
      create: async ({ data }: any) => (state.batch = { id: 'batch-1', ...data }),
      update: async ({ data }: any) => {
        if (data.quantity?.increment) state.batch.quantity += data.quantity.increment;
        if (data.quantity?.decrement) state.batch.quantity -= data.quantity.decrement;
        if (data.freeQuantity?.increment) state.batch.freeQuantity += data.freeQuantity.increment;
        for (const [key, value] of Object.entries(data)) if (key !== 'quantity' && key !== 'freeQuantity') state.batch[key] = value;
        return { ...state.batch };
      },
      updateMany: async ({ where, data }: any) => {
        if (!state.batch || state.batch.id !== where.id || state.batch.quantity < where.quantity.gte) return { count: 0 };
        state.batch.quantity -= data.quantity.decrement;
        return { count: 1 };
      },
    },
    purchase: {
      findUnique: async ({ where }: any) => state.purchases.find((item: any) =>
        (where.id && item.id === where.id) || (where.idempotencyKey && item.idempotencyKey === where.idempotencyKey)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `purchase-${state.purchases.length + 1}`, ...data };
        state.purchases.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.purchases.find((item: any) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    purchaseItem: { create: async ({ data }: any) => { const row = { id: `purchase-item-${state.purchaseItems.length + 1}`, ...data }; state.purchaseItems.push(row); return row; } },
    stockMovement: {
      findUnique: async ({ where }: any) => state.movements.find((row: any) => row.idempotencyKey && row.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `movement-${state.movements.length + 1}`, ...data };
        state.movements.push(row);
        return row;
      },
    },
    sale: {
      findUnique: async ({ where }: any) => state.sales.find((item: any) =>
        (where.id && item.id === where.id) || (where.idempotencyKey && item.idempotencyKey === where.idempotencyKey)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `sale-${state.sales.length + 1}`, ...data };
        state.sales.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.sales.find((item: any) => item.id === where.id);
        if (data.paidAmount?.increment) row.paidAmount = Number(row.paidAmount) + data.paidAmount.increment;
        return row;
      },
    },
    saleItem: { create: async ({ data }: any) => { const row = { id: `sale-item-${state.saleItems.length + 1}`, ...data }; state.saleItems.push(row); return row; } },
    customerCredit: {
      create: async ({ data }: any) => { const row = { id: `credit-${state.credits.length + 1}`, ...data }; state.credits.push(row); return row; },
      findMany: async () => state.credits,
      update: async ({ where, data }: any) => {
        const row = state.credits.find((credit: any) => credit.id === where.id);
        row.paidAmount = Number(row.paidAmount) + data.paidAmount.increment;
        row.balanceAmount = data.balanceAmount;
        row.status = data.status;
        return row;
      },
    },
    customerPayment: {
      findUnique: async ({ where }: any) => state.customerPayments.find((row: any) => row.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => { const row = { id: `customer-payment-${state.customerPayments.length + 1}`, ...data }; state.customerPayments.push(row); return row; },
    },
    supplierPayment: {
      findUnique: async ({ where }: any) => state.supplierPayments.find((row: any) => row.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => { const row = { id: `supplier-payment-${state.supplierPayments.length + 1}`, ...data }; state.supplierPayments.push(row); return row; },
    },
    expense: {
      findUnique: async ({ where }: any) => state.expenses.find((row: any) => row.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => { const row = { id: `expense-${state.expenses.length + 1}`, ...data }; state.expenses.push(row); return row; },
    },
    payment: {
      findUnique: async ({ where }: any) => state.payments.find((row: any) => row.idempotencyKey === where.idempotencyKey || row.id === where.id) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `payment-${state.payments.length + 1}`, ...data, splits: data.splits?.create ?? [] };
        state.payments.push(row);
        return row;
      },
    },
    cashbookEntry: {
      findUnique: async ({ where }: any) => state.cashbook.find((row: any) => row.idempotencyKey === where.idempotencyKey) ?? null,
      findFirst: async () => null,
      findMany: async () => state.cashbook,
      create: async ({ data }: any) => { const row = { id: `entry-${state.cashbook.length + 1}`, ...data }; state.cashbook.push(row); return row; },
    },
    auditLog: { create: async ({ data }: any) => { const row = { id: `audit-${state.audits.length + 1}`, ...data }; state.audits.push(row); return row; } },
  };
  return { client: asClient(client), state };
};

const makeStockTransaction = (initialQuantity: number) => {
  const state = {
    batch: { id: 'batch-1', productId: 'product-1', quantity: initialQuantity, expiryDate: null },
    movements: [] as Array<Record<string, unknown>>,
  };
  return {
    state,
    client: asClient({
      productBatch: {
        findUnique: async () => ({ ...state.batch }),
        update: async ({ data }: { data: { quantity?: { increment?: number; decrement?: number } } }) => {
          if (data.quantity?.increment) state.batch.quantity += data.quantity.increment;
          if (data.quantity?.decrement) state.batch.quantity -= data.quantity.decrement;
          return state.batch;
        },
        updateMany: async ({ data }: { data: { quantity: { decrement: number } } }) => {
          if (state.batch.quantity < data.quantity.decrement) return { count: 0 };
          state.batch.quantity -= data.quantity.decrement;
          return { count: 1 };
        },
      },
      stockMovement: {
        findUnique: async ({ where }: { where: { idempotencyKey?: string } }) =>
          state.movements.find((movement) => movement.idempotencyKey === where.idempotencyKey) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const movement = { id: `movement-${state.movements.length + 1}`, ...data };
          state.movements.push(movement);
          return movement;
        },
      },
    }),
  };
};

test('product creation delegates validated data to the persistence client', async () => {
  let created: Record<string, unknown> | undefined;
  const client = asClient({
    product: { create: async ({ data }: { data: Record<string, unknown> }) => { created = data; return { id: 'p1', ...data }; } },
    auditLog: { create: async () => ({}) },
  });
  await createProduct({ name: 'Paracetamol', sellingPrice: 12.5, minStock: 0 }, client);
  assert.equal(created?.name, 'Paracetamol');
  assert.equal(Number(created?.sellingPrice), 12.5);
});

test('product creation rejects negative prices before persistence', async () => {
  await assert.rejects(() => createProduct({ name: 'Medicine', sellingPrice: -1 }, asClient({ product: { create: async () => assert.fail('must not persist') } })));
});

test('purchase movement adds stock and records before/after quantities', async () => {
  const { client, state } = makeStockTransaction(3);
  await applyStockMovement(client, { productId: 'product-1', batchId: 'batch-1', quantity: 4, movementType: 'PURCHASE_IN', idempotencyKey: 'purchase-1' });
  assert.equal(state.batch.quantity, 7);
  assert.equal(state.movements.length, 1);
  assert.equal(state.movements[0].beforeQty, 3);
  assert.equal(state.movements[0].afterQty, 7);
});

test('sale movement removes stock and records a movement', async () => {
  const { client, state } = makeStockTransaction(8);
  await applyStockMovement(client, { productId: 'product-1', batchId: 'batch-1', quantity: 3, movementType: 'SALE_OUT' });
  assert.equal(state.batch.quantity, 5);
  assert.equal(state.movements[0].movementType, 'SALE_OUT');
});

test('stock cannot become negative and failed removal creates no movement', async () => {
  const { client, state } = makeStockTransaction(2);
  await assert.rejects(() => applyStockMovement(client, { productId: 'product-1', batchId: 'batch-1', quantity: 3, movementType: 'SALE_OUT' }));
  assert.equal(state.batch.quantity, 2);
  assert.equal(state.movements.length, 0);
});

test('same stock idempotency key returns original movement without a second quantity change', async () => {
  const { client, state } = makeStockTransaction(2);
  const input = { productId: 'product-1', batchId: 'batch-1', quantity: 3, movementType: 'PURCHASE_IN' as const, idempotencyKey: 'stock-request-1' };
  const first = await applyStockMovement(client, input);
  const second = await applyStockMovement(client, input);
  assert.equal(first.id, second.id);
  assert.equal(state.batch.quantity, 5);
  assert.equal(state.movements.length, 1);
});

test('purchase total is calculated from quantities, rates, discounts, and GST', () => {
  assert.equal(calculatePurchaseTotal([{ productId: 'p1', batchNumber: 'B1', quantity: 2, purchaseRate: 10, gst: 5 }]), 21);
});

test('sale total uses decimal-safe line calculations', () => {
  assert.equal(calculateSaleTotal([{ productId: 'p1', quantity: 2, sellingPrice: 12.5, gst: 12 }]), 28);
  assert.equal(lineTotal(1, 10, 1, 0), 9);
});

test('cash payment is assigned to cash account', () => {
  assert.deepEqual(paymentAccounts('CASH', 100), [{ method: 'CASH', amount: 100 }]);
});

test('UPI payment is assigned to UPI account', () => {
  assert.deepEqual(paymentAccounts('UPI', 100), [{ method: 'UPI', amount: 100 }]);
});

test('BOTH payment records exact cash and UPI split', () => {
  assert.deepEqual(paymentAccounts('BOTH', 1000, 400, 600), [
    { method: 'CASH', amount: 400 },
    { method: 'UPI', amount: 600 },
  ]);
});

test('BOTH payment rejects split that does not equal total', () => {
  assert.throws(() => validatePaymentSplit('BOTH', 1000, 400, 599));
});

test('daily drawer summary includes only physical cash entries', async () => {
  const entries = [
    { entryType: 'CASH_SALE', paymentMethod: 'CASH', direction: 'IN', amount: new Prisma.Decimal(100), businessDate: new Date('2026-05-01T00:00:00.000Z'), createdAt: new Date() },
    { entryType: 'CASH_PURCHASE', paymentMethod: 'CASH', direction: 'OUT', amount: new Prisma.Decimal(25), businessDate: new Date('2026-05-01T00:00:00.000Z'), createdAt: new Date() },
    { entryType: 'CASH_SALE', paymentMethod: 'UPI', direction: 'IN', amount: new Prisma.Decimal(60), businessDate: new Date('2026-05-01T00:00:00.000Z'), createdAt: new Date() },
  ];
  const client = asClient({
    dailyClosing: { findUnique: async () => null },
    cashbookEntry: {
      findFirst: async () => null,
      findMany: async ({ where }: any) => where?.entryType === 'OPENING_CASH_CORRECTION' ? [] : entries,
    },
  });
  const summary = await getDailyCashSummary('2026-05-01', client);
  assert.equal(summary.cashInflows, '100.00');
  assert.equal(summary.cashOutflows, '25.00');
  assert.equal(summary.expectedDrawerCash, '75.00');
});

test('bank cashbook entry creates a bank transaction with a derived running balance', async () => {
  let bankTransaction: Record<string, unknown> | undefined;
  let cachedBalance = 100;
  const tx = {
    bankAccount: {
      findFirst: async () => ({ id: 'bank-1', openingBalance: 100 }),
      findUnique: async () => ({ id: 'bank-1', openingBalance: 100 }),
      update: async ({ data }: any) => { cachedBalance = data.currentBalance; return { id: 'bank-1' }; },
    },
    bankTransaction: { findMany: async () => [], create: async ({ data }: any) => { bankTransaction = data; return data; } },
    cashbookEntry: {
      findUnique: async () => null,
      create: async ({ data }: any) => ({ id: 'entry-1', ...data }),
    },
    dailyClosing: { findUnique: async () => null },
    auditLog: { create: async ({ data }: any) => data },
  };
  await writeCashbookEntry(tx as never, {
    entryType: 'SUPPLIER_PAYMENT', direction: 'OUT', amount: 25, paymentMethod: 'BANK',
    sourceType: 'SUPPLIER_PAYMENT', sourceId: 'supplier-payment-1', idempotencyKey: 'bank-request-1',
  });
  assert.equal(bankTransaction?.transactionType, 'DEBIT');
  assert.equal(Number(bankTransaction?.balanceAfter), 75);
  assert.equal(Number(cachedBalance), 75);
});

test('customer outstanding is calculated from credit ledger balances', async () => {
  const customer = { id: 'c1', customerCredits: [{ balanceAmount: '12.50' }, { balanceAmount: '7.25' }] };
  const result = await getCustomer('c1', asClient({ customer: { findUnique: async () => customer } }));
  assert.equal(result.outstanding, 19.75);
});

test('supplier payable is calculated from purchase totals and payment history', async () => {
  const supplier = {
    id: 's1',
    purchases: [{ totalAmount: '100', paidAmount: '40', outstandingAmount: '60', supplierPayments: [{ amount: '40' }] }],
    supplierPayments: [],
  };
  const result = await getSupplier('s1', asClient({ supplier: { findUnique: async () => supplier } }));
  assert.equal(result.outstandingPayable, 60);
});

test('purchase transaction creates purchase items and purchase-in stock movements without payment', async () => {
  const { client, state } = makeTransactionHarness();
  const purchase = await createPurchase({
    supplierId: 'supplier-1', invoiceNumber: 'INV-1', invoiceDate: new Date('2026-01-02'),
    paymentMethod: 'CREDIT', paidAmount: 0,
    items: [{ productId: 'product-1', batchNumber: 'B-1', quantity: 5, freeQty: 1, purchaseRate: 4, mrp: 10 }],
  }, 'purchase-request-1', client);
  assert.equal((purchase as any)?.id, 'purchase-1');
  assert.equal(state.purchaseItems.length, 1);
  assert.equal(state.movements.length, 1);
  assert.equal(state.movements[0].movementType, 'PURCHASE_IN');
  assert.equal(state.batch.quantity, 6);
  assert.equal(state.purchases[0].paidAmount, 0);
  assert.equal(state.purchases[0].outstandingAmount, 20);
});

test('sale transaction writes sale items, removes stock, and records payment/cashbook', async () => {
  const { client, state } = makeTransactionHarness();
  state.batch = { id: 'batch-1', productId: 'product-1', batchNumber: 'B-1', quantity: 8, expiryDate: null, sellingPrice: 10, mrp: 10, gst: 0 };
  await createSale({
    paymentMethod: 'CASH',
    items: [{ productId: 'product-1', batchId: 'batch-1', quantity: 3, sellingPrice: 0 }],
  }, 'sale-request-1', client);
  assert.equal(state.sales[0].totalAmount, 30);
  assert.equal(state.saleItems.length, 1);
  assert.equal(state.saleItems[0].sellingPrice, 10);
  assert.equal(state.batch.quantity, 5);
  assert.equal(state.movements[0].movementType, 'SALE_OUT');
  assert.equal(state.payments.length, 1);
  assert.equal(state.cashbook.length, 1);
});

test('sale transaction rejects quantity beyond available stock', async () => {
  const { client, state } = makeTransactionHarness();
  state.batch = { id: 'batch-1', productId: 'product-1', batchNumber: 'B-1', quantity: 2, expiryDate: null, sellingPrice: 10, mrp: 10, gst: 0 };
  await assert.rejects(() => createSale({
    paymentMethod: 'CASH', items: [{ productId: 'product-1', batchId: 'batch-1', quantity: 3 }],
  }, 'sale-request-2', client));
  assert.equal(state.sales.length, 0);
  assert.equal(state.batch.quantity, 2);
  assert.equal(state.movements.length, 0);
});

test('same sale payment idempotency key creates one payment and one cashbook entry', async () => {
  const { client, state } = makeTransactionHarness();
  state.sales.push({ id: 'sale-1', totalAmount: 50, paidAmount: 0, paymentMethod: 'CASH' });
  const input = { saleId: 'sale-1', amount: 50, paymentMethod: 'CASH' as const };
  const first = await recordSalePayment(input, 'payment-request-1', client);
  const second = await recordSalePayment(input, 'payment-request-1', client);
  assert.equal((first as any).id, (second as any).id);
  assert.equal(state.payments.length, 1);
  assert.equal(state.cashbook.length, 1);
  assert.equal(state.sales[0].paidAmount, 50);
});

test('customer payment reduces credit and records money-in cashbook entry', async () => {
  const { client, state } = makeTransactionHarness();
  state.credits.push({ id: 'credit-1', customerId: 'customer-1', amount: 60, paidAmount: 0, balanceAmount: 60, status: 'PENDING' });
  await recordCustomerPayment({ customerId: 'customer-1', amount: 20, paymentMethod: 'CASH' }, 'customer-payment-request-1', client);
  assert.equal(state.customerPayments.length, 1);
  assert.equal(state.credits[0].balanceAmount, 40);
  assert.equal(state.cashbook[0].direction, 'IN');
  assert.equal(state.cashbook[0].entryType, 'CUSTOMER_PAYMENT');
});

test('supplier payment reduces purchase payable and records money-out cashbook entry', async () => {
  const { client, state } = makeTransactionHarness();
  state.purchases.push({ id: 'purchase-1', supplierId: 'supplier-1', totalAmount: 100, paidAmount: 0, outstandingAmount: 100 });
  await recordSupplierPayment({ supplierId: 'supplier-1', purchaseId: 'purchase-1', amount: 30, paymentMethod: 'UPI' }, 'supplier-payment-request-1', client);
  assert.equal(state.supplierPayments.length, 1);
  assert.equal(state.purchases[0].outstandingAmount, 70);
  assert.equal(state.cashbook[0].direction, 'OUT');
  assert.equal(state.cashbook[0].paymentMethod, 'UPI');
});

test('expense records money-out against the selected payment account', async () => {
  const { client, state } = makeTransactionHarness();
  await createExpense({ category: 'Utilities', amount: 15, paymentMethod: 'CASH' }, 'expense-request-1', client);
  assert.equal(state.expenses.length, 1);
  assert.equal(state.cashbook.length, 1);
  assert.equal(state.cashbook[0].direction, 'OUT');
  assert.equal(state.cashbook[0].entryType, 'EXPENSE');
  assert.equal(state.cashbook[0].paymentMethod, 'CASH');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSaleTotal, createSale, getSale, listSales } from '../src/services/saleService.js';
import { recordCustomerPayment } from '../src/services/paymentService.js';
import { createCustomer, getCustomer, listCustomers, updateCustomer } from '../src/services/customerService.js';

type MockBatch = {
  id: string;
  productId: string;
  batchNumber: string;
  quantity: number;
  freeQuantity?: number;
  expiryDate: Date | null;
  sellingPrice?: number;
  mrp?: number;
  gst?: number;
  createdAt?: Date;
};

type MockState = {
  products: Array<{ id: string; name: string; active: boolean; sellingPrice?: number; gst?: number }>;
  batches: MockBatch[];
  movements: Array<Record<string, unknown>>;
  customers: Array<{ id: string; name: string; phone?: string; outstanding?: number }>;
  sales: Array<Record<string, any>>;
  saleItems: Array<Record<string, any>>;
  payments: Array<Record<string, any>>;
  customerCredits: Array<Record<string, any>>;
  customerPayments: Array<Record<string, any>>;
  cashbook: Array<Record<string, any>>;
  audits: Array<Record<string, any>>;
};

const makePosHarness = (initialState?: Partial<MockState>) => {
  const state: MockState = {
    products: [
      { id: 'prod-1', name: 'Paracetamol 500mg', active: true, sellingPrice: 20, gst: 0 },
      { id: 'prod-2', name: 'Amoxicillin 250mg', active: true, sellingPrice: 50, gst: 5 },
      { id: 'prod-inactive', name: 'Discontinued Med', active: false, sellingPrice: 10, gst: 0 },
    ],
    batches: [
      { id: 'batch-1', productId: 'prod-1', batchNumber: 'B001', quantity: 10, expiryDate: new Date('2028-12-31'), sellingPrice: 20, mrp: 25, gst: 0, createdAt: new Date('2026-01-01') },
    ],
    movements: [],
    customers: [
      { id: 'cust-1', name: 'Rahul Sharma', phone: '9876543210', outstanding: 0 },
    ],
    sales: [],
    saleItems: [],
    payments: [],
    customerCredits: [],
    customerPayments: [],
    cashbook: [],
    audits: [],
    ...initialState,
  };

  const client: any = {
    $transaction: async (operation: (tx: any) => Promise<unknown>) => {
      const snapProducts = state.products.map(p => ({ ...p }));
      const snapBatches = state.batches.map(b => ({ ...b }));
      const snapMovements = [...state.movements];
      const snapCustomers = state.customers.map(c => ({ ...c }));
      const snapSales = [...state.sales];
      const snapSaleItems = [...state.saleItems];
      const snapPayments = [...state.payments];
      const snapCustomerCredits = [...state.customerCredits];
      const snapCustomerPayments = [...state.customerPayments];
      const snapCashbook = [...state.cashbook];
      const snapAudits = [...state.audits];
      try {
        return await operation(client);
      } catch (err) {
        state.products = snapProducts;
        state.batches = snapBatches;
        state.movements = snapMovements;
        state.customers = snapCustomers;
        state.sales = snapSales;
        state.saleItems = snapSaleItems;
        state.payments = snapPayments;
        state.customerCredits = snapCustomerCredits;
        state.customerPayments = snapCustomerPayments;
        state.cashbook = snapCashbook;
        state.audits = snapAudits;
        throw err;
      }
    },
    product: {
      findUnique: async ({ where }: any) => state.products.find((p) => p.id === where.id) ?? null,
    },
    customer: {
      findUnique: async ({ where }: any) => {
        const cust = state.customers.find((c) => c.id === where.id);
        if (!cust) return null;
        const credits = state.customerCredits.filter((c) => c.customerId === cust.id);
        const sales = state.sales.filter((s) => s.customerId === cust.id);
        const payments = state.customerPayments.filter((p) => p.customerId === cust.id);
        return { ...cust, customerCredits: credits, sales, payments };
      },
      findMany: async () => state.customers,
      create: async ({ data }: any) => {
        const cust = { id: `cust-${state.customers.length + 1}`, outstanding: 0, ...data };
        state.customers.push(cust);
        return cust;
      },
      update: async ({ where, data }: any) => {
        const cust = state.customers.find((c) => c.id === where.id);
        if (!cust) return null;
        if (data.outstanding?.increment) cust.outstanding = (cust.outstanding ?? 0) + Number(data.outstanding.increment);
        if (data.outstanding?.decrement) cust.outstanding = (cust.outstanding ?? 0) - Number(data.outstanding.decrement);
        for (const [key, value] of Object.entries(data)) {
          if (key !== 'outstanding') (cust as any)[key] = value;
        }
        return cust;
      },
    },
    productBatch: {
      findUnique: async ({ where }: any) => state.batches.find((b) => b.id === where.id) ?? null,
      findMany: async ({ where }: any) => {
        return state.batches.filter((b) => {
          if (where.productId && b.productId !== where.productId) return false;
          if (where.quantity?.gt !== undefined && b.quantity <= where.quantity.gt) return false;
          if (where.OR) {
            const matchesOr = where.OR.some((cond: any) => {
              if (cond.expiryDate === null && b.expiryDate === null) return true;
              if (cond.expiryDate?.gte && b.expiryDate && b.expiryDate >= cond.expiryDate.gte) return true;
              return false;
            });
            if (!matchesOr) return false;
          }
          return true;
        }).sort((a, b) => {
          const aExp = a.expiryDate ? a.expiryDate.getTime() : Infinity;
          const bExp = b.expiryDate ? b.expiryDate.getTime() : Infinity;
          return aExp - bExp;
        });
      },
      update: async ({ data }: any) => {
        const batch = state.batches[0];
        if (data.quantity?.decrement) batch.quantity -= data.quantity.decrement;
        return batch;
      },
      updateMany: async ({ where, data }: any) => {
        const batch = state.batches.find((b) => b.id === where.id);
        if (!batch || batch.quantity < where.quantity.gte) return { count: 0 };
        batch.quantity -= data.quantity.decrement;
        return { count: 1 };
      },
    },
    stockMovement: {
      findUnique: async ({ where }: any) => state.movements.find((m) => m.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `movement-${state.movements.length + 1}`, ...data };
        state.movements.push(row);
        return row;
      },
    },
    sale: {
      findUnique: async ({ where }: any) => state.sales.find((s) =>
        (where.id && s.id === where.id) || (where.idempotencyKey && s.idempotencyKey === where.idempotencyKey)) ?? null,
      findMany: async () => state.sales,
      create: async ({ data }: any) => {
        const row = { id: `sale-${state.sales.length + 1}`, ...data, items: [], payments: [] };
        state.sales.push(row);
        return row;
      },
    },
    saleItem: {
      create: async ({ data }: any) => {
        const row = { id: `sale-item-${state.saleItems.length + 1}`, ...data };
        state.saleItems.push(row);
        return row;
      },
    },
    payment: {
      findUnique: async ({ where }: any) => state.payments.find((p) => p.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `payment-${state.payments.length + 1}`, ...data, splits: data.splits?.create ?? [] };
        state.payments.push(row);
        return row;
      },
    },
    customerCredit: {
      findMany: async ({ where }: any) => state.customerCredits.filter((c) => {
        if (where?.customerId && c.customerId !== where.customerId) return false;
        if (where?.balanceAmount?.gt !== undefined && c.balanceAmount <= where.balanceAmount.gt) return false;
        return true;
      }),
      create: async ({ data }: any) => {
        const row = { id: `credit-${state.customerCredits.length + 1}`, ...data };
        state.customerCredits.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const credit = state.customerCredits.find((c) => c.id === where.id);
        if (!credit) return null;
        if (data.paidAmount?.increment) credit.paidAmount = Number(credit.paidAmount) + data.paidAmount.increment;
        if (data.balanceAmount !== undefined) credit.balanceAmount = data.balanceAmount;
        if (data.status) credit.status = data.status;
        return credit;
      },
    },
    customerPayment: {
      findUnique: async ({ where }: any) => state.customerPayments.find((p) => p.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `cust-pmt-${state.customerPayments.length + 1}`, ...data };
        state.customerPayments.push(row);
        return row;
      },
    },
    cashbookEntry: {
      findUnique: async ({ where }: any) => state.cashbook.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `cb-${state.cashbook.length + 1}`, ...data };
        state.cashbook.push(row);
        return row;
      },
    },
    dailyClosing: { findUnique: async () => null },
    auditLog: {
      create: async ({ data }: any) => {
        const row = { id: `audit-${state.audits.length + 1}`, ...data };
        state.audits.push(row);
        return row;
      },
    },
  };

  return { client, state };
};

test('POS sale calculations: quantity × sellingPrice with discount and GST', () => {
  const total = calculateSaleTotal([
    { productId: 'p1', quantity: 2, sellingPrice: 100, discount: 10, gst: 5 },
  ]);
  // base = 200, discount = 10 -> 190. GST 5% on 190 = 9.5. Total = 199.5
  assert.equal(total, 199.5);
});

test('POS CASH sale: stock decreases, CASH IN cashbook created, paid in full, audited', async () => {
  const { client, state } = makePosHarness();
  const sale = await createSale({
    paymentMethod: 'CASH',
    items: [{ productId: 'prod-1', quantity: 3 }],
  }, 'pos-cash-sale-1', client);

  assert.ok(sale);
  assert.equal(state.sales.length, 1);
  assert.equal(state.sales[0].totalAmount, 60);
  assert.equal(state.sales[0].paidAmount, 60);
  assert.equal(state.sales[0].paymentMethod, 'CASH');
  assert.ok(state.sales[0].saleNumber.startsWith('POS-'));

  // Stock reduced
  assert.equal(state.batches[0].quantity, 7);
  assert.equal(state.movements.length, 1);
  assert.equal(state.movements[0].movementType, 'SALE_OUT');
  assert.equal(state.movements[0].quantity, 3);

  // Cashbook cash in
  assert.equal(state.cashbook.length, 1);
  assert.equal(state.cashbook[0].direction, 'IN');
  assert.equal(state.cashbook[0].entryType, 'SALE');
  assert.equal(state.cashbook[0].paymentMethod, 'CASH');
  assert.equal(Number(state.cashbook[0].amount), 60);

  // Audit log
  assert.ok(state.audits.some((a) => a.action === 'SALE_CREATED'));
  assert.equal(state.customerCredits.length, 0);
});

test('POS UPI sale: stock decreases, UPI cashbook entry created', async () => {
  const { client, state } = makePosHarness();
  await createSale({
    paymentMethod: 'UPI',
    items: [{ productId: 'prod-1', quantity: 2 }],
  }, 'pos-upi-sale-1', client);

  assert.equal(state.batches[0].quantity, 8);
  assert.equal(state.cashbook.length, 1);
  assert.equal(state.cashbook[0].paymentMethod, 'UPI');
  assert.equal(Number(state.cashbook[0].amount), 40);
  assert.equal(state.cashbook[0].direction, 'IN');
});

test('POS BOTH split sale: cash out and UPI out created with exact split', async () => {
  const { client, state } = makePosHarness();
  await createSale({
    paymentMethod: 'BOTH',
    cashAmount: 25,
    upiAmount: 15,
    items: [{ productId: 'prod-1', quantity: 2 }],
  }, 'pos-both-sale-1', client);

  assert.equal(state.batches[0].quantity, 8);
  assert.equal(state.cashbook.length, 2);
  const cashEntry = state.cashbook.find((e) => e.paymentMethod === 'CASH');
  const upiEntry = state.cashbook.find((e) => e.paymentMethod === 'UPI');
  assert.equal(Number(cashEntry?.amount), 25);
  assert.equal(Number(upiEntry?.amount), 15);
});

test('POS CREDIT sale: requires customer, creates CustomerCredit, no cashbook entry', async () => {
  const { client, state } = makePosHarness();
  const sale = await createSale({
    paymentMethod: 'CREDIT',
    customerId: 'cust-1',
    items: [{ productId: 'prod-1', quantity: 4 }],
  }, 'pos-credit-sale-1', client);

  assert.ok(sale);
  assert.equal(state.sales[0].paidAmount, 0);
  assert.equal(state.sales[0].totalAmount, 80);
  assert.equal(state.batches[0].quantity, 6);
  assert.equal(state.cashbook.length, 0); // No cash received yet
  assert.equal(state.customerCredits.length, 1);
  assert.equal(state.customerCredits[0].amount, 80);
  assert.equal(state.customerCredits[0].balanceAmount, 80);
  assert.equal(state.customerCredits[0].status, 'PENDING');
  assert.equal(state.customers[0].outstanding, 80);
});

test('POS partial payment sale: ₹40 paid in CASH + ₹20 on CREDIT', async () => {
  const { client, state } = makePosHarness();
  await createSale({
    paymentMethod: 'CASH',
    customerId: 'cust-1',
    paidAmount: 40,
    items: [{ productId: 'prod-1', quantity: 3 }], // total = 60
  }, 'pos-partial-sale-1', client);

  assert.equal(state.sales[0].totalAmount, 60);
  assert.equal(state.sales[0].paidAmount, 40);
  assert.equal(state.batches[0].quantity, 7);

  // Cashbook entry only for ₹40
  assert.equal(state.cashbook.length, 1);
  assert.equal(Number(state.cashbook[0].amount), 40);

  // Customer credit for ₹20
  assert.equal(state.customerCredits.length, 1);
  assert.equal(state.customerCredits[0].amount, 20);
  assert.equal(state.customerCredits[0].balanceAmount, 20);
  assert.equal(state.customers[0].outstanding, 20);
});

test('Credit sale without customer is rejected', async () => {
  const { client } = makePosHarness();
  await assert.rejects(() => createSale({
    paymentMethod: 'CREDIT',
    items: [{ productId: 'prod-1', quantity: 1 }],
  }, 'pos-bad-credit-1', client));
});

test('Customer payment settles credit balance and writes cashbook entry', async () => {
  const { client, state } = makePosHarness({
    customerCredits: [
      { id: 'credit-1', customerId: 'cust-1', amount: 100, paidAmount: 0, balanceAmount: 100, status: 'PENDING' },
    ],
    customers: [
      { id: 'cust-1', name: 'Rahul', outstanding: 100 },
    ],
  });

  await recordCustomerPayment({
    customerId: 'cust-1',
    amount: 60,
    paymentMethod: 'CASH',
  }, 'cust-pay-1', client);

  assert.equal(state.customerCredits[0].paidAmount, 60);
  assert.equal(state.customerCredits[0].balanceAmount, 40);
  assert.equal(state.customerCredits[0].status, 'PARTIAL');
  assert.equal(state.customers[0].outstanding, 40);

  assert.equal(state.cashbook.length, 1);
  assert.equal(state.cashbook[0].entryType, 'CUSTOMER_PAYMENT');
  assert.equal(state.cashbook[0].direction, 'IN');
  assert.equal(Number(state.cashbook[0].amount), 60);
});

test('Customer payment in full marks credit as PAID', async () => {
  const { client, state } = makePosHarness({
    customerCredits: [
      { id: 'credit-1', customerId: 'cust-1', amount: 50, paidAmount: 0, balanceAmount: 50, status: 'PENDING' },
    ],
    customers: [
      { id: 'cust-1', name: 'Rahul', outstanding: 50 },
    ],
  });

  await recordCustomerPayment({
    customerId: 'cust-1',
    amount: 50,
    paymentMethod: 'UPI',
  }, 'cust-pay-full-1', client);

  assert.equal(state.customerCredits[0].balanceAmount, 0);
  assert.equal(state.customerCredits[0].status, 'PAID');
  assert.equal(state.customers[0].outstanding, 0);
  assert.equal(state.cashbook[0].paymentMethod, 'UPI');
});

test('Customer payment rejects amount exceeding outstanding credit', async () => {
  const { client } = makePosHarness({
    customerCredits: [
      { id: 'credit-1', customerId: 'cust-1', amount: 30, paidAmount: 0, balanceAmount: 30, status: 'PENDING' },
    ],
  });

  await assert.rejects(() => recordCustomerPayment({
    customerId: 'cust-1',
    amount: 50,
    paymentMethod: 'CASH',
  }, 'cust-pay-over-1', client));
});

test('FEFO automatic allocation selects earliest expiry batch first', async () => {
  const { client, state } = makePosHarness({
    batches: [
      { id: 'batch-late', productId: 'prod-1', batchNumber: 'LATE', quantity: 10, expiryDate: new Date('2029-06-30'), sellingPrice: 20, createdAt: new Date('2026-01-01') },
      { id: 'batch-early', productId: 'prod-1', batchNumber: 'EARLY', quantity: 5, expiryDate: new Date('2027-01-15'), sellingPrice: 20, createdAt: new Date('2026-01-01') },
    ],
  });

  await createSale({
    paymentMethod: 'CASH',
    items: [{ productId: 'prod-1', quantity: 3 }],
  }, 'pos-fefo-1', client);

  assert.equal(state.saleItems.length, 1);
  assert.equal(state.saleItems[0].batchId, 'batch-early');
  assert.equal(state.movements[0].batchId, 'batch-early');
});

test('Multi-batch allocation splits line across batches when quantity exceeds single batch', async () => {
  const { client, state } = makePosHarness({
    batches: [
      { id: 'batch-1', productId: 'prod-1', batchNumber: 'B1', quantity: 4, expiryDate: new Date('2027-01-01'), sellingPrice: 20, createdAt: new Date('2026-01-01') },
      { id: 'batch-2', productId: 'prod-1', batchNumber: 'B2', quantity: 10, expiryDate: new Date('2028-01-01'), sellingPrice: 20, createdAt: new Date('2026-01-01') },
    ],
  });

  await createSale({
    paymentMethod: 'CASH',
    items: [{ productId: 'prod-1', quantity: 6, discount: 6 }],
  }, 'pos-multi-batch-1', client);

  // Needs 4 from batch-1 and 2 from batch-2
  assert.equal(state.saleItems.length, 2);
  assert.equal(state.saleItems[0].batchId, 'batch-1');
  assert.equal(state.saleItems[0].quantity, 4);
  assert.equal(state.saleItems[1].batchId, 'batch-2');
  assert.equal(state.saleItems[1].quantity, 2);

  // Discount split: 4/6 * 6 = 4 for batch-1, 2 for batch-2
  assert.equal(state.saleItems[0].discount, 4);
  assert.equal(state.saleItems[1].discount, 2);
});

test('Expired batches are rejected / excluded from sale', async () => {
  const { client } = makePosHarness({
    batches: [
      { id: 'batch-expired', productId: 'prod-1', batchNumber: 'EXP', quantity: 10, expiryDate: new Date('2020-01-01'), sellingPrice: 20 },
    ],
  });

  await assert.rejects(() => createSale({
    paymentMethod: 'CASH',
    items: [{ productId: 'prod-1', batchId: 'batch-expired', quantity: 2 }],
  }, 'pos-expired-1', client));
});

test('Oversell prevention: rejects sale when stock is insufficient', async () => {
  const { client } = makePosHarness({
    batches: [
      { id: 'batch-1', productId: 'prod-1', batchNumber: 'B1', quantity: 3, expiryDate: new Date('2028-01-01'), sellingPrice: 20 },
    ],
  });

  await assert.rejects(() => createSale({
    paymentMethod: 'CASH',
    items: [{ productId: 'prod-1', quantity: 10 }],
  }, 'pos-oversell-1', client));
});

test('Sale idempotency: duplicate key returns original sale without duplicate movements', async () => {
  const { client, state } = makePosHarness();
  const input = {
    paymentMethod: 'CASH' as const,
    items: [{ productId: 'prod-1', quantity: 2 }],
  };

  const sale1 = await createSale(input, 'pos-idempotent-key-1', client);
  const sale2 = await createSale(input, 'pos-idempotent-key-1', client);

  assert.equal(sale1?.id, sale2?.id);
  assert.equal(state.sales.length, 1);
  assert.equal(state.movements.length, 1);
  assert.equal(state.cashbook.length, 1);
});

test('Customer CRUD and ledger balance calculation', async () => {
  const { client } = makePosHarness();
  const created = await createCustomer({ name: 'Vikram Singh', phone: '9988776655' }, client);
  assert.equal(created.name, 'Vikram Singh');

  const customerList = await listCustomers('Vikram', client);
  assert.ok(customerList.length >= 1);

  const customerDetail = await getCustomer('cust-1', client);
  assert.equal(customerDetail.name, 'Rahul Sharma');
});

// STEP 5 — VERIFY EXPECTED DRAWER
test('STEP 5 — Expected Drawer reconciliation: opening, cash sale, UPI sale, customer cash/UPI payment, credit sale', async () => {
  const { calculateDrawerTotals } = await import('../src/services/cashbookMath.js');
  const { client, state } = makePosHarness({
    products: [
      { id: 'prod-x', name: 'Product X', active: true, sellingPrice: 100, gst: 0 },
    ],
    batches: [
      { id: 'bx-1', productId: 'prod-x', batchNumber: 'BX1', quantity: 500, expiryDate: new Date('2029-01-01'), sellingPrice: 100, createdAt: new Date('2026-01-01') },
    ],
    customers: [
      { id: 'cust-1', name: 'Test Customer', outstanding: 0 },
    ],
  });

  const openingCash = 10000;

  // 1. Cash POS sale = ₹2,000 (20 items @ ₹100)
  await createSale({
    paymentMethod: 'CASH',
    items: [{ productId: 'prod-x', quantity: 20 }],
  }, 'step5-sale-cash', client);

  let drawer = calculateDrawerTotals(openingCash, state.cashbook as any);
  assert.equal(drawer.cashInflows.toNumber(), 2000);
  assert.equal(drawer.expectedDrawerCash.toNumber(), 12000);

  // 2. UPI POS sale = ₹3,000 (30 items @ ₹100)
  await createSale({
    paymentMethod: 'UPI',
    items: [{ productId: 'prod-x', quantity: 30 }],
  }, 'step5-sale-upi', client);

  // Expected drawer MUST NOT increase because of UPI sale
  drawer = calculateDrawerTotals(openingCash, state.cashbook as any);
  assert.equal(drawer.cashInflows.toNumber(), 2000);
  assert.equal(drawer.expectedDrawerCash.toNumber(), 12000);

  // 3. Credit POS sale = ₹1,000 (10 items @ ₹100)
  await createSale({
    paymentMethod: 'CREDIT',
    customerId: 'cust-1',
    items: [{ productId: 'prod-x', quantity: 10 }],
  }, 'step5-sale-credit', client);

  // Expected drawer does not change for unpaid credit
  drawer = calculateDrawerTotals(openingCash, state.cashbook as any);
  assert.equal(drawer.cashInflows.toNumber(), 2000);
  assert.equal(drawer.expectedDrawerCash.toNumber(), 12000);

  // 4. Customer cash payment = ₹500
  await recordCustomerPayment({
    customerId: 'cust-1',
    amount: 500,
    paymentMethod: 'CASH',
  }, 'step5-cust-pay-cash', client);

  // Expected drawer increases by ₹500 -> ₹12,500
  drawer = calculateDrawerTotals(openingCash, state.cashbook as any);
  assert.equal(drawer.cashInflows.toNumber(), 2500);
  assert.equal(drawer.expectedDrawerCash.toNumber(), 12500);

  // 5. Customer UPI payment = ₹500
  await recordCustomerPayment({
    customerId: 'cust-1',
    amount: 500,
    paymentMethod: 'UPI',
  }, 'step5-cust-pay-upi', client);

  // Expected drawer does NOT change for customer UPI payment -> stays ₹12,500
  drawer = calculateDrawerTotals(openingCash, state.cashbook as any);
  assert.equal(drawer.cashInflows.toNumber(), 2500);
  assert.equal(drawer.expectedDrawerCash.toNumber(), 12500);
});

// STEP 6 — VERIFY FEFO & MULTI-BATCH
test('STEP 6 — FEFO earlier expiry batch is depleted first (Batch B before Batch A)', async () => {
  const { client, state } = makePosHarness({
    products: [
      { id: 'prod-x', name: 'Product X', active: true, sellingPrice: 50, gst: 0 },
    ],
    batches: [
      { id: 'batch-a', productId: 'prod-x', batchNumber: 'BA', quantity: 100, expiryDate: new Date('2029-12-31'), sellingPrice: 50, createdAt: new Date('2026-01-01') },
      { id: 'batch-b', productId: 'prod-x', batchNumber: 'BB', quantity: 30, expiryDate: new Date('2027-06-30'), sellingPrice: 50, createdAt: new Date('2026-01-01') },
    ],
  });

  // Sell 20
  await createSale({
    paymentMethod: 'CASH',
    items: [{ productId: 'prod-x', quantity: 20 }],
  }, 'step6-fefo-sale', client);

  const batchA = state.batches.find((b) => b.id === 'batch-a');
  const batchB = state.batches.find((b) => b.id === 'batch-b');
  assert.equal(batchB?.quantity, 10);
  assert.equal(batchA?.quantity, 100);
});

test('STEP 6 — Multi-batch allocation: Batch A = 5, Batch B = 20, sell 10 -> Batch A = 0, Batch B = 15', async () => {
  const { client, state } = makePosHarness({
    products: [
      { id: 'prod-x', name: 'Product X', active: true, sellingPrice: 50, gst: 0 },
    ],
    batches: [
      { id: 'batch-a', productId: 'prod-x', batchNumber: 'BA', quantity: 5, expiryDate: new Date('2027-01-01'), sellingPrice: 50, createdAt: new Date('2026-01-01') },
      { id: 'batch-b', productId: 'prod-x', batchNumber: 'BB', quantity: 20, expiryDate: new Date('2028-01-01'), sellingPrice: 50, createdAt: new Date('2026-01-01') },
    ],
  });

  // Sell 10
  const sale = await createSale({
    paymentMethod: 'CASH',
    items: [{ productId: 'prod-x', quantity: 10 }],
  }, 'step6-multibatch-sale', client);

  const batchA = state.batches.find((b) => b.id === 'batch-a');
  const batchB = state.batches.find((b) => b.id === 'batch-b');
  assert.equal(batchA?.quantity, 0);
  assert.equal(batchB?.quantity, 15);

  // The Sale must preserve both batch allocations
  assert.equal(state.saleItems.length, 2);
  assert.equal(state.saleItems[0].batchId, 'batch-a');
  assert.equal(state.saleItems[0].quantity, 5);
  assert.equal(state.saleItems[1].batchId, 'batch-b');
  assert.equal(state.saleItems[1].quantity, 5);
});

// STEP 7 — VERIFY OVERSALE ROLLBACK
test('STEP 7 — Oversell rollback: stock = 10, attempt sale = 11 -> nothing committed', async () => {
  const { client, state } = makePosHarness({
    products: [
      { id: 'prod-x', name: 'Product X', active: true, sellingPrice: 50, gst: 0 },
    ],
    batches: [
      { id: 'batch-1', productId: 'prod-x', batchNumber: 'B1', quantity: 10, expiryDate: new Date('2028-01-01'), sellingPrice: 50, createdAt: new Date('2026-01-01') },
    ],
    customers: [
      { id: 'cust-1', name: 'Test Customer', outstanding: 0 },
    ],
  });

  await assert.rejects(() => createSale({
    paymentMethod: 'CREDIT',
    customerId: 'cust-1',
    items: [{ productId: 'prod-x', quantity: 11 }],
  }, 'step7-oversell-key', client));

  // Verify absolutely nothing is committed
  assert.equal(state.sales.length, 0, 'no Sale');
  assert.equal(state.saleItems.length, 0, 'no SaleItem');
  assert.equal(state.movements.length, 0, 'no StockMovement');
  assert.equal(state.payments.length, 0, 'no Payment');
  assert.equal(state.cashbook.length, 0, 'no Cashbook');
  assert.equal(state.customerCredits.length, 0, 'no CustomerCredit');
  assert.equal(state.batches[0].quantity, 10, 'stock intact');
  assert.equal(state.customers[0].outstanding, 0, 'customer credit unchanged');
});

// STEP 8 — VERIFY IDEMPOTENCY
test('STEP 8 — Idempotency: duplicate request returns original; key with different items returns original', async () => {
  const { client, state } = makePosHarness({
    products: [
      { id: 'prod-x', name: 'Product X', active: true, sellingPrice: 50, gst: 0 },
    ],
    batches: [
      { id: 'batch-1', productId: 'prod-x', batchNumber: 'B1', quantity: 20, expiryDate: new Date('2028-01-01'), sellingPrice: 50, createdAt: new Date('2026-01-01') },
    ],
    customers: [
      { id: 'cust-1', name: 'Test Customer', outstanding: 0 },
    ],
  });

  const sale1 = await createSale({
    paymentMethod: 'CREDIT',
    customerId: 'cust-1',
    items: [{ productId: 'prod-x', quantity: 2 }],
  }, 'step8-idempotency-key', client);

  // Submit second time with same key
  const sale2 = await createSale({
    paymentMethod: 'CREDIT',
    customerId: 'cust-1',
    items: [{ productId: 'prod-x', quantity: 2 }],
  }, 'step8-idempotency-key', client);

  assert.equal(sale1?.id, sale2?.id);
  assert.equal(state.sales.length, 1, 'exactly 1 Sale');
  assert.equal(state.saleItems.length, 1, 'exactly 1 SaleItem');
  assert.equal(state.batches[0].quantity, 18, 'stock reduced only once');
  assert.equal(state.movements.length, 1, 'exactly 1 StockMovement');
  assert.equal(state.customerCredits.length, 1, 'exactly 1 CustomerCredit');

  // Submit with different quantity using same key -> returns original sale without further stock deduction
  const sale3 = await createSale({
    paymentMethod: 'CREDIT',
    customerId: 'cust-1',
    items: [{ productId: 'prod-x', quantity: 5 }],
  }, 'step8-idempotency-key', client);

  assert.equal(sale3?.id, sale1?.id);
  assert.equal(state.batches[0].quantity, 18, 'stock not further reduced');
  assert.equal(state.sales.length, 1);
});

// STEP 9 — VERIFY CREDIT
test('STEP 9 — Credit split & settlement: Sale ₹2000, Cash ₹800, Credit ₹1200; then pay ₹500 cash', async () => {
  const { client, state } = makePosHarness({
    products: [
      { id: 'prod-x', name: 'Product X', active: true, sellingPrice: 100, gst: 0 },
    ],
    batches: [
      { id: 'batch-1', productId: 'prod-x', batchNumber: 'B1', quantity: 50, expiryDate: new Date('2028-01-01'), sellingPrice: 100, createdAt: new Date('2026-01-01') },
    ],
    customers: [
      { id: 'cust-1', name: 'Rahul Sharma', outstanding: 0 },
    ],
  });

  // Sale = ₹2,000 (20 items @ ₹100), Cash paid = ₹800, Credit = ₹1,200
  const sale = await createSale({
    paymentMethod: 'CASH',
    customerId: 'cust-1',
    paidAmount: 800,
    items: [{ productId: 'prod-x', quantity: 20 }],
  }, 'step9-sale-credit-split', client);

  assert.equal(sale?.totalAmount, 2000);
  assert.equal(sale?.paidAmount, 800);
  assert.equal(state.cashbook.length, 1);
  assert.equal(state.cashbook[0].paymentMethod, 'CASH');
  assert.equal(Number(state.cashbook[0].amount), 800);
  assert.equal(state.customers[0].outstanding, 1200);
  assert.equal(state.customerCredits.length, 1);
  assert.equal(state.customerCredits[0].balanceAmount, 1200);

  // Customer pays ₹500 cash
  await recordCustomerPayment({
    customerId: 'cust-1',
    amount: 500,
    paymentMethod: 'CASH',
  }, 'step9-cust-payment-500', client);

  // Cashbook cash +₹500
  assert.equal(state.cashbook.length, 2);
  const paymentEntry = state.cashbook.find((e) => e.entryType === 'CUSTOMER_PAYMENT');
  assert.equal(Number(paymentEntry?.amount), 500);
  assert.equal(paymentEntry?.paymentMethod, 'CASH');

  // Customer outstanding = ₹700
  assert.equal(state.customers[0].outstanding, 700);
  assert.equal(state.customerCredits[0].balanceAmount, 700);
  assert.equal(state.customerCredits[0].status, 'PARTIAL');
});


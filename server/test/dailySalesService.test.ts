import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDailySales,
  getDailySalesReconciliation,
  getDailySale,
  getDailySaleForDate,
  updateDailySales,
} from '../src/services/dailySalesService.js';
import { calculateDrawerTotals } from '../src/services/cashbookMath.js';

type MockState = {
  sales: Array<Record<string, any>>;
  dailySales: Array<Record<string, any>>;
  dailyClosings: Array<Record<string, any>>;
  cashbook: Array<Record<string, any>>;
  audits: Array<Record<string, any>>;
};

const makeDailySalesHarness = (initialState?: Partial<MockState>) => {
  const state: MockState = {
    sales: [],
    dailySales: [],
    dailyClosings: [],
    cashbook: [],
    audits: [],
    ...initialState,
  };

  const client: any = {
    $transaction: async (operation: (tx: any) => Promise<unknown>) => {
      const snapDailySales = state.dailySales.map((d) => ({ ...d }));
      const snapDailyClosings = state.dailyClosings.map((c) => ({ ...c }));
      const snapCashbook = [...state.cashbook];
      const snapAudits = [...state.audits];
      try {
        return await operation(client);
      } catch (err) {
        state.dailySales = snapDailySales;
        state.dailyClosings = snapDailyClosings;
        state.cashbook = snapCashbook;
        state.audits = snapAudits;
        throw err;
      }
    },
    sale: {
      findMany: async ({ where }: any) => {
        return state.sales.filter((s) => {
          if (where.status && s.status !== where.status) return false;
          if (where.saleDate?.gte && s.saleDate < where.saleDate.gte) return false;
          if (where.saleDate?.lte && s.saleDate > where.saleDate.lte) return false;
          return true;
        });
      },
    },
    dailySale: {
      findUnique: async ({ where }: any) => {
        if (where.id) return state.dailySales.find((d) => d.id === where.id) ?? null;
        if (where.idempotencyKey) return state.dailySales.find((d) => d.idempotencyKey === where.idempotencyKey) ?? null;
        if (where.businessDate) {
          const target = new Date(where.businessDate).toISOString().slice(0, 10);
          return state.dailySales.find((d) => new Date(d.businessDate).toISOString().slice(0, 10) === target) ?? null;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const row = { id: `ds-${state.dailySales.length + 1}`, ...data };
        state.dailySales.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = state.dailySales.find((d) => d.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      },
    },
    dailyClosing: {
      findUnique: async ({ where }: any) => {
        if (where.closingDate) {
          const target = new Date(where.closingDate).toISOString().slice(0, 10);
          return state.dailyClosings.find((c) => new Date(c.closingDate).toISOString().slice(0, 10) === target) ?? null;
        }
        return null;
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

// 1. Daily Sales create (no POS sales)
test('Daily Sales create (no POS sales): non-POS equals total, creates cashbook cash and UPI inflows', async () => {
  const { client, state } = makeDailySalesHarness();
  const res = await createDailySales({
    businessDate: '2026-10-06',
    cashSales: 15000,
    upiSales: 10000,
  }, 'ds-key-1', client);

  assert.equal(res.totalSales, 25000);
  assert.equal(res.nonPosCashSales, 15000);
  assert.equal(res.nonPosUpiSales, 10000);
  assert.equal(res.nonPosTotalSales, 25000);
  assert.equal(res.posTotalSales, 0);

  // Cashbook entries: 1 CASH IN (15,000), 1 UPI IN (10,000)
  assert.equal(state.cashbook.length, 2);
  const cashEntry = state.cashbook.find((e) => e.paymentMethod === 'CASH');
  const upiEntry = state.cashbook.find((e) => e.paymentMethod === 'UPI');
  assert.equal(Number(cashEntry?.amount), 15000);
  assert.equal(cashEntry?.direction, 'IN');
  assert.equal(Number(upiEntry?.amount), 10000);
  assert.equal(upiEntry?.direction, 'IN');
});

// 2. POS + Daily Sales reconciliation & no-double-count
test('Daily Sales with existing POS: Cashbook only receives non-POS portion, NO double counting', async () => {
  const date = new Date('2026-10-06T10:00:00.000Z');
  const { client, state } = makeDailySalesHarness({
    sales: [
      {
        id: 'pos-1',
        saleNumber: 'POS-001',
        saleDate: date,
        paymentMethod: 'CASH',
        totalAmount: 5000,
        paidAmount: 5000,
        status: 'COMPLETED',
        payments: [{ paymentMethod: 'CASH', amount: 5000, splits: [] }],
      },
      {
        id: 'pos-2',
        saleNumber: 'POS-002',
        saleDate: date,
        paymentMethod: 'UPI',
        totalAmount: 3000,
        paidAmount: 3000,
        status: 'COMPLETED',
        payments: [{ paymentMethod: 'UPI', amount: 3000, splits: [] }],
      },
    ],
    // Existing POS cashbook entries
    cashbook: [
      { id: 'cb-pos-1', entryType: 'SALE', direction: 'IN', amount: 5000, paymentMethod: 'CASH', businessDate: new Date('2026-10-06') },
      { id: 'cb-pos-2', entryType: 'SALE', direction: 'IN', amount: 3000, paymentMethod: 'UPI', businessDate: new Date('2026-10-06') },
    ],
  });

  // User enters Aggregate Day's Sales: Cash = ₹12,000, UPI = ₹10,000, Total = ₹22,000
  const ds = await createDailySales({
    businessDate: '2026-10-06',
    cashSales: 12000,
    upiSales: 10000,
  }, 'ds-key-reconciled', client);

  // Non-POS should be: Cash = 12,000 - 5,000 = 7,000; UPI = 10,000 - 3,000 = 7,000
  assert.equal(ds.nonPosCashSales, 7000);
  assert.equal(ds.nonPosUpiSales, 7000);
  assert.equal(ds.nonPosTotalSales, 14000);
  assert.equal(ds.posCashSales, 5000);
  assert.equal(ds.posUpiSales, 3000);
  assert.equal(ds.totalSales, 22000);

  // Cashbook entries should only add Non-POS: +₹7,000 CASH, +₹7,000 UPI
  // Total cashbook entries: 2 from POS + 2 from Daily Sales = 4
  assert.equal(state.cashbook.length, 4);
  const dsCashEntry = state.cashbook.find((e) => e.sourceType === 'DAILY_SALES' && e.paymentMethod === 'CASH');
  const dsUpiEntry = state.cashbook.find((e) => e.sourceType === 'DAILY_SALES' && e.paymentMethod === 'UPI');
  assert.equal(Number(dsCashEntry?.amount), 7000, 'Only ₹7,000 non-POS cash added to Cashbook');
  assert.equal(Number(dsUpiEntry?.amount), 7000, 'Only ₹7,000 non-POS UPI added to Cashbook');

  // Verify expected drawer calculation
  const drawer = calculateDrawerTotals(10000, state.cashbook as any);
  // Total cash in: POS (5,000) + Non-POS (7,000) = 12,000
  assert.equal(drawer.cashInflows.toNumber(), 12000);
  assert.equal(drawer.expectedDrawerCash.toNumber(), 22000); // 10,000 opening + 12,000 cash sales
});

// 3. Invalid negative non-POS sales rejection
test('Rejects daily sales where daily cash is less than POS cash sales', async () => {
  const date = new Date('2026-10-06T10:00:00.000Z');
  const { client } = makeDailySalesHarness({
    sales: [
      {
        id: 'pos-1',
        saleDate: date,
        paymentMethod: 'CASH',
        totalAmount: 5000,
        paidAmount: 5000,
        status: 'COMPLETED',
        payments: [{ paymentMethod: 'CASH', amount: 5000, splits: [] }],
      },
    ],
  });

  // Daily cash = 4,000 < POS cash 5,000 -> must reject
  await assert.rejects(
    () => createDailySales({
      businessDate: '2026-10-06',
      cashSales: 4000,
      upiSales: 2000,
    }, 'ds-bad-cash', client),
    (err: any) => err.message.includes('cannot be less than POS cash sales'),
  );
});

test('Rejects daily sales where daily UPI is less than POS UPI sales', async () => {
  const date = new Date('2026-10-06T10:00:00.000Z');
  const { client } = makeDailySalesHarness({
    sales: [
      {
        id: 'pos-1',
        saleDate: date,
        paymentMethod: 'UPI',
        totalAmount: 3000,
        paidAmount: 3000,
        status: 'COMPLETED',
        payments: [{ paymentMethod: 'UPI', amount: 3000, splits: [] }],
      },
    ],
  });

  await assert.rejects(
    () => createDailySales({
      businessDate: '2026-10-06',
      cashSales: 5000,
      upiSales: 2000,
    }, 'ds-bad-upi', client),
    (err: any) => err.message.includes('cannot be less than POS UPI sales'),
  );
});

// 4. Daily Sales editing: incremental difference adjustment
test('Daily Sales update: increasing amounts creates cashbook adjustment for difference only', async () => {
  const date = new Date('2026-10-06T10:00:00.000Z');
  const { client, state } = makeDailySalesHarness({
    sales: [
      {
        id: 'pos-1',
        saleDate: date,
        paymentMethod: 'CASH',
        totalAmount: 2000,
        paidAmount: 2000,
        status: 'COMPLETED',
        payments: [{ paymentMethod: 'CASH', amount: 2000 }],
      },
      {
        id: 'pos-2',
        saleDate: date,
        paymentMethod: 'UPI',
        totalAmount: 3000,
        paidAmount: 3000,
        status: 'COMPLETED',
        payments: [{ paymentMethod: 'UPI', amount: 3000 }],
      },
    ],
  });

  // Initial: Cash = 7,000 (Non-POS = 5,000), UPI = 8,000 (Non-POS = 5,000)
  const initial = await createDailySales({
    businessDate: '2026-10-06',
    cashSales: 7000,
    upiSales: 8000,
  }, 'ds-edit-init', client);

  assert.equal(state.cashbook.length, 2);

  // Edit to: Cash = 8,000 (+1,000), UPI = 9,000 (+1,000)
  const updated = await updateDailySales(initial.id, {
    cashSales: 8000,
    upiSales: 9000,
  }, 'ds-edit-step-2', client);

  assert.equal(updated.nonPosCashSales, 6000);
  assert.equal(updated.nonPosUpiSales, 6000);
  assert.equal(updated.totalSales, 17000);

  // Cashbook adjustments: 2 original + 2 adjustment entries = 4 entries
  assert.equal(state.cashbook.length, 4);
  const cashAdj = state.cashbook.find((e) => e.sourceType === 'DAILY_SALES_ADJUSTMENT' && e.paymentMethod === 'CASH');
  const upiAdj = state.cashbook.find((e) => e.sourceType === 'DAILY_SALES_ADJUSTMENT' && e.paymentMethod === 'UPI');
  assert.equal(Number(cashAdj?.amount), 1000);
  assert.equal(cashAdj?.direction, 'IN');
  assert.equal(Number(upiAdj?.amount), 1000);
  assert.equal(upiAdj?.direction, 'IN');
});

test('Daily Sales update: decreasing amounts creates downward adjustment', async () => {
  const { client, state } = makeDailySalesHarness();

  const initial = await createDailySales({
    businessDate: '2026-10-06',
    cashSales: 10000,
    upiSales: 5000,
  }, 'ds-down-init', client);

  // Change to 8,000 Cash (-2,000)
  await updateDailySales(initial.id, {
    cashSales: 8000,
    upiSales: 5000,
  }, 'ds-down-step-2', client);

  const outAdj = state.cashbook.find((e) => e.sourceType === 'DAILY_SALES_ADJUSTMENT' && e.direction === 'OUT');
  assert.ok(outAdj);
  assert.equal(Number(outAdj.amount), 2000);
  assert.equal(outAdj.paymentMethod, 'CASH');
});

// 5. Closed-day protection
test('Closed-day protection: rejects creating or updating daily sales on closed business date', async () => {
  const { client } = makeDailySalesHarness({
    dailyClosings: [
      { closingDate: new Date('2026-10-05T00:00:00.000Z'), actualCash: 10000 },
    ],
  });

  // Cannot create on closed date
  await assert.rejects(
    () => createDailySales({
      businessDate: '2026-10-05',
      cashSales: 5000,
      upiSales: 2000,
    }, 'ds-closed-day', client),
    (err: any) => err.message.includes('closed business day'),
  );
});

// 6. Idempotency
test('Daily Sales idempotency: duplicate request returns original; key reuse with different amounts rejected', async () => {
  const { client, state } = makeDailySalesHarness();

  const res1 = await createDailySales({
    businessDate: '2026-10-06',
    cashSales: 5000,
    upiSales: 3000,
  }, 'ds-idemp-1', client);

  const res2 = await createDailySales({
    businessDate: '2026-10-06',
    cashSales: 5000,
    upiSales: 3000,
  }, 'ds-idemp-1', client);

  assert.equal(res1.id, res2.id);
  assert.equal(state.dailySales.length, 1);
  assert.equal(state.cashbook.length, 2);

  // Reuse key with different financial amounts -> rejected
  await assert.rejects(
    () => createDailySales({
      businessDate: '2026-10-06',
      cashSales: 8000,
      upiSales: 4000,
    }, 'ds-idemp-1', client),
    (err: any) => err.message.includes('Idempotency key reuse'),
  );
});

// 7. Reconciliation query
test('getDailySalesReconciliation returns correct status and breakdown', async () => {
  const date = new Date('2026-10-06T10:00:00.000Z');
  const { client } = makeDailySalesHarness({
    sales: [
      {
        id: 'pos-1',
        saleDate: date,
        paymentMethod: 'CASH',
        totalAmount: 1000,
        paidAmount: 1000,
        status: 'COMPLETED',
        payments: [{ paymentMethod: 'CASH', amount: 1000 }],
      },
    ],
    dailySales: [
      {
        id: 'ds-1',
        businessDate: new Date('2026-10-06T00:00:00.000Z'),
        cashSales: 5000,
        upiSales: 2000,
        otherSales: 0,
        totalSales: 7000,
        posCashSales: 1000,
        posUpiSales: 0,
        posCreditSales: 0,
        posTotalSales: 1000,
        nonPosCashSales: 4000,
        nonPosUpiSales: 2000,
        nonPosTotalSales: 6000,
      },
    ],
  });

  const recon = await getDailySalesReconciliation('2026-10-06', client);
  assert.equal(recon.reconciliationStatus, 'BALANCED');
  assert.equal(recon.posCashSales, 1000);
  assert.equal(recon.nonPosCashSales, 4000);
  assert.equal(recon.nonPosUpiSales, 2000);
  assert.equal(recon.totalSales, 7000);
  assert.equal(recon.isClosed, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import {
  resolveDateRange,
  getSalesReport,
  getPurchaseReport,
  getExpenseReport,
  getCashbookReport,
  getProfitReport,
  getGstReport,
  getInventoryValuationReport,
  getCustomerOutstandingReport,
  getSupplierOutstandingReport,
  getProductAnalyticsReport,
  getCategoryAnalyticsReport,
  getMonthlyTargetReport,
  setMonthlyTarget,
} from '../src/services/reportsService.js';

const decimal = (value: number | string) => new Prisma.Decimal(value);

const createMockDb = () => {
  const store = {
    products: [] as any[],
    categories: [] as any[],
    batches: [] as any[],
    sales: [] as any[],
    saleItems: [] as any[],
    saleReturns: [] as any[],
    saleReturnItems: [] as any[],
    purchases: [] as any[],
    purchaseItems: [] as any[],
    purchaseReturns: [] as any[],
    purchaseReturnItems: [] as any[],
    expenses: [] as any[],
    customers: [] as any[],
    suppliers: [] as any[],
    cashbookEntries: [] as any[],
    stockMovements: [] as any[],
    dailyClosings: [] as any[],
    dailySales: [] as any[],
    salesTargets: [] as any[],
    payments: [] as any[],
  };

  const db: any = {
    product: {
      findUnique: async ({ where }: any) => store.products.find((p) => p.id === where.id) ?? null,
      findMany: async ({ where }: any) => {
        let res = [...store.products];
        if (where?.categoryId) res = res.filter((p) => p.categoryId === where.categoryId);
        if (where?.supplierId) res = res.filter((p) => p.supplierId === where.supplierId);
        return res.map((p) => ({
          ...p,
          category: store.categories.find((c) => c.id === p.categoryId) ?? null,
          supplier: store.suppliers.find((s) => s.id === p.supplierId) ?? null,
        }));
      },
      create: async ({ data }: any) => {
        const item = { id: data.id ?? `prod-${store.products.length + 1}`, active: true, ...data };
        store.products.push(item);
        return item;
      },
    },

    category: {
      findMany: async () => store.categories,
      create: async ({ data }: any) => {
        const cat = { id: data.id ?? `cat-${store.categories.length + 1}`, ...data };
        store.categories.push(cat);
        return cat;
      },
    },

    productBatch: {
      findMany: async ({ where, orderBy }: any) => {
        let res = [...store.batches];
        if (where?.quantity?.gt !== undefined) res = res.filter((b) => b.quantity > where.quantity.gt);
        if (where?.supplierId) res = res.filter((b) => b.supplierId === where.supplierId);
        if (where?.productId) res = res.filter((b) => b.productId === where.productId);
        return res.map((b) => ({
          ...b,
          product: store.products.find((p) => p.id === b.productId),
          supplier: store.suppliers.find((s) => s.id === b.supplierId),
        }));
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
      findMany: async ({ where }: any) => {
        let res = [...store.sales];
        if (where?.saleDate?.gte && where?.saleDate?.lte) {
          res = res.filter((s) => s.saleDate >= where.saleDate.gte && s.saleDate <= where.saleDate.lte);
        }
        if (where?.customerId) res = res.filter((s) => s.customerId === where.customerId);
        if (where?.status) res = res.filter((s) => s.status === where.status);
        return res.map((s) => ({
          ...s,
          customer: store.customers.find((c) => c.id === s.customerId) ?? null,
          items: store.saleItems.filter((i) => i.saleId === s.id).map((i) => ({
            ...i,
            product: store.products.find((p) => p.id === i.productId),
            batch: store.batches.find((b) => b.id === i.batchId),
          })),
          payments: store.payments.filter((p) => p.saleId === s.id),
          credits: [],
        }));
      },
      create: async ({ data }: any) => {
        const sale = {
          id: data.id ?? `sale-${store.sales.length + 1}`,
          status: 'COMPLETED',
          ...data,
          saleDate: data.saleDate instanceof Date ? data.saleDate : new Date(data.saleDate ?? Date.now()),
          totalAmount: decimal(data.totalAmount),
          paidAmount: decimal(data.paidAmount ?? 0),
        };
        store.sales.push(sale);
        return sale;
      },
    },

    saleItem: {
      findMany: async ({ where }: any) => {
        let res = [...store.saleItems];
        if (where?.sale?.saleDate?.gte && where?.sale?.saleDate?.lte) {
          const matchingSales = store.sales
            .filter((s) => s.saleDate >= where.sale.saleDate.gte && s.saleDate <= where.sale.saleDate.lte && s.status === 'COMPLETED')
            .map((s) => s.id);
          res = res.filter((i) => matchingSales.includes(i.saleId));
        }
        return res.map((i) => ({
          ...i,
          product: store.products.find((p) => p.id === i.productId),
          batch: store.batches.find((b) => b.id === i.batchId),
        }));
      },
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
      findMany: async ({ where }: any) => {
        let res = [...store.saleReturns];
        if (where?.createdAt?.gte && where?.createdAt?.lte) {
          res = res.filter((r) => r.createdAt >= where.createdAt.gte && r.createdAt <= where.createdAt.lte);
        }
        if (where?.customerId) res = res.filter((r) => r.customerId === where.customerId);
        return res.map((r) => ({
          ...r,
          items: store.saleReturnItems.filter((i) => i.saleReturnId === r.id).map((i) => ({
            ...i,
            product: store.products.find((p) => p.id === i.productId),
            batch: store.batches.find((b) => b.id === i.batchId),
            saleItem: store.saleItems.find((si) => si.id === i.saleItemId),
          })),
        }));
      },
      create: async ({ data }: any) => {
        const ret = {
          id: data.id ?? `sr-${store.saleReturns.length + 1}`,
          ...data,
          createdAt: data.createdAt instanceof Date ? data.createdAt : new Date(data.createdAt ?? Date.now()),
          totalAmount: decimal(data.totalAmount),
        };
        store.saleReturns.push(ret);
        return ret;
      },
    },

    saleReturnItem: {
      findMany: async ({ where }: any) => {
        let res = [...store.saleReturnItems];
        if (where?.saleReturn?.createdAt?.gte && where?.saleReturn?.createdAt?.lte) {
          const matching = store.saleReturns
            .filter((r) => r.createdAt >= where.saleReturn.createdAt.gte && r.createdAt <= where.saleReturn.createdAt.lte)
            .map((r) => r.id);
          res = res.filter((i) => matching.includes(i.saleReturnId));
        }
        return res.map((i) => ({
          ...i,
          product: store.products.find((p) => p.id === i.productId),
          batch: store.batches.find((b) => b.id === i.batchId),
        }));
      },
      create: async ({ data }: any) => {
        const item = {
          id: data.id ?? `sri-${store.saleReturnItems.length + 1}`,
          ...data,
          totalAmount: decimal(data.totalAmount),
        };
        store.saleReturnItems.push(item);
        return item;
      },
    },

    purchase: {
      findMany: async ({ where }: any) => {
        let res = [...store.purchases];
        if (where?.invoiceDate?.gte && where?.invoiceDate?.lte) {
          res = res.filter((p) => p.invoiceDate >= where.invoiceDate.gte && p.invoiceDate <= where.invoiceDate.lte);
        }
        if (where?.supplierId) res = res.filter((p) => p.supplierId === where.supplierId);
        return res.map((p) => ({
          ...p,
          supplier: store.suppliers.find((s) => s.id === p.supplierId),
          items: store.purchaseItems.filter((i) => i.purchaseId === p.id).map((i) => ({
            ...i,
            product: store.products.find((pr) => pr.id === i.productId),
            batch: store.batches.find((b) => b.id === i.batchId),
          })),
        }));
      },
      create: async ({ data }: any) => {
        const p = {
          id: data.id ?? `purch-${store.purchases.length + 1}`,
          ...data,
          invoiceDate: data.invoiceDate instanceof Date ? data.invoiceDate : new Date(data.invoiceDate ?? Date.now()),
          totalAmount: decimal(data.totalAmount),
          paidAmount: decimal(data.paidAmount ?? 0),
          outstandingAmount: decimal(data.outstandingAmount ?? data.totalAmount),
        };
        store.purchases.push(p);
        return p;
      },
    },

    purchaseItem: {
      create: async ({ data }: any) => {
        const item = {
          id: data.id ?? `pi-${store.purchaseItems.length + 1}`,
          ...data,
          purchaseRate: decimal(data.purchaseRate),
          discount: data.discount ? decimal(data.discount) : null,
          gst: data.gst ? decimal(data.gst) : null,
        };
        store.purchaseItems.push(item);
        return item;
      },
    },

    purchaseReturn: {
      findMany: async ({ where }: any) => {
        let res = [...store.purchaseReturns];
        if (where?.createdAt?.gte && where?.createdAt?.lte) {
          res = res.filter((r) => r.createdAt >= where.createdAt.gte && r.createdAt <= where.createdAt.lte);
        }
        if (where?.supplierId) res = res.filter((r) => r.supplierId === where.supplierId);
        return res.map((r) => ({
          ...r,
          supplier: store.suppliers.find((s) => s.id === r.supplierId),
          items: store.purchaseReturnItems.filter((i) => i.purchaseReturnId === r.id).map((i) => ({
            ...i,
            product: store.products.find((pr) => pr.id === i.productId),
            purchaseItem: store.purchaseItems.find((pi) => pi.id === i.purchaseItemId),
          })),
        }));
      },
      create: async ({ data }: any) => {
        const pr = {
          id: data.id ?? `pr-${store.purchaseReturns.length + 1}`,
          ...data,
          createdAt: data.createdAt instanceof Date ? data.createdAt : new Date(data.createdAt ?? Date.now()),
          totalAmount: decimal(data.totalAmount),
        };
        store.purchaseReturns.push(pr);
        return pr;
      },
    },

    purchaseReturnItem: {
      create: async ({ data }: any) => {
        const item = {
          id: data.id ?? `pri-${store.purchaseReturnItems.length + 1}`,
          ...data,
          totalAmount: decimal(data.totalAmount),
        };
        store.purchaseReturnItems.push(item);
        return item;
      },
    },

    expense: {
      findMany: async ({ where }: any) => {
        let res = [...store.expenses];
        if (where?.expenseDate?.gte && where?.expenseDate?.lte) {
          res = res.filter((e) => e.expenseDate >= where.expenseDate.gte && e.expenseDate <= where.expenseDate.lte);
        }
        return res;
      },
      create: async ({ data }: any) => {
        const exp = {
          id: data.id ?? `exp-${store.expenses.length + 1}`,
          ...data,
          expenseDate: data.expenseDate instanceof Date ? data.expenseDate : new Date(data.expenseDate ?? Date.now()),
          amount: decimal(data.amount),
        };
        store.expenses.push(exp);
        return exp;
      },
    },

    cashbookEntry: {
      findMany: async ({ where }: any) => {
        let res = [...store.cashbookEntries];
        if (where?.businessDate?.gte && where?.businessDate?.lte) {
          res = res.filter((e) => e.businessDate >= where.businessDate.gte && e.businessDate <= where.businessDate.lte);
        }
        return res;
      },
      create: async ({ data }: any) => {
        const entry = {
          id: `cb-${store.cashbookEntries.length + 1}`,
          ...data,
          businessDate: data.businessDate instanceof Date ? data.businessDate : new Date(data.businessDate ?? Date.now()),
          amount: decimal(data.amount),
          createdAt: new Date(),
        };
        store.cashbookEntries.push(entry);
        return entry;
      },
    },

    dailyClosing: {
      findUnique: async ({ where }: any) => store.dailyClosings.find((c) => c.closingDate.toISOString().slice(0, 10) === where.closingDate.toISOString().slice(0, 10)) ?? null,
      findMany: async ({ where }: any) => store.dailyClosings,
      create: async ({ data }: any) => {
        const c = {
          id: `dc-${store.dailyClosings.length + 1}`,
          ...data,
          closingDate: data.closingDate instanceof Date ? data.closingDate : new Date(data.closingDate),
          openingCash: decimal(data.openingCash),
          cashInflows: decimal(data.cashInflows ?? 0),
          cashOutflows: decimal(data.cashOutflows ?? 0),
          expectedCash: decimal(data.expectedCash),
          actualCash: decimal(data.actualCash),
          difference: decimal(data.difference),
        };
        store.dailyClosings.push(c);
        return c;
      },
    },

    dailySale: {
      findUnique: async ({ where }: any) => store.dailySales.find((d) => d.businessDate.toISOString().slice(0, 10) === where.businessDate.toISOString().slice(0, 10)) ?? null,
      create: async ({ data }: any) => {
        const ds = {
          id: `ds-${store.dailySales.length + 1}`,
          ...data,
          businessDate: data.businessDate instanceof Date ? data.businessDate : new Date(data.businessDate),
          cashSales: decimal(data.cashSales),
          upiSales: decimal(data.upiSales),
          otherSales: decimal(data.otherSales ?? 0),
          totalSales: decimal(data.totalSales),
        };
        store.dailySales.push(ds);
        return ds;
      },
    },

    customer: {
      findMany: async () => store.customers.map((c) => ({
        ...c,
        sales: store.sales.filter((s) => s.customerId === c.id),
        payments: [],
        customerCredits: [],
      })),
      create: async ({ data }: any) => {
        const c = { id: data.id ?? `cust-${store.customers.length + 1}`, ...data, outstanding: decimal(data.outstanding ?? 0) };
        store.customers.push(c);
        return c;
      },
    },

    supplier: {
      findMany: async () => store.suppliers.map((s) => ({
        ...s,
        purchases: store.purchases.filter((p) => p.supplierId === s.id),
        supplierPayments: [],
      })),
      create: async ({ data }: any) => {
        const s = { id: data.id ?? `supp-${store.suppliers.length + 1}`, ...data, outstanding: decimal(data.outstanding ?? 0) };
        store.suppliers.push(s);
        return s;
      },
    },

    salesTarget: {
      findFirst: async ({ where }: any) => store.salesTargets.find((t) => t.year === where.year && t.month === where.month) ?? null,
      create: async ({ data }: any) => {
        const target = { id: `st-${store.salesTargets.length + 1}`, ...data, targetAmount: decimal(data.targetAmount) };
        store.salesTargets.push(target);
        return target;
      },
      update: async ({ where, data }: any) => {
        const target = store.salesTargets.find((t) => t.id === where.id);
        if (target) {
          if (data.targetAmount) target.targetAmount = decimal(data.targetAmount);
        }
        return target;
      },
    },
  };

  return { db, store };
};

// ==========================================
// TEST SUITE
// ==========================================

test('1. CRITICAL DOUBLE-COUNT TEST: POS + Daily Sales Reconciliation produces exact total without double counting', async () => {
  const { db } = createMockDb();
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12, 0, 0));

  // POS Sales on today: Cash ₹2,000 + UPI ₹3,000 = Total ₹5,000
  const productA = await db.product.create({ data: { name: 'Item A', active: true } });
  const batchA = await db.productBatch.create({ data: { productId: productA.id, batchNumber: 'B1', purchaseRate: 10, quantity: 100 } });

  await db.sale.create({
    data: {
      saleDate: todayDate,
      paymentMethod: 'CASH',
      totalAmount: 2000,
      paidAmount: 2000,
      status: 'COMPLETED',
    },
  });
  await db.sale.create({
    data: {
      saleDate: todayDate,
      paymentMethod: 'UPI',
      totalAmount: 3000,
      paidAmount: 3000,
      status: 'COMPLETED',
    },
  });

  // Daily aggregate entered at end of day: Cash ₹7,000 + UPI ₹8,000 = Total ₹15,000
  await db.dailySale.create({
    data: {
      businessDate: todayDate,
      cashSales: 7000,
      upiSales: 8000,
      otherSales: 0,
      totalSales: 15000,
    },
  });

  const report = await getSalesReport({ preset: 'TODAY' }, db);

  // Verification:
  // POS Sales: ₹5,000
  // Non-POS Sales: Cash (7000 - 2000) = 5000, UPI (8000 - 3000) = 5000 -> Total Non-POS = ₹10,000
  // Gross Total Sales: ₹15,000 (NOT ₹20,000)
  assert.equal(report.summary.posSales, 5000);
  assert.equal(report.summary.nonPosSales, 10000);
  assert.equal(report.summary.grossSales, 15000);
  assert.equal(report.summary.cashSales, 7000);
  assert.equal(report.summary.upiSales, 8000);
  assert.equal(report.summary.netSales, 15000);
});

test('2. Sales Report with Returns: correctly subtracts sales returns from gross sales', async () => {
  const { db } = createMockDb();
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 10, 0, 0));

  const sale = await db.sale.create({
    data: { saleDate: todayDate, paymentMethod: 'CASH', totalAmount: 100000, paidAmount: 100000, status: 'COMPLETED' },
  });

  // Customer returns ₹5,000 worth of goods
  await db.saleReturn.create({
    data: { saleId: sale.id, totalAmount: 5000, refundMethod: 'CASH', createdAt: todayDate },
  });

  const report = await getSalesReport({ preset: 'TODAY' }, db);
  assert.equal(report.summary.grossSales, 100000);
  assert.equal(report.summary.salesReturns, 5000);
  assert.equal(report.summary.netSales, 95000);
});

test('3. Purchase Report: calculates gross purchases, subtracts purchase returns, and isolates operating expenses', async () => {
  const { db } = createMockDb();
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 11, 0, 0));

  const supplier = await db.supplier.create({ data: { name: 'MediSupply Co' } });
  const product = await db.product.create({ data: { name: 'Product X', active: true } });

  const purch = await db.purchase.create({
    data: {
      supplierId: supplier.id,
      invoiceNumber: 'INV-101',
      invoiceDate: todayDate,
      paymentMethod: 'CASH',
      totalAmount: 50000,
      paidAmount: 50000,
    },
  });
  await db.purchaseItem.create({
    data: { purchaseId: purch.id, productId: product.id, quantity: 500, purchaseRate: 100, gst: 12 },
  });

  // Supplier return of ₹3,000
  await db.purchaseReturn.create({
    data: { supplierId: supplier.id, purchaseId: purch.id, totalAmount: 3000, createdAt: todayDate },
  });

  const report = await getPurchaseReport({ preset: 'TODAY' }, db);
  assert.equal(report.summary.grossPurchases, 50000);
  assert.equal(report.summary.purchaseReturns, 3000);
  assert.equal(report.summary.netPurchases, 47000);
  assert.equal(report.summary.invoiceCount, 1);
  assert.equal(report.supplierBreakdown[0].name, 'MediSupply Co');
});

test('4. Expense Report: groups expenses by category and separates cash vs bank/UPI without inventory purchases', async () => {
  const { db } = createMockDb();
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 10, 0, 0));

  await db.expense.create({ data: { category: 'Electricity', amount: 3500, paymentMethod: 'UPI', expenseDate: todayDate } });
  await db.expense.create({ data: { category: 'Rent', amount: 15000, paymentMethod: 'BANK', expenseDate: todayDate } });
  await db.expense.create({ data: { category: 'Transport', amount: 500, paymentMethod: 'CASH', expenseDate: todayDate } });

  const report = await getExpenseReport({ preset: 'TODAY' }, db);
  assert.equal(report.summary.totalExpenses, 19000);
  assert.equal(report.summary.cashExpenses, 500);
  assert.equal(report.summary.bankUpiExpenses, 18500);
  assert.equal(report.summary.expenseCount, 3);
  assert.equal(report.categoryBreakdown[0].category, 'Rent');
  assert.equal(report.categoryBreakdown[0].amount, 15000);
});

test('5. FINANCIAL ACCURACY TEST: Physical Cash Drawer Reconciliation respects cash vs digital and transfers', async () => {
  const { db } = createMockDb();
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12, 0, 0));

  // Opening Cash = ₹10,000 (IN)
  await db.cashbookEntry.create({ data: { entryType: 'OPENING_CASH', direction: 'IN', amount: 10000, paymentMethod: 'CASH', businessDate: todayDate } });
  // Cash Sales = ₹7,000 (IN)
  await db.cashbookEntry.create({ data: { entryType: 'CASH_SALE', direction: 'IN', amount: 7000, paymentMethod: 'CASH', businessDate: todayDate } });
  // UPI Sales = ₹8,000 (Digital IN - does NOT affect physical cash)
  await db.cashbookEntry.create({ data: { entryType: 'SALE', direction: 'IN', amount: 8000, paymentMethod: 'UPI', businessDate: todayDate } });
  // Cash Expense = ₹300 (OUT)
  await db.cashbookEntry.create({ data: { entryType: 'EXPENSE', direction: 'OUT', amount: 300, paymentMethod: 'CASH', businessDate: todayDate } });
  // Cash Purchase = ₹1,000 (OUT)
  await db.cashbookEntry.create({ data: { entryType: 'CASH_PURCHASE', direction: 'OUT', amount: 1000, paymentMethod: 'CASH', businessDate: todayDate } });
  // Supplier Cash Payment = ₹500 (OUT)
  await db.cashbookEntry.create({ data: { entryType: 'SUPPLIER_PAYMENT', direction: 'OUT', amount: 500, paymentMethod: 'CASH', businessDate: todayDate } });
  // Bank Deposit = ₹1,000 (OUT)
  await db.cashbookEntry.create({ data: { entryType: 'BANK_DEPOSIT', direction: 'OUT', amount: 1000, paymentMethod: 'CASH', businessDate: todayDate } });
  // Customer Refund = ₹200 (OUT)
  await db.cashbookEntry.create({ data: { entryType: 'CUSTOMER_REFUND', direction: 'OUT', amount: 200, paymentMethod: 'CASH', businessDate: todayDate } });
  // Cash Adjustment = ₹100 (IN)
  await db.cashbookEntry.create({ data: { entryType: 'CASH_ADJUSTMENT', direction: 'IN', amount: 100, paymentMethod: 'CASH', businessDate: todayDate } });

  const report = await getCashbookReport({ preset: 'TODAY' }, db);

  // Total Physical Cash In = 10000 + 7000 + 100 = 17100
  // Total Physical Cash Out = 300 + 1000 + 500 + 1000 + 200 = 3000
  // Net Physical Cash Position = 17100 - 3000 = ₹14,100
  assert.equal(report.summary.physicalCash.inflows, 17100);
  assert.equal(report.summary.physicalCash.outflows, 3000);
  assert.equal(report.summary.physicalCash.netCashFlow, 14100);
  assert.equal(report.summary.bankDigital.inflows, 8000);
});

test('6. COGS & Profitability Test: Net Sales - COGS = Gross Profit, Gross Profit - Expenses = Net Profit', async () => {
  const { db } = createMockDb();
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 10, 0, 0));

  const product = await db.product.create({ data: { name: 'Syrup Pro', purchasePrice: 60, sellingPrice: 100, active: true } });
  const batch = await db.productBatch.create({ data: { productId: product.id, batchNumber: 'SY-10', purchaseRate: 60, sellingPrice: 100, quantity: 200 } });

  // 100 units sold at ₹100 = ₹10,000 Net Sales. COGS = 100 * ₹60 = ₹6,000.
  const sale = await db.sale.create({
    data: { saleDate: todayDate, paymentMethod: 'CASH', totalAmount: 10000, paidAmount: 10000, status: 'COMPLETED' },
  });
  await db.saleItem.create({
    data: { saleId: sale.id, productId: product.id, batchId: batch.id, quantity: 100, sellingPrice: 100, discount: 0, gst: 0 },
  });

  // Operating Expenses = ₹1,500
  await db.expense.create({ data: { category: 'Utilities', amount: 1500, paymentMethod: 'CASH', expenseDate: todayDate } });

  const profitReport = await getProfitReport({ preset: 'TODAY' }, db);

  // Net Sales: ₹10,000
  // COGS: ₹6,000
  // Gross Profit: ₹4,000 (Gross Margin: 40%)
  // Operating Expenses: ₹1,500
  // Net Profit: ₹2,500 (Net Margin: 25%)
  assert.equal(profitReport.summary.netSales, 10000);
  assert.equal(profitReport.summary.cogs.totalCogs, 6000);
  assert.equal(profitReport.summary.grossProfit, 4000);
  assert.equal(profitReport.summary.grossMarginPercentage, 40);
  assert.equal(profitReport.summary.operatingExpenses, 1500);
  assert.equal(profitReport.summary.netProfit, 2500);
  assert.equal(profitReport.summary.netMarginPercentage, 25);
});

test('7. Sales Return COGS Reversal: customer return reverses the sold COGS accurately', async () => {
  const { db } = createMockDb();
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 10, 0, 0));

  const product = await db.product.create({ data: { name: 'Pain Relief Spray', purchasePrice: 20, sellingPrice: 50, active: true } });
  const batch = await db.productBatch.create({ data: { productId: product.id, batchNumber: 'PR-1', purchaseRate: 20, sellingPrice: 50, quantity: 100 } });

  // 10 units sold @ ₹50 = ₹500. COGS = 10 * 20 = ₹200.
  const sale = await db.sale.create({
    data: { saleDate: todayDate, paymentMethod: 'CASH', totalAmount: 500, paidAmount: 500, status: 'COMPLETED' },
  });
  const saleItem = await db.saleItem.create({
    data: { saleId: sale.id, productId: product.id, batchId: batch.id, quantity: 10, sellingPrice: 50 },
  });

  // Customer returns 3 units = ₹150 refund. COGS reversed = 3 * 20 = ₹60.
  const saleRet = await db.saleReturn.create({
    data: { saleId: sale.id, totalAmount: 150, refundMethod: 'CASH', createdAt: todayDate },
  });
  await db.saleReturnItem.create({
    data: { saleReturnId: saleRet.id, saleItemId: saleItem.id, productId: product.id, batchId: batch.id, quantity: 3, totalAmount: 150 },
  });

  const profitReport = await getProfitReport({ preset: 'TODAY' }, db);

  // Net Sales: 500 - 150 = ₹350
  // Net COGS: 200 - 60 = ₹140
  // Gross Profit: 350 - 140 = ₹210 (60% Gross Margin)
  assert.equal(profitReport.summary.netSales, 350);
  assert.equal(profitReport.summary.cogs.returnCogsReversal, 60);
  assert.equal(profitReport.summary.cogs.totalCogs, 140);
  assert.equal(profitReport.summary.grossProfit, 210);
  assert.equal(profitReport.summary.grossMarginPercentage, 60);
});

test('8. GST Summary Report: Output GST - Input GST = Net GST Position with multi-rate support and return reversals', async () => {
  const { db } = createMockDb();
  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 10, 0, 0));

  const product12 = await db.product.create({ data: { name: 'Med 12%', active: true } });
  const product18 = await db.product.create({ data: { name: 'Med 18%', active: true } });

  // Sale with 12% and 18% items
  // Item 1: ₹1,000 @ 12% GST = ₹120 GST (₹60 CGST, ₹60 SGST)
  // Item 2: ₹2,000 @ 18% GST = ₹360 GST (₹180 CGST, ₹180 SGST)
  // Total Output GST = ₹480
  const sale = await db.sale.create({ data: { saleDate: todayDate, totalAmount: 3000, paidAmount: 3000, status: 'COMPLETED' } });
  await db.saleItem.create({ data: { saleId: sale.id, productId: product12.id, quantity: 10, sellingPrice: 100, gst: 12 } });
  await db.saleItem.create({ data: { saleId: sale.id, productId: product18.id, quantity: 10, sellingPrice: 200, gst: 18 } });

  // Purchase with 12% GST: ₹1,000 @ 12% = ₹120 Input GST
  const purch = await db.purchase.create({ data: { invoiceNumber: 'INV-1', invoiceDate: todayDate, totalAmount: 1000 } });
  await db.purchaseItem.create({ data: { purchaseId: purch.id, productId: product12.id, quantity: 10, purchaseRate: 100, gst: 12 } });

  const gstReport = await getGstReport({ preset: 'TODAY' }, db);

  assert.equal(gstReport.summary.outputGst.grossOutputGst, 480);
  assert.equal(gstReport.summary.outputGst.cgst, 240);
  assert.equal(gstReport.summary.outputGst.sgst, 240);
  assert.equal(gstReport.summary.inputGst.grossInputGst, 120);
  assert.equal(gstReport.summary.inputGst.cgst, 60);
  assert.equal(gstReport.summary.inputGst.sgst, 60);
  assert.equal(gstReport.summary.netGstPayable, 360); // 480 - 120
});

test('9. Inventory Valuation: calculates exact cost valuation vs MRP valuation and potential margin', async () => {
  const { db } = createMockDb();

  const productA = await db.product.create({ data: { name: 'Tablet Alpha', active: true, reorderLevel: 20 } });
  const productB = await db.product.create({ data: { name: 'Syrup Beta', active: true, reorderLevel: 10 } });

  // Batch 1: 100 units @ ₹20 cost, ₹30 MRP -> Cost: ₹2,000, MRP: ₹3,000
  await db.productBatch.create({ data: { productId: productA.id, batchNumber: 'B-A1', purchaseRate: 20, mrp: 30, quantity: 100 } });
  // Batch 2: 50 units @ ₹40 cost, ₹60 MRP -> Cost: ₹2,000, MRP: ₹3,000
  await db.productBatch.create({ data: { productId: productB.id, batchNumber: 'B-B1', purchaseRate: 40, mrp: 60, quantity: 50 } });

  const valuation = await getInventoryValuationReport({}, db);

  assert.equal(valuation.summary.totalUnits, 150);
  assert.equal(valuation.summary.costValuation, 4000); // 2000 + 2000
  assert.equal(valuation.summary.mrpValuation, 6000);  // 3000 + 3000
  assert.equal(valuation.summary.potentialGrossMargin, 2000);
});

test('10. Customer and Supplier Outstanding: calculates and sorts balances descending', async () => {
  const { db } = createMockDb();

  await db.customer.create({ data: { name: 'Customer Small Dues', outstanding: 1200 } });
  await db.customer.create({ data: { name: 'Customer Big Dues', outstanding: 8500 } });
  await db.customer.create({ data: { name: 'Customer Zero Dues', outstanding: 0 } });

  await db.supplier.create({ data: { name: 'Supplier Small Payable', outstanding: 5000 } });
  await db.supplier.create({ data: { name: 'Supplier Big Payable', outstanding: 25000 } });

  const custReport = await getCustomerOutstandingReport(db);
  assert.equal(custReport.summary.totalOutstanding, 9700);
  assert.equal(custReport.summary.customerCountWithDues, 2);
  assert.equal(custReport.customers[0].name, 'Customer Big Dues');
  assert.equal(custReport.customers[0].outstanding, 8500);

  const suppReport = await getSupplierOutstandingReport(db);
  assert.equal(suppReport.summary.totalPayable, 30000);
  assert.equal(suppReport.summary.supplierCountWithDues, 2);
  assert.equal(suppReport.suppliers[0].name, 'Supplier Big Payable');
  assert.equal(suppReport.suppliers[0].outstanding, 25000);
});

test('11. Monthly Sales Target: tracks target progress with reconciled sales and setting updates', async () => {
  const { db } = createMockDb();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  await setMonthlyTarget(year, month, 500000, 'user-1', db);

  // Create ₹3,50,000 of sales in this month
  const saleDate = new Date(Date.UTC(year, month - 1, 15, 10, 0, 0));
  await db.sale.create({
    data: { saleDate, paymentMethod: 'CASH', totalAmount: 350000, paidAmount: 350000, status: 'COMPLETED' },
  });

  const targetReport = await getMonthlyTargetReport(year, month, db);

  assert.equal(targetReport.targetAmount, 500000);
  assert.equal(targetReport.completedSales, 350000);
  assert.equal(targetReport.remainingSales, 150000);
  assert.equal(targetReport.progressPercentage, 70); // 3,50,000 / 5,00,000 = 70%
  assert.equal(targetReport.isTargetMet, false);
});

import type { PrismaClient } from '@prisma/client';
import { database } from './domainUtils.js';
import { normalizeBusinessDate } from './cashbookLedgerService.js';
import { getDailyCashSummary } from './cashbookService.js';
import { getDailySalesReconciliation } from './dailySalesService.js';
import { getProductStockSummary, getLowStockProducts, getExpiryInventory } from './inventoryService.js';

export const getDashboardSummary = async (dateInput?: string | Date, client?: PrismaClient) => {
  const db = database(client);
  const normalizedDate = normalizeBusinessDate(dateInput ?? new Date());
  const dateStr = normalizedDate.toISOString().slice(0, 10);

  const startOfDay = new Date(Date.UTC(normalizedDate.getUTCFullYear(), normalizedDate.getUTCMonth(), normalizedDate.getUTCDate(), 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(normalizedDate.getUTCFullYear(), normalizedDate.getUTCMonth(), normalizedDate.getUTCDate(), 23, 59, 59, 999));

  const [reconciliation, cashSummary, purchases, expenses, customers, suppliers, lowStock, expiredItems, nearExpiryItems] = await Promise.all([
    getDailySalesReconciliation(normalizedDate, client),
    getDailyCashSummary(dateStr, db),
    db.purchase.findMany({
      where: { invoiceDate: { gte: startOfDay, lte: endOfDay } },
      select: { totalAmount: true, paidAmount: true, paymentMethod: true },
    }),
    db.expense.findMany({
      where: { expenseDate: { gte: startOfDay, lte: endOfDay } },
      select: { amount: true, paymentMethod: true },
    }),
    db.customer.aggregate({ _sum: { outstanding: true } }),
    db.supplier.aggregate({ _sum: { outstanding: true } }),
    getLowStockProducts({}, db).then((r) => r.pagination.total).catch(() => 0),
    getExpiryInventory('EXPIRED', {}, db).then((r) => r.pagination.total).catch(() => 0),
    getExpiryInventory('DAYS_0_30', {}, db).then((r) => r.pagination.total).catch(() => 0),
  ]);

  const totalPurchases = Math.round(purchases.reduce((acc, p) => acc + Number(p.totalAmount), 0) * 100) / 100;
  const cashPurchases = Math.round(purchases.filter((p) => p.paymentMethod === 'CASH').reduce((acc, p) => acc + Number(p.paidAmount), 0) * 100) / 100;
  const totalExpenses = Math.round(expenses.reduce((acc, e) => acc + Number(e.amount), 0) * 100) / 100;

  const totalSales = reconciliation.totalSales;
  const posSales = reconciliation.posTotalSales;
  const nonPosSales = reconciliation.nonPosTotalSales;
  const cashSales = Math.round((reconciliation.posCashSales + reconciliation.nonPosCashSales) * 100) / 100;
  const upiSales = Math.round((reconciliation.posUpiSales + reconciliation.nonPosUpiSales) * 100) / 100;
  const creditSales = reconciliation.posCreditSales;

  return {
    businessDate: dateStr,
    sales: {
      totalSales,
      posSales,
      nonPosSales,
      cashSales,
      upiSales,
      creditSales,
      reconciliationStatus: reconciliation.reconciliationStatus,
    },
    purchases: {
      totalPurchases,
      cashPurchases,
    },
    expenses: {
      totalExpenses,
    },
    cashbook: {
      openingCash: cashSummary.openingCash,
      cashInflows: cashSummary.cashInflows,
      cashOutflows: cashSummary.cashOutflows,
      expectedDrawerCash: cashSummary.expectedDrawerCash,
      actualDrawerCash: cashSummary.actualDrawerCash,
      difference: cashSummary.difference,
      closingStatus: cashSummary.closingStatus,
      isClosed: cashSummary.isClosed,
    },
    dues: {
      customerDues: Number(customers._sum.outstanding ?? 0),
      supplierDues: Number(suppliers._sum.outstanding ?? 0),
    },
    alerts: {
      expiredProducts: expiredItems,
      nearExpiryProducts: nearExpiryItems,
      lowStockProducts: lowStock,
      customerDues: Number(customers._sum.outstanding ?? 0),
      supplierDues: Number(suppliers._sum.outstanding ?? 0),
    },
  };
};

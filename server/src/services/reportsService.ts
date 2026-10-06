import { Prisma, type PrismaClient } from '@prisma/client';
import { database, invalid, missing, type DbClient } from './domainUtils.js';
import { normalizeBusinessDate } from './cashbookLedgerService.js';
import { getDailySalesReconciliation } from './dailySalesService.js';
import { getDailyCashSummary } from './cashbookService.js';

export type DateRangePreset =
  | 'TODAY'
  | 'YESTERDAY'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'PREV_MONTH'
  | 'THIS_YEAR'
  | 'CUSTOM';

export type ReportDateRange = {
  startDate: Date;
  endDate: Date;
  startDateStr: string;
  endDateStr: string;
  preset: DateRangePreset;
};

export type ReportFilterInput = {
  preset?: DateRangePreset;
  startDate?: string | Date;
  endDate?: string | Date;
  categoryId?: string;
  supplierId?: string;
  customerId?: string;
};

const round = (num: number) => Math.round(num * 100) / 100;
const safeDiv = (num: number, den: number) => (den > 0 ? round((num / den) * 100) : 0);

export const resolveDateRange = (filters: ReportFilterInput = {}): ReportDateRange => {
  const preset: DateRangePreset = filters.preset ?? (filters.startDate ? 'CUSTOM' : 'TODAY');
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let start: Date;
  let end: Date;

  switch (preset) {
    case 'TODAY': {
      start = new Date(todayUtc);
      end = new Date(todayUtc);
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'YESTERDAY': {
      start = new Date(todayUtc);
      start.setUTCDate(start.getUTCDate() - 1);
      end = new Date(start);
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'THIS_WEEK': {
      start = new Date(todayUtc);
      const day = start.getUTCDay(); // 0 is Sun, 1 is Mon
      const diff = (day === 0 ? 6 : day - 1); // Monday as start of week
      start.setUTCDate(start.getUTCDate() - diff);
      end = new Date(todayUtc);
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'THIS_MONTH': {
      start = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 1, 0, 0, 0, 0));
      end = new Date(todayUtc);
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'PREV_MONTH': {
      start = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() - 1, 1, 0, 0, 0, 0));
      end = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 0, 23, 59, 59, 999));
      break;
    }
    case 'THIS_YEAR': {
      start = new Date(Date.UTC(todayUtc.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      end = new Date(todayUtc);
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'CUSTOM': {
      if (!filters.startDate) throw invalid('startDate is required for custom date range');
      const normStart = normalizeBusinessDate(filters.startDate);
      const normEnd = filters.endDate ? normalizeBusinessDate(filters.endDate) : normStart;
      if (normStart > normEnd) throw invalid('startDate cannot be after endDate');
      start = normStart;
      end = new Date(normEnd);
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    default: {
      start = new Date(todayUtc);
      end = new Date(todayUtc);
      end.setUTCHours(23, 59, 59, 999);
    }
  }

  return {
    startDate: start,
    endDate: end,
    startDateStr: start.toISOString().slice(0, 10),
    endDateStr: end.toISOString().slice(0, 10),
    preset,
  };
};

// Generate an array of business dates between start and end
const getBusinessDatesInRange = (startDate: Date, endDate: Date): Date[] => {
  const dates: Date[] = [];
  const current = new Date(startDate);
  current.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);

  while (current <= end) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
};

// ==========================================
// 1. SALES REPORT (No Double Counting)
// ==========================================

export const getSalesReport = async (filters: ReportFilterInput = {}, client?: DbClient) => {
  const db = database(client);
  const range = resolveDateRange(filters);
  const dates = getBusinessDatesInRange(range.startDate, range.endDate);

  // Fetch sales returns in date range
  const salesReturns = await db.saleReturn.findMany({
    where: {
      createdAt: { gte: range.startDate, lte: range.endDate },
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    include: { items: { include: { product: true } } },
  });

  // Fetch POS sales with line details
  const posSales = await db.sale.findMany({
    where: {
      saleDate: { gte: range.startDate, lte: range.endDate },
      status: 'COMPLETED',
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    include: {
      items: { include: { product: true, batch: true } },
      payments: { include: { splits: true } },
      customer: true,
    },
    orderBy: { saleDate: 'desc' },
  });

  // Calculate day-by-day reconciled sales to prevent duplicate counting
  let totalPosCash = 0;
  let totalPosUpi = 0;
  let totalPosCredit = 0;
  let totalPosSales = 0;
  let totalNonPosCash = 0;
  let totalNonPosUpi = 0;
  let totalNonPosOther = 0;
  let totalNonPosSales = 0;

  const dailyBreakdown: Array<{
    date: string;
    posSales: number;
    nonPosSales: number;
    totalSales: number;
    cashSales: number;
    upiSales: number;
    creditSales: number;
  }> = [];

  for (const date of dates) {
    const recon = await getDailySalesReconciliation(date, client as any);
    totalPosCash += recon.posCashSales;
    totalPosUpi += recon.posUpiSales;
    totalPosCredit += recon.posCreditSales;
    totalPosSales += recon.posTotalSales;

    totalNonPosCash += recon.nonPosCashSales;
    totalNonPosUpi += recon.nonPosUpiSales;
    totalNonPosOther += recon.nonPosOtherSales;
    totalNonPosSales += recon.nonPosTotalSales;

    dailyBreakdown.push({
      date: recon.businessDate,
      posSales: recon.posTotalSales,
      nonPosSales: recon.nonPosTotalSales,
      totalSales: recon.totalSales,
      cashSales: round(recon.posCashSales + recon.nonPosCashSales),
      upiSales: round(recon.posUpiSales + recon.nonPosUpiSales),
      creditSales: recon.posCreditSales,
    });
  }

  const grossSales = round(totalPosSales + totalNonPosSales);
  const totalSalesReturns = round(salesReturns.reduce((acc, r) => acc + Number(r.totalAmount), 0));
  const netSales = round(Math.max(0, grossSales - totalSalesReturns));

  // Item and invoice metrics
  const invoiceCount = posSales.length;
  let totalItemsSold = 0;
  let totalDiscountGiven = 0;
  let totalTaxCollected = 0;

  for (const sale of posSales) {
    for (const item of sale.items) {
      totalItemsSold += item.quantity;
      totalDiscountGiven += Number(item.discount ?? 0);
      if (item.gst) {
        const itemSellingPrice = Number(item.sellingPrice) * item.quantity;
        const lineTax = (Number(item.gst) * itemSellingPrice) / 100;
        totalTaxCollected += lineTax;
      }
    }
  }

  const averageInvoiceValue = invoiceCount > 0 ? round(totalPosSales / invoiceCount) : 0;

  return {
    dateRange: range,
    summary: {
      grossSales,
      salesReturns: totalSalesReturns,
      netSales,
      posSales: round(totalPosSales),
      nonPosSales: round(totalNonPosSales),
      cashSales: round(totalPosCash + totalNonPosCash),
      upiSales: round(totalPosUpi + totalNonPosUpi),
      creditSales: round(totalPosCredit),
      otherSales: round(totalNonPosOther),
      invoiceCount,
      totalItemsSold,
      averageInvoiceValue,
      totalDiscountGiven: round(totalDiscountGiven),
      totalTaxCollected: round(totalTaxCollected),
    },
    dailyBreakdown,
    recentSales: posSales.slice(0, 50).map((s) => ({
      id: s.id,
      saleNumber: s.saleNumber,
      saleDate: s.saleDate,
      customerName: s.customer?.name ?? 'Walk-in Customer',
      paymentMethod: s.paymentMethod,
      totalAmount: Number(s.totalAmount),
      paidAmount: Number(s.paidAmount),
      itemCount: s.items.length,
    })),
  };
};

// ==========================================
// 2. PURCHASE REPORT
// ==========================================

export const getPurchaseReport = async (filters: ReportFilterInput = {}, client?: DbClient) => {
  const db = database(client);
  const range = resolveDateRange(filters);

  const [purchases, purchaseReturns] = await Promise.all([
    db.purchase.findMany({
      where: {
        invoiceDate: { gte: range.startDate, lte: range.endDate },
        ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      },
      include: {
        supplier: true,
        items: { include: { product: true, batch: true } },
      },
      orderBy: { invoiceDate: 'desc' },
    }),
    db.purchaseReturn.findMany({
      where: {
        createdAt: { gte: range.startDate, lte: range.endDate },
        ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      },
      include: { supplier: true, items: { include: { product: true } } },
    }),
  ]);

  let grossPurchases = 0;
  let cashPurchases = 0;
  let upiPurchases = 0;
  let creditPurchases = 0;
  let totalPurchaseQty = 0;
  let totalPurchaseGst = 0;

  const supplierMap: { [id: string]: { id: string; name: string; total: number; count: number; returns: number } } = {};

  for (const p of purchases) {
    const amt = Number(p.totalAmount);
    grossPurchases += amt;
    const method = p.paymentMethod ?? 'CREDIT';
    if (method === 'CASH') cashPurchases += Number(p.paidAmount);
    else if (method === 'UPI' || method === 'BANK') upiPurchases += Number(p.paidAmount);
    else if (method === 'CREDIT') creditPurchases += amt;
    else if (method === 'BOTH') {
      cashPurchases += Number(p.paidAmount);
    }

    if (p.supplier) {
      if (!supplierMap[p.supplier.id]) {
        supplierMap[p.supplier.id] = { id: p.supplier.id, name: p.supplier.name, total: 0, count: 0, returns: 0 };
      }
      supplierMap[p.supplier.id].total += amt;
      supplierMap[p.supplier.id].count += 1;
    }

    for (const it of p.items) {
      totalPurchaseQty += it.quantity + it.freeQty;
      if (it.gst) {
        const itemCost = Number(it.purchaseRate) * it.quantity;
        totalPurchaseGst += (Number(it.gst) * itemCost) / 100;
      }
    }
  }

  let totalPurchaseReturns = 0;
  for (const pr of purchaseReturns) {
    const amt = Number(pr.totalAmount);
    totalPurchaseReturns += amt;
    if (pr.supplier && supplierMap[pr.supplier.id]) {
      supplierMap[pr.supplier.id].returns += amt;
    }
  }

  const netPurchases = round(Math.max(0, grossPurchases - totalPurchaseReturns));

  return {
    dateRange: range,
    summary: {
      grossPurchases: round(grossPurchases),
      purchaseReturns: round(totalPurchaseReturns),
      netPurchases,
      cashPurchases: round(cashPurchases),
      upiPurchases: round(upiPurchases),
      creditPurchases: round(creditPurchases),
      invoiceCount: purchases.length,
      totalPurchaseQty,
      totalPurchaseGst: round(totalPurchaseGst),
    },
    supplierBreakdown: Object.values(supplierMap).sort((a, b) => b.total - a.total),
    purchases: purchases.map((p) => ({
      id: p.id,
      invoiceNumber: p.invoiceNumber,
      invoiceDate: p.invoiceDate,
      supplierName: p.supplier?.name ?? '—',
      paymentMethod: p.paymentMethod,
      totalAmount: Number(p.totalAmount),
      paidAmount: Number(p.paidAmount),
      outstandingAmount: Number(p.outstandingAmount),
      itemCount: p.items.length,
    })),
  };
};

// ==========================================
// 3. EXPENSE REPORT
// ==========================================

export const getExpenseReport = async (filters: ReportFilterInput = {}, client?: DbClient) => {
  const db = database(client);
  const range = resolveDateRange(filters);

  const expenses = await db.expense.findMany({
    where: {
      expenseDate: { gte: range.startDate, lte: range.endDate },
    },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { expenseDate: 'desc' },
  });

  let totalExpenses = 0;
  let cashExpenses = 0;
  let bankUpiExpenses = 0;
  const categoryMap: { [cat: string]: { category: string; amount: number; count: number } } = {};

  for (const exp of expenses) {
    const amt = Number(exp.amount);
    totalExpenses += amt;

    if (exp.paymentMethod === 'CASH') cashExpenses += amt;
    else bankUpiExpenses += amt;

    const cat = exp.category || 'General';
    if (!categoryMap[cat]) {
      categoryMap[cat] = { category: cat, amount: 0, count: 0 };
    }
    categoryMap[cat].amount += amt;
    categoryMap[cat].count += 1;
  }

  const categoryBreakdown = Object.values(categoryMap)
    .map((c) => ({
      category: c.category,
      amount: round(c.amount),
      count: c.count,
      percentage: safeDiv(c.amount, totalExpenses),
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    dateRange: range,
    summary: {
      totalExpenses: round(totalExpenses),
      cashExpenses: round(cashExpenses),
      bankUpiExpenses: round(bankUpiExpenses),
      upiExpenses: round(bankUpiExpenses),
      expenseCount: expenses.length,
    },
    categories: categoryBreakdown,
    categoryBreakdown,
    expenses: expenses.map((e) => ({
      id: e.id,
      category: e.category,
      amount: Number(e.amount),
      expenseDate: e.expenseDate,
      paymentMethod: e.paymentMethod,
      description: e.description,
      createdByName: e.createdBy?.name ?? null,
    })),
  };
};

// ==========================================
// 4. CASHBOOK & RECONCILIATION REPORT
// ==========================================

export const getCashbookReport = async (filters: ReportFilterInput = {}, client?: DbClient) => {
  const db = database(client);
  const range = resolveDateRange(filters);

  const entries = await db.cashbookEntry.findMany({
    where: {
      businessDate: { gte: range.startDate, lte: range.endDate },
    },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  let physicalCashIn = 0;
  let physicalCashOut = 0;
  let bankIn = 0;
  let bankOut = 0;
  let cashToBankTransfers = 0;
  let bankToCashTransfers = 0;

  for (const entry of entries) {
    const amt = Number(entry.amount);
    const method = entry.paymentMethod;

    if (entry.entryType === 'CASH_TO_BANK') {
      cashToBankTransfers += amt;
    } else if (entry.entryType === 'BANK_TO_CASH') {
      bankToCashTransfers += amt;
    } else if (method === 'CASH') {
      if (entry.direction === 'IN') physicalCashIn += amt;
      else physicalCashOut += amt;
    } else if (method === 'UPI' || method === 'BANK') {
      if (entry.direction === 'IN') bankIn += amt;
      else bankOut += amt;
    }
  }

  // Get daily closing summary for the date range
  const dailyClosings = await db.dailyClosing.findMany({
    where: { closingDate: { gte: range.startDate, lte: range.endDate } },
    orderBy: { closingDate: 'desc' },
  });

  return {
    dateRange: range,
    cash: {
      inflows: round(physicalCashIn),
      outflows: round(physicalCashOut),
      netCashFlow: round(physicalCashIn - physicalCashOut),
      expectedCash: round(physicalCashIn - physicalCashOut),
      actualCash: null,
      difference: 0,
    },
    bank: {
      inflows: round(bankIn),
      outflows: round(bankOut),
      netBankFlow: round(bankIn - bankOut),
    },
    summary: {
      physicalCash: {
        inflows: round(physicalCashIn),
        outflows: round(physicalCashOut),
        netCashFlow: round(physicalCashIn - physicalCashOut),
      },
      bankDigital: {
        inflows: round(bankIn),
        outflows: round(bankOut),
        netBankFlow: round(bankIn - bankOut),
      },
      transfers: {
        cashToBank: round(cashToBankTransfers),
        bankToCash: round(bankToCashTransfers),
      },
      entryCount: entries.length,
    },
    dailyClosings: dailyClosings.map((c) => ({
      closingDate: c.closingDate,
      openingCash: Number(c.openingCash),
      cashInflows: Number(c.cashInflows),
      cashOutflows: Number(c.cashOutflows),
      expectedCash: Number(c.expectedCash),
      actualCash: Number(c.actualCash),
      difference: Number(c.difference),
      status: c.status,
    })),
    entries: entries.slice(0, 100).map((e) => ({
      id: e.id,
      entryType: e.entryType,
      direction: e.direction,
      amount: Number(e.amount),
      paymentMethod: e.paymentMethod,
      businessDate: e.businessDate,
      sourceType: e.sourceType,
      notes: e.notes,
      createdAt: e.createdAt,
    })),
  };
};

// ==========================================
// 5. PROFIT & COGS REPORT
// ==========================================

export const getProfitReport = async (filters: ReportFilterInput = {}, client?: DbClient) => {
  const db = database(client);
  const range = resolveDateRange(filters);

  // 1. Get Reconciled Sales
  const salesReport = await getSalesReport(filters, client);
  const netSales = salesReport.summary.netSales;
  const grossSales = salesReport.summary.grossSales;

  // 2. Compute POS COGS directly from sold batch allocations
  const posSalesWithBatches = await db.sale.findMany({
    where: {
      saleDate: { gte: range.startDate, lte: range.endDate },
      status: 'COMPLETED',
    },
    include: {
      items: { include: { batch: true, product: true } },
    },
  });

  let posSoldCogs = 0;
  let totalPosRevenue = 0;

  for (const sale of posSalesWithBatches) {
    for (const item of sale.items) {
      const unitCost = Number(item.batch?.purchaseRate ?? item.product?.purchasePrice ?? 0);
      posSoldCogs += item.quantity * unitCost;
      totalPosRevenue += Number(item.sellingPrice) * item.quantity - Number(item.discount ?? 0);
    }
  }

  // 3. Compute Sales Return COGS Reversal
  const salesReturns = await db.saleReturn.findMany({
    where: {
      createdAt: { gte: range.startDate, lte: range.endDate },
    },
    include: {
      items: { include: { batch: true, product: true } },
    },
  });

  let returnCogsReversal = 0;
  for (const ret of salesReturns) {
    for (const item of ret.items) {
      const unitCost = Number(item.batch?.purchaseRate ?? item.product?.purchasePrice ?? 0);
      returnCogsReversal += item.quantity * unitCost;
    }
  }

  const netPosCogs = round(Math.max(0, posSoldCogs - returnCogsReversal));

  // 4. If Non-POS daily sales exist, estimate cost using POS cost ratio
  let nonPosCogs = 0;
  const nonPosSalesAmount = salesReport.summary.nonPosSales;
  if (nonPosSalesAmount > 0) {
    const costRatio = totalPosRevenue > 0 ? posSoldCogs / totalPosRevenue : 0.70; // 70% default cost if no POS sales
    nonPosCogs = round(nonPosSalesAmount * costRatio);
  }

  const totalCogs = round(netPosCogs + nonPosCogs);

  // 5. Gross Profit
  const grossProfit = round(netSales - totalCogs);
  const grossMarginPercentage = safeDiv(grossProfit, netSales);

  // 6. Operating Expenses
  const expenseReport = await getExpenseReport(filters, client);
  const operatingExpenses = expenseReport.summary.totalExpenses;

  // 7. Net Profit
  const netProfit = round(grossProfit - operatingExpenses);
  const netMarginPercentage = safeDiv(netProfit, netSales);

  return {
    dateRange: range,
    summary: {
      grossSales,
      salesReturns: salesReport.summary.salesReturns,
      netSales,
      cogs: {
        posCogs: netPosCogs,
        nonPosCogs,
        returnCogsReversal: round(returnCogsReversal),
        totalCogs,
      },
      grossProfit,
      grossMarginPercentage,
      operatingExpenses,
      netProfit,
      netMarginPercentage,
    },
    expenseBreakdown: expenseReport.categoryBreakdown,
  };
};

// ==========================================
// 6. GST SUMMARY / MANAGEMENT REPORT
// ==========================================

export const getGstReport = async (filters: ReportFilterInput = {}, client?: DbClient) => {
  const db = database(client);
  const range = resolveDateRange(filters);

  const [sales, saleReturns, purchases, purchaseReturns] = await Promise.all([
    db.sale.findMany({
      where: { saleDate: { gte: range.startDate, lte: range.endDate }, status: 'COMPLETED' },
      include: { items: true },
    }),
    db.saleReturn.findMany({
      where: { createdAt: { gte: range.startDate, lte: range.endDate } },
      include: { items: { include: { saleItem: true } } },
    }),
    db.purchase.findMany({
      where: { invoiceDate: { gte: range.startDate, lte: range.endDate } },
      include: { items: true },
    }),
    db.purchaseReturn.findMany({
      where: { createdAt: { gte: range.startDate, lte: range.endDate } },
      include: { items: { include: { purchaseItem: true } } },
    }),
  ]);

  const salesGstByRate: { [rate: string]: { taxable: number; cgst: number; sgst: number; totalGst: number } } = {};
  let totalOutputTaxable = 0;
  let totalOutputGst = 0;

  for (const sale of sales) {
    for (const item of sale.items) {
      const rate = Number(item.gst ?? 0);
      const lineTotal = Number(item.sellingPrice) * item.quantity - Number(item.discount ?? 0);
      const rateKey = `${rate}%`;
      if (!salesGstByRate[rateKey]) {
        salesGstByRate[rateKey] = { taxable: 0, cgst: 0, sgst: 0, totalGst: 0 };
      }
      salesGstByRate[rateKey].taxable += lineTotal;
      const gstAmt = (rate * lineTotal) / 100;
      salesGstByRate[rateKey].totalGst += gstAmt;
      salesGstByRate[rateKey].cgst += gstAmt / 2;
      salesGstByRate[rateKey].sgst += gstAmt / 2;

      totalOutputTaxable += lineTotal;
      totalOutputGst += gstAmt;
    }
  }

  // Less Sales Return GST Reversals
  let outputGstReversed = 0;
  for (const ret of saleReturns) {
    for (const it of ret.items) {
      const rate = Number(it.saleItem?.gst ?? 0);
      const refundAmt = Number(it.totalAmount);
      const reversed = (rate * refundAmt) / 100;
      outputGstReversed += reversed;
    }
  }

  const netOutputGst = round(Math.max(0, totalOutputGst - outputGstReversed));

  // Purchases Input GST
  const purchaseGstByRate: { [rate: string]: { taxable: number; cgst: number; sgst: number; totalGst: number } } = {};
  let totalInputTaxable = 0;
  let totalInputGst = 0;

  for (const purch of purchases) {
    for (const item of purch.items) {
      const rate = Number(item.gst ?? 0);
      const lineCost = Number(item.purchaseRate) * item.quantity - Number(item.discount ?? 0);
      const rateKey = `${rate}%`;
      if (!purchaseGstByRate[rateKey]) {
        purchaseGstByRate[rateKey] = { taxable: 0, cgst: 0, sgst: 0, totalGst: 0 };
      }
      purchaseGstByRate[rateKey].taxable += lineCost;
      const gstAmt = (rate * lineCost) / 100;
      purchaseGstByRate[rateKey].totalGst += gstAmt;
      purchaseGstByRate[rateKey].cgst += gstAmt / 2;
      purchaseGstByRate[rateKey].sgst += gstAmt / 2;

      totalInputTaxable += lineCost;
      totalInputGst += gstAmt;
    }
  }

  // Less Purchase Return GST Reversals
  let inputGstReversed = 0;
  for (const pr of purchaseReturns) {
    for (const it of pr.items) {
      const rate = Number(it.purchaseItem?.gst ?? 0);
      const returnAmt = Number(it.totalAmount);
      const reversed = (rate * returnAmt) / 100;
      inputGstReversed += reversed;
    }
  }

  const netInputGst = round(Math.max(0, totalInputGst - inputGstReversed));
  const netGstPosition = round(netOutputGst - netInputGst);

  return {
    reportType: 'GST Summary / Management Report',
    dateRange: range,
    summary: {
      outputGst: {
        taxableSales: round(totalOutputTaxable),
        grossOutputGst: round(totalOutputGst),
        salesReturnGstReversal: round(outputGstReversed),
        netOutputGst,
        cgst: round(netOutputGst / 2),
        sgst: round(netOutputGst / 2),
      },
      inputGst: {
        taxablePurchases: round(totalInputTaxable),
        grossInputGst: round(totalInputGst),
        purchaseReturnGstReversal: round(inputGstReversed),
        netInputGst,
        cgst: round(netInputGst / 2),
        sgst: round(netInputGst / 2),
      },
      netGstPayable: netGstPosition > 0 ? netGstPosition : 0,
      inputTaxCreditBalance: netGstPosition < 0 ? Math.abs(netGstPosition) : 0,
    },
    salesRatesBreakdown: Object.entries(salesGstByRate).map(([rate, v]) => ({
      rate,
      taxable: round(v.taxable),
      cgst: round(v.cgst),
      sgst: round(v.sgst),
      totalGst: round(v.totalGst),
    })),
    purchaseRatesBreakdown: Object.entries(purchaseGstByRate).map(([rate, v]) => ({
      rate,
      taxable: round(v.taxable),
      cgst: round(v.cgst),
      sgst: round(v.sgst),
      totalGst: round(v.totalGst),
    })),
  };
};

// ==========================================
// 7. INVENTORY VALUATION REPORT
// ==========================================

export const getInventoryValuationReport = async (filters: { categoryId?: string; supplierId?: string } = {}, client?: DbClient) => {
  const db = database(client);
  const now = new Date();
  const day30 = new Date(now);
  day30.setDate(day30.getDate() + 30);

  const [products, batches] = await Promise.all([
    db.product.findMany({
      where: {
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      },
      include: { category: true, supplier: true },
    }),
    db.productBatch.findMany({
      where: {
        quantity: { gt: 0 },
        ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      },
      include: { product: true, supplier: true },
    }),
  ]);

  let totalUnits = 0;
  let totalCostValuation = 0;
  let totalMrpValuation = 0;
  let expiredCostValuation = 0;
  let nearExpiryCostValuation = 0;

  for (const b of batches) {
    totalUnits += b.quantity;
    const cost = Number(b.purchaseRate) * b.quantity;
    const mrp = Number(b.mrp ?? b.sellingPrice ?? b.purchaseRate) * b.quantity;
    totalCostValuation += cost;
    totalMrpValuation += mrp;

    if (b.expiryDate) {
      if (b.expiryDate < now) {
        expiredCostValuation += cost;
      } else if (b.expiryDate <= day30) {
        nearExpiryCostValuation += cost;
      }
    }
  }

  const potentialGrossMargin = round(Math.max(0, totalMrpValuation - totalCostValuation));

  // Low stock & out of stock products
  const lowStockCount = products.filter((p) => {
    const stock = batches.filter((b) => b.productId === p.id).reduce((sum, b) => sum + b.quantity, 0);
    return stock > 0 && stock <= p.reorderLevel;
  }).length;

  const outOfStockCount = products.filter((p) => {
    const stock = batches.filter((b) => b.productId === p.id).reduce((sum, b) => sum + b.quantity, 0);
    return stock === 0;
  }).length;

  return {
    asOfDate: now.toISOString(),
    summary: {
      totalProducts: products.length,
      activeProducts: products.filter((p) => p.active).length,
      activeBatches: batches.length,
      totalUnits,
      costValuation: round(totalCostValuation),
      mrpValuation: round(totalMrpValuation),
      potentialGrossMargin,
      potentialMarginPercent: safeDiv(potentialGrossMargin, totalMrpValuation),
      expiredStockValuation: round(expiredCostValuation),
      nearExpiryStockValuation: round(nearExpiryCostValuation),
      lowStockCount,
      outOfStockCount,
    },
    topValuedBatches: batches
      .map((b) => ({
        id: b.id,
        productId: b.productId,
        productName: b.product.name,
        batchNumber: b.batchNumber,
        quantity: b.quantity,
        purchaseRate: Number(b.purchaseRate),
        mrp: b.mrp ? Number(b.mrp) : null,
        totalCostValue: round(Number(b.purchaseRate) * b.quantity),
        totalMrpValue: b.mrp ? round(Number(b.mrp) * b.quantity) : null,
        expiryDate: b.expiryDate,
        supplierName: b.supplier?.name ?? null,
      }))
      .sort((a, b) => b.totalCostValue - a.totalCostValue)
      .slice(0, 50),
  };
};

// ==========================================
// 8. CUSTOMER & SUPPLIER OUTSTANDING REPORTS
// ==========================================

export const getCustomerOutstandingReport = async (client?: DbClient) => {
  const db = database(client);
  const customers = await db.customer.findMany({
    include: {
      sales: { select: { id: true, saleNumber: true, saleDate: true, totalAmount: true } },
      payments: { select: { id: true, amount: true, paymentDate: true }, orderBy: { paymentDate: 'desc' } },
      customerCredits: { where: { balanceAmount: { gt: 0 } } },
    },
    orderBy: { outstanding: 'desc' },
  });

  const duesCustomers = customers
    .filter((c) => Number(c.outstanding) > 0)
    .sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
  const totalOutstanding = duesCustomers.reduce((sum, c) => sum + Number(c.outstanding), 0);

  return {
    summary: {
      totalOutstanding: round(totalOutstanding),
      customerCountWithDues: duesCustomers.length,
      totalRegisteredCustomers: customers.length,
    },
    customers: duesCustomers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      outstanding: Number(c.outstanding),
      totalSalesCount: c.sales.length,
      lastPaymentDate: c.payments[0]?.paymentDate ?? null,
      lastPaymentAmount: c.payments[0] ? Number(c.payments[0].amount) : null,
      pendingCreditCount: c.customerCredits.length,
    })),
  };
};

export const getSupplierOutstandingReport = async (client?: DbClient) => {
  const db = database(client);
  const suppliers = await db.supplier.findMany({
    include: {
      purchases: { select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true, outstandingAmount: true } },
      supplierPayments: { select: { id: true, amount: true, paymentDate: true }, orderBy: { paymentDate: 'desc' } },
    },
    orderBy: { outstanding: 'desc' },
  });

  const duesSuppliers = suppliers
    .filter((s) => Number(s.outstanding) > 0)
    .sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
  const totalPayables = duesSuppliers.reduce((sum, s) => sum + Number(s.outstanding), 0);

  return {
    summary: {
      totalPayable: round(totalPayables),
      supplierCountWithDues: duesSuppliers.length,
      totalRegisteredSuppliers: suppliers.length,
    },
    suppliers: duesSuppliers.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      gstin: s.gstin,
      outstanding: Number(s.outstanding),
      totalPurchasesCount: s.purchases.length,
      lastPaymentDate: s.supplierPayments[0]?.paymentDate ?? null,
      lastPaymentAmount: s.supplierPayments[0] ? Number(s.supplierPayments[0].amount) : null,
    })),
  };
};

// ==========================================
// 9. TOP PRODUCTS & CATEGORY ANALYTICS
// ==========================================

export const getProductAnalyticsReport = async (filters: ReportFilterInput = {}, client?: DbClient) => {
  const db = database(client);
  const range = resolveDateRange(filters);

  const [saleItems, returnItems, allProducts] = await Promise.all([
    db.saleItem.findMany({
      where: {
        sale: { saleDate: { gte: range.startDate, lte: range.endDate }, status: 'COMPLETED' },
      },
      include: { product: true, batch: true },
    }),
    db.saleReturnItem.findMany({
      where: {
        saleReturn: { createdAt: { gte: range.startDate, lte: range.endDate } },
      },
      include: { product: true, batch: true },
    }),
    db.product.findMany({ select: { id: true, name: true, active: true } }),
  ]);

  const productMetrics: {
    [id: string]: {
      id: string;
      name: string;
      soldQty: number;
      returnedQty: number;
      netQty: number;
      revenue: number;
      cogs: number;
      grossProfit: number;
    };
  } = {};

  for (const it of saleItems) {
    if (!productMetrics[it.productId]) {
      productMetrics[it.productId] = {
        id: it.productId,
        name: it.product?.name ?? 'Unknown',
        soldQty: 0,
        returnedQty: 0,
        netQty: 0,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
      };
    }
    productMetrics[it.productId].soldQty += it.quantity;
    const rev = Number(it.sellingPrice) * it.quantity - Number(it.discount ?? 0);
    const cost = it.quantity * Number(it.batch?.purchaseRate ?? it.product?.purchasePrice ?? 0);
    productMetrics[it.productId].revenue += rev;
    productMetrics[it.productId].cogs += cost;
  }

  for (const it of returnItems) {
    if (productMetrics[it.productId]) {
      productMetrics[it.productId].returnedQty += it.quantity;
      const rev = Number(it.totalAmount);
      const cost = it.quantity * Number(it.batch?.purchaseRate ?? it.product?.purchasePrice ?? 0);
      productMetrics[it.productId].revenue -= rev;
      productMetrics[it.productId].cogs -= cost;
    }
  }

  const productList = Object.values(productMetrics).map((p) => {
    const netQty = Math.max(0, p.soldQty - p.returnedQty);
    const revenue = round(Math.max(0, p.revenue));
    const cogs = round(Math.max(0, p.cogs));
    const grossProfit = round(revenue - cogs);
    return {
      ...p,
      netQty,
      revenue,
      cogs,
      grossProfit,
      marginPercent: safeDiv(grossProfit, revenue),
    };
  });

  const topByQty = [...productList].sort((a, b) => b.netQty - a.netQty).slice(0, 10);
  const topByRevenue = [...productList].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const topByProfit = [...productList].sort((a, b) => b.grossProfit - a.grossProfit).slice(0, 10);

  const soldProductIds = new Set(Object.keys(productMetrics));
  const noSalesProducts = allProducts.filter((p) => p.active && !soldProductIds.has(p.id)).slice(0, 20);

  return {
    dateRange: range,
    topByQuantity: topByQty,
    topByRevenue: topByRevenue,
    topByGrossProfit: topByProfit,
    noSalesProductsCount: allProducts.filter((p) => p.active && !soldProductIds.has(p.id)).length,
    noSalesProductsSample: noSalesProducts,
  };
};

export const getCategoryAnalyticsReport = async (filters: ReportFilterInput = {}, client?: DbClient) => {
  const db = database(client);
  const range = resolveDateRange(filters);

  const [categories, saleItems] = await Promise.all([
    db.category.findMany({ select: { id: true, name: true } }),
    db.saleItem.findMany({
      where: {
        sale: { saleDate: { gte: range.startDate, lte: range.endDate }, status: 'COMPLETED' },
      },
      include: { product: true, batch: true },
    }),
  ]);

  const catMap: { [id: string]: { id: string; name: string; quantity: number; revenue: number; cogs: number } } = {};
  categories.forEach((c) => {
    catMap[c.id] = { id: c.id, name: c.name, quantity: 0, revenue: 0, cogs: 0 };
  });
  catMap['uncategorized'] = { id: 'uncategorized', name: 'Uncategorized', quantity: 0, revenue: 0, cogs: 0 };

  for (const it of saleItems) {
    const catId = it.product?.categoryId ?? 'uncategorized';
    if (!catMap[catId]) {
      catMap[catId] = { id: catId, name: 'Uncategorized', quantity: 0, revenue: 0, cogs: 0 };
    }
    catMap[catId].quantity += it.quantity;
    const rev = Number(it.sellingPrice) * it.quantity - Number(it.discount ?? 0);
    const cost = it.quantity * Number(it.batch?.purchaseRate ?? it.product?.purchasePrice ?? 0);
    catMap[catId].revenue += rev;
    catMap[catId].cogs += cost;
  }

  const totalRevenue = Object.values(catMap).reduce((sum, c) => sum + c.revenue, 0);

  const categoryBreakdown = Object.values(catMap)
    .filter((c) => c.quantity > 0 || c.revenue > 0)
    .map((c) => {
      const revenue = round(c.revenue);
      const cogs = round(c.cogs);
      const grossProfit = round(revenue - cogs);
      return {
        id: c.id,
        name: c.name,
        quantity: c.quantity,
        revenue,
        cogs,
        grossProfit,
        marginPercent: safeDiv(grossProfit, revenue),
        revenueContributionPercent: safeDiv(revenue, totalRevenue),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return {
    dateRange: range,
    categories: categoryBreakdown,
  };
};

// ==========================================
// 10. MONTHLY SALES TARGET
// ==========================================

export const getMonthlyTargetReport = async (yearInput?: number, monthInput?: number, client?: DbClient) => {
  const db = database(client);
  const now = new Date();
  const year = yearInput ?? now.getUTCFullYear();
  const month = monthInput ?? (now.getUTCMonth() + 1);

  const target = await db.salesTarget.findFirst({
    where: { year, month },
  });

  // Calculate actual sales for this month using Reconciled Sales
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const salesReport = await getSalesReport({
    preset: 'CUSTOM',
    startDate: startOfMonth,
    endDate: endOfMonth,
  }, client);

  const completedSales = salesReport.summary.netSales;
  const targetAmount = target ? Number(target.targetAmount) : 500000; // Default ₹5,00,000 if not configured
  const remainingSales = round(Math.max(0, targetAmount - completedSales));
  const progressPercentage = safeDiv(completedSales, targetAmount);

  return {
    year,
    month,
    targetAmount: round(targetAmount),
    completedSales,
    remainingSales,
    progressPercentage,
    isTargetMet: completedSales >= targetAmount,
  };
};

export const setMonthlyTarget = async (
  year: number,
  month: number,
  targetAmount: number,
  actorId?: string,
  client?: DbClient,
) => {
  if (targetAmount <= 0) throw invalid('Target amount must be greater than zero');
  const db = database(client);

  const existing = await db.salesTarget.findFirst({ where: { year, month } });
  if (existing) {
    return db.salesTarget.update({
      where: { id: existing.id },
      data: { targetAmount: new Prisma.Decimal(targetAmount) },
    });
  }

  return db.salesTarget.create({
    data: {
      year,
      month,
      targetAmount: new Prisma.Decimal(targetAmount),
      userId: actorId,
    },
  });
};

// ==========================================
// 11. DASHBOARD ANALYTICS & ALIASES
// ==========================================

export const getDashboardAnalytics = async (client?: DbClient) => {
  const [salesToday, purchasesToday, expensesToday, cashbookToday, valuation, custDues, suppDues, target] = await Promise.all([
    getSalesReport({ preset: 'TODAY' }, client),
    getPurchaseReport({ preset: 'TODAY' }, client),
    getExpenseReport({ preset: 'TODAY' }, client),
    getCashbookReport({ preset: 'TODAY' }, client),
    getInventoryValuationReport({}, client),
    getCustomerOutstandingReport(client),
    getSupplierOutstandingReport(client),
    getMonthlyTargetReport(undefined, undefined, client),
  ]);

  return {
    today: {
      totalSales: salesToday.summary.grossSales,
      posSales: salesToday.summary.posSales,
      nonPosSales: salesToday.summary.nonPosSales,
      cashSales: salesToday.summary.cashSales,
      upiSales: salesToday.summary.upiSales,
      creditSales: salesToday.summary.creditSales,
      salesReturns: salesToday.summary.salesReturns,
      netSales: salesToday.summary.netSales,
      purchases: purchasesToday.summary.grossPurchases,
      expenses: expensesToday.summary.totalExpenses,
      expectedDrawer: cashbookToday.cash.expectedCash,
      actualDrawer: cashbookToday.cash.actualCash,
      cashDifference: cashbookToday.cash.difference,
    },
    alerts: {
      expiredBatches: valuation.summary.expiredStockValuation > 0 ? 1 : 0,
      nearExpiryBatches: valuation.summary.nearExpiryStockValuation > 0 ? 1 : 0,
      lowStockCount: valuation.summary.lowStockCount,
      outOfStockCount: valuation.summary.outOfStockCount,
      customerDuesTotal: custDues.summary.totalOutstanding,
      supplierDuesTotal: suppDues.summary.totalPayable,
    },
    monthly: {
      target: target.targetAmount,
      completedSales: target.completedSales,
      remainingSales: target.remainingSales,
      progressPercentage: target.progressPercentage,
    },
  };
};

export const getGstSummaryReport = getGstReport;
export const getProductAnalytics = getProductAnalyticsReport;
export const getCategoryAnalytics = getCategoryAnalyticsReport;
export const getMonthlySalesTarget = async (client?: DbClient) => {
  const t = await getMonthlyTargetReport(undefined, undefined, client);
  return { target: t.targetAmount, completedSales: t.completedSales, remainingSales: t.remainingSales, progressPercentage: t.progressPercentage };
};
export const updateMonthlySalesTarget = async (amount: number | string, client?: DbClient, actorId?: string) => {
  const num = Number(amount);
  const now = new Date();
  const saved = await setMonthlyTarget(now.getUTCFullYear(), now.getUTCMonth() + 1, num, actorId, client);
  return { monthlyTarget: Number(saved.targetAmount) };
};


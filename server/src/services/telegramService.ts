import type { Prisma } from '@prisma/client';
import env from '../config/env.js';
import { database, type DbClient } from './domainUtils.js';
import {
  getSalesReport,
  getPurchaseReport,
  getExpenseReport,
  getCashbookReport,
  getProfitReport,
  getGstReport,
  getInventoryValuationReport,
  getCustomerOutstandingReport,
  getSupplierOutstandingReport,
  getDashboardAnalytics,
} from './reportsService.js';
import { getExpiryDashboard } from './batchService.js';
import { getPurchaseList } from './purchaseOrderService.js';
import { getDailyClosing } from './cashbookLedgerService.js';
import { getDailyCashSummary } from './cashbookService.js';

export type NotificationPreferences = {
  dailySummary: boolean;
  purchaseNotifications: boolean;
  expenseNotifications: boolean;
  dailyClosing: boolean;
  lowStockAlert: boolean;
  expiryAlert: boolean;
  customerDues: boolean;
  supplierDues: boolean;
  monthlySummary: boolean;
};

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  dailySummary: true,
  purchaseNotifications: true,
  expenseNotifications: true,
  dailyClosing: true,
  lowStockAlert: true,
  expiryAlert: true,
  customerDues: true,
  supplierDues: true,
  monthlySummary: true,
};

export type TelegramConfig = {
  configured: boolean;
  enabled: boolean;
  chatId: string | null;
  hasToken: boolean;
  preferences: NotificationPreferences;
};

export type SendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
  formattedMessage?: string;
};

const round = (num: number) => Math.round(num * 100) / 100;
const fmtINR = (val: number | string | Prisma.Decimal | null | undefined) => {
  const n = typeof val === 'object' && val !== null ? Number(val) : Number(val ?? 0);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * Retrieve current Telegram configuration without exposing bot token.
 */
export const getTelegramConfig = async (client?: DbClient): Promise<TelegramConfig> => {
  const db = database(client);
  const rows = await db.setting.findMany({
    where: {
      key: {
        in: [
          'TELEGRAM_BOT_TOKEN',
          'TELEGRAM_CHAT_ID',
          'TELEGRAM_ENABLED',
          'TELEGRAM_NOTIFICATION_PREFS',
        ],
      },
    },
  });

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const tokenFromDb = map.get('TELEGRAM_BOT_TOKEN');
  const tokenFromEnv = process.env.TELEGRAM_BOT_TOKEN;
  const token = (tokenFromDb || tokenFromEnv || '').trim();

  const chatIdFromDb = map.get('TELEGRAM_CHAT_ID');
  const chatIdFromEnv = process.env.TELEGRAM_CHAT_ID;
  const chatId = (chatIdFromDb || chatIdFromEnv || '').trim() || null;

  const enabledSetting = map.get('TELEGRAM_ENABLED');
  const enabled = enabledSetting !== undefined ? enabledSetting === 'true' : true;

  let preferences = { ...DEFAULT_PREFERENCES };
  const prefsStr = map.get('TELEGRAM_NOTIFICATION_PREFS');
  if (prefsStr) {
    try {
      preferences = { ...DEFAULT_PREFERENCES, ...JSON.parse(prefsStr) };
    } catch {
      // Use defaults if parse fails
    }
  }

  const hasToken = token.length > 0;
  const configured = hasToken && chatId !== null;

  return {
    configured,
    enabled,
    chatId,
    hasToken,
    preferences,
  };
};

/**
 * Update Telegram credentials and preferences in database settings.
 */
export const updateTelegramConfig = async (
  input: {
    botToken?: string;
    chatId?: string;
    enabled?: boolean;
    preferences?: Partial<NotificationPreferences>;
  },
  client?: DbClient,
  actorId?: string,
): Promise<TelegramConfig> => {
  const db = database(client);

  if (input.botToken !== undefined) {
    const trimmedToken = input.botToken.trim();
    if (trimmedToken) {
      await db.setting.upsert({
        where: { key: 'TELEGRAM_BOT_TOKEN' },
        update: { value: trimmedToken },
        create: { key: 'TELEGRAM_BOT_TOKEN', value: trimmedToken },
      });
    } else {
      await db.setting.deleteMany({ where: { key: 'TELEGRAM_BOT_TOKEN' } });
    }
  }

  if (input.chatId !== undefined) {
    const trimmedChatId = input.chatId.trim();
    if (trimmedChatId) {
      await db.setting.upsert({
        where: { key: 'TELEGRAM_CHAT_ID' },
        update: { value: trimmedChatId },
        create: { key: 'TELEGRAM_CHAT_ID', value: trimmedChatId },
      });
    } else {
      await db.setting.deleteMany({ where: { key: 'TELEGRAM_CHAT_ID' } });
    }
  }

  if (input.enabled !== undefined) {
    await db.setting.upsert({
      where: { key: 'TELEGRAM_ENABLED' },
      update: { value: input.enabled ? 'true' : 'false' },
      create: { key: 'TELEGRAM_ENABLED', value: input.enabled ? 'true' : 'false' },
    });
  }

  if (input.preferences) {
    const current = await getTelegramConfig(client);
    const updatedPrefs = { ...current.preferences, ...input.preferences };
    await db.setting.upsert({
      where: { key: 'TELEGRAM_NOTIFICATION_PREFS' },
      update: { value: JSON.stringify(updatedPrefs) },
      create: { key: 'TELEGRAM_NOTIFICATION_PREFS', value: JSON.stringify(updatedPrefs) },
    });
  }

  await db.auditLog.create({
    data: {
      userId: actorId ?? null,
      action: 'TELEGRAM_CONFIG_UPDATED',
      entityType: 'Setting',
      newValue: {
        chatIdUpdated: input.chatId !== undefined,
        tokenUpdated: input.botToken !== undefined,
        enabled: input.enabled,
        preferencesUpdated: input.preferences !== undefined,
      },
    },
  });

  return getTelegramConfig(client);
};

/**
 * Low-level safe sender that posts a raw message to Telegram Bot API.
 * Never throws an unhandled exception.
 */
export const sendTelegramRawMessage = async (
  messageText: string,
  options?: {
    token?: string;
    chatId?: string;
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    force?: boolean;
  },
  client?: DbClient,
  context?: {
    eventType?: string;
    entityType?: string;
    entityId?: string;
    userId?: string;
  },
): Promise<SendResult> => {
  const db = database(client);

  try {
    let token = options?.token;
    let chatId = options?.chatId;
    let enabled = true;

    if (!token || !chatId) {
      const rows = await db.setting.findMany({
        where: {
          key: { in: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ENABLED'] },
        },
      });
      const map = new Map(rows.map((r) => [r.key, r.value]));

      token = token || map.get('TELEGRAM_BOT_TOKEN') || process.env.TELEGRAM_BOT_TOKEN;
      chatId = chatId || map.get('TELEGRAM_CHAT_ID') || process.env.TELEGRAM_CHAT_ID;
      const enabledSetting = map.get('TELEGRAM_ENABLED');
      enabled = enabledSetting !== undefined ? enabledSetting === 'true' : true;
    }

    if (!token || !chatId) {
      return {
        success: false,
        error: 'Telegram is not configured (missing bot token or chat ID)',
        formattedMessage: messageText,
      };
    }

    if (!enabled && !options?.force) {
      return {
        success: false,
        error: 'Telegram notifications are disabled in settings',
        formattedMessage: messageText,
      };
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload: Record<string, any> = {
      chat_id: chatId,
      text: messageText,
    };
    if (options?.parseMode) {
      payload.parse_mode = options.parseMode;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data: any = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      const errMsg = data.description || `HTTP ${response.status}: Failed to send Telegram message`;
      await db.telegramEvent.create({
        data: {
          userId: context?.userId ?? null,
          eventType: context?.eventType ?? 'MESSAGE',
          entityType: context?.entityType ?? null,
          entityId: context?.entityId ?? null,
          message: messageText,
          status: 'FAILED',
        },
      });

      return {
        success: false,
        error: errMsg,
        formattedMessage: messageText,
      };
    }

    await db.telegramEvent.create({
      data: {
        userId: context?.userId ?? null,
        eventType: context?.eventType ?? 'MESSAGE',
        entityType: context?.entityType ?? null,
        entityId: context?.entityId ?? null,
        message: messageText,
        sentAt: new Date(),
        status: 'SENT',
      },
    });

    return {
      success: true,
      messageId: String(data.result?.message_id ?? ''),
      formattedMessage: messageText,
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Unknown network error sending Telegram message';
    try {
      await db.telegramEvent.create({
        data: {
          userId: context?.userId ?? null,
          eventType: context?.eventType ?? 'MESSAGE',
          entityType: context?.entityType ?? null,
          entityId: context?.entityId ?? null,
          message: messageText,
          status: 'FAILED',
        },
      });
    } catch {
      // Ignore DB logging failure if connection lost
    }

    return {
      success: false,
      error: errMsg,
      formattedMessage: messageText,
    };
  }
};

/**
 * 1. Test Telegram Connection
 */
export const testTelegramConnection = async (
  client?: DbClient,
  actorId?: string,
): Promise<SendResult> => {
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const msg = [
    '🧪 *PHARMORA POS TEST NOTIFICATION*',
    '',
    'Your Telegram bot connection has been successfully verified.',
    `Time: ${timestamp}`,
    'Status: Online & Ready',
  ].join('\n');

  return sendTelegramRawMessage(
    msg,
    { force: true },
    client,
    { eventType: 'TEST_CONNECTION', userId: actorId },
  );
};

/**
 * 2. Daily Summary Notification
 */
export const sendDailySummary = async (
  dateInput?: Date | string,
  client?: DbClient,
  actorId?: string,
): Promise<SendResult> => {
  const db = database(client);
  const targetDate = dateInput ? new Date(dateInput) : new Date();
  const dateStr = targetDate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Pull existing verified calculations from reports, cashbook & batch services
  const [salesReport, purchaseReport, expenseReport, cashbookReport, expiryDashboard, purchaseList, dashboard] =
    await Promise.all([
      getSalesReport({ preset: 'TODAY' }, client),
      getPurchaseReport({ preset: 'TODAY' }, client),
      getExpenseReport({ preset: 'TODAY' }, client),
      getCashbookReport({ preset: 'TODAY' }, client),
      getExpiryDashboard(targetDate, client),
      getPurchaseList({ filter: 'LOW_STOCK' }, client),
      getDashboardAnalytics(client),
    ]);

  const posSales = salesReport.summary.posSales ?? salesReport.summary.grossSales;
  const nonPosSales = salesReport.summary.nonPosSales ?? 0;
  const totalSales = salesReport.summary.netSales;

  const cashPay = salesReport.summary.cashSales;
  const upiPay = salesReport.summary.upiSales;
  const creditPay = salesReport.summary.creditSales;

  const grossPurchases = purchaseReport.summary.grossPurchases;
  const totalExpenses = expenseReport.summary.totalExpenses;

  const drawerOpening = cashbookReport.cash.inflows;
  const drawerExpected = dashboard.today.expectedDrawer;
  const drawerActual = dashboard.today.actualDrawer;
  const drawerDiff = dashboard.today.cashDifference;

  const customerDue = dashboard.alerts.customerDuesTotal;
  const supplierDue = dashboard.alerts.supplierDuesTotal;

  const lowStockCount = purchaseList.filter((p: any) => p.stockStatus === 'LOW_STOCK').length;
  const outOfStockCount = purchaseList.filter((p: any) => p.stockStatus === 'OUT_OF_STOCK').length;
  const expiringSoonCount = expiryDashboard.summary.near30Days.count;
  const expiredCount = expiryDashboard.summary.expired.count;

  const msg = [
    '🏥 *PHARMORA DAILY SUMMARY*',
    `📅 Date: ${dateStr}`,
    '',
    '📊 *Sales*',
    `POS Sales: ${fmtINR(posSales)}`,
    `Non-POS Sales: ${fmtINR(nonPosSales)}`,
    `Total Sales: ${fmtINR(totalSales)}`,
    '',
    '💳 *Payment Breakdown*',
    `Cash: ${fmtINR(cashPay)}`,
    `UPI: ${fmtINR(upiPay)}`,
    `Credit: ${fmtINR(creditPay)}`,
    '',
    `📦 Purchases: ${fmtINR(grossPurchases)}`,
    `💸 Expenses: ${fmtINR(totalExpenses)}`,
    '',
    '💵 *Cash Drawer*',
    `Inflows: ${fmtINR(drawerOpening)}`,
    `Expected: ${fmtINR(drawerExpected)}`,
    `Actual: ${drawerActual !== null ? fmtINR(drawerActual) : 'Pending Closing'}`,
    `Difference: ${drawerDiff !== null ? fmtINR(drawerDiff) : '—'}`,
    '',
    '👥 *Outstanding Dues*',
    `Customer Due: ${fmtINR(customerDue)}`,
    `Supplier Due: ${fmtINR(supplierDue)}`,
    '',
    '⚠️ *Alerts*',
    `Low Stock: ${lowStockCount + outOfStockCount} items (${outOfStockCount} out of stock)`,
    `Expiring Soon (<=30d): ${expiringSoonCount} batches`,
    `Expired: ${expiredCount} batches`,
  ].join('\n');

  return sendTelegramRawMessage(
    msg,
    undefined,
    client,
    { eventType: 'DAILY_SUMMARY', entityType: 'Report', userId: actorId },
  );
};

/**
 * 3. Purchase Recorded Notification
 */
export const sendPurchaseSummary = async (
  purchaseId: string,
  client?: DbClient,
  actorId?: string,
): Promise<SendResult> => {
  const db = database(client);
  const purchase = await db.purchase.findUnique({
    where: { id: purchaseId },
    include: {
      supplier: true,
      items: { include: { product: true } },
    },
  });

  if (!purchase) {
    return { success: false, error: 'Purchase record not found' };
  }

  const supplierName = purchase.supplier.name;
  const invoiceNumber = purchase.invoiceNumber;
  const dateStr = new Date(purchase.invoiceDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const lines = [
    '📦 *PURCHASE RECORDED*',
    '',
    `Supplier: ${supplierName}`,
    `Invoice: #${invoiceNumber}`,
    `Date: ${dateStr}`,
    '',
    'Items:',
  ];

  for (const item of purchase.items) {
    lines.push(`• ${item.product.name} × ${item.quantity + item.freeQty}`);
  }

  lines.push('');
  lines.push(`Total: ${fmtINR(Number(purchase.totalAmount))}`);
  lines.push(`Payment: ${purchase.paymentMethod || 'PENDING'} (Paid: ${fmtINR(Number(purchase.paidAmount))})`);
  lines.push(`Supplier Outstanding: ${fmtINR(Number(purchase.supplier.outstanding))}`);

  const msg = lines.join('\n');

  return sendTelegramRawMessage(
    msg,
    undefined,
    client,
    { eventType: 'PURCHASE_NOTIFICATION', entityType: 'Purchase', entityId: purchaseId, userId: actorId },
  );
};

/**
 * 4. Expense Recorded Notification
 */
export const sendExpenseSummary = async (
  expenseId: string,
  client?: DbClient,
  actorId?: string,
): Promise<SendResult> => {
  const db = database(client);
  const expense = await db.expense.findUnique({
    where: { id: expenseId },
  });

  if (!expense) {
    return { success: false, error: 'Expense record not found' };
  }

  const dateStr = new Date(expense.expenseDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const lines = [
    '💸 *EXPENSE RECORDED*',
    '',
    `Category: ${expense.category}`,
    `Amount: ${fmtINR(Number(expense.amount))}`,
    `Payment: ${expense.paymentMethod}`,
    expense.description ? `Description: ${expense.description}` : '',
    `Date: ${dateStr}`,
  ].filter(Boolean);

  const msg = lines.join('\n');

  return sendTelegramRawMessage(
    msg,
    undefined,
    client,
    { eventType: 'EXPENSE_NOTIFICATION', entityType: 'Expense', entityId: expenseId, userId: actorId },
  );
};

/**
 * 5. Daily Closing Notification
 */
export const sendDailyClosingSummary = async (
  closingDateInput: Date | string,
  client?: DbClient,
  actorId?: string,
): Promise<SendResult> => {
  const db = database(client);
  const targetDate = typeof closingDateInput === 'string' ? new Date(closingDateInput) : closingDateInput;
  const closingDateStr = targetDate.toISOString().slice(0, 10);

  const [closing, cashSummary] = await Promise.all([
    getDailyClosing(closingDateStr, client).catch(() => null),
    getDailyCashSummary(targetDate, client).catch(() => null),
  ]);

  const dateFormatted = targetDate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const opening = closing?.openingCash ?? cashSummary?.openingCash ?? 0;
  const inflows = closing?.cashInflows ?? cashSummary?.cashInflows ?? 0;
  const outflows = closing?.cashOutflows ?? cashSummary?.cashOutflows ?? 0;
  const expected = closing?.expectedCash ?? cashSummary?.expectedDrawerCash ?? 0;
  const actual = closing?.actualCash ?? 0;
  const diff = closing?.difference ?? 0;
  const status = closing?.status ?? 'PENDING';

  const lines = [
    '🔒 *DAILY CLOSING REPORT*',
    `Date: ${dateFormatted}`,
    '',
    `Opening Cash: ${fmtINR(opening)}`,
    `Total Cash In: ${fmtINR(inflows)}`,
    `Total Cash Out: ${fmtINR(outflows)}`,
    '',
    `Expected Drawer: ${fmtINR(expected)}`,
    `Actual Drawer: ${fmtINR(actual)}`,
    `Difference: ${fmtINR(diff)}`,
    '',
    `Status: *${status}*`,
  ];

  if (closing?.notes) {
    lines.push(`Notes: ${closing.notes}`);
  }

  const msg = lines.join('\n');

  return sendTelegramRawMessage(
    msg,
    undefined,
    client,
    { eventType: 'DAILY_CLOSING_NOTIFICATION', entityType: 'DailyClosing', userId: actorId },
  );
};

/**
 * 6. Low Stock Alert
 */
export const sendLowStockAlert = async (
  client?: DbClient,
  actorId?: string,
): Promise<SendResult> => {
  const purchaseList = await getPurchaseList({ filter: 'LOW_STOCK' }, client);

  const outOfStock = purchaseList.filter((p: any) => p.stockStatus === 'OUT_OF_STOCK');
  const lowStock = purchaseList.filter((p: any) => p.stockStatus === 'LOW_STOCK');

  if (outOfStock.length === 0 && lowStock.length === 0) {
    const msg = '✅ *STOCK STATUS: ALL GOOD*\n\nAll active products have healthy inventory levels.';
    return sendTelegramRawMessage(msg, undefined, client, { eventType: 'LOW_STOCK_ALERT', userId: actorId });
  }

  const lines = [
    '⚠️ *LOW STOCK ALERT*',
    `Total Items Requiring Attention: ${outOfStock.length + lowStock.length}`,
    '',
  ];

  if (outOfStock.length > 0) {
    lines.push('🚨 *OUT OF STOCK:*');
    outOfStock.slice(0, 15).forEach((p: any, idx: number) => {
      lines.push(`${idx + 1}. ${p.name} — Current: 0 | Reorder: ${p.reorderLevel} | Suggested: ${p.suggestedQuantity}`);
    });
    if (outOfStock.length > 15) {
      lines.push(`... and ${outOfStock.length - 15} more out of stock items.`);
    }
    lines.push('');
  }

  if (lowStock.length > 0) {
    lines.push('⚠️ *LOW STOCK:*');
    lowStock.slice(0, 15).forEach((p: any, idx: number) => {
      lines.push(`${idx + 1}. ${p.name} — Current: ${p.currentStock} | Reorder: ${p.reorderLevel} | Suggested: ${p.suggestedQuantity}`);
    });
    if (lowStock.length > 15) {
      lines.push(`... and ${lowStock.length - 15} more low stock items.`);
    }
  }

  const msg = lines.join('\n');

  return sendTelegramRawMessage(
    msg,
    undefined,
    client,
    { eventType: 'LOW_STOCK_ALERT', userId: actorId },
  );
};

/**
 * 7. Expiry Alert
 */
export const sendExpiryAlert = async (
  client?: DbClient,
  actorId?: string,
): Promise<SendResult> => {
  const dashboard = await getExpiryDashboard(new Date(), client);
  const { expired, near30Days, near60Days, near90Days } = dashboard.summary;

  const totalFlagged = expired.count + near30Days.count + near60Days.count + near90Days.count;
  if (totalFlagged === 0) {
    const msg = '✅ *EXPIRY STATUS: ALL CLEAR*\n\nNo batches expired or nearing expiry in the next 90 days.';
    return sendTelegramRawMessage(msg, undefined, client, { eventType: 'EXPIRY_ALERT', userId: actorId });
  }

  const lines = [
    '⚠️ *BATCH EXPIRY ALERT*',
    '',
    `🔴 Expired: ${expired.count} batches (${expired.units} units — ${fmtINR(expired.totalCost)})`,
    `🟠 0–30 Days: ${near30Days.count} batches (${near30Days.units} units — ${fmtINR(near30Days.totalCost)})`,
    `🟡 31–60 Days: ${near60Days.count} batches (${near60Days.units} units — ${fmtINR(near60Days.totalCost)})`,
    `🔵 61–90 Days: ${near90Days.count} batches (${near90Days.units} units — ${fmtINR(near90Days.totalCost)})`,
    '',
  ];

  if (expired.count > 0) {
    lines.push('🚨 *Top Expired Batches:*');
    dashboard.batches.expired.slice(0, 5).forEach((b: any) => {
      lines.push(`• ${b.productName} (Batch: ${b.batchNumber}) — ${b.quantity} pcs (${fmtINR(b.totalCostValue)})`);
    });
    lines.push('');
  }

  if (near30Days.count > 0) {
    lines.push('⚠️ *Top Expiring Soon (< 30 Days):*');
    dashboard.batches.near30Days.slice(0, 5).forEach((b: any) => {
      lines.push(`• ${b.productName} (Batch: ${b.batchNumber}) — ${b.quantity} pcs in ${b.daysUntilExpiry}d (${fmtINR(b.totalCostValue)})`);
    });
  }

  const msg = lines.join('\n');

  return sendTelegramRawMessage(
    msg,
    undefined,
    client,
    { eventType: 'EXPIRY_ALERT', userId: actorId },
  );
};

/**
 * 8. Customer Due Alert
 */
export const sendCustomerDueSummary = async (
  client?: DbClient,
  actorId?: string,
): Promise<SendResult> => {
  const report = await getCustomerOutstandingReport(client);
  const customersWithDues = report.customers.filter((c) => c.outstanding > 0);

  const lines = [
    '👥 *CUSTOMER OUTSTANDING DUES*',
    '',
    `Total Outstanding: ${fmtINR(report.summary.totalOutstanding)}`,
    `Customers with Dues: ${customersWithDues.length}`,
    '',
  ];

  if (customersWithDues.length > 0) {
    lines.push('*Top Customer Dues:*');
    customersWithDues.slice(0, 10).forEach((c, idx) => {
      lines.push(`${idx + 1}. ${c.name} — ${fmtINR(c.outstanding)}${c.phone ? ` (${c.phone})` : ''}`);
    });
    if (customersWithDues.length > 10) {
      lines.push(`... and ${customersWithDues.length - 10} more customers.`);
    }
  } else {
    lines.push('All customer credit accounts are fully settled.');
  }

  const msg = lines.join('\n');

  return sendTelegramRawMessage(
    msg,
    undefined,
    client,
    { eventType: 'CUSTOMER_DUES_ALERT', userId: actorId },
  );
};

/**
 * 9. Supplier Due Alert
 */
export const sendSupplierDueSummary = async (
  client?: DbClient,
  actorId?: string,
): Promise<SendResult> => {
  const report = await getSupplierOutstandingReport(client);
  const suppliersWithDues = report.suppliers.filter((s) => s.outstanding > 0);

  const lines = [
    '🏢 *SUPPLIER OUTSTANDING PAYABLES*',
    '',
    `Total Outstanding: ${fmtINR(report.summary.totalPayable)}`,
    `Suppliers with Payables: ${suppliersWithDues.length}`,
    '',
  ];

  if (suppliersWithDues.length > 0) {
    lines.push('*Top Supplier Payables:*');
    suppliersWithDues.slice(0, 10).forEach((s, idx) => {
      lines.push(`${idx + 1}. ${s.name} — ${fmtINR(s.outstanding)}`);
    });
    if (suppliersWithDues.length > 10) {
      lines.push(`... and ${suppliersWithDues.length - 10} more suppliers.`);
    }
  } else {
    lines.push('All supplier accounts are fully settled.');
  }

  const msg = lines.join('\n');

  return sendTelegramRawMessage(
    msg,
    undefined,
    client,
    { eventType: 'SUPPLIER_DUES_ALERT', userId: actorId },
  );
};

/**
 * 10. Monthly Business Summary Notification
 */
export const sendMonthlySummary = async (
  year?: number,
  month?: number,
  client?: DbClient,
  actorId?: string,
): Promise<SendResult> => {
  const now = new Date();
  const targetYear = year ?? (now.getDate() === 1 ? (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()) : now.getFullYear());
  const targetMonth = month ?? (now.getDate() === 1 ? (now.getMonth() === 0 ? 12 : now.getMonth()) : now.getMonth() + 1);

  // Calculate month date range
  const startDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999));

  const filter = { startDate, endDate, preset: 'CUSTOM' as const };

  const [salesReport, purchaseReport, expenseReport, profitReport, gstReport, valuationReport, custReport, suppReport, cashbookReport] =
    await Promise.all([
      getSalesReport(filter, client),
      getPurchaseReport(filter, client),
      getExpenseReport(filter, client),
      getProfitReport(filter, client),
      getGstReport(filter, client),
      getInventoryValuationReport({}, client),
      getCustomerOutstandingReport(client),
      getSupplierOutstandingReport(client),
      getCashbookReport(filter, client),
    ]);

  const monthLabel = startDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const msg = [
    `📊 *MONTHLY BUSINESS SUMMARY (${monthLabel})*`,
    '',
    '🛒 *Sales & Revenue*',
    `Gross Sales: ${fmtINR(salesReport.summary.grossSales)}`,
    `Sales Returns: -${fmtINR(salesReport.summary.salesReturns)}`,
    `*Net Sales: ${fmtINR(salesReport.summary.netSales)}*`,
    '',
    '📦 *Purchases & Expenses*',
    `Purchases: ${fmtINR(purchaseReport.summary.grossPurchases)}`,
    `Purchase Returns: -${fmtINR(purchaseReport.summary.purchaseReturns)}`,
    `Operating Expenses: ${fmtINR(expenseReport.summary.totalExpenses)}`,
    '',
    '📈 *Profitability (COGS)*',
    `Cost of Goods Sold (COGS): ${fmtINR(profitReport.summary.cogs.totalCogs)}`,
    `*Gross Profit: ${fmtINR(profitReport.summary.grossProfit)} (${profitReport.summary.grossMarginPercentage}%)*`,
    `*Net Profit: ${fmtINR(profitReport.summary.netProfit)} (${profitReport.summary.netMarginPercentage}%)*`,
    '',
    '💵 *Liquidity & Cash Position*',
    `Cash Inflows: ${fmtINR(cashbookReport.cash.inflows)}`,
    `Cash Outflows: ${fmtINR(cashbookReport.cash.outflows)}`,
    `Bank/UPI Inflows: ${fmtINR(cashbookReport.bank.inflows)}`,
    '',
    '⚖️ *Ledger Outstandings*',
    `Customer Outstanding: ${fmtINR(custReport.summary.totalOutstanding)}`,
    `Supplier Outstanding: ${fmtINR(suppReport.summary.totalPayable)}`,
    `Inventory Valuation (Cost): ${fmtINR(valuationReport.summary.costValuation)}`,
    '',
    '🏛️ *GST Position*',
    `Output GST: ${fmtINR(gstReport.summary.outputGst.netOutputGst)}`,
    `Input GST: ${fmtINR(gstReport.summary.inputGst.netInputGst)}`,
    `Net GST Position: ${fmtINR(gstReport.summary.netGstPayable)}`,
  ].join('\n');

  return sendTelegramRawMessage(
    msg,
    undefined,
    client,
    { eventType: 'MONTHLY_SUMMARY', entityType: 'Report', userId: actorId },
  );
};

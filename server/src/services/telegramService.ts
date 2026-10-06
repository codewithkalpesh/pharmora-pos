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
  getMonthlySalesTarget,
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
export const getTelegramConfig = async (client?: DbClient, shopId = 'default-shop-pharmora'): Promise<TelegramConfig> => {
  const db = database(client);
  const rows = await db.setting.findMany({
    where: {
      shopId,
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
  shopId = 'default-shop-pharmora',
): Promise<TelegramConfig> => {
  const db = database(client);

  if (input.botToken !== undefined) {
    const trimmedToken = input.botToken.trim();
    if (trimmedToken) {
      await db.setting.upsert({
        where: { key_shopId: { key: 'TELEGRAM_BOT_TOKEN', shopId } },
        update: { value: trimmedToken },
        create: { key: 'TELEGRAM_BOT_TOKEN', value: trimmedToken, shopId },
      });
    } else {
      await db.setting.deleteMany({ where: { key: 'TELEGRAM_BOT_TOKEN', shopId } });
    }
  }

  if (input.chatId !== undefined) {
    const trimmedChatId = input.chatId.trim();
    if (trimmedChatId) {
      await db.setting.upsert({
        where: { key_shopId: { key: 'TELEGRAM_CHAT_ID', shopId } },
        update: { value: trimmedChatId },
        create: { key: 'TELEGRAM_CHAT_ID', value: trimmedChatId, shopId },
      });
    } else {
      await db.setting.deleteMany({ where: { key: 'TELEGRAM_CHAT_ID', shopId } });
    }
  }

  if (input.enabled !== undefined) {
    await db.setting.upsert({
      where: { key_shopId: { key: 'TELEGRAM_ENABLED', shopId } },
      update: { value: input.enabled ? 'true' : 'false' },
      create: { key: 'TELEGRAM_ENABLED', value: input.enabled ? 'true' : 'false', shopId },
    });
  }

  if (input.preferences) {
    const current = await getTelegramConfig(client, shopId);
    const updatedPrefs = { ...current.preferences, ...input.preferences };
    await db.setting.upsert({
      where: { key_shopId: { key: 'TELEGRAM_NOTIFICATION_PREFS', shopId } },
      update: { value: JSON.stringify(updatedPrefs) },
      create: { key: 'TELEGRAM_NOTIFICATION_PREFS', value: JSON.stringify(updatedPrefs), shopId },
    });
  }

  await db.auditLog.create({
    data: {
      shopId,
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

  return getTelegramConfig(client, shopId);
};

/**
 * Low-level safe sender that posts a raw message to Telegram Bot API.
 */
export const sendTelegramRawMessage = async (
  messageText: string,
  options?: {
    token?: string;
    chatId?: string;
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    force?: boolean;
    shopId?: string;
  },
  client?: DbClient,
  context?: {
    eventType?: string;
    entityType?: string;
    entityId?: string;
    userId?: string;
    shopId?: string;
  },
): Promise<SendResult> => {
  const db = database(client);
  const targetShopId = options?.shopId || context?.shopId || 'default-shop-pharmora';

  try {
    let token = options?.token;
    let chatId = options?.chatId;
    let enabled = true;

    if (!token || !chatId) {
      const rows = await db.setting.findMany({
        where: {
          shopId: targetShopId,
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
          shopId: targetShopId,
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
        shopId: targetShopId,
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
    const errorStr = err?.message || 'Network error while contacting Telegram';
    try {
      await db.telegramEvent.create({
        data: {
          shopId: targetShopId,
          userId: context?.userId ?? null,
          eventType: context?.eventType ?? 'MESSAGE',
          entityType: context?.entityType ?? null,
          entityId: context?.entityId ?? null,
          message: messageText,
          status: 'FAILED',
        },
      });
    } catch {
      // Ignore fallback DB failure
    }
    return {
      success: false,
      error: errorStr,
      formattedMessage: messageText,
    };
  }
};

/**
 * 1. Daily Summary Message
 */
export const sendDailySummary = async (dateInput?: string | Date, client?: DbClient, actorId?: string, shopId = 'default-shop-pharmora'): Promise<SendResult> => {
  const config = await getTelegramConfig(client, shopId);
  if (!config.preferences.dailySummary) {
    return { success: false, error: 'Daily summary notification preference is turned off' };
  }

  const [sales, purchase, expense, cashbook, analytics] = await Promise.all([
    getSalesReport({ preset: 'TODAY' }, client, shopId),
    getPurchaseReport({ preset: 'TODAY' }, client, shopId),
    getExpenseReport({ preset: 'TODAY' }, client, shopId),
    getCashbookReport({ preset: 'TODAY' }, client, shopId),
    getDashboardAnalytics(client, shopId),
  ]);

  const dateStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const lines = [
    `📊 <b>PHARMORA DAILY SUMMARY</b>`,
    `📅 <i>${dateStr}</i>`,
    ``,
    `💰 <b>Sales</b>`,
    `• Total Sales: <b>${fmtINR(sales.summary.grossSales)}</b>`,
    `• Invoices: ${sales.summary.invoiceCount} (Avg: ${fmtINR(sales.summary.averageInvoiceValue)})`,
    ``,
    `💳 <b>Payment Breakdown:</b>`,
    `  - Cash: ${fmtINR(sales.summary.cashSales)}`,
    `  - UPI/Bank: ${fmtINR(sales.summary.upiSales)}`,
    `  - Credit/Dues: ${fmtINR(sales.summary.creditSales)}`,
    ``,
    `📦 <b>Purchases & Expenses</b>`,
    `• Purchases: ${fmtINR(purchase.summary.grossPurchases)} (${purchase.summary.invoiceCount} bills)`,
    `• Expenses: ${fmtINR(expense.summary.totalExpenses)} (${expense.summary.expenseCount} entries)`,
    ``,
    `💵 <b>Cash Drawer & Digital</b>`,
    `• Expected Cash: ${fmtINR(cashbook.cash.expectedCash)}`,
    `• Net Bank Inflow: ${fmtINR(cashbook.bank.netBankFlow)}`,
    ``,
    `⚠️ <b>Alerts</b>`,
    `• Low stock / expiry monitoring active`,
    ``,
    `🎯 <b>Target Progress:</b> ${analytics.monthly.progressPercentage}% (${fmtINR(analytics.monthly.completedSales)} / ${fmtINR(analytics.monthly.target)})`,
    ``,
    `<i>Sent automatically by Pharmora POS</i>`,
  ];

  const msg = lines.join('\n');
  return sendTelegramRawMessage(
    msg,
    { parseMode: 'HTML', shopId },
    client,
    { eventType: 'DAILY_SUMMARY', userId: actorId, shopId },
  );
};

/**
 * 2. Purchase Notification Message
 */
export const sendPurchaseNotification = async (purchaseId: string, client?: DbClient, actorId?: string, shopId = 'default-shop-pharmora'): Promise<SendResult> => {
  const config = await getTelegramConfig(client, shopId);
  if (!config.preferences.purchaseNotifications) {
    return { success: false, error: 'Purchase notifications are turned off' };
  }

  const db = database(client);
  const purchase = db.purchase.findFirst
    ? await db.purchase.findFirst({
        where: { id: purchaseId, shopId },
        include: { supplier: true, items: { include: { product: true } } },
      })
    : await db.purchase.findUnique({
        where: { id: purchaseId },
        include: { supplier: true, items: { include: { product: true } } },
      });

  if (!purchase || (shopId && (purchase as any).shopId && (purchase as any).shopId !== shopId)) return { success: false, error: 'Purchase not found' };

  const lines = [
    `📥 <b>PURCHASE RECORDED</b>`,
    ``,
    `• Invoice No: <b>#${purchase.invoiceNumber}</b>`,
    `• Supplier: <b>${purchase.supplier?.name ?? '—'}</b>`,
    `• Total Amount: <b>${fmtINR(purchase.totalAmount)}</b>`,
    `• Paid Amount: ${fmtINR(purchase.paidAmount)} (${purchase.paymentMethod})`,
    `• Balance Due: <b>${fmtINR(purchase.outstandingAmount)}</b>`,
    `• Items Count: ${purchase.items.length}`,
    ``,
    `<i>Recorded on ${new Date(purchase.invoiceDate).toLocaleDateString('en-IN')}</i>`,
  ];

  return sendTelegramRawMessage(
    lines.join('\n'),
    { parseMode: 'HTML', shopId },
    client,
    { eventType: 'PURCHASE', entityType: 'Purchase', entityId: purchaseId, userId: actorId, shopId },
  );
};

/**
 * 3. Expense Notification Message
 */
export const sendExpenseSummary = async (expenseId: string, client?: DbClient, actorId?: string, shopId = 'default-shop-pharmora'): Promise<SendResult> => {
  const config = await getTelegramConfig(client, shopId);
  if (!config.preferences.expenseNotifications) {
    return { success: false, error: 'Expense notifications are turned off' };
  }

  const db = database(client);
  const expense = db.expense.findFirst
    ? await db.expense.findFirst({
        where: { id: expenseId, shopId },
        include: { createdBy: { select: { name: true } } },
      })
    : await db.expense.findUnique({
        where: { id: expenseId },
        include: { createdBy: { select: { name: true } } },
      });

  if (!expense || (shopId && (expense as any).shopId && (expense as any).shopId !== shopId)) return { success: false, error: 'Expense not found' };

  const lines = [
    `💸 <b>NEW EXPENSE RECORDED</b>`,
    ``,
    `• Category: <b>${expense.category}</b>`,
    `• Amount: <b>${fmtINR(expense.amount)}</b>`,
    `• Mode: ${expense.paymentMethod}`,
    expense.description ? `• Note: <i>${expense.description}</i>` : '',
    expense.createdBy?.name ? `• Recorded by: ${expense.createdBy.name}` : '',
    ``,
    `<i>${new Date(expense.expenseDate).toLocaleDateString('en-IN')}</i>`,
  ].filter(Boolean);

  return sendTelegramRawMessage(
    lines.join('\n'),
    { parseMode: 'HTML', shopId },
    client,
    { eventType: 'EXPENSE', entityType: 'Expense', entityId: expenseId, userId: actorId, shopId },
  );
};

/**
 * 4. Daily Closing Summary Message
 */
export const sendDailyClosingSummary = async (closingDate: Date | string, client?: DbClient, actorId?: string, shopId = 'default-shop-pharmora'): Promise<SendResult> => {
  const config = await getTelegramConfig(client, shopId);
  if (!config.preferences.dailyClosing) {
    return { success: false, error: 'Daily closing notifications are turned off' };
  }

  const closing = await getDailyClosing(closingDate, client, shopId);
  if (!closing) return { success: false, error: 'Closing not found' };

  const diffNum = Number(closing.difference);
  const statusEmoji = closing.status === 'BALANCED' ? '✅' : diffNum > 0 ? '🟢' : '🔴';

  const lines = [
    `🔒 <b>DAILY DRAWER CLOSING SUMMARY</b>`,
    `📅 <i>${new Date(closing.closingDate).toLocaleDateString('en-IN')}</i>`,
    ``,
    `• Opening Cash: ${fmtINR(closing.openingCash)}`,
    `• Cash Inflows: ${fmtINR(closing.cashInflows)}`,
    `• Cash Outflows: ${fmtINR(closing.cashOutflows)}`,
    `• Expected Cash: <b>${fmtINR(closing.expectedCash)}</b>`,
    `• Actual Counted: <b>${fmtINR(closing.actualCash)}</b>`,
    ``,
    `• Discrepancy: ${statusEmoji} <b>${fmtINR(diffNum)} (${closing.status})</b>`,
    (closing as any).closedBy?.name ? `• Closed by: ${(closing as any).closedBy.name}` : '',
    closing.notes ? `• Notes: <i>${closing.notes}</i>` : '',
  ].filter(Boolean);

  return sendTelegramRawMessage(
    lines.join('\n'),
    { parseMode: 'HTML', shopId },
    client,
    { eventType: 'DAILY_CLOSING', entityType: 'DailyClosing', entityId: closing.id, userId: actorId, shopId },
  );
};

/**
 * 5. Low Stock Alert Message
 */
export const sendLowStockAlert = async (client?: DbClient, actorId?: string, shopId = 'default-shop-pharmora'): Promise<SendResult> => {
  const config = await getTelegramConfig(client, shopId);
  if (!config.preferences.lowStockAlert) {
    return { success: false, error: 'Low stock alerts are turned off' };
  }

  const purchaseList = await getPurchaseList({ filter: 'LOW_STOCK', shopId }, client, shopId);
  if (purchaseList.length === 0) {
    return { success: false, error: 'No low stock items currently' };
  }

  const lines = [
    `⚠️ <b>LOW STOCK ALERT — OUT OF STOCK ITEMS</b>`,
    `Found <b>${purchaseList.length}</b> products needing reorder:`,
    ``,
  ];

  purchaseList.slice(0, 15).forEach((p, idx) => {
    const status = p.stockStatus === 'OUT_OF_STOCK' ? '🔴 OUT' : '🟠 LOW';
    lines.push(`${idx + 1}. <b>${p.name}</b> — Stock: ${p.currentStock} / Reorder: ${p.reorderLevel} [${status}] (Order: ${p.suggestedQuantity})`);
  });

  if (purchaseList.length > 15) {
    lines.push(``);
    lines.push(`<i>...and ${purchaseList.length - 15} more items in Purchase Order recommendations.</i>`);
  }

  return sendTelegramRawMessage(
    lines.join('\n'),
    { parseMode: 'HTML', shopId },
    client,
    { eventType: 'LOW_STOCK', userId: actorId, shopId },
  );
};

/**
 * 6. Expiry Alert Message
 */
export const sendExpiryAlert = async (client?: DbClient, actorId?: string, shopId = 'default-shop-pharmora'): Promise<SendResult> => {
  const config = await getTelegramConfig(client, shopId);
  if (!config.preferences.expiryAlert) {
    return { success: false, error: 'Expiry alerts are turned off' };
  }

  const expiry = await getExpiryDashboard(undefined, client, shopId);
  const expiredCount = expiry.summary.expired.count;
  const days30Count = expiry.summary.near30Days.count;

  if (expiredCount === 0 && days30Count === 0) {
    return { success: false, error: 'No expired or near-expiry medicines currently' };
  }

  const lines = [
    `⏰ <b>BATCH EXPIRY ALERT</b>`,
    ``,
    `• Expired: <b>${expiredCount}</b> (Valuation: ${fmtINR(expiry.summary.expired.totalCost)})`,
    `• 0–30 Days: <b>${days30Count}</b> (Valuation: ${fmtINR(expiry.summary.near30Days.totalCost)})`,
    ``,
  ];

  if (expiry.batches.expired.length > 0) {
    lines.push(`<b>Expired Items:</b>`);
    expiry.batches.expired.slice(0, 5).forEach((b: any) => {
      lines.push(`• <s>${b.product?.name || 'Product'}</s> (Batch: ${b.batchNumber}, Qty: ${b.quantity})`);
    });
    lines.push(``);
  }

  if (expiry.batches.near30Days.length > 0) {
    lines.push(`<b>Expiring Soon (Next 30 Days):</b>`);
    expiry.batches.near30Days.slice(0, 5).forEach((b: any) => {
      lines.push(`• ${b.product?.name || 'Product'} (Batch: ${b.batchNumber}, Qty: ${b.quantity}) - Exp: ${b.expiryDate ? new Date(b.expiryDate).toLocaleDateString('en-IN') : 'N/A'}`);
    });
  }

  return sendTelegramRawMessage(
    lines.join('\n'),
    { parseMode: 'HTML', shopId },
    client,
    { eventType: 'EXPIRY_ALERT', userId: actorId, shopId },
  );
};

/**
 * 7. Customer Dues Summary Message
 */
export const sendCustomerDuesSummary = async (client?: DbClient, actorId?: string, shopId = 'default-shop-pharmora'): Promise<SendResult> => {
  const config = await getTelegramConfig(client, shopId);
  if (!config.preferences.customerDues) {
    return { success: false, error: 'Customer dues notifications are turned off' };
  }

  const dues = await getCustomerOutstandingReport(client, shopId);
  if (dues.customers.length === 0) {
    return { success: false, error: 'No customers with pending dues' };
  }

  const lines = [
    `👥 <b>CUSTOMER OUTSTANDING DUES SUMMARY</b>`,
    ``,
    `• Total Outstanding: <b>${fmtINR(dues.summary.totalOutstanding)}</b>`,
    `• Customers with Dues: <b>${dues.summary.customerCountWithDues}</b>`,
    ``,
    `<b>Top Pending Accounts:</b>`,
  ];

  dues.customers.slice(0, 10).forEach((c, idx) => {
    lines.push(`${idx + 1}. <b>${c.name}</b> — <b>${fmtINR(c.outstanding)}</b> ${c.phone ? `(${c.phone})` : ''}`);
  });

  return sendTelegramRawMessage(
    lines.join('\n'),
    { parseMode: 'HTML', shopId },
    client,
    { eventType: 'CUSTOMER_DUES', userId: actorId, shopId },
  );
};

/**
 * 8. Supplier Dues Summary Message
 */
export const sendSupplierDuesSummary = async (client?: DbClient, actorId?: string, shopId = 'default-shop-pharmora'): Promise<SendResult> => {
  const config = await getTelegramConfig(client, shopId);
  if (!config.preferences.supplierDues) {
    return { success: false, error: 'Supplier dues notifications are turned off' };
  }

  const dues = await getSupplierOutstandingReport(client, shopId);
  if (dues.suppliers.length === 0) {
    return { success: false, error: 'No supplier payables currently' };
  }

  const lines = [
    `🏢 <b>SUPPLIER OUTSTANDING PAYABLES SUMMARY</b>`,
    ``,
    `• Total Payable: <b>${fmtINR(dues.summary.totalPayable)}</b>`,
    `• Suppliers Due: <b>${dues.summary.supplierCountWithDues}</b>`,
    ``,
    `<b>Top Payables:</b>`,
  ];

  dues.suppliers.slice(0, 10).forEach((s, idx) => {
    lines.push(`${idx + 1}. <b>${s.name}</b> — <b>${fmtINR(s.outstanding)}</b>`);
  });

  return sendTelegramRawMessage(
    lines.join('\n'),
    { parseMode: 'HTML', shopId },
    client,
    { eventType: 'SUPPLIER_DUES', userId: actorId, shopId },
  );
};

/**
 * 9. Monthly Summary Message
 */
export const sendMonthlySummary = async (yearInput?: number, monthInput?: number, client?: DbClient, actorId?: string, shopId = 'default-shop-pharmora'): Promise<SendResult> => {
  const config = await getTelegramConfig(client, shopId);
  if (!config.preferences.monthlySummary) {
    return { success: false, error: 'Monthly summary notifications are turned off' };
  }

  const now = new Date();
  const year = yearInput ?? now.getUTCFullYear();
  const month = monthInput ?? now.getUTCMonth() + 1;

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const [sales, purchase, expense, profit, target, gst] = await Promise.all([
    getSalesReport({ preset: 'CUSTOM', startDate: startOfMonth, endDate: endOfMonth }, client, shopId),
    getPurchaseReport({ preset: 'CUSTOM', startDate: startOfMonth, endDate: endOfMonth }, client, shopId),
    getExpenseReport({ preset: 'CUSTOM', startDate: startOfMonth, endDate: endOfMonth }, client, shopId),
    getProfitReport({ preset: 'CUSTOM', startDate: startOfMonth, endDate: endOfMonth }, client, shopId),
    getMonthlySalesTarget(client, shopId),
    getGstReport({ preset: 'CUSTOM', startDate: startOfMonth, endDate: endOfMonth }, client, shopId),
  ]);

  const monthName = startOfMonth.toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  const lines = [
    `📈 <b>PHARMORA POS — MONTHLY BUSINESS SUMMARY</b>`,
    `🗓 <b>${monthName}</b>`,
    ``,
    `💰 <b>SALES & REVENUE</b>`,
    `• Net Sales: <b>${fmtINR(sales.summary.netSales)}</b>`,
    `• Cost of Goods Sold: ${fmtINR(profit.summary.cogs.totalCogs)}`,
    `• Gross Profit: <b>${fmtINR(profit.summary.grossProfit)} (${profit.summary.grossMarginPercentage}%)</b>`,
    `• Net Profit: <b>${fmtINR(profit.summary.netProfit)} (${profit.summary.netMarginPercentage}%)</b>`,
    ``,
    `📦 <b>PURCHASES & EXPENSES</b>`,
    `• Total Purchases: ${fmtINR(purchase.summary.netPurchases)}`,
    `• Operating Expenses: ${fmtINR(expense.summary.totalExpenses)}`,
    ``,
    `⚖️ <b>GST POSITION</b>`,
    `• Net GST Position: <b>${fmtINR(gst.summary.netGstPayable)}</b>`,
    ``,
    `🎯 <b>SALES TARGET STATUS</b>`,
    `• Target: ${fmtINR(target.target)}`,
    `• Achieved: ${fmtINR(target.completedSales)} (${target.progressPercentage}%)`,
    target.remainingSales === 0 ? `🎉 <b>Monthly Target Achieved!</b>` : `• Shortfall: ${fmtINR(target.remainingSales)}`,
  ];

  return sendTelegramRawMessage(
    lines.join('\n'),
    { parseMode: 'HTML', shopId },
    client,
    { eventType: 'MONTHLY_SUMMARY', userId: actorId, shopId },
  );
};

export const sendPurchaseSummary = sendPurchaseNotification;
export const sendCustomerDueSummary = sendCustomerDuesSummary;
export const sendSupplierDueSummary = sendSupplierDuesSummary;

export const testTelegramConnection = async (client?: DbClient, actorId?: string, shopId = 'default-shop-pharmora'): Promise<SendResult> => {
  return sendTelegramRawMessage(
    '🔔 <b>Test Notification from Pharmora POS</b>\n\nYour Telegram bot integration is working successfully!',
    { parseMode: 'HTML', force: true, shopId },
    client,
    { eventType: 'TEST_CONNECTION', userId: actorId, shopId },
  );
};

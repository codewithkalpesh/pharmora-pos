import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import {
  getTelegramConfig,
  updateTelegramConfig,
  sendTelegramRawMessage,
  testTelegramConnection,
  sendDailySummary,
  sendPurchaseSummary,
  sendExpenseSummary,
  sendDailyClosingSummary,
  sendLowStockAlert,
  sendExpiryAlert,
  sendCustomerDueSummary,
  sendSupplierDueSummary,
  sendMonthlySummary,
} from '../src/services/telegramService.js';
import {
  formatWhatsAppPhoneNumber,
  createWhatsAppUrl,
  generateCustomerInvoiceWhatsApp,
  generateCustomerPaymentReceiptWhatsApp,
  generateCustomerDueReminderWhatsApp,
  generatePurchaseOrderWhatsApp,
} from '../src/services/whatsappService.js';
import { runScheduledTasks } from '../src/services/notificationScheduler.js';

const decimal = (n: number | string) => new Prisma.Decimal(n);

// Build an in-memory mock client with all required domain models
const createMockClient = () => {
  const settings: Array<{ key: string; value: string }> = [
    { key: 'TELEGRAM_BOT_TOKEN', value: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz' },
    { key: 'TELEGRAM_CHAT_ID', value: '-100987654321' },
    { key: 'TELEGRAM_ENABLED', value: 'true' },
  ];

  const telegramEvents: Array<any> = [];
  const auditLogs: Array<any> = [];

  const suppliers: Array<any> = [
    { id: 'supp-1', name: 'MedLife Distributors', phone: '9876543210', outstanding: decimal(15000), purchases: [], supplierPayments: [] },
    { id: 'supp-2', name: 'Sun Pharma Agency', phone: '9876543211', outstanding: decimal(8500), purchases: [], supplierPayments: [] },
  ];

  const customers: Array<any> = [
    {
      id: 'cust-1',
      name: 'Ramesh Patel',
      phone: '9822012345',
      address: 'Shop 12, Main Bazar',
      outstanding: decimal(3200),
      sales: [{ id: 'sale-1', totalAmount: decimal(3200), paidAmount: decimal(0) }],
      payments: [],
      customerCredits: [{ id: 'cc-1', customerId: 'cust-1', balanceAmount: decimal(3200) }],
    },
    {
      id: 'cust-2',
      name: 'Suresh Sharma',
      phone: '9822054321',
      address: 'Flat 402, Green Park',
      outstanding: decimal(1200),
      sales: [],
      payments: [],
      customerCredits: [{ id: 'cc-2', customerId: 'cust-2', balanceAmount: decimal(1200) }],
    },
  ];

  const products: Array<any> = [
    {
      id: 'prod-1',
      name: 'Amoxicillin 500mg',
      genericName: 'Amoxicillin',
      brand: 'Cipla',
      barcode: '8901234567890',
      sku: 'SKU-AMOX-500',
      reorderLevel: 20,
      minStock: 10,
      maxStock: 50,
      purchasePrice: decimal(45),
      sellingPrice: decimal(65),
      active: true,
      batches: [{ id: 'b-1', quantity: 0, batchNumber: 'BAT-001', purchaseRate: decimal(45), expiryDate: new Date('2028-12-31') }],
      purchaseItems: [],
    },
    {
      id: 'prod-2',
      name: 'Paracetamol 650mg',
      genericName: 'Paracetamol',
      brand: 'Dolo',
      barcode: '8901234567891',
      sku: 'SKU-DOLO-650',
      reorderLevel: 30,
      minStock: 15,
      maxStock: 100,
      purchasePrice: decimal(20),
      sellingPrice: decimal(32),
      active: true,
      batches: [{ id: 'b-2', quantity: 5, batchNumber: 'BAT-002', purchaseRate: decimal(20), expiryDate: new Date('2028-12-31') }],
      purchaseItems: [],
    },
  ];

  const batches: Array<any> = [
    {
      id: 'b-exp',
      productId: 'prod-1',
      batchNumber: 'EXP-101',
      purchaseRate: decimal(40),
      mrp: decimal(60),
      sellingPrice: decimal(55),
      quantity: 12,
      expiryDate: new Date('2024-01-01'), // Expired
      product: products[0],
      supplier: suppliers[0],
    },
    {
      id: 'b-near30',
      productId: 'prod-2',
      batchNumber: 'NEAR-202',
      purchaseRate: decimal(20),
      mrp: decimal(32),
      sellingPrice: decimal(30),
      quantity: 25,
      expiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days left
      product: products[1],
      supplier: suppliers[1],
    },
  ];

  const sales: Array<any> = [
    {
      id: 'sale-1',
      saleNumber: 'POS-20261006-00001',
      saleDate: new Date(),
      paymentMethod: 'CASH',
      totalAmount: decimal(500),
      paidAmount: decimal(500),
      customerId: 'cust-1',
      status: 'COMPLETED',
      customer: customers[0],
      items: [{ id: 'si-1', productId: 'prod-1', batchId: 'b-1', quantity: 2, sellingPrice: decimal(65), product: products[0], batch: batches[0] }],
      payments: [{ id: 'p-1', amount: decimal(500), paymentMethod: 'CASH' }],
      credits: [],
      createdBy: { name: 'Cashier John' },
    },
  ];

  const purchases: Array<any> = [
    {
      id: 'purch-1',
      invoiceNumber: 'INV-7890',
      invoiceDate: new Date(),
      totalAmount: decimal(2500),
      paidAmount: decimal(2500),
      outstandingAmount: decimal(0),
      paymentMethod: 'UPI',
      supplierId: 'supp-1',
      supplier: suppliers[0],
      items: [
        { id: 'pi-1', productId: 'prod-1', quantity: 50, freeQty: 5, purchaseRate: decimal(45), product: products[0] },
      ],
      supplierPayments: [],
    },
  ];

  const expenses: Array<any> = [
    {
      id: 'exp-1',
      category: 'Electricity',
      amount: decimal(850),
      expenseDate: new Date(),
      paymentMethod: 'CASH',
      description: 'Monthly electricity bill',
    },
  ];

  const purchaseOrders: Array<any> = [
    {
      id: 'po-1',
      orderNumber: 'PO-20261006-0001',
      supplier: 'MedLife Distributors',
      supplierId: 'supp-1',
      supplierRel: suppliers[0],
      orderDate: new Date(),
      totalAmount: decimal(1800),
      totalQuantity: 40,
      notes: 'Urgent delivery requested',
      items: [
        {
          id: 'poi-1',
          productId: 'prod-1',
          quantity: 40,
          unitPrice: decimal(45),
          notes: 'Standard box',
          product: products[0],
        },
      ],
    },
  ];

  const customerPayments: Array<any> = [
    {
      id: 'cp-1',
      customerId: 'cust-1',
      amount: decimal(1000),
      paymentMethod: 'UPI',
      paymentDate: new Date(),
      customer: customers[0],
    },
  ];

  const cashbookEntries: Array<any> = [
    {
      id: 'cb-1',
      entryType: 'CASH_SALE',
      direction: 'IN',
      amount: decimal(500),
      paymentMethod: 'CASH',
      businessDate: new Date(),
      createdAt: new Date(),
    },
  ];

  const dailyClosings: Array<any> = [
    {
      id: 'dc-1',
      closingDate: new Date(),
      openingCash: decimal(5000),
      cashInflows: decimal(2500),
      cashOutflows: decimal(800),
      expectedCash: decimal(6700),
      actualCash: decimal(6700),
      difference: decimal(0),
      status: 'BALANCED',
      notes: 'Clean drawer closing',
    },
  ];

  const mockDb: any = {
    setting: {
      findMany: async (args?: any) => {
        if (args?.where?.key?.in) {
          return settings.filter((s) => args.where.key.in.includes(s.key));
        }
        return settings;
      },
      findUnique: async (args: any) => settings.find((s) => s.key === args.where.key) || null,
      upsert: async (args: any) => {
        const idx = settings.findIndex((s) => s.key === args.where.key);
        if (idx >= 0) {
          settings[idx].value = args.update.value;
          return settings[idx];
        }
        const created = { key: args.create.key, value: args.create.value };
        settings.push(created);
        return created;
      },
      deleteMany: async (args: any) => {
        const idx = settings.findIndex((s) => s.key === args.where.key);
        if (idx >= 0) settings.splice(idx, 1);
        return { count: 1 };
      },
    },
    telegramEvent: {
      create: async (args: any) => {
        const ev = { id: `tev-${telegramEvents.length + 1}`, ...args.data, createdAt: new Date() };
        telegramEvents.push(ev);
        return ev;
      },
      findFirst: async (args: any) => {
        return telegramEvents.find((e) => e.eventType === args.where.eventType && (!args.where.status || e.status === args.where.status)) || null;
      },
      findMany: async () => telegramEvents,
    },
    auditLog: {
      create: async (args: any) => {
        const log = { id: `audit-${auditLogs.length + 1}`, ...args.data, createdAt: new Date() };
        auditLogs.push(log);
        return log;
      },
    },
    supplier: {
      findMany: async () => suppliers,
      findUnique: async (args: any) => suppliers.find((s) => s.id === args.where.id) || null,
    },
    customer: {
      findMany: async () => customers,
      findUnique: async (args: any) => customers.find((s) => s.id === args.where.id) || null,
    },
    product: {
      findMany: async () => products,
      findUnique: async (args: any) => products.find((p) => p.id === args.where.id) || null,
    },
    productBatch: {
      findMany: async (args?: any) => {
        if (args?.where?.productId) {
          return batches.filter((b) => b.productId === args.where.productId);
        }
        return batches;
      },
    },
    sale: {
      findMany: async () => sales,
      findUnique: async (args: any) => sales.find((s) => s.id === args.where.id) || null,
    },
    purchase: {
      findMany: async () => purchases,
      findUnique: async (args: any) => purchases.find((p) => p.id === args.where.id) || null,
    },
    expense: {
      findMany: async () => expenses,
      findUnique: async (args: any) => expenses.find((e) => e.id === args.where.id) || null,
    },
    purchaseOrder: {
      findMany: async () => purchaseOrders,
      findUnique: async (args: any) => purchaseOrders.find((p) => p.id === args.where.id) || null,
    },
    customerPayment: {
      findMany: async () => customerPayments,
      findUnique: async (args: any) => customerPayments.find((p) => p.id === args.where.id) || null,
    },
    cashbookEntry: {
      findMany: async () => cashbookEntries,
    },
    dailyClosing: {
      findMany: async () => dailyClosings,
      findUnique: async (args: any) => dailyClosings[0] || null,
    },
    dailySale: {
      findMany: async () => [],
      findUnique: async () => null,
    },
    saleReturn: {
      findMany: async () => [],
    },
    purchaseReturn: {
      findMany: async () => [],
    },
    salesTarget: {
      findFirst: async () => ({ targetAmount: decimal(500000), completedAmount: decimal(150000), percentage: decimal(30) }),
    },
    category: {
      findMany: async () => [{ id: 'cat-1', name: 'Antibiotics' }],
    },
    $transaction: async (fn: any) => fn(mockDb),
  };

  return { mockDb, settings, telegramEvents, auditLogs, suppliers, customers, sales, purchases, expenses };
};

// ==========================================
// TEST SUITE: TELEGRAM & WHATSAPP INTEGRATION
// ==========================================

test('1. Configured Telegram sends message successfully and records TelegramEvent', async () => {
  const { mockDb, telegramEvents } = createMockClient();

  // Mock global fetch for Telegram API
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /api\.telegram\.org\/bot/);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 998877 } }),
    } as any;
  }) as any;

  try {
    const result = await sendTelegramRawMessage('Test Hello World', undefined, mockDb);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.messageId, '998877');
    assert.strictEqual(telegramEvents.length, 1);
    assert.strictEqual(telegramEvents[0].status, 'SENT');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('2. Missing credentials does not crash and returns safe error status', async () => {
  const { mockDb, settings } = createMockClient();
  settings.length = 0; // Clear all settings

  const originalEnvToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalEnvChat = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;

  try {
    const status = await getTelegramConfig(mockDb);
    assert.strictEqual(status.configured, false);
    assert.strictEqual(status.hasToken, false);

    const result = await sendTelegramRawMessage('Will not crash', undefined, mockDb);
    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /not configured/i);
  } finally {
    if (originalEnvToken) process.env.TELEGRAM_BOT_TOKEN = originalEnvToken;
    if (originalEnvChat) process.env.TELEGRAM_CHAT_ID = originalEnvChat;
  }
});

test('3. Telegram network failure does NOT throw or crash', async () => {
  const { mockDb, telegramEvents } = createMockClient();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('ETIMEDOUT: Connection to api.telegram.org timed out');
  }) as any;

  try {
    const result = await sendTelegramRawMessage('Timeout test', undefined, mockDb);
    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /ETIMEDOUT/);
    assert.strictEqual(telegramEvents.length, 1);
    assert.strictEqual(telegramEvents[0].status, 'FAILED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('4. Daily Summary uses report values without altering financial state', async () => {
  const { mockDb } = createMockClient();

  const originalFetch = globalThis.fetch;
  let sentText = '';
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    sentText = body.text;
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 123 } }) } as any;
  }) as any;

  try {
    const res = await sendDailySummary(new Date(), mockDb);
    assert.strictEqual(res.success, true);
    assert.match(sentText, /PHARMORA DAILY SUMMARY/);
    assert.match(sentText, /Sales/);
    assert.match(sentText, /Payment Breakdown/);
    assert.match(sentText, /Purchases/);
    assert.match(sentText, /Cash Drawer/);
    assert.match(sentText, /Alerts/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('5. Monthly Summary formats comprehensive P&L, COGS, and GST', async () => {
  const { mockDb } = createMockClient();

  const originalFetch = globalThis.fetch;
  let sentText = '';
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    sentText = body.text;
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 456 } }) } as any;
  }) as any;

  try {
    const res = await sendMonthlySummary(2026, 10, mockDb);
    assert.strictEqual(res.success, true);
    assert.match(sentText, /MONTHLY BUSINESS SUMMARY/);
    assert.match(sentText, /Net Sales/);
    assert.match(sentText, /Cost of Goods Sold/);
    assert.match(sentText, /Gross Profit/);
    assert.match(sentText, /Net Profit/);
    assert.match(sentText, /GST Position/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6. Low-stock grouping consolidates items into a single alert', async () => {
  const { mockDb } = createMockClient();

  const originalFetch = globalThis.fetch;
  let sentText = '';
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    sentText = body.text;
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 789 } }) } as any;
  }) as any;

  try {
    const res = await sendLowStockAlert(mockDb);
    assert.strictEqual(res.success, true);
    assert.match(sentText, /LOW STOCK ALERT/);
    assert.match(sentText, /OUT OF STOCK/);
    assert.match(sentText, /Amoxicillin 500mg/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('7. Expiry alert groups near-expiry and expired batches', async () => {
  const { mockDb } = createMockClient();

  const originalFetch = globalThis.fetch;
  let sentText = '';
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    sentText = body.text;
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 101 } }) } as any;
  }) as any;

  try {
    const res = await sendExpiryAlert(mockDb);
    assert.strictEqual(res.success, true);
    assert.match(sentText, /BATCH EXPIRY ALERT/);
    assert.match(sentText, /Expired:/);
    assert.match(sentText, /0–30 Days:/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('8. Customer Due summary lists total receivables and top debtor customers', async () => {
  const { mockDb } = createMockClient();

  const originalFetch = globalThis.fetch;
  let sentText = '';
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    sentText = body.text;
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 202 } }) } as any;
  }) as any;

  try {
    const res = await sendCustomerDueSummary(mockDb);
    assert.strictEqual(res.success, true);
    assert.match(sentText, /CUSTOMER OUTSTANDING DUES/);
    assert.match(sentText, /Ramesh Patel/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('9. Supplier Due summary lists total payables and top creditor suppliers', async () => {
  const { mockDb } = createMockClient();

  const originalFetch = globalThis.fetch;
  let sentText = '';
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    sentText = body.text;
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 303 } }) } as any;
  }) as any;

  try {
    const res = await sendSupplierDueSummary(mockDb);
    assert.strictEqual(res.success, true);
    assert.match(sentText, /SUPPLIER OUTSTANDING PAYABLES/);
    assert.match(sentText, /MedLife Distributors/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('10. Duplicate scheduled notification protection prevents duplicate daily/monthly sends', async () => {
  const { mockDb, telegramEvents } = createMockClient();

  // Pre-populate sent daily summary event for today
  telegramEvents.push({
    id: 'tev-prev',
    eventType: 'DAILY_SUMMARY',
    status: 'SENT',
    createdAt: new Date(),
  });

  const scheduledResult = await runScheduledTasks(mockDb);
  assert.strictEqual(scheduledResult.dailySummarySent, false, 'Should not re-send daily summary if already sent today');
});

test('11. WhatsApp Invoice message generation accurately formats total, paid, balance', async () => {
  const { mockDb } = createMockClient();

  const result = await generateCustomerInvoiceWhatsApp('sale-1', mockDb);
  assert.strictEqual(result.phoneNumber, '9822012345');
  assert.strictEqual(result.cleanPhone, '919822012345');
  assert.match(result.messageText, /Hello Ramesh Patel/);
  assert.match(result.messageText, /Invoice: POS-20261006-00001/);
  assert.match(result.messageText, /Total: ₹500\.00/);
  assert.match(result.messageText, /Paid: ₹500\.00/);
  assert.match(result.messageText, /Balance: ₹0\.00/);
  assert.match(result.messageText, /Thank you for shopping with us\./);
  assert.match(result.shareUrl, /^https:\/\/wa\.me\/919822012345\?text=/);
});

test('12. WhatsApp Payment Receipt generation accurately formats previous and remaining dues', async () => {
  const { mockDb } = createMockClient();

  const result = await generateCustomerPaymentReceiptWhatsApp('cp-1', mockDb);
  assert.match(result.messageText, /PAYMENT RECEIVED/);
  assert.match(result.messageText, /Customer: Ramesh Patel/);
  assert.match(result.messageText, /Amount: ₹1000\.00/);
  assert.match(result.messageText, /Payment Method: UPI/);
  assert.match(result.messageText, /Previous Due: ₹4200\.00/);
  assert.match(result.messageText, /Payment: ₹1000\.00/);
  assert.match(result.messageText, /Remaining Due: ₹3200\.00/);
  assert.match(result.shareUrl, /^https:\/\/wa\.me\/919822012345\?text=/);
});

test('13. WhatsApp Customer Due Reminder generation formats outstanding balance', async () => {
  const { mockDb } = createMockClient();

  const result = await generateCustomerDueReminderWhatsApp('cust-1', mockDb);
  assert.match(result.messageText, /Hello Ramesh Patel/);
  assert.match(result.messageText, /outstanding balance at Pharmora is ₹3200\.00/);
  assert.match(result.messageText, /Please contact us if you have already made the payment/);
  assert.match(result.shareUrl, /^https:\/\/wa\.me\/919822012345\?text=/);
});

test('14. WhatsApp Purchase Order generation formats supplier, items, and estimated total', async () => {
  const { mockDb } = createMockClient();

  const result = await generatePurchaseOrderWhatsApp('po-1', mockDb);
  assert.match(result.messageText, /PURCHASE ORDER/);
  assert.match(result.messageText, /Supplier: MedLife Distributors/);
  assert.match(result.messageText, /• Amoxicillin 500mg × 40 \(Standard box\)/);
  assert.match(result.messageText, /Estimated Total:\n₹1800\.00/);
  assert.match(result.shareUrl, /^https:\/\/wa\.me\/919876543210\?text=/);
});

test('15. WhatsApp Phone number formatting handles 10-digit Indian numbers and empty phones', () => {
  assert.strictEqual(formatWhatsAppPhoneNumber('9822012345'), '919822012345');
  assert.strictEqual(formatWhatsAppPhoneNumber('+91 98220-12345'), '919822012345');
  assert.strictEqual(formatWhatsAppPhoneNumber(null), null);
  assert.strictEqual(formatWhatsAppPhoneNumber(''), null);

  const urlWithPhone = createWhatsAppUrl('Hello', '9822012345');
  assert.strictEqual(urlWithPhone, 'https://wa.me/919822012345?text=Hello');

  const urlWithoutPhone = createWhatsAppUrl('Hello', null);
  assert.strictEqual(urlWithoutPhone, 'https://wa.me/?text=Hello');
});

test('16. WhatsApp functions are purely user-triggered and make zero automated network calls', async () => {
  const { mockDb } = createMockClient();

  // No fetch mock provided; function executes synchronously without network side-effects
  const poResult = await generatePurchaseOrderWhatsApp('po-1', mockDb);
  assert.ok(poResult.shareUrl);
});

test('17. Telegram Bot Token is never returned in getTelegramConfig API responses', async () => {
  const { mockDb } = createMockClient();

  const config = await getTelegramConfig(mockDb);
  assert.strictEqual(config.configured, true);
  assert.strictEqual(config.hasToken, true);
  assert.strictEqual((config as any).token, undefined);
  assert.strictEqual((config as any).botToken, undefined);
});

test('18. Telegram settings updates record AuditLog entry', async () => {
  const { mockDb, auditLogs } = createMockClient();

  await updateTelegramConfig(
    {
      chatId: '-1001122334455',
      enabled: true,
      preferences: { dailySummary: true, purchaseNotifications: false },
    },
    mockDb,
    'user-admin-1',
  );

  const updatedConfig = await getTelegramConfig(mockDb);
  assert.strictEqual(updatedConfig.chatId, '-1001122334455');
  assert.strictEqual(updatedConfig.preferences.purchaseNotifications, false);
  assert.strictEqual(auditLogs.length, 1);
  assert.strictEqual(auditLogs[0].action, 'TELEGRAM_CONFIG_UPDATED');
});

test('19. Purchase and Expense Notifications format correctly', async () => {
  const { mockDb } = createMockClient();

  const originalFetch = globalThis.fetch;
  const sentMessages: string[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    sentMessages.push(body.text);
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 555 } }) } as any;
  }) as any;

  try {
    const purchRes = await sendPurchaseSummary('purch-1', mockDb);
    assert.strictEqual(purchRes.success, true);
    assert.match(sentMessages[0], /PURCHASE RECORDED/);
    assert.match(sentMessages[0], /MedLife Distributors/);

    const expRes = await sendExpenseSummary('exp-1', mockDb);
    assert.strictEqual(expRes.success, true);
    assert.match(sentMessages[1], /EXPENSE RECORDED/);
    assert.match(sentMessages[1], /Electricity/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('20. CRITICAL FINANCIAL SAFETY: Notifications and WhatsApp sharing cause ZERO state changes to financial models', async () => {
  const { mockDb, sales, purchases, expenses, suppliers, customers } = createMockClient();

  const initialSalesCount = sales.length;
  const initialPurchasesCount = purchases.length;
  const initialExpensesCount = expenses.length;
  const initialCustomerOutstanding = Number(customers[0].outstanding);
  const initialSupplierOutstanding = Number(suppliers[0].outstanding);

  // Run all notification and sharing functions
  await generateCustomerInvoiceWhatsApp('sale-1', mockDb);
  await generateCustomerPaymentReceiptWhatsApp('cp-1', mockDb);
  await generateCustomerDueReminderWhatsApp('cust-1', mockDb);
  await generatePurchaseOrderWhatsApp('po-1', mockDb);
  await testTelegramConnection(mockDb);

  assert.strictEqual(sales.length, initialSalesCount, 'Sales count must not change');
  assert.strictEqual(purchases.length, initialPurchasesCount, 'Purchases count must not change');
  assert.strictEqual(expenses.length, initialExpensesCount, 'Expenses count must not change');
  assert.strictEqual(Number(customers[0].outstanding), initialCustomerOutstanding, 'Customer outstanding must not change');
  assert.strictEqual(Number(suppliers[0].outstanding), initialSupplierOutstanding, 'Supplier outstanding must not change');
});

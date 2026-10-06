import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import test from 'node:test';
import {
  getTelegramConfig,
  updateTelegramConfig,
  sendDailySummary,
  sendPurchaseSummary,
  sendExpenseSummary,
  sendDailyClosingSummary,
  sendLowStockAlert,
  sendExpiryAlert,
  sendCustomerDueSummary,
  sendSupplierDueSummary,
  sendMonthlySummary,
} from '../../src/services/telegramService.js';
import {
  generateCustomerInvoiceWhatsApp,
  generateCustomerPaymentReceiptWhatsApp,
  generateCustomerDueReminderWhatsApp,
  generatePurchaseOrderWhatsApp,
} from '../../src/services/whatsappService.js';
import { createSale } from '../../src/services/saleService.js';
import { createProduct } from '../../src/services/productService.js';
import { createBatch } from '../../src/services/batchService.js';
import { createSupplier } from '../../src/services/supplierService.js';
import { createCustomer } from '../../src/services/customerService.js';
import { createPurchase } from '../../src/services/purchaseService.js';
import { createExpense } from '../../src/services/expenseService.js';
import { createPurchaseOrder } from '../../src/services/purchaseOrderService.js';
import { recordCustomerPayment } from '../../src/services/paymentService.js';
import { applyStockMovement } from '../../src/services/stockService.js';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), override: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Integration tests require server/.env DATABASE_URL');

const target = new URL(connectionString);
const databaseName = target.pathname.replace(/^\//, '').split('?')[0];
if (!target.hostname.endsWith('.neon.tech') || databaseName !== 'pharmora_pos_dev') {
  throw new Error('Integration tests are restricted to the verified Neon pharmora_pos_dev database');
}

const prisma = new PrismaClient();
class RollbackRequested extends Error {}

test('Live Neon DB: Phase 11 Telegram Notifications, WhatsApp Sharing, and Financial Safety with clean transactional rollback', async () => {
  const marker = randomUUID().slice(0, 8);

  // Mock global fetch to safely emulate Telegram Bot API response during integration run
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, _init: any) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 887766 } }),
    } as any;
  }) as any;

  try {
    await prisma.$connect();

    await prisma.$transaction(
      async (tx) => {
        // 1. Setup Role and User
        let role = await tx.role.findFirst({ where: { name: 'OWNER' } });
        if (!role) {
          role = await tx.role.create({ data: { name: 'OWNER' } });
        }

        const user = await tx.user.create({
          data: {
            name: `Phase11 Tester ${marker}`,
            email: `p11-${marker}@example.com`,
            password: 'hashedpassword',
            roleId: role.id,
          },
        });

        // 2. Setup Supplier and Customer
        const supplier = await createSupplier(
          {
            name: `Apollo Pharma ${marker}`,
            phone: '9876543210',
            gstin: '27AAAAA0000A1Z5',
          },
          tx as any,
          user.id,
        );

        const customer = await createCustomer(
          {
            name: `Aakash Gupta ${marker}`,
            phone: '9123456789',
            address: 'Shop 5, Sector 9',
          },
          tx as any,
        );

        // 3. Setup Product & Batch
        const product = await createProduct(
          {
            name: `Cough Syrup 100ml ${marker}`,
            genericName: 'Dextromethorphan',
            brand: 'Benadryl',
            barcode: `BAR-P11-${marker}`,
            sku: `SKU-P11-${marker}`,
            mrp: 120,
            sellingPrice: 110,
            purchasePrice: 70,
            gst: 18,
            reorderLevel: 20,
            maxStock: 80,
            supplierId: supplier.id,
          },
          tx as any,
          user.id,
        );

        const batch = await createBatch(
          {
            productId: product.id,
            batchNumber: `BAT-P11-${marker}`,
            purchaseRate: 70,
            sellingPrice: 110,
            mrp: 120,
            gst: 18,
            expiryDate: new Date('2028-10-15'),
            supplierId: supplier.id,
          },
          tx as any,
          user.id,
        );

        await applyStockMovement(tx, {
          productId: product.id,
          batchId: batch.id,
          quantity: 50,
          movementType: 'OPENING_STOCK',
          reason: 'Initial test stock setup',
          idempotencyKey: `stock-p11-${marker}`,
          createdById: user.id,
        });

        // 4. Create POS Sale (5 units @ 110 on Credit)
        const sale = await createSale(
          {
            customerId: customer.id,
            saleDate: new Date(),
            paymentMethod: 'CREDIT',
            items: [
              {
                productId: product.id,
                batchId: batch.id,
                quantity: 5,
                sellingPrice: 110,
                gst: 18,
              },
            ],
          },
          `sale-p11-${marker}`,
          tx as any,
        );

        // 5. Customer Payment (₹200 in Cash)
        const customerPayment = await recordCustomerPayment(
          {
            customerId: customer.id,
            amount: 200,
            paymentMethod: 'CASH',
            notes: 'Partial payment',
            createdById: user.id,
          },
          `cpay-p11-${marker}`,
          tx as any,
        );

        // 6. Create Purchase (10 units @ 70 paid in UPI)
        const purchase = await createPurchase(
          {
            supplierId: supplier.id,
            invoiceNumber: `INV-P11-${marker}`,
            invoiceDate: new Date(),
            paymentMethod: 'UPI',
            paidAmount: 700,
            items: [
              {
                productId: product.id,
                batchNumber: `BAT-PUR-P11-${marker}`,
                quantity: 10,
                freeQty: 0,
                purchaseRate: 70,
                sellingPrice: 110,
                mrp: 120,
                gst: 18,
                expiryDate: new Date('2028-08-30'),
              },
            ],
            createdById: user.id,
          },
          `purchase-p11-${marker}`,
          tx as any,
        );

        // 7. Create Expense (₹150 in Cash)
        const expense = await createExpense(
          {
            category: 'Stationery',
            amount: 150,
            paymentMethod: 'CASH',
            expenseDate: new Date(),
            description: 'Thermal billing paper rolls',
            createdById: user.id,
          },
          `expense-p11-${marker}`,
          tx as any,
        );

        // 8. Create Purchase Order (20 units @ 70)
        const purchaseOrder = await createPurchaseOrder(
          {
            supplierId: supplier.id,
            supplier: supplier.name,
            notes: 'Restock order',
            items: [
              {
                productId: product.id,
                quantity: 20,
                unitPrice: 70,
                notes: 'Urgent',
              },
            ],
          },
          `po-p11-${marker}`,
          tx as any,
          user.id,
        );

        // Record Pre-Notification Financial Baseline
        const beforeSalesCount = await tx.sale.count();
        const beforePurchasesCount = await tx.purchase.count();
        const beforeExpensesCount = await tx.expense.count();
        const beforeCashbookCount = await tx.cashbookEntry.count();
        const beforeCustomer = await tx.customer.findUnique({ where: { id: customer.id } });
        const beforeSupplier = await tx.supplier.findUnique({ where: { id: supplier.id } });
        const beforeBatch = await tx.productBatch.findUnique({ where: { id: batch.id } });

        // 9. TEST WHATSAPP SHARING FORMATTERS
        const waInvoice = await generateCustomerInvoiceWhatsApp(sale.id, tx as any);
        assert.strictEqual(waInvoice.phoneNumber, '9123456789');
        assert.match(waInvoice.messageText, /Hello Aakash Gupta/);
        assert.match(waInvoice.messageText, /Invoice:/);
        assert.match(waInvoice.shareUrl, /^https:\/\/wa\.me\/919123456789\?text=/);

        const waReceipt = await generateCustomerPaymentReceiptWhatsApp(customerPayment.id, tx as any);
        assert.match(waReceipt.messageText, /PAYMENT RECEIVED/);
        assert.match(waReceipt.messageText, /Amount: ₹200\.00/);

        const waDue = await generateCustomerDueReminderWhatsApp(customer.id, tx as any);
        assert.match(waDue.messageText, /outstanding balance at Pharmora/);

        const waPO = await generatePurchaseOrderWhatsApp(purchaseOrder.id, tx as any);
        assert.match(waPO.messageText, /PURCHASE ORDER/);
        assert.match(waPO.messageText, /Apollo Pharma/);

        // 10. TEST TELEGRAM CONFIGURATION
        await updateTelegramConfig(
          {
            botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
            chatId: '-10099887766',
            enabled: true,
            preferences: { dailySummary: true, purchaseNotifications: true },
          },
          tx as any,
          user.id,
        );

        const config = await getTelegramConfig(tx as any);
        assert.strictEqual(config.configured, true);
        assert.strictEqual(config.enabled, true);
        assert.strictEqual((config as any).botToken, undefined, 'Bot token must never be exposed');

        // 11. TEST TELEGRAM ALERTS & SUMMARIES
        const dailyRes = await sendDailySummary(new Date(), tx as any, user.id);
        assert.strictEqual(dailyRes.success, true);
        assert.match(dailyRes.formattedMessage || '', /PHARMORA DAILY SUMMARY/);

        const purchRes = await sendPurchaseSummary(purchase.id, tx as any, user.id);
        assert.strictEqual(purchRes.success, true);
        assert.match(purchRes.formattedMessage || '', /PURCHASE RECORDED/);

        const expRes = await sendExpenseSummary(expense.id, tx as any, user.id);
        assert.strictEqual(expRes.success, true);
        assert.match(expRes.formattedMessage || '', /EXPENSE RECORDED/);

        const lowStockRes = await sendLowStockAlert(tx as any, user.id);
        assert.strictEqual(lowStockRes.success, true);

        const expiryRes = await sendExpiryAlert(tx as any, user.id);
        assert.strictEqual(expiryRes.success, true);

        const custDuesRes = await sendCustomerDueSummary(tx as any, user.id);
        assert.strictEqual(custDuesRes.success, true);

        const suppDuesRes = await sendSupplierDueSummary(tx as any, user.id);
        assert.strictEqual(suppDuesRes.success, true);

        const monthlyRes = await sendMonthlySummary(2026, 10, tx as any, user.id);
        assert.strictEqual(monthlyRes.success, true);
        assert.match(monthlyRes.formattedMessage || '', /MONTHLY BUSINESS SUMMARY/);

        // 12. CRITICAL FINANCIAL SAFETY VERIFICATION: ZERO STATE MUTATIONS
        const afterSalesCount = await tx.sale.count();
        const afterPurchasesCount = await tx.purchase.count();
        const afterExpensesCount = await tx.expense.count();
        const afterCashbookCount = await tx.cashbookEntry.count();
        const afterCustomer = await tx.customer.findUnique({ where: { id: customer.id } });
        const afterSupplier = await tx.supplier.findUnique({ where: { id: supplier.id } });
        const afterBatch = await tx.productBatch.findUnique({ where: { id: batch.id } });

        assert.strictEqual(afterSalesCount, beforeSalesCount, 'Sale records must remain identical');
        assert.strictEqual(afterPurchasesCount, beforePurchasesCount, 'Purchase records must remain identical');
        assert.strictEqual(afterExpensesCount, beforeExpensesCount, 'Expense records must remain identical');
        assert.strictEqual(afterCashbookCount, beforeCashbookCount, 'Cashbook entries must remain identical');
        assert.strictEqual(Number(afterCustomer?.outstanding), Number(beforeCustomer?.outstanding), 'Customer outstanding must remain identical');
        assert.strictEqual(Number(afterSupplier?.outstanding), Number(beforeSupplier?.outstanding), 'Supplier outstanding must remain identical');
        assert.strictEqual(afterBatch?.quantity, beforeBatch?.quantity, 'Batch inventory quantity must remain identical');

        // Rollback transaction to leave Neon database completely pristine
        throw new RollbackRequested('Clean Phase 11 integration rollback');
      },
      { maxWait: 60000, timeout: 240000 },
    );
  } catch (err: any) {
    if (err instanceof RollbackRequested) {
      // Transaction rolled back successfully as intended
      return;
    }
    throw err;
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.$disconnect();
  }
});

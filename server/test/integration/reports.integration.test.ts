import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import test from 'node:test';
import {
  getSalesReport,
  getPurchaseReport,
  getExpenseReport,
  getCashbookReport,
  getProfitReport,
  getGstSummaryReport,
  getInventoryValuationReport,
  getCustomerOutstandingReport,
  getSupplierOutstandingReport,
  getProductAnalytics,
  getCategoryAnalytics,
  getDashboardAnalytics,
  getMonthlySalesTarget,
  updateMonthlySalesTarget,
} from '../../src/services/reportsService.js';
import { createSale } from '../../src/services/saleService.js';
import { createProduct } from '../../src/services/productService.js';
import { createBatch } from '../../src/services/batchService.js';
import { createSupplier } from '../../src/services/supplierService.js';
import { createCustomer } from '../../src/services/customerService.js';
import { createPurchase } from '../../src/services/purchaseService.js';
import { createExpense } from '../../src/services/expenseService.js';
import { createSaleReturn, createPurchaseReturn } from '../../src/services/returnsService.js';
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

test('Live Neon DB: Phase 9 Reports, Profit, GST & Financial Analytics integration with clean transactional rollback', async () => {
  const marker = randomUUID().slice(0, 8);

  try {
    await prisma.$connect();

    await prisma.$transaction(
      async (tx) => {
        // 1. Setup Role and User for audit
        let role = await tx.role.findFirst({ where: { name: 'OWNER' } });
        if (!role) {
          role = await tx.role.create({ data: { name: 'OWNER' } });
        }

        const user = await tx.user.create({
          data: {
            name: `Phase9 Tester ${marker}`,
            email: `p9-${marker}@example.com`,
            password: 'hashedpassword',
            roleId: role.id,
          },
        });

        // 2. Setup Supplier & Customer
        const supplier = await createSupplier(
          {
            name: `Supplier ${marker}`,
            phone: '9876543210',
            gstin: '27AAAAA0000A1Z5',
          },
          tx as any,
          user.id,
        );

        const customer = await createCustomer(
          {
            name: `Customer ${marker}`,
            phone: '9123456780',
          },
          tx as any,
        );

        // 3. Setup Products & Batches
        const product = await createProduct(
          {
            name: `Medicine A ${marker}`,
            genericName: 'Paracetamol 500mg',
            brand: 'HealthPharma',
            barcode: `BAR-P9-${marker}`,
            sku: `SKU-P9-${marker}`,
            mrp: 100,
            sellingPrice: 80,
            purchasePrice: 50,
            gst: 18,
            supplierId: supplier.id,
          },
          tx as any,
          user.id,
        );

        const batch = await createBatch(
          {
            productId: product.id,
            batchNumber: `BAT-${marker}`,
            purchaseRate: 50,
            sellingPrice: 80,
            mrp: 100,
            gst: 18,
            expiryDate: new Date('2028-12-31'),
            supplierId: supplier.id,
          },
          tx as any,
          user.id,
        );

        // Add 100 units of opening stock
        await applyStockMovement(tx, {
          productId: product.id,
          batchId: batch.id,
          quantity: 100,
          movementType: 'OPENING_STOCK',
          reason: 'Initial test stock setup',
          idempotencyKey: `stock-${marker}`,
          createdById: user.id,
        });

        // 4. Create POS Sale: 10 units @ 80 = 800 + 18% GST (Paid in CASH)
        const sale = await createSale(
          {
            customerId: customer.id,
            saleDate: new Date(),
            paymentMethod: 'CASH',
            items: [
              {
                productId: product.id,
                batchId: batch.id,
                quantity: 10,
                sellingPrice: 80,
                gst: 18,
              },
            ],
          },
          `sale-1-${marker}`,
          tx as any,
        );
        assert.ok(sale.id, 'Sale should be created');

        // 5. Create Sales Return: return 2 units for CASH refund
        const saleReturn = await createSaleReturn(
          {
            saleId: sale.id,
            customerId: customer.id,
            refundMethod: 'CASH',
            reason: 'Wrong dosage requested',
            items: [
              {
                saleItemId: sale.items[0].id,
                productId: product.id,
                batchId: batch.id,
                quantity: 2,
                refundRate: 80,
                condition: 'RESTOCKABLE',
              },
            ],
            idempotencyKey: `salereturn-1-${marker}`,
            createdById: user.id,
          },
          tx as any,
        );
        assert.ok(saleReturn.id, 'Sale return should be created');

        // 6. Create Purchase: 20 units @ 50 = 1000 (Paid via UPI)
        const purchase = await createPurchase(
          {
            supplierId: supplier.id,
            invoiceNumber: `INV-${marker}`,
            invoiceDate: new Date(),
            paymentMethod: 'UPI',
            paidAmount: 1000,
            items: [
              {
                productId: product.id,
                batchNumber: `BAT-PUR-${marker}`,
                quantity: 20,
                freeQty: 0,
                purchaseRate: 50,
                sellingPrice: 80,
                mrp: 100,
                gst: 18,
                expiryDate: new Date('2028-06-30'),
              },
            ],
            createdById: user.id,
          },
          `purchase-1-${marker}`,
          tx as any,
        );
        assert.ok(purchase.id, 'Purchase should be created');

        // 7. Create Expense: Electricity = 250 (Paid in CASH)
        const expense = await createExpense(
          {
            category: 'Electricity',
            amount: 250,
            paymentMethod: 'CASH',
            expenseDate: new Date(),
            description: 'Shop bill paid in cash',
            createdById: user.id,
          },
          `expense-1-${marker}`,
          tx as any,
        );
        assert.ok(expense.id, 'Expense should be created');

        // 8. TEST SALES REPORT
        const salesReport = await getSalesReport({ preset: 'TODAY' }, tx as any);
        assert.strictEqual(salesReport.summary.invoiceCount >= 1, true);
        assert.strictEqual(salesReport.summary.grossSales >= 800, true);
        assert.strictEqual(salesReport.summary.salesReturns >= 160, true);
        assert.strictEqual(salesReport.summary.netSales >= 640, true);

        // 9. TEST PURCHASE REPORT
        const purchaseReport = await getPurchaseReport({ preset: 'TODAY' }, tx as any);
        assert.strictEqual(purchaseReport.summary.invoiceCount >= 1, true);
        assert.strictEqual(purchaseReport.summary.grossPurchases >= 1000, true);

        // 10. TEST EXPENSE REPORT
        const expenseReport = await getExpenseReport({ preset: 'TODAY' }, tx as any);
        assert.strictEqual(expenseReport.summary.totalExpenses >= 250, true);
        const elecCategory = expenseReport.categories.find((c) => c.category === 'Electricity');
        assert.ok(elecCategory, 'Electricity category should be present in expense report');

        // 11. TEST CASHBOOK REPORT
        const cashbookReport = await getCashbookReport({ preset: 'TODAY' }, tx as any);
        assert.ok(cashbookReport.cash, 'Cash summary must be present');
        assert.ok(cashbookReport.bank, 'Bank summary must be present');

        // 12. TEST PROFIT REPORT (Net Sales - COGS = Gross Profit; Gross Profit - Expenses = Net Profit)
        const profitReport = await getProfitReport({ preset: 'TODAY' }, tx as any);
        assert.strictEqual(profitReport.summary.grossSales >= 800, true);
        assert.strictEqual(profitReport.summary.salesReturns >= 160, true);
        assert.strictEqual(profitReport.summary.cogs.returnCogsReversal >= 100, true); // 2 units @ 50
        assert.ok(profitReport.summary.grossProfit !== undefined);
        assert.ok(profitReport.summary.netProfit !== undefined);

        // 13. TEST GST SUMMARY REPORT
        const gstReport = await getGstSummaryReport({ preset: 'TODAY' }, tx as any);
        assert.strictEqual(gstReport.reportType, 'GST Summary / Management Report');
        assert.ok(gstReport.summary.outputGst.grossOutputGst > 0);
        assert.ok(gstReport.summary.inputGst.grossInputGst > 0);

        // 14. TEST INVENTORY VALUATION
        const valuation = await getInventoryValuationReport({}, tx as any);
        assert.strictEqual(valuation.summary.totalUnits > 0, true);
        assert.strictEqual(valuation.summary.costValuation > 0, true);
        assert.strictEqual(valuation.summary.mrpValuation >= valuation.summary.costValuation, true);

        // 15. TEST CUSTOMER & SUPPLIER OUTSTANDING
        const customerDues = await getCustomerOutstandingReport(tx as any);
        assert.ok(Array.isArray(customerDues.customers));

        const supplierDues = await getSupplierOutstandingReport(tx as any);
        assert.ok(Array.isArray(supplierDues.suppliers));

        // 16. TEST PRODUCT & CATEGORY ANALYTICS
        const productAnalytics = await getProductAnalytics({ preset: 'TODAY' }, tx as any);
        assert.ok(Array.isArray(productAnalytics.topByQuantity));

        const categoryAnalytics = await getCategoryAnalytics({ preset: 'TODAY' }, tx as any);
        assert.ok(Array.isArray(categoryAnalytics.categories));

        // 17. TEST DASHBOARD LIVE ANALYTICS
        const dashboard = await getDashboardAnalytics(tx as any);
        assert.ok(dashboard.today);
        assert.ok(dashboard.alerts);
        assert.ok(dashboard.monthly);

        // 18. TEST MONTHLY SALES TARGET
        const updatedTarget = await updateMonthlySalesTarget('600000', tx as any, user.id);
        assert.strictEqual(updatedTarget.monthlyTarget, 600000);
        const targetProgress = await getMonthlySalesTarget(tx as any);
        assert.strictEqual(targetProgress.target, 600000);

        // Rollback transaction to leave Neon database completely pristine
        throw new RollbackRequested('Clean integration rollback');
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
    await prisma.$disconnect();
  }
});

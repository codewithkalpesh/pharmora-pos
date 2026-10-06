import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import test from 'node:test';
import { getReceiptData, getStoreSettings, updateStoreSettings } from '../../src/services/receiptService.js';
import { generateInvoicePdfBuffer } from '../../src/services/invoicePdfService.js';
import { createSale } from '../../src/services/saleService.js';
import { createProduct } from '../../src/services/productService.js';
import { createBatch } from '../../src/services/batchService.js';
import { createSupplier } from '../../src/services/supplierService.js';
import { createCustomer } from '../../src/services/customerService.js';
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

test('Live Neon DB: Phase 10 Thermal Receipts, A4 GST Invoice PDF, and Store Settings with clean transactional rollback', async () => {
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
            name: `Receipt Tester ${marker}`,
            email: `p10-${marker}@example.com`,
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
            name: `Rahul Sharma ${marker}`,
            phone: '9123456780',
            address: 'Pune, Maharashtra',
          },
          tx as any,
        );

        // 3. Setup Product & Batch
        const product = await createProduct(
          {
            name: `Azithromycin 500mg ${marker}`,
            genericName: 'Azithromycin',
            brand: 'ZithroCare',
            barcode: `BAR-P10-${marker}`,
            sku: `SKU-P10-${marker}`,
            mrp: 150,
            sellingPrice: 120,
            purchasePrice: 80,
            gst: 12,
            supplierId: supplier.id,
          },
          tx as any,
          user.id,
        );

        const batch = await createBatch(
          {
            productId: product.id,
            batchNumber: `BAT-AZ-${marker}`,
            purchaseRate: 80,
            sellingPrice: 120,
            mrp: 150,
            gst: 12,
            expiryDate: new Date('2028-12-31'),
            supplierId: supplier.id,
          },
          tx as any,
          user.id,
        );

        // Add 50 units stock
        await applyStockMovement(tx, {
          productId: product.id,
          batchId: batch.id,
          quantity: 50,
          movementType: 'OPENING_STOCK',
          reason: 'Initial test stock setup',
          idempotencyKey: `stock-p10-${marker}`,
          createdById: user.id,
        });

        // 4. Update and verify Store Settings
        const settings = await updateStoreSettings(
          {
            storeName: `Pharmora Health Hub ${marker}`,
            phone: '+91 91111 22222',
            receiptFooter: 'Thank you for choosing us! Get well soon.',
          },
          tx as any,
        );
        assert.strictEqual(settings.storeName, `Pharmora Health Hub ${marker}`);

        // 5. Create POS Sale: 3 units @ 120 = 360 + 12% GST = 403.20 (Paid via BOTH: Cash 200, UPI 203.20)
        const sale = await createSale(
          {
            customerId: customer.id,
            saleDate: new Date(),
            paymentMethod: 'BOTH',
            cashAmount: 200,
            upiAmount: 203.2,
            paidAmount: 403.2,
            items: [
              {
                productId: product.id,
                batchId: batch.id,
                quantity: 3,
                sellingPrice: 120,
                gst: 12,
              },
            ],
            createdById: user.id,
          },
          `sale-p10-${marker}`,
          tx as any,
        );
        assert.ok(sale.id, 'Sale created');

        // 6. Test getReceiptData
        const receipt = await getReceiptData(sale.id, tx as any);
        assert.strictEqual(receipt.store.storeName, `Pharmora Health Hub ${marker}`);
        assert.strictEqual(receipt.customer.name, `Rahul Sharma ${marker}`);
        assert.strictEqual(receipt.customer.phone, '9123456780');
        assert.strictEqual(receipt.items.length, 1);
        assert.strictEqual(receipt.items[0].productName, `Azithromycin 500mg ${marker}`);
        assert.strictEqual(receipt.items[0].quantity, 3);
        assert.strictEqual(receipt.items[0].gstRate, 12);
        assert.strictEqual(receipt.payment.paymentMethod, 'BOTH');
        assert.ok(receipt.whatsapp.shareUrl.includes('919123456780'));
        assert.ok(receipt.whatsapp.shareText.includes('Azithromycin 500mg'));

        // 7. Test A4 PDF Generation
        const pdf = await generateInvoicePdfBuffer(sale.id, tx as any);
        assert.ok(pdf.buffer instanceof Buffer);
        assert.strictEqual(pdf.buffer.length > 500, true);
        const header = pdf.buffer.subarray(0, 5).toString('ascii');
        assert.strictEqual(header, '%PDF-');
        assert.ok(pdf.filename.endsWith('.pdf'));

        // Rollback transaction to keep Neon database pristine
        throw new RollbackRequested('Clean integration rollback');
      },
      { maxWait: 60000, timeout: 240000 },
    );
  } catch (err: any) {
    if (err instanceof RollbackRequested) {
      // Transaction rolled back successfully
      return;
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
});

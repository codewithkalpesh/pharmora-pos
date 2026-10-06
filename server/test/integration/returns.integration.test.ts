import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import test from 'node:test';
import { createSaleReturn, createPurchaseReturn, listSaleReturns, listPurchaseReturns, getSaleReturn, getPurchaseReturn } from '../../src/services/returnsService.js';
import { createSale } from '../../src/services/saleService.js';
import { createProduct } from '../../src/services/productService.js';
import { createBatch, getExpiryDashboard } from '../../src/services/batchService.js';
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

test('Live Neon DB: Phase 8 Sales Returns, Purchase Returns, and Expiry Dashboard integration with clean transactional rollback', async () => {
  const marker = randomUUID().slice(0, 8);

  try {
    await prisma.$connect();

    await prisma.$transaction(async (tx) => {
      // 1. Setup Role and User for audit
      let role = await tx.role.findFirst({ where: { name: 'OWNER' } });
      if (!role) {
        role = await tx.role.create({ data: { name: 'OWNER' } });
      }

      const user = await tx.user.create({
        data: {
          name: `Phase8 Tester ${marker}`,
          email: `p8-${marker}@example.com`,
          password: 'hashedpassword',
          roleId: role.id,
        },
      });

      // 2. Setup Supplier & Customer
      const supplier = await createSupplier({
        name: `Supplier ${marker}`,
        phone: '9876543210',
        gstin: '27AAAAA0000A1Z5',
      }, tx as any, user.id);

      const customer = await createCustomer({
        name: `Customer ${marker}`,
        phone: '9123456780',
      }, tx as any);

      // 3. Setup Products & Batches
      const product = await createProduct({
        name: `Test Med ${marker}`,
        genericName: 'Paracetamol',
        brand: 'PharmaBrand',
        barcode: `BAR-${marker}`,
        sku: `SKU-${marker}`,
        mrp: '100.00',
        sellingPrice: '80.00',
        purchasePrice: '50.00',
        supplierId: supplier.id,
      }, tx as any, user.id);

      const batch = await createBatch({
        productId: product.id,
        batchNumber: `B-${marker}`,
        purchaseRate: '50.00',
        sellingPrice: '80.00',
        mrp: '100.00',
        expiryDate: new Date('2027-12-31'),
        supplierId: supplier.id,
      }, tx as any, user.id);

      // Add stock to batch: 50 units
      await applyStockMovement(tx, {
        productId: product.id,
        batchId: batch.id,
        quantity: 50,
        movementType: 'OPENING_STOCK',
        reason: 'Initial stock setup for test',
        idempotencyKey: `init-stock-${marker}`,
        createdById: user.id,
      });

      // 4. Create a Sale: sell 10 units
      const sale = await createSale({
        customerId: customer.id,
        items: [{ productId: product.id, batchId: batch.id, quantity: 10, sellingPrice: 80 }],
        paymentMethod: 'CASH',
        paidAmount: 800,
        createdById: user.id,
      }, `sale-key-${marker}`, tx as any);

      // Verify batch quantity is now 40
      const batchAfterSale = await tx.productBatch.findUnique({ where: { id: batch.id } });
      assert.equal(batchAfterSale?.quantity, 40);

      // 5. Test Sales Return (Restockable 4 units)
      const saleItem = sale.items[0];
      const saleReturn = await createSaleReturn({
        saleId: sale.id,
        items: [
          { saleItemId: saleItem.id, quantity: 4, condition: 'RESTOCKABLE', reason: 'Customer returned 4 units' },
        ],
        refundMethod: 'CASH',
        reason: 'Restocked return',
        createdById: user.id,
        idempotencyKey: `sr-idem-${marker}`,
      }, tx as any);

      assert.ok(saleReturn);
      assert.equal(Number(saleReturn.totalAmount), 320); // 4 * 80
      assert.equal(saleReturn.items.length, 1);

      // Verify batch quantity restored to 44
      const batchAfterReturn = await tx.productBatch.findUnique({ where: { id: batch.id } });
      assert.equal(batchAfterReturn?.quantity, 44);

      // 6. Test Sales Return (Damaged 2 units)
      const damagedReturn = await createSaleReturn({
        saleId: sale.id,
        items: [
          { saleItemId: saleItem.id, quantity: 2, condition: 'DAMAGED', reason: 'Damaged strips' },
        ],
        refundMethod: 'CASH',
        reason: 'Damaged return',
        createdById: user.id,
        idempotencyKey: `sr-dmg-${marker}`,
      }, tx as any);

      assert.ok(damagedReturn);
      assert.equal(Number(damagedReturn.totalAmount), 160); // 2 * 80

      // Verify batch quantity remains 44 (NOT incremented for damaged)
      const batchAfterDmg = await tx.productBatch.findUnique({ where: { id: batch.id } });
      assert.equal(batchAfterDmg?.quantity, 44);

      // Verify Over-return is prevented: 4 + 2 = 6 returned, total sold was 10. Attempt to return 5 -> REJECT
      await assert.rejects(
        async () => {
          await createSaleReturn({
            saleId: sale.id,
            items: [{ saleItemId: saleItem.id, quantity: 5 }],
            idempotencyKey: `sr-over-${marker}`,
          }, tx as any);
        },
        /Cannot return 5 units/
      );

      // 7. Test Purchase Return (Supplier Debit Note 14 units)
      const purchaseReturn = await createPurchaseReturn({
        supplierId: supplier.id,
        items: [
          { productId: product.id, batchId: batch.id, quantity: 14, reason: 'Overstock return to supplier' },
        ],
        refundMethod: 'CREDIT',
        reason: 'Supplier return test',
        createdById: user.id,
        idempotencyKey: `pr-idem-${marker}`,
      }, tx as any);

      assert.ok(purchaseReturn);
      assert.equal(Number(purchaseReturn.totalAmount), 700); // 14 * 50

      // Verify batch quantity decremented: 44 - 14 = 30
      const batchAfterPR = await tx.productBatch.findUnique({ where: { id: batch.id } });
      assert.equal(batchAfterPR?.quantity, 30);

      // 8. Test Expiry Dashboard
      const expiryDashboard = await getExpiryDashboard(new Date(), tx as any);
      assert.ok(expiryDashboard.summary);
      assert.ok(Array.isArray(expiryDashboard.batches.all));

      // Always rollback integration test fixtures
      throw new RollbackRequested('Clean rollback of Phase 8 integration test');
    }, { maxWait: 20000, timeout: 60000 });
  } catch (error) {
    if (error instanceof RollbackRequested) {
      // Clean rollback succeeded
      return;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
});

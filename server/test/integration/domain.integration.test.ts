import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import test from 'node:test';
import {
  createAdjustment,
  createCashbookEntry,
  createDailyClosing,
  getDailyCashSummary,
  getOpeningCash,
  setOpeningCash,
  transferCashAndBank,
} from '../../src/services/cashbookService.js';
import { createBatch } from '../../src/services/batchService.js';
import { adjustInventoryStock, getFefoBatchAvailability, getProductStockSummary } from '../../src/services/inventoryService.js';
import { createProduct, listProductsPage, setProductActive, updateProduct } from '../../src/services/productService.js';
import { createDailySales, updateDailySales } from '../../src/services/dailySalesService.js';
import {
  calculateSuggestedOrderQty,
  createPurchaseOrder,
  cancelPurchaseOrder,
  getPurchaseList,
  updatePurchaseOrderStatus,
  reorderPurchaseOrder,
} from '../../src/services/purchaseOrderService.js';
import { createPurchase } from '../../src/services/purchaseService.js';

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

test('verified Neon connection and POS schema relationships rollback cleanly', async () => {
  const marker = randomUUID();
  const email = `integration-${marker}@example.invalid`;
  const barcode = `it-${marker}`;
  const createdIds: Record<string, string> = {};
  const ledgerEntryIds: string[] = [];
  const ledgerAuditIds: string[] = [];
  const inventoryMovementIds: string[] = [];
  let purchaseOrderItemMissing = false;
  let operationError: unknown;

  try {
    await prisma.$connect();
    const identity = await prisma.$queryRaw<Array<{ database: string; schema: string; version: string }>>`
      SELECT current_database() AS database, current_schema() AS schema, version() AS version
    `;
    assert.equal(identity[0]?.database, 'pharmora_pos_dev');
    assert.equal(identity[0]?.schema, 'public');
    assert.match(identity[0]?.version ?? '', /^PostgreSQL /);

    try {
      await prisma.$transaction(async (tx) => {
        let role = await tx.role.findFirst({ where: { name: 'OWNER' } });
        if (!role) {
          role = await tx.role.create({ data: { name: 'OWNER' } });
          createdIds.role = role.id;
        }
        const user = await tx.user.create({
          data: { name: 'Integration Test', email, password: `test-${marker}`, roleId: role.id },
          include: { role: true },
        });
        createdIds.user = user.id;
        assert.equal((await tx.user.findUnique({ where: { id: user.id }, include: { role: true } }))?.role.name, 'OWNER');

        const category = await tx.category.create({ data: { name: `Integration ${marker}` } });
        createdIds.category = category.id;
        assert.equal((await tx.category.findUnique({ where: { id: category.id } }))?.name, category.name);

        const supplier = await tx.supplier.create({ data: { name: `Integration Supplier ${marker}` } });
        createdIds.supplier = supplier.id;
        assert.equal((await tx.supplier.findUnique({ where: { id: supplier.id } }))?.name, supplier.name);

        const customer = await tx.customer.create({ data: { name: `Integration Customer ${marker}` } });
        createdIds.customer = customer.id;
        assert.equal((await tx.customer.findUnique({ where: { id: customer.id } }))?.name, customer.name);

        const product = await tx.product.create({
          data: {
            name: `Integration Product ${marker}`,
            barcode,
            sku: `sku-${marker}`,
            sellingPrice: 12,
            supplierId: supplier.id,
            categoryId: category.id,
          },
          include: { category: true, supplier: true },
        });
        createdIds.product = product.id;
        const productRead = await tx.product.findUnique({ where: { id: product.id }, include: { category: true, supplier: true } });
        assert.equal(productRead?.category.id, category.id);
        assert.equal(productRead?.supplier?.id, supplier.id);

        const inventoryProduct = await createProduct({
          name: `Inventory Fixture ${marker}`,
          brand: 'Northstar',
          barcode: `inventory-${marker}`,
          sku: `inventory-sku-${marker}`,
          purchasePrice: '8.45',
          sellingPrice: '12.99',
        }, tx, user.id);
        createdIds.inventoryProduct = inventoryProduct.id;
        assert.equal(inventoryProduct.purchasePrice?.toFixed(2), '8.45');
        assert.equal(inventoryProduct.sellingPrice?.toFixed(2), '12.99');
        await assert.rejects(() => createProduct({ name: `Duplicate Barcode ${marker}`, barcode: inventoryProduct.barcode! }, tx, user.id));
        await assert.rejects(() => createProduct({ name: `Duplicate SKU ${marker}`, sku: inventoryProduct.sku! }, tx, user.id));
        const productSearch = await listProductsPage({ search: 'Northstar', page: 1, pageSize: 10 }, tx);
        assert.ok(productSearch.items.some((item) => item.id === inventoryProduct.id));
        const changedProduct = await updateProduct(inventoryProduct.id, { brand: 'Northstar Labs' }, tx, user.id);
        assert.equal(changedProduct.brand, 'Northstar Labs');
        await setProductActive(inventoryProduct.id, false, tx, user.id);
        const inactiveSearch = await listProductsPage({ search: 'Northstar', active: false, page: 1, pageSize: 10 }, tx);
        assert.ok(inactiveSearch.items.some((item) => item.id === inventoryProduct.id));
        await setProductActive(inventoryProduct.id, true, tx, user.id);

        const emptyInventory = await getProductStockSummary(inventoryProduct.id, '2026-10-05', tx);
        assert.equal(emptyInventory.totalStock, 0);
        const earlierBatch = await createBatch({
          productId: inventoryProduct.id,
          batchNumber: `FEFO-A-${marker}`,
          purchaseRate: '8.45',
          expiryDate: new Date('2026-11-01T00:00:00.000Z'),
        }, tx, user.id);
        createdIds.inventoryBatchA = earlierBatch.id;
        const soonerBatch = await createBatch({
          productId: inventoryProduct.id,
          batchNumber: `FEFO-B-${marker}`,
          purchaseRate: '8.45',
          expiryDate: new Date('2026-10-15T00:00:00.000Z'),
        }, tx, user.id);
        createdIds.inventoryBatchB = soonerBatch.id;
        const addOneHundred = await adjustInventoryStock({ productId: inventoryProduct.id, batchId: earlierBatch.id, quantityChange: 100, reason: 'FOUND', note: marker, actorId: user.id, idempotencyKey: `${marker}:add-100` }, tx);
        inventoryMovementIds.push(...(addOneHundred.movementIds as string[]));
        assert.equal((await getProductStockSummary(inventoryProduct.id, '2026-10-05', tx)).totalStock, 100);
        const addFifty = await adjustInventoryStock({ productId: inventoryProduct.id, batchId: soonerBatch.id, quantityChange: 50, reason: 'FOUND', note: marker, actorId: user.id, idempotencyKey: `${marker}:add-50` }, tx);
        inventoryMovementIds.push(...(addFifty.movementIds as string[]));
        assert.equal((await getProductStockSummary(inventoryProduct.id, '2026-10-05', tx)).totalStock, 150);
        const fefoBefore = await getFefoBatchAvailability(inventoryProduct.id, 20, '2026-10-05', tx);
        assert.equal(fefoBefore.allocations[0]?.batch.id, soonerBatch.id);
        const consumeTwenty = await adjustInventoryStock({ productId: inventoryProduct.id, batchId: soonerBatch.id, quantityChange: -20, reason: 'COUNT_CORRECTION', note: marker, actorId: user.id, idempotencyKey: `${marker}:consume-20` }, tx);
        inventoryMovementIds.push(...(consumeTwenty.movementIds as string[]));
        assert.equal((await getProductStockSummary(inventoryProduct.id, '2026-10-05', tx)).totalStock, 130);
        const updatedSoonerBatch = await tx.productBatch.findUnique({ where: { id: soonerBatch.id } });
        assert.equal(updatedSoonerBatch?.quantity, 30);
        const updatedEarlierBatch = await tx.productBatch.findUnique({ where: { id: earlierBatch.id } });
        assert.equal(updatedEarlierBatch?.quantity, 100);
        const movementCountBeforeReject = await tx.stockMovement.count({ where: { productId: inventoryProduct.id } });
        const adjustmentAuditCountBeforeReject = await tx.auditLog.count({ where: { entityType: 'Product', entityId: inventoryProduct.id, action: 'STOCK_ADJUSTED' } });
        await assert.rejects(() => adjustInventoryStock({ productId: inventoryProduct.id, quantityChange: -131, reason: 'COUNT_CORRECTION', note: marker, actorId: user.id, idempotencyKey: `${marker}:oversell` }, tx));
        assert.equal(await tx.stockMovement.count({ where: { productId: inventoryProduct.id } }), movementCountBeforeReject);
        assert.equal(await tx.auditLog.count({ where: { entityType: 'Product', entityId: inventoryProduct.id, action: 'STOCK_ADJUSTED' } }), adjustmentAuditCountBeforeReject);
        assert.equal((await tx.productBatch.findUnique({ where: { id: soonerBatch.id } }))?.quantity, 30);
        assert.equal((await tx.productBatch.findUnique({ where: { id: earlierBatch.id } }))?.quantity, 100);
        assert.equal((await getProductStockSummary(inventoryProduct.id, '2026-10-05', tx)).totalStock, 130);

        const batch = await tx.productBatch.create({
          data: {
            productId: product.id,
            supplierId: supplier.id,
            batchNumber: `batch-${marker}`,
            purchaseRate: 7,
            mrp: 15,
            sellingPrice: 12,
            quantity: 5,
          },
        });
        createdIds.batch = batch.id;
        assert.equal((await tx.productBatch.findUnique({ where: { id: batch.id }, include: { product: true, supplier: true } }))?.product.id, product.id);

        const movement = await tx.stockMovement.create({
          data: {
            productId: product.id,
            batchId: batch.id,
            quantity: 5,
            beforeQty: 0,
            afterQty: 5,
            movementType: 'OPENING_STOCK',
            referenceType: 'INTEGRATION_TEST',
            referenceId: marker,
            createdById: user.id,
          },
        });
        createdIds.stockMovement = movement.id;
        assert.equal((await tx.stockMovement.findUnique({ where: { id: movement.id }, include: { product: true, batch: true, createdBy: true } }))?.batch?.id, batch.id);

        const purchase = await tx.purchase.create({
          data: {
            supplierId: supplier.id,
            invoiceNumber: `INV-${marker}`,
            invoiceDate: new Date(),
            totalAmount: 35,
            paidAmount: 0,
            outstandingAmount: 35,
            createdById: user.id,
          },
        });
        createdIds.purchase = purchase.id;
        const purchaseItem = await tx.purchaseItem.create({
          data: { purchaseId: purchase.id, productId: product.id, batchId: batch.id, quantity: 5, purchaseRate: 7 },
        });
        createdIds.purchaseItem = purchaseItem.id;
        const purchaseRead = await tx.purchase.findUnique({ where: { id: purchase.id }, include: { supplier: true, items: true, createdBy: true } });
        assert.equal(purchaseRead?.supplier.id, supplier.id);
        assert.equal(purchaseRead?.items[0]?.id, purchaseItem.id);
        assert.equal(Number(purchaseRead?.paidAmount), 0);

        const sale = await tx.sale.create({
          data: { saleNumber: `SALE-${marker}`, customerId: customer.id, paymentMethod: 'CASH', totalAmount: 12, paidAmount: 12, createdById: user.id },
        });
        createdIds.sale = sale.id;
        const saleItem = await tx.saleItem.create({
          data: { saleId: sale.id, productId: product.id, batchId: batch.id, quantity: 1, sellingPrice: 12 },
        });
        createdIds.saleItem = saleItem.id;
        const saleRead = await tx.sale.findUnique({ where: { id: sale.id }, include: { customer: true, items: true, createdBy: true } });
        assert.equal(saleRead?.customer?.id, customer.id);
        assert.equal(saleRead?.items[0]?.id, saleItem.id);

        const expense = await tx.expense.create({
          data: { category: `Integration ${marker}`, amount: 3, paymentMethod: 'CASH', description: 'Integration rollback fixture', createdById: user.id },
        });
        createdIds.expense = expense.id;
        assert.equal((await tx.expense.findUnique({ where: { id: expense.id }, include: { createdBy: true } }))?.createdBy?.id, user.id);

        const cashbookEntry = await tx.cashbookEntry.create({
          data: {
            entryType: 'EXPENSE',
            direction: 'OUT',
            amount: 3,
            paymentMethod: 'CASH',
            sourceType: 'INTEGRATION_TEST',
            sourceId: marker,
            createdById: user.id,
          },
        });
        createdIds.cashbookEntry = cashbookEntry.id;
        assert.equal((await tx.cashbookEntry.findUnique({ where: { id: cashbookEntry.id }, include: { createdBy: true } }))?.createdBy?.id, user.id);

        const customerPayment = await tx.customerPayment.create({
          data: { customerId: customer.id, amount: 2, paymentMethod: 'CASH', createdById: user.id, notes: marker },
        });
        createdIds.customerPayment = customerPayment.id;
        assert.equal((await tx.customerPayment.findUnique({ where: { id: customerPayment.id }, include: { customer: true, createdBy: true } }))?.customer.id, customer.id);

        const supplierPayment = await tx.supplierPayment.create({
          data: { supplierId: supplier.id, purchaseId: purchase.id, amount: 2, paymentMethod: 'UPI', createdById: user.id, notes: marker },
        });
        createdIds.supplierPayment = supplierPayment.id;
        assert.equal((await tx.supplierPayment.findUnique({ where: { id: supplierPayment.id }, include: { supplier: true, purchase: true, createdBy: true } }))?.purchase?.id, purchase.id);

        const order = await tx.purchaseOrder.create({ data: { supplier: supplier.name, notes: marker } });
        createdIds.purchaseOrder = order.id;
        const orderItemDelegate = (tx as unknown as { purchaseOrderItem?: { create: (args: unknown) => Promise<{ id: string }> } }).purchaseOrderItem;
        purchaseOrderItemMissing = !orderItemDelegate;
        if (orderItemDelegate) {
          const orderItem = await orderItemDelegate.create({
            data: { purchaseOrderId: order.id, productId: product.id, quantity: 1, unitPrice: 7 },
          });
          createdIds.purchaseOrderItem = orderItem.id;
          const orderRead = await tx.purchaseOrder.findUnique({ where: { id: order.id }, include: { items: { include: { product: true } } } });
          assert.equal(orderRead?.items[0]?.id, orderItem.id);
          assert.equal(orderRead?.items[0]?.product.id, product.id);
        }

        const bankAccount = await tx.bankAccount.create({ data: { name: `Integration Bank ${marker}`, isPrimary: true } });
        createdIds.bankAccount = bankAccount.id;

        const cashDate = '2098-03-14';
        const nextCashDate = '2098-03-15';
        await setOpeningCash({
          businessDate: cashDate,
          amount: '10000.00',
          createdById: user.id,
          idempotencyKey: `${marker}:opening`,
        }, tx);
        const openingEntry = await tx.cashbookEntry.findUnique({ where: { idempotencyKey: `${marker}:opening` } });
        assert.ok(openingEntry);
        ledgerEntryIds.push(openingEntry.id);
        const flowInputs = [
          { entryType: 'CASH_SALE' as const, direction: 'IN' as const, amount: '2000.00', paymentMethod: 'CASH' as const },
          { entryType: 'OTHER_INCOME' as const, direction: 'IN' as const, amount: '500.00', paymentMethod: 'CASH' as const },
          { entryType: 'CASH_PURCHASE' as const, direction: 'OUT' as const, amount: '1000.00', paymentMethod: 'CASH' as const },
          { entryType: 'EXPENSE' as const, direction: 'OUT' as const, amount: '300.00', paymentMethod: 'CASH' as const },
          { entryType: 'SUPPLIER_PAYMENT' as const, direction: 'OUT' as const, amount: '500.00', paymentMethod: 'CASH' as const },
          { entryType: 'CUSTOMER_REFUND' as const, direction: 'OUT' as const, amount: '200.00', paymentMethod: 'CASH' as const },
        ];
        for (const [index, flow] of flowInputs.entries()) {
          const entry = await createCashbookEntry({
            ...flow,
            businessDate: cashDate,
            sourceType: 'CASHBOOK_INTEGRATION',
            sourceId: `${marker}:${index}`,
            createdById: user.id,
            idempotencyKey: `${marker}:flow-${index}`,
          }, tx);
          ledgerEntryIds.push(entry.id);
        }
        const adjustment = await createAdjustment({
          direction: 'IN',
          amount: '100.00',
          businessDate: cashDate,
          description: `Cash adjustment ${marker}`,
          createdById: user.id,
          idempotencyKey: `${marker}:adjustment`,
        }, tx);
        ledgerEntryIds.push(adjustment.id);
        const transfer = await transferCashAndBank({
          direction: 'CASH_TO_BANK',
          amount: '1000.00',
          businessDate: cashDate,
          description: `Bank deposit ${marker}`,
          createdById: user.id,
          idempotencyKey: `${marker}:deposit`,
        }, tx);
        ledgerEntryIds.push(...transfer.map((entry) => entry.id));

        const duplicateEntry = await createCashbookEntry({
          ...flowInputs[0]!,
          businessDate: cashDate,
          sourceType: 'CASHBOOK_INTEGRATION',
          sourceId: `${marker}:0`,
          createdById: user.id,
          idempotencyKey: `${marker}:flow-0`,
        }, tx);
        assert.equal(duplicateEntry.id, ledgerEntryIds[1]);

        const summary = await getDailyCashSummary(cashDate, tx);
        assert.equal(summary.openingCash, '10000.00');
        assert.equal(summary.cashInflows, '2600.00');
        assert.equal(summary.cashOutflows, '3000.00');
        assert.equal(summary.expectedDrawerCash, '9600.00');

        const closing = await createDailyClosing({
          businessDate: cashDate,
          actualCash: '9500.00',
          notes: `Counted cash ${marker}`,
          closedById: user.id,
        }, tx);
        createdIds.dailyClosing = closing.id;
        assert.equal(closing.status, 'CASH_SHORT');
        assert.equal(closing.difference.toFixed(2), '-100.00');
        await assert.rejects(() => createDailyClosing({ businessDate: cashDate, actualCash: '9600.00' }, tx));

        const nextOpening = await getOpeningCash(nextCashDate, tx);
        assert.equal(nextOpening.openingCash, '9500.00');
        assert.equal(nextOpening.source, 'PREVIOUS_CLOSING');
        const correctedOpening = await setOpeningCash({
          businessDate: nextCashDate,
          amount: '9600.00',
          reason: `Count correction ${marker}`,
          createdById: user.id,
          idempotencyKey: `${marker}:opening-correction`,
        }, tx);
        assert.equal(correctedOpening.openingCash, '9600.00');
        const correctionEntry = await tx.cashbookEntry.findUnique({ where: { idempotencyKey: `${marker}:opening-correction` } });
        assert.ok(correctionEntry);
        ledgerEntryIds.push(correctionEntry.id);

        const ledgerAudit = await tx.auditLog.findMany({
          where: { entityType: { in: ['CashbookEntry', 'DailyClosing'] }, entityId: { in: [closing.id, ...ledgerEntryIds] } },
        });
        ledgerAuditIds.push(...ledgerAudit.map((entry) => entry.id));
        const correctionAudit = await tx.auditLog.findFirst({ where: { action: 'CASHBOOK_ENTRY_CREATED', entityType: 'CashbookEntry', entityId: correctionEntry.id } });
        assert.ok(correctionAudit);
        ledgerAuditIds.push(correctionAudit.id);

        const bankTransaction = await tx.bankTransaction.create({
          data: {
            bankAccountId: bankAccount.id,
            transactionType: 'CREDIT',
            amount: 10,
            balanceAfter: 10,
            referenceType: 'INTEGRATION_TEST',
            referenceId: marker,
            createdById: user.id,
          },
        });
        createdIds.bankTransaction = bankTransaction.id;
        const bankRead = await tx.bankAccount.findUnique({ where: { id: bankAccount.id }, include: { transactions: true } });
        assert.ok(bankRead?.transactions.some((transaction) => transaction.id === bankTransaction.id));
        assert.equal((await tx.bankTransaction.findUnique({ where: { id: bankTransaction.id }, include: { bankAccount: true, createdBy: true } }))?.bankAccount.id, bankAccount.id);

        throw new RollbackRequested('Integration fixtures are rolled back by design');
      }, { timeout: 120_000, maxWait: 15_000 });
      assert.fail('The integration transaction should have been rolled back');
    } catch (error) {
      if (!(error instanceof RollbackRequested)) operationError = error;
    }

    const delegateMap: Record<string, string> = {
      batch: 'productBatch',
      inventoryProduct: 'product',
      inventoryBatchA: 'productBatch',
      inventoryBatchB: 'productBatch',
    };
    for (const [model, id] of Object.entries(createdIds)) {
      const delegateName = delegateMap[model] ?? model;
      const delegate = (prisma as any)[delegateName] as { findUnique: (args: { where: { id: string } }) => Promise<unknown> } | undefined;
      assert.ok(delegate, `Missing Prisma delegate for ${model}`);
      assert.equal(await delegate.findUnique({ where: { id } }), null, `Test record ${model} was not rolled back`);
    }
    for (const id of inventoryMovementIds) {
      assert.equal(await prisma.stockMovement.findUnique({ where: { id } }), null, 'Inventory test movement was not rolled back');
    }
    for (const id of ledgerEntryIds) {
      assert.equal(await prisma.cashbookEntry.findUnique({ where: { id } }), null, 'Cashbook test entry was not rolled back');
    }
    for (const id of ledgerAuditIds) {
      assert.equal(await prisma.auditLog.findUnique({ where: { id } }), null, 'Cashbook audit fixture was not rolled back');
    }
    if (operationError) throw operationError;
    assert.equal(purchaseOrderItemMissing, false, 'PurchaseOrderItem model/relation is missing from the canonical Prisma schema');
  } finally {
    await prisma.$disconnect();
  }
});

test('verified Phase 6: Daily Sales, POS reconciliation, and cashbook non-double-counting rollback cleanly on Neon', async () => {
  const marker = randomUUID();
  const email = `phase6-${marker}@example.invalid`;
  const createdIds: Record<string, string> = {};
  const ledgerEntryIds: string[] = [];
  let operationError: unknown;

  try {
    await prisma.$connect();

    try {
      await prisma.$transaction(async (tx) => {
        let role = await tx.role.findFirst({ where: { name: 'MANAGER' } });
        if (!role) {
          role = await tx.role.create({ data: { name: 'MANAGER' } });
          createdIds.role = role.id;
        }
        const user = await tx.user.create({
          data: { name: 'Phase6 Test User', email, password: `test-${marker}`, roleId: role.id },
        });
        createdIds.user = user.id;

        const p6DateStr = '2098-06-01';
        const p6Date = new Date(`${p6DateStr}T00:00:00.000Z`);

        // 1. Opening Cash = ₹10,000
        await setOpeningCash({
          businessDate: p6DateStr,
          amount: '10000.00',
          createdById: user.id,
          idempotencyKey: `${marker}:p6-opening`,
        }, tx);
        const p6Opening = await tx.cashbookEntry.findUnique({ where: { idempotencyKey: `${marker}:p6-opening` } });
        assert.ok(p6Opening);
        ledgerEntryIds.push(p6Opening.id);

        // 2. POS cash sale = ₹2,000
        const p6PosCashSale = await tx.sale.create({
          data: {
            saleNumber: `POS-${marker}-1`,
            paymentMethod: 'CASH',
            totalAmount: 2000,
            paidAmount: 2000,
            saleDate: p6Date,
            status: 'COMPLETED',
            createdById: user.id,
          },
        });
        createdIds.p6PosCashSale = p6PosCashSale.id;
        const p6CbPosCash = await tx.cashbookEntry.create({
          data: {
            entryType: 'SALE',
            direction: 'IN',
            amount: 2000,
            paymentMethod: 'CASH',
            businessDate: p6Date,
            sourceType: 'SALE',
            sourceId: p6PosCashSale.id,
            createdById: user.id,
            idempotencyKey: `${marker}:p6-pos-cash-cb`,
          },
        });
        ledgerEntryIds.push(p6CbPosCash.id);

        // 3. POS UPI sale = ₹3,000
        const p6PosUpiSale = await tx.sale.create({
          data: {
            saleNumber: `POS-${marker}-2`,
            paymentMethod: 'UPI',
            totalAmount: 3000,
            paidAmount: 3000,
            saleDate: p6Date,
            status: 'COMPLETED',
            createdById: user.id,
          },
        });
        createdIds.p6PosUpiSale = p6PosUpiSale.id;
        const p6CbPosUpi = await tx.cashbookEntry.create({
          data: {
            entryType: 'SALE',
            direction: 'IN',
            amount: 3000,
            paymentMethod: 'UPI',
            businessDate: p6Date,
            sourceType: 'SALE',
            sourceId: p6PosUpiSale.id,
            createdById: user.id,
            idempotencyKey: `${marker}:p6-pos-upi-cb`,
          },
        });
        ledgerEntryIds.push(p6CbPosUpi.id);

        // 4. Daily aggregate sales: Cash = ₹7,000, UPI = ₹8,000 (Total = ₹15,000)
        const p6DailySale = await createDailySales({
          businessDate: p6DateStr,
          cashSales: 7000,
          upiSales: 8000,
          createdById: user.id,
        }, `${marker}:p6-daily-sales`, tx);
        createdIds.p6DailySale = p6DailySale.id;

        // Verify Non-POS breakdown: Non-POS Cash = ₹5,000, Non-POS UPI = ₹5,000
        assert.equal(Number(p6DailySale.nonPosCashSales), 5000);
        assert.equal(Number(p6DailySale.nonPosUpiSales), 5000);
        assert.equal(Number(p6DailySale.nonPosTotalSales), 10000);
        assert.equal(Number(p6DailySale.totalSales), 15000);

        const p6DsCashEntry = await tx.cashbookEntry.findUnique({ where: { idempotencyKey: `${marker}:p6-daily-sales:cash` } });
        const p6DsUpiEntry = await tx.cashbookEntry.findUnique({ where: { idempotencyKey: `${marker}:p6-daily-sales:upi` } });
        assert.ok(p6DsCashEntry);
        assert.ok(p6DsUpiEntry);
        ledgerEntryIds.push(p6DsCashEntry.id, p6DsUpiEntry.id);

        // Verify drawer calculation on p6DateStr
        const p6Summary = await getDailyCashSummary(p6DateStr, tx);
        // Cash inflows must be POS cash ₹2,000 + Non-POS cash ₹5,000 = ₹7,000 (NOT ₹9,000)
        assert.equal(p6Summary.cashInflows, '7000.00');
        // Expected drawer: Opening 10,000 + 7,000 = 17,000
        assert.equal(p6Summary.expectedDrawerCash, '17000.00');

        // 5. Edit Daily Sales to: Cash = ₹8,000 (+1,000), UPI = ₹9,000 (+1,000)
        const p6UpdatedDailySale = await updateDailySales(p6DailySale.id, {
          cashSales: 8000,
          upiSales: 9000,
          createdById: user.id,
        }, `${marker}:p6-ds-edit`, tx);
        assert.equal(Number(p6UpdatedDailySale.nonPosCashSales), 6000);
        assert.equal(Number(p6UpdatedDailySale.nonPosUpiSales), 6000);
        assert.equal(Number(p6UpdatedDailySale.totalSales), 17000);

        const p6DsAdjCash = await tx.cashbookEntry.findUnique({ where: { idempotencyKey: `${marker}:p6-ds-edit:cash-in` } });
        const p6DsAdjUpi = await tx.cashbookEntry.findUnique({ where: { idempotencyKey: `${marker}:p6-ds-edit:upi-in` } });
        assert.ok(p6DsAdjCash);
        assert.ok(p6DsAdjUpi);
        ledgerEntryIds.push(p6DsAdjCash.id, p6DsAdjUpi.id);

        const p6SummaryAfterEdit = await getDailyCashSummary(p6DateStr, tx);
        assert.equal(p6SummaryAfterEdit.cashInflows, '8000.00');
        assert.equal(p6SummaryAfterEdit.expectedDrawerCash, '18000.00');

        // 6. Close the day and test closed-day protection
        const p6Closing = await createDailyClosing({
          businessDate: p6DateStr,
          actualCash: '18000.00',
          closedById: user.id,
        }, tx);
        createdIds.p6Closing = p6Closing.id;

        await assert.rejects(
          () => updateDailySales(p6DailySale.id, { cashSales: 9000, upiSales: 10000, createdById: user.id }, `${marker}:p6-ds-after-close`, tx),
          (err: any) => err.message.includes('closed business day'),
        );

        throw new RollbackRequested('Phase 6 fixtures rolled back');
      }, { timeout: 120_000, maxWait: 15_000 });
      assert.fail('Phase 6 transaction should have rolled back');
    } catch (error) {
      if (!(error instanceof RollbackRequested)) operationError = error;
    }

    const delegateMap: Record<string, string> = {
      p6PosCashSale: 'sale',
      p6PosUpiSale: 'sale',
      p6DailySale: 'dailySale',
      p6Closing: 'dailyClosing',
      role: 'role',
      user: 'user',
    };
    for (const [model, id] of Object.entries(createdIds)) {
      const delegateName = delegateMap[model] ?? model;
      const delegate = (prisma as any)[delegateName] as { findUnique: (args: { where: { id: string } }) => Promise<unknown> } | undefined;
      assert.ok(delegate, `Missing Prisma delegate for ${model}`);
      assert.equal(await delegate.findUnique({ where: { id } }), null, `Test record ${model} was not rolled back`);
    }
    for (const id of ledgerEntryIds) {
      assert.equal(await prisma.cashbookEntry.findUnique({ where: { id } }), null, 'Cashbook test entry was not rolled back');
    }
    if (operationError) throw operationError;
  } finally {
    await prisma.$disconnect();
  }
});

test('verified Phase 7: Purchase Orders + Stock Checker suggestions, financial isolation, and rollback on Neon', async () => {
  const marker = randomUUID();
  const email = `phase7-${marker}@example.invalid`;
  const createdIds: Record<string, string> = {};
  const ledgerEntryIds: string[] = [];
  const stockMovementIds: string[] = [];
  let operationError: unknown;

  try {
    await prisma.$connect();

    try {
      await prisma.$transaction(async (tx) => {
        let role = await tx.role.findFirst({ where: { name: 'OWNER' } });
        if (!role) {
          role = await tx.role.create({ data: { name: 'OWNER' } });
          createdIds.role = role.id;
        }
        const user = await tx.user.create({
          data: { name: 'Phase7 User', email, password: `test-${marker}`, roleId: role.id },
        });
        createdIds.user = user.id;

        const supplier = await tx.supplier.create({
          data: { name: `Supplier A ${marker}`, phone: '9876543210', outstanding: 0 },
        });
        createdIds.supplier = supplier.id;

        const product = await tx.product.create({
          data: {
            name: `Product A ${marker}`,
            sku: `sku-p7-${marker}`,
            barcode: `bc-p7-${marker}`,
            reorderLevel: 20,
            maxStock: 50,
            purchasePrice: 15,
            sellingPrice: 25,
            supplierId: supplier.id,
          },
        });
        createdIds.product = product.id;

        // Create initial stock of 10
        const initialBatch = await tx.productBatch.create({
          data: {
            productId: product.id,
            batchNumber: `BATCH-INIT-${marker}`,
            purchaseRate: 15,
            quantity: 10,
            supplierId: supplier.id,
            expiryDate: new Date('2028-01-01T00:00:00.000Z'),
          },
        });
        createdIds.initialBatch = initialBatch.id;

        // 1. Verify Stock Checker / Purchase List calculation
        const purchaseList = await getPurchaseList({ supplierId: supplier.id }, tx);
        assert.ok(purchaseList.length >= 1);
        const item = purchaseList.find((i) => i.id === product.id);
        assert.ok(item);
        assert.equal(item.currentStock, 10);
        assert.equal(item.reorderLevel, 20);
        assert.equal(item.maxStock, 50);
        assert.equal(item.stockStatus, 'LOW_STOCK');
        // Smart suggestion: 50 - 10 = 40
        assert.equal(item.suggestedQuantity, 40);

        // 2. Create Purchase Order: Product A x 40
        const po = await createPurchaseOrder(
          {
            supplier: supplier.name,
            supplierId: supplier.id,
            notes: `PO for ${marker}`,
            items: [{ productId: product.id, quantity: 40, unitPrice: 15 }],
            createdById: user.id,
          },
          `${marker}:p7-po`,
          tx as unknown as PrismaClient,
        );
        createdIds.purchaseOrder = po.id;
        assert.equal(po.totalQuantity, 40);
        assert.equal(Number(po.totalAmount), 600);
        assert.equal(po.status, 'DRAFT');

        // 3. Verify Financial Isolation:
        // Inventory MUST REMAIN 10
        const stockSummary = await getProductStockSummary(product.id, '2098-01-01', tx);
        assert.equal(stockSummary.totalStock, 10);
        // Cashbook must be unchanged
        const cbCount = await tx.cashbookEntry.count({ where: { createdById: user.id } });
        assert.equal(cbCount, 0);
        // Supplier outstanding must be unchanged (0)
        const supCheck = await tx.supplier.findUnique({ where: { id: supplier.id } });
        assert.equal(Number(supCheck?.outstanding), 0);
        // Purchase table must have 0 records
        const purchaseCount = await tx.purchase.count({ where: { supplierId: supplier.id } });
        assert.equal(purchaseCount, 0);

        // 4. Cancel Purchase Order
        const cancelledPo = await cancelPurchaseOrder(po.id, 'Cancelled for test', user.id, tx as unknown as PrismaClient);
        assert.equal(cancelledPo.status, 'CANCELLED');

        // Verify balances are STILL UNTOUCHED after cancellation
        const stockSummary2 = await getProductStockSummary(product.id, '2098-01-01', tx);
        assert.equal(stockSummary2.totalStock, 10);
        const supCheck2 = await tx.supplier.findUnique({ where: { id: supplier.id } });
        assert.equal(Number(supCheck2?.outstanding), 0);
        const cbCount2 = await tx.cashbookEntry.count({ where: { createdById: user.id } });
        assert.equal(cbCount2, 0);

        // 5. Now create a REAL Purchase through Phase 4 flow
        const realPurchase = await createPurchase(
          {
            supplierId: supplier.id,
            invoiceNumber: `INV-${marker}`,
            invoiceDate: new Date('2098-01-01T00:00:00.000Z'),
            paymentMethod: 'CASH',
            paidAmount: 600,
            createdById: user.id,
            items: [
              {
                productId: product.id,
                batchNumber: `BATCH-REAL-${marker}`,
                quantity: 40,
                purchaseRate: 15,
                expiryDate: new Date('2028-06-01T00:00:00.000Z'),
              },
            ],
          },
          `${marker}:real-purchase`,
          tx as unknown as PrismaClient,
        );
        createdIds.realPurchase = realPurchase.id;

        // Verify real purchase consequences:
        // Stock increased from 10 to 50
        const stockSummaryAfterRealPurchase = await getProductStockSummary(product.id, '2098-01-01', tx);
        assert.equal(stockSummaryAfterRealPurchase.totalStock, 50);

        // Stock movement was created
        const movements = await tx.stockMovement.findMany({ where: { productId: product.id, movementType: 'PURCHASE_IN' } });
        assert.equal(movements.length, 1);
        stockMovementIds.push(...movements.map((m) => m.id));

        // Cashbook entry was created
        const cbEntries = await tx.cashbookEntry.findMany({ where: { createdById: user.id } });
        assert.equal(cbEntries.length, 1);
        assert.equal(cbEntries[0]?.entryType, 'CASH_PURCHASE');
        assert.equal(Number(cbEntries[0]?.amount), 600);
        ledgerEntryIds.push(...cbEntries.map((c) => c.id));

        throw new RollbackRequested('Phase 7 fixtures rolled back');
      }, { timeout: 120_000, maxWait: 15_000 });
      assert.fail('Phase 7 transaction should have rolled back');
    } catch (error) {
      if (!(error instanceof RollbackRequested)) operationError = error;
    }

    const delegateMap: Record<string, string> = {
      purchaseOrder: 'purchaseOrder',
      realPurchase: 'purchase',
      initialBatch: 'productBatch',
      product: 'product',
      supplier: 'supplier',
      role: 'role',
      user: 'user',
    };
    for (const [model, id] of Object.entries(createdIds)) {
      const delegateName = delegateMap[model] ?? model;
      const delegate = (prisma as any)[delegateName] as { findUnique: (args: { where: { id: string } }) => Promise<unknown> } | undefined;
      assert.ok(delegate, `Missing Prisma delegate for ${model}`);
      assert.equal(await delegate.findUnique({ where: { id } }), null, `Test record ${model} was not rolled back`);
    }
    for (const id of stockMovementIds) {
      assert.equal(await prisma.stockMovement.findUnique({ where: { id } }), null, 'Stock movement fixture was not rolled back');
    }
    for (const id of ledgerEntryIds) {
      assert.equal(await prisma.cashbookEntry.findUnique({ where: { id } }), null, 'Cashbook fixture was not rolled back');
    }
    if (operationError) throw operationError;
  } finally {
    await prisma.$disconnect();
  }
});
import type { PaymentMethod, PrismaClient } from '@prisma/client';
import { applyStockMovement } from './stockService.js';
import { writeCashbookEntry } from './cashbookService.js';
import {
  database,
  duplicate,
  idempotencyKey,
  invalid,
  isUniqueConstraintError,
  missing,
  nonNegativeAmount,
  nonNegativeQuantity,
  positiveQuantity,
  transactionalDatabase,
  withTransaction,
  type DbClient,
} from './domainUtils.js';
import { lineTotal, paymentAccounts } from './transactionUtils.js';
import { sendPurchaseSummary } from './telegramService.js';

export type PurchaseLineInput = {
  productId: string;
  batchNumber: string;
  quantity: number;
  freeQty?: number;
  purchaseRate: number;
  mrp?: number;
  sellingPrice?: number;
  gst?: number;
  discount?: number;
  expiryDate?: Date;
};

export type PurchaseInput = {
  supplierId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  paymentMethod?: PaymentMethod;
  paidAmount?: number;
  cashAmount?: number;
  upiAmount?: number;
  notes?: string;
  items: PurchaseLineInput[];
  createdById?: string;
};

export const calculatePurchaseTotal = (items: PurchaseLineInput[]) => {
  if (!items || !items.length) throw invalid('Purchase must contain at least one item');
  return Math.round(items.reduce((total, item) => {
    positiveQuantity(item.quantity);
    nonNegativeQuantity(item.freeQty ?? 0, 'Free quantity');
    nonNegativeAmount(item.purchaseRate, 'Purchase rate');
    return total + lineTotal(item.quantity, item.purchaseRate, item.discount ?? 0, item.gst ?? 0);
  }, 0) * 100) / 100;
};

export const createPurchase = async (input: PurchaseInput, key: string, client?: DbClient) => {
  const stableKey = idempotencyKey(key);
  if (!input.supplierId || !input.invoiceNumber?.trim() || !input.invoiceDate || Number.isNaN(input.invoiceDate.getTime())) {
    throw invalid('Supplier, invoice number, and valid invoice date are required');
  }
  const totalAmount = calculatePurchaseTotal(input.items);
  const method: PaymentMethod = input.paymentMethod ?? (input.paidAmount === 0 ? 'CREDIT' : 'CASH');

  let paidAmount = 0;
  let cashAmount = 0;
  let upiAmount = 0;

  if (method === 'CREDIT') {
    paidAmount = 0;
  } else if (method === 'BOTH') {
    cashAmount = input.cashAmount ?? 0;
    upiAmount = input.upiAmount ?? 0;
    paidAmount = Math.round((cashAmount + upiAmount) * 100) / 100;
    if (paidAmount <= 0) throw invalid('Split payment amounts must be positive');
  } else {
    paidAmount = input.paidAmount ?? totalAmount;
    if (method === 'CASH') cashAmount = paidAmount;
    else upiAmount = paidAmount;
  }

  if (paidAmount < 0 || paidAmount > totalAmount) {
    throw invalid('Paid amount cannot be negative or exceed the total purchase amount');
  }

  const outstandingAmount = Math.round((totalAmount - paidAmount) * 100) / 100;
  const status = paidAmount === totalAmount ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'PENDING';

  const db = database(client);
  const prior = await db.purchase.findUnique({
    where: { idempotencyKey: stableKey },
    include: { items: true, supplier: true },
  });
  if (prior) {
    if (Number(prior.totalAmount) !== totalAmount || prior.supplierId !== input.supplierId) {
      throw duplicate('Idempotency key reused with different financial payload');
    }
    return prior;
  }

  try {
    const createdPurchase = await withTransaction(client, async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw missing('Supplier');

      const purchase = await tx.purchase.create({
        data: {
          supplierId: input.supplierId,
          invoiceNumber: input.invoiceNumber.trim(),
          invoiceDate: input.invoiceDate,
          paymentMethod: method,
          totalAmount,
          paidAmount,
          outstandingAmount,
          status,
          createdById: input.createdById,
          idempotencyKey: stableKey,
        },
      });

      for (const [index, item] of input.items.entries()) {
        if (!item.productId || !item.batchNumber?.trim()) throw invalid('Each purchase item requires a product and batch number');
        if (item.expiryDate && Number.isNaN(item.expiryDate.getTime())) throw invalid('Batch expiry date is invalid');
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true } });
        if (!product) throw missing('Product');

        const batchNumber = item.batchNumber.trim();
        const batch = await tx.productBatch.findUnique({
          where: { productId_batchNumber: { productId: item.productId, batchNumber } },
        });
        const quantityAdded = item.quantity + (item.freeQty ?? 0);

        const storedBatch = batch
          ? await tx.productBatch.update({
              where: { id: batch.id },
              data: {
                freeQuantity: { increment: item.freeQty ?? 0 },
                purchaseRate: item.purchaseRate,
                mrp: item.mrp,
                sellingPrice: item.sellingPrice,
                gst: item.gst,
                expiryDate: item.expiryDate,
                supplierId: input.supplierId,
              },
            })
          : await tx.productBatch.create({
              data: {
                productId: item.productId,
                batchNumber,
                purchaseDate: input.invoiceDate,
                expiryDate: item.expiryDate,
                purchaseRate: item.purchaseRate,
                mrp: item.mrp,
                sellingPrice: item.sellingPrice,
                gst: item.gst,
                quantity: 0,
                freeQuantity: item.freeQty ?? 0,
                supplierId: input.supplierId,
              },
            });

        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            productId: item.productId,
            batchId: storedBatch.id,
            quantity: item.quantity,
            freeQty: item.freeQty ?? 0,
            purchaseRate: item.purchaseRate,
            mrp: item.mrp,
            gst: item.gst,
            discount: item.discount,
            batchNumber,
            expiryDate: item.expiryDate,
          },
        });

        await applyStockMovement(tx, {
          productId: item.productId,
          batchId: storedBatch.id,
          quantity: quantityAdded,
          movementType: 'PURCHASE_IN',
          referenceType: 'PURCHASE',
          referenceId: purchase.id,
          createdById: input.createdById,
          idempotencyKey: `${stableKey}-item-${index}`,
        });
      }

      if (paidAmount > 0 && method !== 'CREDIT') {
        const accounts = method === 'BOTH'
          ? paymentAccounts(method, paidAmount, cashAmount, upiAmount)
          : paymentAccounts(method, paidAmount);
        for (const [accIndex, account] of accounts.entries()) {
          const entryType = account.method === 'CASH' ? 'CASH_PURCHASE' as const : 'SUPPLIER_PAYMENT' as const;
          await writeCashbookEntry(tx, {
            entryType,
            direction: 'OUT',
            amount: account.amount,
            paymentMethod: account.method,
            sourceType: 'PURCHASE',
            sourceId: purchase.id,
            createdById: input.createdById,
            notes: input.notes ?? `Purchase INV #${purchase.invoiceNumber}`,
            idempotencyKey: `${stableKey}-pay-${accIndex}`,
          });
        }
      }

      if (outstandingAmount > 0) {
        await tx.supplier.update({
          where: { id: input.supplierId },
          data: { outstanding: { increment: outstandingAmount } },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: input.createdById,
          action: 'PURCHASE_CREATED',
          entityType: 'Purchase',
          entityId: purchase.id,
          newValue: {
            invoiceNumber: purchase.invoiceNumber,
            totalAmount: purchase.totalAmount,
            paidAmount: purchase.paidAmount,
            outstandingAmount: purchase.outstandingAmount,
            paymentMethod: purchase.paymentMethod,
          },
        },
      });

      return tx.purchase.findUnique({
        where: { id: purchase.id },
        include: { items: { include: { product: true, batch: true } }, supplier: true, supplierPayments: true },
      });
    });

    if (createdPurchase) {
      setImmediate(() => {
        sendPurchaseSummary(createdPurchase.id, client, input.createdById).catch(() => {});
      });
    }

    return createdPurchase;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const original = await db.purchase.findUnique({
        where: { idempotencyKey: stableKey },
        include: { items: true, supplier: true },
      });
      if (original) return original;
      throw duplicate('Purchase invoice or idempotency key already exists');
    }
    throw error;
  }
};

export const listPurchases = (supplierId?: string, client?: DbClient) =>
  database(client).purchase.findMany({
    where: supplierId ? { supplierId } : undefined,
    include: { supplier: true, items: { include: { product: true, batch: true } }, supplierPayments: true },
    orderBy: { invoiceDate: 'desc' },
  });

export const getPurchase = async (id: string, client?: DbClient) => {
  const purchase = await database(client).purchase.findUnique({
    where: { id },
    include: { supplier: true, items: { include: { product: true, batch: true } }, supplierPayments: true },
  });
  if (!purchase) throw missing('Purchase');
  return purchase;
};

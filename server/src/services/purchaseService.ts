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
import { sendPurchaseNotification } from './telegramService.js';

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
  shopId?: string;
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

export const calculatePurchaseTotal = (items: Array<{ quantity: number; purchaseRate: number; discount?: number; gst?: number }>) => {
  if (!items || items.length === 0) throw invalid('Purchase requires at least one item');
  return items.reduce((sum, item) => {
    const base = (Number(item.quantity) * Number(item.purchaseRate)) - (Number(item.discount) || 0);
    const withGst = base + (base * ((Number(item.gst) || 0) / 100));
    return sum + (Math.round(withGst * 100) / 100);
  }, 0);
};

export const createPurchase = async (
  input: PurchaseInput,
  key: string,
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  const targetShopId = input.shopId || shopId;
  const stableKey = idempotencyKey(key);
  if (!input.items?.length) throw invalid('Purchase requires at least one line item');
  if (input.invoiceDate && Number.isNaN(input.invoiceDate.getTime())) throw invalid('Invoice date is invalid');

  const method = input.paymentMethod ?? 'CREDIT';
  let totalAmount = 0;
  for (const item of input.items) {
    positiveQuantity(item.quantity, 'Purchase item quantity');
    nonNegativeQuantity(item.freeQty ?? 0, 'Purchase item free quantity');
    nonNegativeAmount(item.purchaseRate, 'Purchase rate');
    if (item.mrp !== undefined) nonNegativeAmount(item.mrp, 'MRP');
    if (item.sellingPrice !== undefined) nonNegativeAmount(item.sellingPrice, 'Selling price');
    if (item.gst !== undefined) nonNegativeAmount(item.gst, 'GST');
    if (item.discount !== undefined) nonNegativeAmount(item.discount, 'Discount');
    totalAmount += lineTotal(item.quantity, item.purchaseRate, item.discount ?? 0, item.gst ?? 0);
  }
  totalAmount = Math.round(totalAmount * 100) / 100;

  const paidAmount = method === 'CREDIT' ? 0 : input.paidAmount ?? totalAmount;
  nonNegativeAmount(paidAmount, 'Paid amount');
  if (paidAmount > totalAmount) throw invalid('Paid amount cannot exceed total purchase amount');

  let cashAmount = 0;
  let upiAmount = 0;
  if (method === 'BOTH') {
    const accounts = paymentAccounts(method, paidAmount, input.cashAmount, input.upiAmount);
    cashAmount = accounts.find((a) => a.method === 'CASH')?.amount ?? 0;
    upiAmount = accounts.find((a) => a.method === 'UPI')?.amount ?? 0;
  } else if (method === 'CASH') {
    cashAmount = paidAmount;
  } else if (method === 'UPI' || method === 'BANK') {
    upiAmount = paidAmount;
  }

  const outstandingAmount = Math.round((totalAmount - paidAmount) * 100) / 100;
  const status = outstandingAmount === 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'PENDING';

  const db = database(client);
  const prior = await db.purchase.findUnique({
    where: { idempotencyKey: stableKey },
    include: { items: { include: { product: true, batch: true } }, supplier: true },
  });
  if (prior) return prior;

  try {
    const result = await withTransaction(client, async (tx) => {
      const supplier = tx.supplier.findFirst
        ? await tx.supplier.findFirst({ where: { id: input.supplierId, shopId: targetShopId } })
        : await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw missing('Supplier');

      const purchase = await tx.purchase.create({
        data: {
          shopId: targetShopId,
          supplierId: input.supplierId,
          invoiceNumber: input.invoiceNumber.trim(),
          invoiceDate: input.invoiceDate,
          totalAmount,
          paidAmount,
          outstandingAmount,
          paymentMethod: method,
          status,
          notes: input.notes?.trim(),
          createdById: input.createdById,
          idempotencyKey: stableKey,
        },
      });

      for (const [index, item] of input.items.entries()) {
        const product = tx.product.findFirst
          ? await tx.product.findFirst({ where: { id: item.productId, shopId: targetShopId } })
          : await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw missing(`Product ${item.productId}`);

        const totalQty = item.quantity + (item.freeQty ?? 0);
        let batch = tx.productBatch.findFirst
          ? await tx.productBatch.findFirst({
              where: { productId: item.productId, batchNumber: item.batchNumber.trim(), shopId: targetShopId },
            })
          : (tx.productBatch.findUnique
              ? await tx.productBatch.findUnique({
                  where: { productId_batchNumber: { productId: item.productId, batchNumber: item.batchNumber.trim() } } as any,
                })
              : null);

        if (batch) {
          batch = await tx.productBatch.update({
            where: { id: batch.id },
            data: {
              purchaseRate: item.purchaseRate,
              mrp: item.mrp ?? batch.mrp,
              sellingPrice: item.sellingPrice ?? batch.sellingPrice,
              gst: item.gst ?? batch.gst,
              expiryDate: item.expiryDate ?? batch.expiryDate,
              supplierId: input.supplierId,
            },
          });
        } else {
          batch = await tx.productBatch.create({
            data: {
              shopId: targetShopId,
              productId: item.productId,
              batchNumber: item.batchNumber.trim(),
              quantity: 0,
              freeQuantity: item.freeQty ?? 0,
              purchaseRate: item.purchaseRate,
              mrp: item.mrp,
              sellingPrice: item.sellingPrice,
              gst: item.gst,
              purchaseDate: input.invoiceDate,
              expiryDate: item.expiryDate,
              supplierId: input.supplierId,
              createdById: input.createdById,
            },
          });
        }

        await tx.purchaseItem.create({
          data: {
            shopId: targetShopId,
            purchaseId: purchase.id,
            productId: item.productId,
            batchId: batch.id,
            batchNumber: item.batchNumber.trim(),
            quantity: item.quantity,
            freeQty: item.freeQty ?? 0,
            purchaseRate: item.purchaseRate,
            mrp: item.mrp,
            sellingPrice: item.sellingPrice,
            gst: item.gst,
            discount: item.discount,
            expiryDate: item.expiryDate,
          },
        });

        await applyStockMovement(tx, {
          shopId: targetShopId,
          productId: item.productId,
          batchId: batch.id,
          quantity: totalQty,
          movementType: 'PURCHASE_IN',
          referenceType: 'PURCHASE',
          referenceId: purchase.id,
          createdById: input.createdById,
          idempotencyKey: `${stableKey.slice(0, 112)}:item-${index}`,
        });
      }

      if (paidAmount > 0) {
        if (cashAmount > 0) {
          await writeCashbookEntry(tx, {
            shopId: targetShopId,
            entryType: 'CASH_PURCHASE',
            direction: 'OUT',
            amount: cashAmount,
            paymentMethod: 'CASH',
            businessDate: input.invoiceDate,
            sourceType: 'PURCHASE',
            sourceId: purchase.id,
            notes: `Cash purchase ${input.invoiceNumber}`,
            createdById: input.createdById,
            idempotencyKey: `${stableKey.slice(0, 112)}:cash`,
          });
        }

        if (upiAmount > 0) {
          await writeCashbookEntry(tx, {
            shopId: targetShopId,
            entryType: 'MONEY_OUT',
            direction: 'OUT',
            amount: upiAmount,
            paymentMethod: 'UPI',
            businessDate: input.invoiceDate,
            sourceType: 'PURCHASE',
            sourceId: purchase.id,
            notes: `UPI purchase ${input.invoiceNumber}`,
            createdById: input.createdById,
            idempotencyKey: `${stableKey.slice(0, 112)}:upi`,
          });
        }
      }

      if (outstandingAmount > 0) {
        if (tx.supplier.updateMany) {
          await tx.supplier.updateMany({
            where: { id: input.supplierId, shopId: targetShopId },
            data: { outstanding: { increment: outstandingAmount } },
          });
        } else {
          await tx.supplier.update({
            where: { id: input.supplierId },
            data: { outstanding: { increment: outstandingAmount } },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          shopId: targetShopId,
          userId: input.createdById,
          action: 'PURCHASE_CREATED',
          entityType: 'Purchase',
          entityId: purchase.id,
          newValue: {
            invoiceNumber: input.invoiceNumber,
            totalAmount,
            paidAmount,
            outstandingAmount,
            paymentMethod: method,
            supplierId: input.supplierId,
          },
        },
      });

      return tx.purchase.findFirst
        ? tx.purchase.findFirst({
            where: { id: purchase.id, shopId: targetShopId },
            include: { items: { include: { product: true, batch: true } }, supplier: true },
          })
        : tx.purchase.findUnique({
            where: { id: purchase.id },
            include: { items: { include: { product: true, batch: true } }, supplier: true },
          });
    });

    if (result) {
      setImmediate(() => {
        void sendPurchaseNotification(result.id, undefined, input.createdById, targetShopId).catch((err: any) => {
          console.error('[Notification] Telegram purchase notification dispatch failed:', err);
        });
      });
    }

    return result;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const original = await db.purchase.findUnique({
        where: { idempotencyKey: stableKey },
        include: { items: { include: { product: true, batch: true } }, supplier: true },
      });
      if (original) return original;
      throw duplicate('Purchase idempotency key already exists');
    }
    throw error;
  }
};

export const listPurchases = (supplierId?: string, client?: DbClient, shopId = 'default-shop-pharmora') =>
  database(client).purchase.findMany({
    where: { shopId, supplierId },
    include: { supplier: true, items: { include: { product: true, batch: true } } },
    orderBy: { invoiceDate: 'desc' },
  });

export const getPurchase = async (id: string, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const purchase = await database(client).purchase.findFirst({
    where: { id, shopId },
    include: { supplier: true, items: { include: { product: true, batch: true } } },
  });
  if (!purchase) throw missing('Purchase');
  return purchase;
};

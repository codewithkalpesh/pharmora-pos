import type { PaymentMethod, PrismaClient, Product, ProductBatch } from '@prisma/client';
import { applyStockMovement } from './stockService.js';
import { database, duplicate, idempotencyKey, invalid, isUniqueConstraintError, missing, positiveQuantity, ruleViolation, withTransaction, type DbClient, validatePaymentSplit } from './domainUtils.js';
import { createSalePayment } from './paymentService.js';
import { lineTotal } from './transactionUtils.js';

export type SaleLineInput = {
  productId: string;
  batchId?: string;
  quantity: number;
  sellingPrice?: number;
  discount?: number;
  gst?: number;
};

export type SaleInput = {
  shopId?: string;
  saleNumber?: string;
  customerId?: string;
  items: SaleLineInput[];
  paymentMethod: PaymentMethod;
  paidAmount?: number;
  cashAmount?: number;
  upiAmount?: number;
  createdById?: string;
};

export const calculateSaleTotal = (items: SaleLineInput[]) => {
  if (!items.length) throw invalid('Sale must contain at least one item');
  return Math.round(items.reduce((total, item) => {
    positiveQuantity(item.quantity);
    if (item.sellingPrice === undefined) throw invalid('Sale item selling price is required');
    return total + lineTotal(item.quantity, item.sellingPrice, item.discount ?? 0, item.gst ?? 0);
  }, 0) * 100) / 100;
};

export const createSale = async (input: SaleInput, key: string, client?: DbClient, shopId?: string) => {
  const stableKey = idempotencyKey(key);
  const targetShopId = shopId || input.shopId || 'default-shop-pharmora';
  if (!['CASH', 'UPI', 'BOTH', 'CREDIT'].includes(input.paymentMethod)) throw invalid('Sale payment method must be CASH, UPI, BOTH, or CREDIT');
  if (input.paymentMethod === 'CREDIT') {
    if (!input.customerId || input.cashAmount !== undefined || input.upiAmount !== undefined) {
      throw invalid('Credit sale requires a customer and does not accept cash/UPI split amounts');
    }
    if (input.paidAmount !== undefined && input.paidAmount !== 0) {
      throw invalid('Credit sale paid amount must be 0');
    }
  }
  const db = database(client);
  const prior = await db.sale.findUnique({
    where: { idempotencyKey: stableKey },
    include: { items: { include: { product: true, batch: true } }, payments: { include: { splits: true } }, customer: true },
  });
  if (prior) return prior;
  try {
    return await withTransaction(client, async (tx) => {
      if (input.customerId) {
        const hasCustomer = tx.customer.findFirst
          ? await tx.customer.findFirst({ where: { id: input.customerId, shopId: targetShopId }, select: { id: true } })
          : await tx.customer.findUnique({ where: { id: input.customerId } });
        if (!hasCustomer) throw missing('Customer');
      }

      const selectedLines: Array<{ line: SaleLineInput; batch: ProductBatch; product: Pick<Product, 'sellingPrice' | 'gst'>; lineIndex: number; discount: number }> = [];
      for (const [lineIndex, line] of input.items.entries()) {
        if (!line.productId) throw invalid('Sale item product is required');
        const product = tx.product.findFirst
          ? await tx.product.findFirst({ where: { id: line.productId, shopId: targetShopId }, select: { id: true, name: true, active: true, sellingPrice: true, gst: true } })
          : await tx.product.findUnique({ where: { id: line.productId } });
        if (!product || !product.active) throw missing('Active product');
        if (line.batchId) {
          const batch = tx.productBatch.findFirst
            ? await tx.productBatch.findFirst({ where: { id: line.batchId, shopId: targetShopId } })
            : await tx.productBatch.findUnique({ where: { id: line.batchId } });
          if (!batch || batch.productId !== line.productId) throw missing('Product batch');
          if (batch.expiryDate && batch.expiryDate < new Date()) throw ruleViolation('Expired batches cannot be sold');
          if (batch.quantity < line.quantity) throw ruleViolation('Insufficient stock in selected batch');
          selectedLines.push({ line, batch, product, lineIndex, discount: 0 });
        } else {
          let remaining = line.quantity;
          const batches = await tx.productBatch.findMany({
            where: { productId: line.productId, shopId: targetShopId, quantity: { gt: 0 }, OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }] },
            orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
          });
          for (const batch of batches) {
            if (remaining <= 0) break;
            const take = Math.min(batch.quantity, remaining);
            selectedLines.push({ line: { ...line, quantity: take }, batch, product, lineIndex, discount: 0 });
            remaining -= take;
          }
          if (remaining > 0) throw ruleViolation(`Insufficient stock for product ${product.name}`);
        }
      }

      for (const [lineIndex, line] of input.items.entries()) {
        const allocations = selectedLines.filter((selection) => selection.lineIndex === lineIndex);
        const totalDiscountCents = Math.round((line.discount ?? 0) * 100);
        let allocatedCents = 0;
        for (const [allocationIndex, selection] of allocations.entries()) {
          const allocated = allocationIndex === allocations.length - 1
            ? totalDiscountCents - allocatedCents
            : Math.floor(totalDiscountCents * selection.line.quantity / line.quantity);
          selection.discount = allocated / 100;
          allocatedCents += allocated;
        }
      }

      const totalAmount = Math.round(selectedLines.reduce((total, { line, batch, product, discount }) => {
        const sellingPrice = Number(batch.sellingPrice ?? batch.mrp ?? product.sellingPrice ?? 0);
        if (sellingPrice <= 0) throw invalid('A positive selling price must be configured for every sale item');
        const gst = Number(batch.gst ?? product.gst ?? 0);
        return total + lineTotal(line.quantity, sellingPrice, discount, gst);
      }, 0) * 100) / 100;

      let paidAmount: number;
      if (input.paymentMethod === 'CREDIT') {
        paidAmount = 0;
      } else if (input.paidAmount !== undefined) {
        if (input.paidAmount < 0 || input.paidAmount > totalAmount) {
          throw invalid('Paid amount must be between 0 and total amount');
        }
        paidAmount = Math.round(input.paidAmount * 100) / 100;
      } else {
        paidAmount = totalAmount;
      }

      const creditAmount = Math.round((totalAmount - paidAmount) * 100) / 100;
      if (creditAmount > 0 && !input.customerId) {
        throw invalid('Sale with outstanding credit balance requires a customer');
      }

      if (paidAmount > 0) {
        if (input.paymentMethod === 'BOTH') {
          validatePaymentSplit(input.paymentMethod, paidAmount, input.cashAmount, input.upiAmount);
        } else {
          validatePaymentSplit(input.paymentMethod, paidAmount);
        }
      }

      const saleNumber = input.saleNumber ?? `POS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      const sale = await tx.sale.create({
        data: {
          shopId: targetShopId,
          saleNumber,
          customerId: input.customerId,
          paymentMethod: input.paymentMethod,
          totalAmount,
          paidAmount,
          status: 'COMPLETED',
          idempotencyKey: stableKey,
          createdById: input.createdById,
        },
      });

      for (const [index, { line, batch, product, discount }] of selectedLines.entries()) {
        const sellingPrice = Number(batch.sellingPrice ?? batch.mrp ?? product.sellingPrice ?? 0);
        if (sellingPrice <= 0) throw invalid('A positive selling price must be configured for every sale item');
        const gst = Number(batch.gst ?? product.gst ?? 0);
        await tx.saleItem.create({
          data: { saleId: sale.id, productId: line.productId, batchId: batch.id, quantity: line.quantity, sellingPrice, discount, gst },
        });
        await applyStockMovement(tx, {
          productId: line.productId,
          batchId: batch.id,
          quantity: line.quantity,
          movementType: 'SALE_OUT',
          referenceType: 'SALE',
          referenceId: sale.id,
          createdById: input.createdById,
          idempotencyKey: `${stableKey}-stock-${index}`,
        });
      }

      if (creditAmount > 0) {
        await tx.customerCredit.create({
          data: {
            shopId: targetShopId,
            customerId: input.customerId!,
            saleId: sale.id,
            description: `Sale ${sale.saleNumber ?? sale.id}`,
            amount: creditAmount,
            paidAmount: 0,
            balanceAmount: creditAmount,
            status: 'PENDING',
          },
        });
        if (tx.customer?.update) {
          await tx.customer.update({
            where: { id: input.customerId },
            data: { outstanding: { increment: creditAmount } },
          });
        }
      }

      if (paidAmount > 0) {
        await createSalePayment(tx, {
          shopId: targetShopId,
          saleId: sale.id,
          amount: paidAmount,
          paymentMethod: input.paymentMethod,
          cashAmount: input.paymentMethod === 'BOTH' ? input.cashAmount : undefined,
          upiAmount: input.paymentMethod === 'BOTH' ? input.upiAmount : undefined,
          idempotencyKey: `${stableKey.slice(0, 112)}:payment`,
          createdById: input.createdById,
        });
      }

      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            shopId: targetShopId,
            userId: input.createdById,
            action: 'SALE_CREATED',
            entityType: 'Sale',
            entityId: sale.id,
            newValue: {
              saleNumber: sale.saleNumber,
              totalAmount,
              paidAmount,
              creditAmount,
              paymentMethod: input.paymentMethod,
              customerId: input.customerId,
              itemCount: selectedLines.length,
            },
          },
        });
      }

      return tx.sale.findUnique({
        where: { id: sale.id },
        include: { items: { include: { product: true, batch: true } }, payments: { include: { splits: true } }, customer: true },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const original = await db.sale.findUnique({
        where: { idempotencyKey: stableKey },
        include: { items: { include: { product: true, batch: true } }, payments: { include: { splits: true } }, customer: true },
      });
      if (original) return original;
      throw duplicate('Sale number or idempotency key already exists');
    }
    throw error;
  }
};

export const listSales = (client?: DbClient, shopId?: string) => {
  const targetShopId = shopId || 'default-shop-pharmora';
  return database(client).sale.findMany({
    where: { shopId: targetShopId },
    include: { customer: true, items: { include: { product: true, batch: true } }, payments: true },
    orderBy: { saleDate: 'desc' },
  });
};

export const getSale = async (id: string, client?: DbClient, shopId?: string) => {
  const db = database(client);
  const sale = db.sale.findFirst
    ? await db.sale.findFirst({
        where: { id, ...(shopId ? { shopId } : {}) },
        include: { customer: true, items: { include: { product: true, batch: true } }, payments: { include: { splits: true } } },
      })
    : await db.sale.findUnique({
        where: { id },
        include: { customer: true, items: { include: { product: true, batch: true } }, payments: { include: { splits: true } } },
      });
  if (!sale) throw missing('Sale');
  return sale;
};

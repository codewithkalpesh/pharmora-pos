import { Prisma, type PaymentMethod, type PrismaClient } from '@prisma/client';
import { database, duplicate, idempotencyKey, invalid, missing, positiveQuantity, ruleViolation, withTransaction, type DbClient } from './domainUtils.js';
import { nonNegativeMoney, positiveMoney, type MoneyInput } from './cashbookMath.js';
import { writeCashbookEntry } from './cashbookLedgerService.js';
import { applyStockMovement } from './stockService.js';

export type ReturnCondition = 'RESTOCKABLE' | 'DAMAGED' | 'EXPIRED' | 'OTHER';

export type SaleReturnItemInput = {
  saleItemId: string;
  quantity: number;
  condition?: ReturnCondition;
  unitPrice?: MoneyInput;
  reason?: string;
  notes?: string;
};

export type SaleReturnInput = {
  saleId: string;
  items: SaleReturnItemInput[];
  refundMethod?: PaymentMethod;
  reason?: string;
  notes?: string;
  createdById?: string;
  idempotencyKey?: string;
  businessDate?: Date | string;
};

export type PurchaseReturnItemInput = {
  productId: string;
  batchId: string;
  quantity: number;
  unitPrice?: MoneyInput;
  purchaseItemId?: string;
  reason?: string;
};

export type PurchaseReturnInput = {
  supplierId: string;
  purchaseId?: string;
  items: PurchaseReturnItemInput[];
  refundMethod?: PaymentMethod;
  reason?: string;
  notes?: string;
  createdById?: string;
  idempotencyKey?: string;
  businessDate?: Date | string;
};

const generateReturnNumber = (prefix: 'SR' | 'PR') => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `${prefix}-${dateStr}-${rand}`;
};

// ==========================================
// 1. SALES RETURNS (Customer Refunds)
// ==========================================

export const createSaleReturn = async (input: SaleReturnInput, client?: DbClient) => {
  if (!input.saleId?.trim()) throw invalid('Sale ID is required for a sales return');
  if (!Array.isArray(input.items) || input.items.length === 0) throw invalid('Sales return must include at least one item');
  const key = idempotencyKey(input.idempotencyKey);
  const refundMethod: PaymentMethod = input.refundMethod ?? 'CASH';

  return withTransaction(client, async (tx) => {
    // 1. Idempotency Check
    const existing = await tx.saleReturn.findUnique({
      where: { idempotencyKey: key },
      include: {
        items: { include: { product: true, batch: true, saleItem: true } },
        sale: { include: { customer: true } },
        customer: true,
      },
    });
    if (existing) {
      if (existing.saleId !== input.saleId) {
        throw duplicate('Idempotency key was already used for a different sales return');
      }
      return existing;
    }

    // 2. Fetch origin Sale with its items and past returns
    const originSale = await tx.sale.findUnique({
      where: { id: input.saleId },
      include: {
        customer: true,
        items: {
          include: {
            returnItems: true,
            product: true,
            batch: true,
          },
        },
      },
    });
    if (!originSale) throw missing('Sale');

    // 3. Validate return lines against origin sale items and calculate refund
    const processedLines: Array<{
      saleItemId: string;
      productId: string;
      batchId: string | null;
      quantity: number;
      unitPrice: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      condition: ReturnCondition;
      restocked: boolean;
      reason: string | null;
      notes: string | null;
    }> = [];

    for (const [index, line] of input.items.entries()) {
      if (!line.saleItemId?.trim()) throw invalid(`Item #${index + 1}: Sale item ID is required`);
      positiveQuantity(line.quantity, `Item #${index + 1} return quantity`);

      const saleItem = originSale.items.find((it) => it.id === line.saleItemId);
      if (!saleItem) {
        throw invalid(`Item #${index + 1}: Sale item does not belong to sale ${originSale.saleNumber ?? originSale.id}`);
      }

      // Check cumulative returns against original sold quantity
      const alreadyReturnedQty = saleItem.returnItems.reduce((sum, ret) => sum + ret.quantity, 0);
      const remainingReturnable = saleItem.quantity - alreadyReturnedQty;
      if (line.quantity > remainingReturnable) {
        throw ruleViolation(
          `Cannot return ${line.quantity} units for product ${saleItem.product?.name ?? saleItem.productId}. ` +
          `Originally sold: ${saleItem.quantity}, already returned: ${alreadyReturnedQty}, max returnable: ${remainingReturnable}.`
        );
      }

      const condition: ReturnCondition = line.condition ?? 'RESTOCKABLE';
      const restocked = condition === 'RESTOCKABLE';

      // Determine unit price
      let unitRefundDecimal: Prisma.Decimal;
      if (line.unitPrice !== undefined) {
        unitRefundDecimal = nonNegativeMoney(line.unitPrice, `Item #${index + 1} unit price`);
      } else {
        // Effective unit price = sellingPrice - (discount / quantity)
        const itemSellingPrice = Number(saleItem.sellingPrice);
        const itemDiscount = Number(saleItem.discount ?? 0);
        const netUnitPrice = Math.max(0, itemSellingPrice - (itemDiscount / saleItem.quantity));
        unitRefundDecimal = new Prisma.Decimal(Math.round(netUnitPrice * 100) / 100);
      }

      const lineTotalRefund = new Prisma.Decimal(Math.round(Number(unitRefundDecimal) * line.quantity * 100) / 100);

      processedLines.push({
        saleItemId: saleItem.id,
        productId: saleItem.productId,
        batchId: saleItem.batchId,
        quantity: line.quantity,
        unitPrice: unitRefundDecimal,
        totalAmount: lineTotalRefund,
        condition,
        restocked,
        reason: line.reason?.trim() || input.reason?.trim() || null,
        notes: line.notes?.trim() || null,
      });
    }

    const totalRefundAmount = processedLines.reduce(
      (sum, line) => sum.plus(line.totalAmount),
      new Prisma.Decimal(0)
    );

    const returnNumber = generateReturnNumber('SR');

    // 4. Create SaleReturn record
    const saleReturn = await tx.saleReturn.create({
      data: {
        returnNumber,
        saleId: originSale.id,
        customerId: originSale.customerId,
        totalAmount: totalRefundAmount,
        refundMethod,
        refundStatus: 'COMPLETED',
        reason: input.reason?.trim() || null,
        notes: input.notes?.trim() || null,
        createdById: input.createdById,
        idempotencyKey: key,
      },
    });

    // 5. Create SaleReturnItem records & apply stock movements
    for (const [idx, line] of processedLines.entries()) {
      await tx.saleReturnItem.create({
        data: {
          saleReturnId: saleReturn.id,
          saleItemId: line.saleItemId,
          productId: line.productId,
          batchId: line.batchId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalAmount: line.totalAmount,
          condition: line.condition,
          restocked: line.restocked,
          notes: line.notes,
        },
      });

      // If line doesn't have batchId, find or create one
      let batchId = line.batchId;
      if (!batchId) {
        const firstBatch = await tx.productBatch.findFirst({
          where: { productId: line.productId },
          orderBy: { createdAt: 'desc' },
        });
        if (firstBatch) {
          batchId = firstBatch.id;
        } else {
          const newBatch = await tx.productBatch.create({
            data: {
              productId: line.productId,
              batchNumber: `RET-${saleReturn.returnNumber || 'BATCH'}`,
              purchaseRate: 0,
              quantity: 0,
            },
          });
          batchId = newBatch.id;
        }
      }

      if (line.restocked) {
        // Restockable: applyStockMovement with RETURN_IN automatically increments batch quantity
        await applyStockMovement(tx, {
          productId: line.productId,
          batchId,
          quantity: line.quantity,
          movementType: 'RETURN_IN',
          reason: `Customer return (${line.condition}): ${line.reason || 'Restocked return'}`,
          referenceType: 'SALE_RETURN',
          referenceId: saleReturn.id,
          createdById: input.createdById,
          idempotencyKey: `${key.slice(0, 80)}:stock:${idx}`,
        });
      } else {
        // Non-restockable (Damaged / Expired / Waste): record audit stock movement without modifying sellable stock
        const currentBatch = await tx.productBatch.findUnique({ where: { id: batchId }, select: { quantity: true } });
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            batchId,
            quantity: line.quantity,
            beforeQty: currentBatch?.quantity ?? 0,
            afterQty: currentBatch?.quantity ?? 0,
            movementType: line.condition === 'EXPIRED' ? 'EXPIRED' : 'DAMAGE',
            reason: `Customer return non-restocked (${line.condition}): ${line.reason || 'Damaged/expired return'}`,
            referenceType: 'SALE_RETURN',
            referenceId: saleReturn.id,
            createdById: input.createdById,
            idempotencyKey: `${key.slice(0, 80)}:damage:${idx}`,
          },
        });
      }
    }

    // 6. Financial Settlement
    if (totalRefundAmount.gt(0)) {
      if (refundMethod === 'CREDIT') {
        // Store credit / Customer balance reduction
        if (originSale.customerId) {
          await tx.customer.update({
            where: { id: originSale.customerId },
            data: { outstanding: { decrement: totalRefundAmount } },
          });
        }
      } else {
        // Cash / UPI / Bank refund via Cashbook entry
        await writeCashbookEntry(tx, {
          entryType: 'CUSTOMER_REFUND',
          direction: 'OUT',
          amount: totalRefundAmount,
          paymentMethod: refundMethod,
          sourceType: 'SALE_RETURN',
          sourceId: saleReturn.id,
          businessDate: input.businessDate ?? new Date(),
          notes: `Customer refund for Return ${returnNumber} (Sale ${originSale.saleNumber ?? originSale.id})`,
          createdById: input.createdById,
          idempotencyKey: `${key.slice(0, 80)}:refund_cashbook`,
        });
      }
    }

    // 7. Audit Log
    await tx.auditLog.create({
      data: {
        userId: input.createdById,
        action: 'SALE_RETURN_CREATED',
        entityType: 'SaleReturn',
        entityId: saleReturn.id,
        newValue: {
          returnNumber,
          saleId: originSale.id,
          saleNumber: originSale.saleNumber,
          totalAmount: totalRefundAmount.toFixed(2),
          refundMethod,
          itemCount: processedLines.length,
          restockedCount: processedLines.filter((l) => l.restocked).length,
          actorId: input.createdById,
        },
      },
    });

    return tx.saleReturn.findUnique({
      where: { id: saleReturn.id },
      include: {
        items: { include: { product: true, batch: true, saleItem: true } },
        sale: { include: { customer: true } },
        customer: true,
      },
    });
  });
};

export const listSaleReturns = async (filters: { saleId?: string; customerId?: string; search?: string } = {}, client?: DbClient) => {
  const db = database(client);
  const query = filters.search?.trim();
  return db.saleReturn.findMany({
    where: {
      saleId: filters.saleId,
      customerId: filters.customerId,
      OR: query
        ? [
            { returnNumber: { contains: query, mode: 'insensitive' } },
            { sale: { saleNumber: { contains: query, mode: 'insensitive' } } },
            { customer: { name: { contains: query, mode: 'insensitive' } } },
          ]
        : undefined,
    },
    include: {
      sale: { select: { id: true, saleNumber: true, saleDate: true, totalAmount: true } },
      customer: { select: { id: true, name: true, phone: true } },
      items: { include: { product: true, batch: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
};

export const getSaleReturn = async (id: string, client?: DbClient) => {
  const db = database(client);
  const saleReturn = await db.saleReturn.findUnique({
    where: { id },
    include: {
      sale: {
        include: {
          customer: true,
          items: { include: { product: true, batch: true } },
        },
      },
      customer: true,
      items: {
        include: {
          product: true,
          batch: true,
          saleItem: true,
        },
      },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!saleReturn) throw missing('Sale return');
  return saleReturn;
};

// ==========================================
// 2. PURCHASE RETURNS (Supplier Returns / Debit Notes)
// ==========================================

export const createPurchaseReturn = async (input: PurchaseReturnInput, client?: DbClient) => {
  if (!input.supplierId?.trim()) throw invalid('Supplier ID is required for a purchase return');
  if (!Array.isArray(input.items) || input.items.length === 0) throw invalid('Purchase return must include at least one item');
  const key = idempotencyKey(input.idempotencyKey);
  const refundMethod: PaymentMethod = input.refundMethod ?? 'CREDIT';

  return withTransaction(client, async (tx) => {
    // 1. Idempotency Check
    const existing = await tx.purchaseReturn.findUnique({
      where: { idempotencyKey: key },
      include: {
        items: { include: { product: true, batch: true } },
        supplier: true,
        purchase: true,
      },
    });
    if (existing) {
      if (existing.supplierId !== input.supplierId) {
        throw duplicate('Idempotency key was already used for a different purchase return');
      }
      return existing;
    }

    // 2. Validate Supplier
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw missing('Supplier');

    // 3. Optional Purchase validation
    let purchase: any = null;
    if (input.purchaseId) {
      purchase = await tx.purchase.findUnique({ where: { id: input.purchaseId } });
      if (!purchase) throw missing('Purchase');
      if (purchase.supplierId !== input.supplierId) {
        throw ruleViolation('Selected purchase does not belong to the selected supplier');
      }
    }

    // 4. Validate return lines against batches
    const processedLines: Array<{
      productId: string;
      batchId: string;
      purchaseItemId: string | null;
      quantity: number;
      unitPrice: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      batchNumber: string | null;
      expiryDate: Date | null;
      reason: string | null;
    }> = [];

    for (const [index, line] of input.items.entries()) {
      if (!line.productId?.trim()) throw invalid(`Item #${index + 1}: Product ID is required`);
      if (!line.batchId?.trim()) throw invalid(`Item #${index + 1}: Batch ID is required`);
      positiveQuantity(line.quantity, `Item #${index + 1} return quantity`);

      const product = await tx.product.findUnique({ where: { id: line.productId } });
      if (!product) throw missing(`Item #${index + 1}: Product`);

      const batch = await tx.productBatch.findUnique({ where: { id: line.batchId } });
      if (!batch || batch.productId !== line.productId) {
        throw missing(`Item #${index + 1}: Product batch`);
      }

      if (batch.quantity < line.quantity) {
        throw ruleViolation(
          `Insufficient stock in batch ${batch.batchNumber} for product ${product.name}. Available: ${batch.quantity}, Requested: ${line.quantity}`
        );
      }

      const unitPrice = line.unitPrice !== undefined
        ? nonNegativeMoney(line.unitPrice, `Item #${index + 1} unit price`)
        : batch.purchaseRate;

      const lineTotal = new Prisma.Decimal(Math.round(Number(unitPrice) * line.quantity * 100) / 100);

      processedLines.push({
        productId: product.id,
        batchId: batch.id,
        purchaseItemId: line.purchaseItemId?.trim() || null,
        quantity: line.quantity,
        unitPrice,
        totalAmount: lineTotal,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        reason: line.reason?.trim() || input.reason?.trim() || null,
      });
    }

    const totalReturnAmount = processedLines.reduce(
      (sum, line) => sum.plus(line.totalAmount),
      new Prisma.Decimal(0)
    );

    const returnNumber = generateReturnNumber('PR');

    // 5. Create PurchaseReturn
    const purchaseReturn = await tx.purchaseReturn.create({
      data: {
        returnNumber,
        supplierId: supplier.id,
        purchaseId: purchase?.id ?? null,
        totalAmount: totalReturnAmount,
        refundMethod,
        status: 'COMPLETED',
        reason: input.reason?.trim() || null,
        notes: input.notes?.trim() || null,
        createdById: input.createdById,
        idempotencyKey: key,
      },
    });

    // 6. Deduct stock from batches & record RETURN_OUT stock movements
    for (const [idx, line] of processedLines.entries()) {
      await tx.purchaseReturnItem.create({
        data: {
          purchaseReturnId: purchaseReturn.id,
          purchaseItemId: line.purchaseItemId,
          productId: line.productId,
          batchId: line.batchId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalAmount: line.totalAmount,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate,
          reason: line.reason,
        },
      });

      // Record RETURN_OUT movement (applyStockMovement atomically decrements batch quantity)
      await applyStockMovement(tx, {
        productId: line.productId,
        batchId: line.batchId,
        quantity: line.quantity,
        movementType: 'RETURN_OUT',
        reason: `Supplier return: ${line.reason || 'Returned to supplier'}`,
        referenceType: 'PURCHASE_RETURN',
        referenceId: purchaseReturn.id,
        createdById: input.createdById,
        idempotencyKey: `${key.slice(0, 80)}:stock:${idx}`,
      });
    }

    // 7. Financial Handling / Debit Note
    if (totalReturnAmount.gt(0)) {
      if (refundMethod === 'CREDIT') {
        // Debit Note: reduces supplier outstanding payable
        if (purchase && Number(purchase.outstandingAmount) > 0) {
          const deduction = Math.min(Number(totalReturnAmount), Number(purchase.outstandingAmount));
          await tx.purchase.update({
            where: { id: purchase.id },
            data: { outstandingAmount: { decrement: deduction } },
          });
        }
        await tx.supplier.update({
          where: { id: supplier.id },
          data: { outstanding: { decrement: totalReturnAmount } },
        });
      } else {
        // Direct cash/bank refund from supplier -> Cashbook IN
        await writeCashbookEntry(tx, {
          entryType: 'CASH_RECEIVED',
          direction: 'IN',
          amount: totalReturnAmount,
          paymentMethod: refundMethod,
          sourceType: 'PURCHASE_RETURN',
          sourceId: purchaseReturn.id,
          businessDate: input.businessDate ?? new Date(),
          notes: `Supplier refund for Return ${returnNumber} (${supplier.name})`,
          createdById: input.createdById,
          idempotencyKey: `${key.slice(0, 80)}:supplier_refund`,
        });
      }
    }

    // 8. Audit Log
    await tx.auditLog.create({
      data: {
        userId: input.createdById,
        action: 'PURCHASE_RETURN_CREATED',
        entityType: 'PurchaseReturn',
        entityId: purchaseReturn.id,
        newValue: {
          returnNumber,
          supplierId: supplier.id,
          supplierName: supplier.name,
          purchaseId: purchase?.id ?? null,
          totalAmount: totalReturnAmount.toFixed(2),
          refundMethod,
          itemCount: processedLines.length,
          actorId: input.createdById,
        },
      },
    });

    return tx.purchaseReturn.findUnique({
      where: { id: purchaseReturn.id },
      include: {
        items: { include: { product: true, batch: true } },
        supplier: true,
        purchase: true,
      },
    });
  });
};

export const listPurchaseReturns = async (filters: { supplierId?: string; purchaseId?: string; search?: string } = {}, client?: DbClient) => {
  const db = database(client);
  const query = filters.search?.trim();
  return db.purchaseReturn.findMany({
    where: {
      supplierId: filters.supplierId,
      purchaseId: filters.purchaseId,
      OR: query
        ? [
            { returnNumber: { contains: query, mode: 'insensitive' } },
            { supplier: { name: { contains: query, mode: 'insensitive' } } },
            { purchase: { invoiceNumber: { contains: query, mode: 'insensitive' } } },
          ]
        : undefined,
    },
    include: {
      supplier: { select: { id: true, name: true, phone: true, gstin: true } },
      purchase: { select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true } },
      items: { include: { product: true, batch: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
};

export const getPurchaseReturn = async (id: string, client?: DbClient) => {
  const db = database(client);
  const purchaseReturn = await db.purchaseReturn.findUnique({
    where: { id },
    include: {
      supplier: true,
      purchase: {
        include: {
          items: { include: { product: true, batch: true } },
        },
      },
      items: {
        include: {
          product: true,
          batch: true,
          purchaseItem: true,
        },
      },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!purchaseReturn) throw missing('Purchase return');
  return purchaseReturn;
};

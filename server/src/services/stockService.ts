import type { Prisma } from '@prisma/client';
import { database, invalid, missing, positiveQuantity, ruleViolation, withTransaction, type DbClient } from './domainUtils.js';

export type StockMovementKind =
  | 'PURCHASE_IN'
  | 'SALE_OUT'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'DAMAGE'
  | 'EXPIRY'
  | 'EXPIRED'
  | 'OPENING_STOCK';

const inbound = new Set(['PURCHASE_IN', 'RETURN_IN', 'ADJUSTMENT_IN', 'OPENING_STOCK']);
const outbound = new Set(['SALE_OUT', 'RETURN_OUT', 'ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRY', 'EXPIRED']);

export const applyStockMovement = async (tx: Prisma.TransactionClient, input: {
  shopId?: string;
  productId: string;
  batchId: string;
  quantity: number;
  movementType: StockMovementKind;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  createdById?: string;
  idempotencyKey?: string;
}) => {
  positiveQuantity(input.quantity);
  const isInbound = inbound.has(input.movementType);
  if (!isInbound && !outbound.has(input.movementType)) throw invalid('Unsupported stock movement type');
  if (input.idempotencyKey) {
    const prior = await tx.stockMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prior) return prior;
  }
  const batch = await tx.productBatch.findUnique({ where: { id: input.batchId } });
  if (!batch || batch.productId !== input.productId || (input.shopId && batch.shopId && batch.shopId !== input.shopId)) throw missing('Product batch');
  const targetShopId = input.shopId || batch.shopId || 'default-shop-pharmora';
  const afterQty = batch.quantity + (isInbound ? input.quantity : -input.quantity);
  if (afterQty < 0) throw ruleViolation('Insufficient stock in selected batch');
  if (isInbound) {
    await tx.productBatch.update({ where: { id: input.batchId }, data: { quantity: { increment: input.quantity } } });
  } else {
    const changed = await tx.productBatch.updateMany({
      where: { id: input.batchId, quantity: { gte: input.quantity } },
      data: { quantity: { decrement: input.quantity } },
    });
    if (changed.count !== 1) throw ruleViolation('Insufficient stock in selected batch');
  }
  return tx.stockMovement.create({
    data: {
      shopId: targetShopId,
      productId: input.productId,
      batchId: input.batchId,
      quantity: input.quantity,
      beforeQty: batch.quantity,
      afterQty,
      movementType: input.movementType,
      reason: input.reason,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      createdById: input.createdById,
      idempotencyKey: input.idempotencyKey,
    },
  });
};

export const adjustStock = async (input: Parameters<typeof applyStockMovement>[1], client?: DbClient) => {
  if (input.movementType !== 'ADJUSTMENT_IN' && input.movementType !== 'ADJUSTMENT_OUT' && input.movementType !== 'OPENING_STOCK') {
    throw invalid('adjustStock only accepts adjustment or opening stock movements');
  }
  return withTransaction(client, (tx) => applyStockMovement(tx, input));
};

export const addPurchaseStock = (input: Omit<Parameters<typeof applyStockMovement>[1], 'movementType'>, client?: DbClient) =>
  withTransaction(client, (tx) => applyStockMovement(tx, { ...input, movementType: 'PURCHASE_IN' }));

export const removeSaleStock = (input: Omit<Parameters<typeof applyStockMovement>[1], 'movementType'>, client?: DbClient) =>
  withTransaction(client, (tx) => applyStockMovement(tx, { ...input, movementType: 'SALE_OUT' }));

export const returnStock = (input: Omit<Parameters<typeof applyStockMovement>[1], 'movementType'> & { direction?: 'IN' | 'OUT' }, client?: DbClient) => {
  const { direction = 'IN', ...movement } = input;
  return withTransaction(client, (tx) =>
    applyStockMovement(tx, { ...movement, movementType: direction === 'IN' ? 'RETURN_IN' : 'RETURN_OUT' }),
  );
};

export const recordDamage = (input: Omit<Parameters<typeof applyStockMovement>[1], 'movementType'>, client?: DbClient) =>
  withTransaction(client, (tx) => applyStockMovement(tx, { ...input, movementType: 'DAMAGE' }));

export const recordExpiry = (input: Omit<Parameters<typeof applyStockMovement>[1], 'movementType'>, client?: DbClient) =>
  withTransaction(client, (tx) => applyStockMovement(tx, { ...input, movementType: 'EXPIRY' }));

import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type StockMovementType } from '@prisma/client';
import { AppError } from '../utils/appError.js';
import { database, duplicate, idempotencyKey, invalid, missing, ruleViolation, withTransaction, type DbClient } from './domainUtils.js';
import { normalizeBusinessDate } from './cashbookLedgerService.js';
import { applyStockMovement } from './stockService.js';
import {
  allocateFefo,
  calculateStockStatus,
  classifyExpiry,
  normalizeInventoryDate,
  orderFefoBatches,
  suggestedReorderQuantity,
  type ExpiryBucket,
} from './inventoryMath.js';

export type InventoryFilters = {
  search?: string;
  categoryId?: string;
  active?: boolean;
  stockStatus?: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'NORMAL';
  expiryStatus?: ExpiryBucket;
  page?: number;
  pageSize?: number;
  businessDate?: Date | string;
};

export type StockAdjustmentInput = {
  productId: string;
  batchId?: string;
  quantityChange: number;
  reason: 'DAMAGE' | 'EXPIRED' | 'FOUND' | 'COUNT_CORRECTION' | 'OTHER';
  note: string;
  actorId: string;
  idempotencyKey: string;
};

const productStock = (product: {
  id: string;
  name: string;
  genericName: string | null;
  brand: string | null;
  barcode: string | null;
  sku: string | null;
  mrp: Prisma.Decimal | null;
  sellingPrice: Prisma.Decimal | null;
  purchasePrice: Prisma.Decimal | null;
  minStock: number;
  maxStock: number | null;
  reorderLevel: number;
  active: boolean;
  rackLocation: string | null;
  categoryId: string | null;
  category: { id: string; name: string; active: boolean } | null;
  batches: Array<{ id: string; batchNumber: string; quantity: number; expiryDate: Date | null; createdAt: Date }>;
}, businessDate: Date | string = new Date()) => {
  const totalStock = product.batches.reduce((sum, batch) => sum + batch.quantity, 0);
  const availableBatches = product.active ? orderFefoBatches(product.batches, businessDate) : [];
  const availableStock = availableBatches.reduce((sum, batch) => sum + batch.quantity, 0);
  const stockStatus = calculateStockStatus(totalStock, product.reorderLevel);
  const nearestExpiry = availableBatches.find((batch) => batch.expiryDate)?.expiryDate ?? null;
  return {
    id: product.id,
    name: product.name,
    genericName: product.genericName,
    brand: product.brand,
    barcode: product.barcode,
    sku: product.sku,
    mrp: product.mrp?.toFixed(2) ?? null,
    sellingPrice: product.sellingPrice?.toFixed(2) ?? null,
    purchasePrice: product.purchasePrice?.toFixed(2) ?? null,
    minStock: product.minStock,
    maxStock: product.maxStock,
    reorderLevel: product.reorderLevel,
    rackLocation: product.rackLocation,
    active: product.active,
    category: product.category,
    totalStock,
    availableStock,
    stockStatus,
    suggestedReorderQuantity: suggestedReorderQuantity(totalStock, product.reorderLevel, product.maxStock),
    nearestExpiry,
    batchCount: product.batches.length,
    expiredBatchCount: product.batches.filter((batch) => batch.quantity > 0 && classifyExpiry(batch.expiryDate, businessDate) === 'EXPIRED').length,
  };
};

const buildProductWhere = (filters: InventoryFilters): Prisma.ProductWhereInput => {
  const query = filters.search?.trim();
  return {
    categoryId: filters.categoryId,
    active: filters.active,
    OR: query ? [
      { name: { contains: query, mode: 'insensitive' } },
      { genericName: { contains: query, mode: 'insensitive' } },
      { brand: { contains: query, mode: 'insensitive' } },
      { barcode: { contains: query, mode: 'insensitive' } },
      { sku: { contains: query, mode: 'insensitive' } },
    ] : undefined,
  };
};

export const getInventoryList = async (filters: InventoryFilters = {}, client?: DbClient) => {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw invalid('Invalid pagination values');
  }
  const businessDate = filters.businessDate ? normalizeInventoryDate(filters.businessDate) : normalizeInventoryDate(new Date());
  const db = database(client);
  const where = buildProductWhere(filters);
  const [products, total] = await Promise.all([
    db.product.findMany({ where, include: { category: true, batches: { orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }] } }, orderBy: { name: 'asc' } }),
    db.product.count({ where }),
  ]);
  let items = products.map((product) => {
    const batches = product.batches;
    const totalStock = batches.reduce((sum, batch) => sum + batch.quantity, 0);
    const availableStock = orderFefoBatches(batches, businessDate).reduce((sum, batch) => sum + batch.quantity, 0);
    const stockStatus = calculateStockStatus(totalStock, product.reorderLevel);
    const expiryStatuses = batches.filter((batch) => batch.quantity > 0).map((batch) => classifyExpiry(batch.expiryDate, businessDate));
    const item = {
      ...productStock(product),
      availableStock,
      expiryStatuses,
      batches: batches.map((batch) => ({ ...batch, expiryStatus: classifyExpiry(batch.expiryDate, businessDate) })),
    };
    return { ...item, stockStatus };
  });
  if (filters.stockStatus) items = items.filter((item) => item.stockStatus === filters.stockStatus);
  if (filters.expiryStatus) items = items.filter((item) => item.expiryStatuses.includes(filters.expiryStatus!));
  const filteredTotal = items.length;
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, total: filters.stockStatus || filters.expiryStatus ? filteredTotal : total, pages: Math.ceil((filters.stockStatus || filters.expiryStatus ? filteredTotal : total) / pageSize) },
    businessDate: businessDate.toISOString().slice(0, 10),
    stockSource: 'PRODUCT_BATCH_QUANTITY' as const,
  };
};

export const getProductStockSummary = async (productId: string, businessDate: Date | string = new Date(), client?: DbClient) => {
  const db = database(client);
  const product = await db.product.findUnique({
    where: { id: productId },
    include: {
      category: true,
      batches: { orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }] },
      stockMovements: { include: { createdBy: true, batch: true }, orderBy: { createdAt: 'desc' }, take: 100 },
    },
  });
  if (!product) throw missing('Product');
  const date = normalizeInventoryDate(businessDate);
  const summary = productStock(product);
  return {
    ...summary,
    businessDate: date.toISOString().slice(0, 10),
    batches: product.batches.map((batch) => ({ ...batch, expiryStatus: classifyExpiry(batch.expiryDate, date) })),
    stockMovements: product.stockMovements,
    stockSource: 'PRODUCT_BATCH_QUANTITY' as const,
  };
};

export const getLowStockProducts = async (filters: Omit<InventoryFilters, 'stockStatus' | 'expiryStatus'> = {}, client?: DbClient) =>
  getInventoryList({ ...filters, stockStatus: 'LOW_STOCK' }, client);

export const getOutOfStockProducts = async (filters: Omit<InventoryFilters, 'stockStatus' | 'expiryStatus'> = {}, client?: DbClient) =>
  getInventoryList({ ...filters, stockStatus: 'OUT_OF_STOCK' }, client);

export const getExpiryInventory = async (bucket: ExpiryBucket, filters: Omit<InventoryFilters, 'expiryStatus'> = {}, client?: DbClient) =>
  getInventoryList({ ...filters, expiryStatus: bucket }, client);

export const getFefoBatchAvailability = async (productId: string, quantity?: number, businessDate: Date | string = new Date(), client?: DbClient) => {
  const product = await database(client).product.findUnique({
    where: { id: productId },
    include: { batches: { orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (!product) throw missing('Product');
  const date = normalizeInventoryDate(businessDate);
  const eligible = product.batches.map((batch) => ({ ...batch, active: product.active, expiryStatus: classifyExpiry(batch.expiryDate, date) }));
  const result = quantity === undefined
    ? { totalAvailable: orderFefoBatches(eligible, date).reduce((sum, batch) => sum + batch.quantity, 0), allocations: orderFefoBatches(eligible, date).map((batch) => ({ batch, quantity: batch.quantity })) }
    : allocateFefo(eligible, quantity, date);
  return { productId, businessDate: date.toISOString().slice(0, 10), ...result };
};

const stockAudit = (
  tx: Prisma.TransactionClient,
  input: StockAdjustmentInput,
  values: { beforeQty: number; afterQty: number; movementIds: string[]; batchId: string | null },
) => tx.auditLog.create({
  data: {
    userId: input.actorId,
    action: 'STOCK_ADJUSTED',
    entityType: 'Product',
    entityId: input.productId,
    oldValue: { totalQuantity: values.beforeQty, batchId: values.batchId },
    newValue: {
      idempotencyKey: input.idempotencyKey,
      productId: input.productId,
      beforeQuantity: values.beforeQty,
      adjustment: input.quantityChange,
      totalQuantity: values.afterQty,
      batchId: values.batchId,
      reason: input.reason,
      note: input.note,
      actorId: input.actorId,
      stockMovementIds: values.movementIds,
    },
  },
});

export const adjustInventoryStock = async (input: StockAdjustmentInput, client?: DbClient) => {
  if (!Number.isInteger(input.quantityChange) || input.quantityChange === 0) throw invalid('Stock adjustment must be a non-zero whole number');
  if (!input.note.trim()) throw invalid('A note is required for stock adjustments');
  if (!input.actorId) throw invalid('An authenticated actor is required for stock adjustments');
  const key = idempotencyKey(input.idempotencyKey);
  return withTransaction(client, async (tx) => {
    const previous = await tx.auditLog.findFirst({ where: { action: 'STOCK_ADJUSTED', entityType: 'Product', newValue: { path: ['idempotencyKey'], equals: key } } });
    if (previous) {
      const value = previous.newValue as Record<string, unknown>;
      if (value.productId !== input.productId || value.adjustment !== input.quantityChange || value.reason !== input.reason || value.note !== input.note) {
        throw duplicate('Idempotency key was already used for a different stock adjustment');
      }
      return {
        audit: previous,
        movementIds: value.stockMovementIds,
        beforeQty: value.beforeQuantity,
        afterQty: value.totalQuantity,
        batchId: value.batchId,
      };
    }
    const product = await tx.product.findUnique({ where: { id: input.productId }, include: { batches: true } });
    if (!product) throw missing('Product');
    if (!product.active) throw ruleViolation('Inactive products cannot receive stock adjustments');
    const beforeQty = product.batches.reduce((sum, batch) => sum + batch.quantity, 0);
    const movementIds: string[] = [];
    let adjustedBatchId: string | null = input.batchId ?? null;
    const inbound = input.quantityChange > 0;
    if ((input.reason === 'DAMAGE' || input.reason === 'EXPIRED') && inbound) throw invalid('Damage/expiry adjustments must remove stock');
    if (input.reason === 'FOUND' && !inbound) throw invalid('Found stock adjustments must add stock');

    if (input.batchId) {
      const batch = product.batches.find((item) => item.id === input.batchId);
      if (!batch) throw missing('Product batch');
      if (input.reason === 'EXPIRED' && classifyExpiry(batch.expiryDate, new Date()) !== 'EXPIRED') {
        throw ruleViolation('Only expired batches can be adjusted with the EXPIRED reason');
      }
      const movementType: StockMovementType = input.reason === 'DAMAGE'
        ? 'DAMAGE'
        : input.reason === 'EXPIRED'
          ? 'EXPIRED'
          : inbound ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
      const movement = await applyStockMovement(tx, {
        productId: product.id,
        batchId: batch.id,
        quantity: Math.abs(input.quantityChange),
        movementType,
        reason: `${input.reason}: ${input.note}`,
        referenceType: 'STOCK_ADJUSTMENT',
        referenceId: key,
        createdById: input.actorId,
        idempotencyKey: `${key.slice(0, 96)}:0`,
      });
      movementIds.push(movement.id);
    } else if (inbound) {
      const generatedBatchNumber = `ADJ-${randomUUID()}`;
      const batch = await tx.productBatch.create({
        data: {
          productId: product.id,
          batchNumber: generatedBatchNumber,
          purchaseRate: product.purchasePrice ?? new Prisma.Decimal(0),
          mrp: product.mrp,
          sellingPrice: product.sellingPrice,
          gst: product.gst,
          quantity: 0,
        },
      });
      adjustedBatchId = batch.id;
      const movement = await applyStockMovement(tx, {
        productId: product.id,
        batchId: batch.id,
        quantity: input.quantityChange,
        movementType: 'ADJUSTMENT_IN',
        reason: `${input.reason}: ${input.note}`,
        referenceType: 'STOCK_ADJUSTMENT',
        referenceId: key,
        createdById: input.actorId,
        idempotencyKey: `${key.slice(0, 96)}:0`,
      });
      movementIds.push(movement.id);
    } else {
      let allocations: { totalAvailable: number; allocations: Array<{ batch: (typeof product.batches)[number]; quantity: number }> };
      if (input.reason === 'EXPIRED') {
        const expiredBatches = product.batches
          .filter((batch) => batch.quantity > 0 && classifyExpiry(batch.expiryDate, new Date()) === 'EXPIRED')
          .sort((left, right) => left.expiryDate!.getTime() - right.expiryDate!.getTime() || left.batchNumber.localeCompare(right.batchNumber));
        const totalAvailable = expiredBatches.reduce((total, batch) => total + batch.quantity, 0);
        if (totalAvailable < Math.abs(input.quantityChange)) throw new AppError('Insufficient expired stock for this adjustment', 422);
        let remaining = Math.abs(input.quantityChange);
        const expiredAllocations: Array<{ batch: (typeof product.batches)[number]; quantity: number }> = [];
        for (const batch of expiredBatches) {
          if (remaining === 0) break;
          const quantity = Math.min(batch.quantity, remaining);
          expiredAllocations.push({ batch, quantity });
          remaining -= quantity;
        }
        allocations = { totalAvailable, allocations: expiredAllocations };
      } else {
        allocations = allocateFefo(product.batches, Math.abs(input.quantityChange));
      }
      for (const [index, allocation] of allocations.allocations.entries()) {
        const movementType: StockMovementType = input.reason === 'DAMAGE'
          ? 'DAMAGE'
          : input.reason === 'EXPIRED' ? 'EXPIRED' : 'ADJUSTMENT_OUT';
        const movement = await applyStockMovement(tx, {
          productId: product.id,
          batchId: allocation.batch.id,
          quantity: allocation.quantity,
          movementType,
          reason: `${input.reason}: ${input.note}`,
          referenceType: 'STOCK_ADJUSTMENT',
          referenceId: key,
          createdById: input.actorId,
          idempotencyKey: `${key.slice(0, 90)}:${index}`,
        });
        movementIds.push(movement.id);
      }
    }

    const afterBatches = await tx.productBatch.findMany({ where: { productId: product.id }, select: { quantity: true } });
    const afterQty = afterBatches.reduce((sum, batch) => sum + batch.quantity, 0);
    const audit = await stockAudit(tx, input, { beforeQty, afterQty, movementIds, batchId: adjustedBatchId });
    return { audit, movementIds, beforeQty, afterQty, batchId: adjustedBatchId };
  });
};

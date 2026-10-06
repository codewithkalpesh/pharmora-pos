import { Prisma, type Prisma as PrismaTypes } from '@prisma/client';
import { database, invalid, missing, nonNegativeQuantity, positiveQuantity, withTransaction, type DbClient } from './domainUtils.js';
import { nonNegativeMoney, type MoneyInput } from './cashbookMath.js';

type BatchInput = {
  productId: string;
  batchNumber: string;
  purchaseRate: MoneyInput;
  mrp?: MoneyInput;
  sellingPrice?: MoneyInput;
  gst?: MoneyInput;
  quantity?: number;
  freeQuantity?: number;
  purchaseDate?: Date;
  expiryDate?: Date;
  supplierId?: string;
  createdById?: string;
};

const validateBatch = (input: BatchInput) => {
  if (!input.productId || !input.batchNumber?.trim()) throw invalid('Product and batch number are required');
  nonNegativeMoney(input.purchaseRate, 'Purchase rate');
  for (const [field, amount] of [['MRP', input.mrp], ['Selling price', input.sellingPrice], ['GST', input.gst]] as const) {
    if (amount !== undefined) nonNegativeMoney(amount, field);
  }
  if (input.quantity !== undefined) nonNegativeQuantity(input.quantity);
  if (input.freeQuantity !== undefined) nonNegativeQuantity(input.freeQuantity, 'Free quantity');
  if (input.expiryDate && Number.isNaN(input.expiryDate.getTime())) throw invalid('Expiry date is invalid');
};

export const createBatch = async (input: BatchInput, client?: DbClient, actorId?: string) => {
  validateBatch(input);
  if ((input.quantity ?? 0) > 0) throw invalid('Initial stock must be recorded through the stock service');
  return withTransaction(client, async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId }, select: { id: true, active: true } });
    if (!product) throw missing('Product');
    if (!product.active) throw invalid('Cannot add a batch to an inactive product');
    if (input.supplierId && !(await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true } }))) throw missing('Supplier');
    const batch = await tx.productBatch.create({
      data: {
        productId: input.productId,
        batchNumber: input.batchNumber.trim(),
        purchaseRate: nonNegativeMoney(input.purchaseRate),
        mrp: input.mrp === undefined ? undefined : nonNegativeMoney(input.mrp),
        sellingPrice: input.sellingPrice === undefined ? undefined : nonNegativeMoney(input.sellingPrice),
        gst: input.gst === undefined ? undefined : nonNegativeMoney(input.gst),
        quantity: 0,
        freeQuantity: input.freeQuantity ?? 0,
        purchaseDate: input.purchaseDate,
        expiryDate: input.expiryDate,
        supplierId: input.supplierId,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId ?? input.createdById,
        action: 'PRODUCT_BATCH_CREATED',
        entityType: 'ProductBatch',
        entityId: batch.id,
        oldValue: Prisma.JsonNull,
        newValue: {
          productId: batch.productId,
          batchNumber: batch.batchNumber,
          purchaseRate: batch.purchaseRate.toFixed(2),
          expiryDate: batch.expiryDate?.toISOString() ?? null,
          quantity: batch.quantity,
        },
      },
    });
    return batch;
  });
};

export const updateBatch = async (
  id: string,
  input: Partial<Pick<BatchInput, 'expiryDate' | 'mrp' | 'sellingPrice' | 'gst'>>,
  client?: DbClient,
  actorId?: string,
) => {
  const db = database(client);
  const batch = await db.productBatch.findUnique({ where: { id } });
  if (!batch) throw missing('Batch');
  for (const [field, amount] of [['MRP', input.mrp], ['Selling price', input.sellingPrice], ['GST', input.gst]] as const) {
    if (amount !== undefined) nonNegativeMoney(amount, field);
  }
  if (input.expiryDate && Number.isNaN(input.expiryDate.getTime())) throw invalid('Expiry date is invalid');
  const data: PrismaTypes.ProductBatchUncheckedUpdateInput = {
    expiryDate: input.expiryDate,
    mrp: input.mrp === undefined ? undefined : nonNegativeMoney(input.mrp),
    sellingPrice: input.sellingPrice === undefined ? undefined : nonNegativeMoney(input.sellingPrice),
    gst: input.gst === undefined ? undefined : nonNegativeMoney(input.gst),
  };
  return withTransaction(client, async (tx) => {
    const updated = await tx.productBatch.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: 'PRODUCT_BATCH_UPDATED',
        entityType: 'ProductBatch',
        entityId: id,
        oldValue: { expiryDate: batch.expiryDate?.toISOString() ?? null, mrp: batch.mrp?.toFixed(2) ?? null, sellingPrice: batch.sellingPrice?.toFixed(2) ?? null, gst: batch.gst?.toFixed(2) ?? null },
        newValue: { expiryDate: updated.expiryDate?.toISOString() ?? null, mrp: updated.mrp?.toFixed(2) ?? null, sellingPrice: updated.sellingPrice?.toFixed(2) ?? null, gst: updated.gst?.toFixed(2) ?? null },
      },
    });
    return updated;
  });
};

export const listBatches = async (productId: string, client?: DbClient) => {
  const db = database(client);
  if (!(await db.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw missing('Product');
  return db.productBatch.findMany({ where: { productId }, orderBy: [{ expiryDate: 'asc' }, { batchNumber: 'asc' }] });
};

export const listAvailableBatches = (productId: string, at = new Date(), client?: DbClient) =>
  database(client).productBatch.findMany({
    where: { productId, quantity: { gt: 0 }, OR: [{ expiryDate: null }, { expiryDate: { gte: at } }] },
    orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
  });

export const listExpiredBatches = (at = new Date(), client?: DbClient) =>
  database(client).productBatch.findMany({ where: { expiryDate: { lt: at }, quantity: { gt: 0 } }, include: { product: true } });

export const listNearExpiryBatches = (days = 30, at = new Date(), client?: DbClient) => {
  positiveQuantity(days, 'Days');
  const until = new Date(at);
  until.setDate(until.getDate() + days);
  return database(client).productBatch.findMany({
    where: { expiryDate: { gte: at, lte: until }, quantity: { gt: 0 } },
    include: { product: true, supplier: true },
    orderBy: { expiryDate: 'asc' },
  });
};

export const getExpiryDashboard = async (at = new Date(), client?: DbClient) => {
  const db = database(client);
  const now = new Date(at);

  const day30 = new Date(now);
  day30.setDate(day30.getDate() + 30);

  const day60 = new Date(now);
  day60.setDate(day60.getDate() + 60);

  const day90 = new Date(now);
  day90.setDate(day90.getDate() + 90);

  const allActiveBatches = await db.productBatch.findMany({
    where: {
      quantity: { gt: 0 },
      expiryDate: { not: null },
    },
    include: { product: true, supplier: true },
    orderBy: { expiryDate: 'asc' },
  });

  const expiredBatches: typeof allActiveBatches = [];
  const near30Batches: typeof allActiveBatches = [];
  const near60Batches: typeof allActiveBatches = [];
  const near90Batches: typeof allActiveBatches = [];

  let expiredTotalCost = 0;
  let expiredTotalUnits = 0;
  let near30TotalCost = 0;
  let near30TotalUnits = 0;
  let near60TotalCost = 0;
  let near60TotalUnits = 0;
  let near90TotalCost = 0;
  let near90TotalUnits = 0;

  for (const batch of allActiveBatches) {
    if (!batch.expiryDate) continue;
    const exp = batch.expiryDate;
    const cost = Number(batch.purchaseRate) * batch.quantity;

    if (exp < now) {
      expiredBatches.push(batch);
      expiredTotalCost += cost;
      expiredTotalUnits += batch.quantity;
    } else if (exp <= day30) {
      near30Batches.push(batch);
      near30TotalCost += cost;
      near30TotalUnits += batch.quantity;
    } else if (exp <= day60) {
      near60Batches.push(batch);
      near60TotalCost += cost;
      near60TotalUnits += batch.quantity;
    } else if (exp <= day90) {
      near90Batches.push(batch);
      near90TotalCost += cost;
      near90TotalUnits += batch.quantity;
    }
  }

  const mapBatchInfo = (batch: (typeof allActiveBatches)[number]) => {
    const exp = batch.expiryDate!;
    const diffMs = exp.getTime() - now.getTime();
    const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return {
      id: batch.id,
      productId: batch.productId,
      productName: batch.product.name,
      genericName: batch.product.genericName,
      brand: batch.product.brand,
      barcode: batch.product.barcode,
      batchNumber: batch.batchNumber,
      expiryDate: exp.toISOString(),
      daysUntilExpiry,
      quantity: batch.quantity,
      purchaseRate: Number(batch.purchaseRate),
      mrp: batch.mrp ? Number(batch.mrp) : null,
      sellingPrice: batch.sellingPrice ? Number(batch.sellingPrice) : null,
      totalCostValue: Math.round(Number(batch.purchaseRate) * batch.quantity * 100) / 100,
      totalMrpValue: batch.mrp ? Math.round(Number(batch.mrp) * batch.quantity * 100) / 100 : null,
      supplierId: batch.supplierId,
      supplierName: batch.supplier?.name ?? null,
      status: daysUntilExpiry <= 0 ? 'EXPIRED' : daysUntilExpiry <= 30 ? 'NEAR_30' : daysUntilExpiry <= 60 ? 'NEAR_60' : 'NEAR_90',
    };
  };

  return {
    summary: {
      expired: {
        count: expiredBatches.length,
        units: expiredTotalUnits,
        totalCost: Math.round(expiredTotalCost * 100) / 100,
      },
      near30Days: {
        count: near30Batches.length,
        units: near30TotalUnits,
        totalCost: Math.round(near30TotalCost * 100) / 100,
      },
      near60Days: {
        count: near60Batches.length,
        units: near60TotalUnits,
        totalCost: Math.round(near60TotalCost * 100) / 100,
      },
      near90Days: {
        count: near90Batches.length,
        units: near90TotalUnits,
        totalCost: Math.round(near90TotalCost * 100) / 100,
      },
    },
    batches: {
      expired: expiredBatches.map(mapBatchInfo),
      near30Days: near30Batches.map(mapBatchInfo),
      near60Days: near60Batches.map(mapBatchInfo),
      near90Days: near90Batches.map(mapBatchInfo),
      all: allActiveBatches.map(mapBatchInfo),
    },
    referenceDate: now.toISOString(),
  };
};


import { AppError } from '../utils/appError.js';

export type ExpiryBucket = 'EXPIRED' | 'DAYS_0_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_91_180' | 'SAFE';
export type StockStatus = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'NORMAL';

export type InventoryBatch = {
  id: string;
  batchNumber: string;
  quantity: number;
  expiryDate: Date | null;
  createdAt: Date;
  active?: boolean;
};

const DAY_MS = 86_400_000;

export const normalizeInventoryDate = (date: Date | string = new Date()) => {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (parsed.toISOString().slice(0, 10) !== date) throw new AppError('Business date is invalid', 400);
    return parsed;
  }
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) throw new AppError('Business date is invalid', 400);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
};

export const classifyExpiry = (expiryDate: Date | string | null, businessDate: Date | string = new Date()): ExpiryBucket => {
  if (expiryDate === null) return 'SAFE';
  const expires = normalizeInventoryDate(expiryDate);
  const today = normalizeInventoryDate(businessDate);
  const days = Math.floor((expires.getTime() - today.getTime()) / DAY_MS);
  if (days < 0) return 'EXPIRED';
  if (days <= 30) return 'DAYS_0_30';
  if (days <= 60) return 'DAYS_31_60';
  if (days <= 90) return 'DAYS_61_90';
  if (days <= 180) return 'DAYS_91_180';
  return 'SAFE';
};

export const calculateStockStatus = (quantity: number, reorderLevel: number) => {
  if (!Number.isInteger(quantity) || quantity < 0) throw new AppError('Stock quantity must be a non-negative integer', 400);
  if (!Number.isInteger(reorderLevel) || reorderLevel < 0) throw new AppError('Reorder level must be a non-negative integer', 400);
  if (quantity === 0) return 'OUT_OF_STOCK' satisfies StockStatus;
  if (quantity <= reorderLevel) return 'LOW_STOCK' satisfies StockStatus;
  return 'NORMAL' satisfies StockStatus;
};

export const suggestedReorderQuantity = (quantity: number, reorderLevel: number, maxStock: number | null) => {
  const target = maxStock !== null && maxStock > reorderLevel ? maxStock : reorderLevel;
  return Math.max(0, target - quantity);
};

const expiryOrder = (date: Date | null) => date?.getTime() ?? Number.POSITIVE_INFINITY;

export const orderFefoBatches = <T extends InventoryBatch>(batches: T[], businessDate: Date | string = new Date()) => {
  const today = normalizeInventoryDate(businessDate);
  return batches
    .filter((batch) => batch.active !== false && Number.isInteger(batch.quantity) && batch.quantity > 0)
    .filter((batch) => !batch.expiryDate || normalizeInventoryDate(batch.expiryDate) >= today)
    .sort((left, right) =>
      expiryOrder(left.expiryDate) - expiryOrder(right.expiryDate)
      || left.createdAt.getTime() - right.createdAt.getTime()
      || left.batchNumber.localeCompare(right.batchNumber)
      || left.id.localeCompare(right.id));
};

export const allocateFefo = <T extends InventoryBatch>(batches: T[], requestedQuantity: number, businessDate: Date | string = new Date()) => {
  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
    throw new AppError('Requested quantity must be a positive integer', 400);
  }
  const ordered = orderFefoBatches(batches, businessDate);
  const totalAvailable = ordered.reduce((total, batch) => total + batch.quantity, 0);
  if (totalAvailable < requestedQuantity) throw new AppError('Insufficient available stock for the requested quantity', 422);
  let remaining = requestedQuantity;
  const allocations = [] as Array<{ batch: T; quantity: number }>;
  for (const batch of ordered) {
    if (remaining === 0) break;
    const quantity = Math.min(batch.quantity, remaining);
    allocations.push({ batch, quantity });
    remaining -= quantity;
  }
  return { totalAvailable, allocations };
};

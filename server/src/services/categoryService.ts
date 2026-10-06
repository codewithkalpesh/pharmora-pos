import { Prisma } from '@prisma/client';
import { database, duplicate, invalid, missing, withTransaction, type DbClient } from './domainUtils.js';

export type CategoryInput = { name: string; shopId?: string };

const normalizeName = (name: string) => {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2) throw invalid('Category name must contain at least two characters');
  return normalized;
};

const categorySnapshot = (category: { id: string; name: string; active: boolean; shopId?: string }) => ({
  id: category.id,
  name: category.name,
  active: category.active,
  shopId: category.shopId,
});

const auditCategory = (
  tx: Prisma.TransactionClient,
  action: string,
  category: { id: string; name: string; active: boolean; shopId?: string },
  actorId?: string,
  oldCategory?: { id: string; name: string; active: boolean; shopId?: string },
) => tx.auditLog.create({
  data: {
    shopId: category.shopId,
    userId: actorId,
    action,
    entityType: 'Category',
    entityId: category.id,
    oldValue: oldCategory ? categorySnapshot(oldCategory) : Prisma.JsonNull,
    newValue: categorySnapshot(category),
  },
});

const ensureUniqueName = async (tx: Prisma.TransactionClient, name: string, shopId: string, excludingId?: string) => {
  const existing = await tx.category.findFirst({
    where: {
      shopId,
      name: { equals: name, mode: 'insensitive' },
      id: excludingId ? { not: excludingId } : undefined,
    },
    select: { id: true },
  });
  if (existing) throw duplicate('A category with this name already exists');
};

export const listCategories = (filters: { search?: string; active?: boolean; shopId?: string } = {}, client?: DbClient) => {
  const search = filters.search?.trim();
  const shopId = filters.shopId || 'default-shop-pharmora';
  return database(client).category.findMany({
    where: {
      shopId,
      active: filters.active,
      name: search ? { contains: search, mode: 'insensitive' } : undefined,
    },
    include: { _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  });
};

export const createCategory = (input: CategoryInput, client?: DbClient, actorId?: string, shopId?: string) =>
  withTransaction(client, async (tx) => {
    const targetShopId = shopId || input.shopId || 'default-shop-pharmora';
    const name = normalizeName(input.name);
    await ensureUniqueName(tx, name, targetShopId);
    const category = await tx.category.create({ data: { name, shopId: targetShopId } });
    await auditCategory(tx, 'CATEGORY_CREATED', category, actorId);
    return category;
  });

export const updateCategory = async (id: string, input: CategoryInput, client?: DbClient, actorId?: string, shopId?: string) =>
  withTransaction(client, async (tx) => {
    if (!id) throw invalid('Category ID is required');
    const oldCategory = await tx.category.findFirst({ where: { id, ...(shopId ? { shopId } : {}) } });
    if (!oldCategory) throw missing('Category');
    const targetShopId = shopId || oldCategory.shopId;
    const name = normalizeName(input.name);
    await ensureUniqueName(tx, name, targetShopId, id);
    const category = await tx.category.update({ where: { id: oldCategory.id }, data: { name } });
    await auditCategory(tx, 'CATEGORY_UPDATED', category, actorId, oldCategory);
    return category;
  });

export const setCategoryActive = async (id: string, active: boolean, client?: DbClient, actorId?: string, shopId?: string) =>
  withTransaction(client, async (tx) => {
    if (!id || typeof active !== 'boolean') throw invalid('Valid category ID and active state are required');
    const oldCategory = await tx.category.findFirst({ where: { id, ...(shopId ? { shopId } : {}) } });
    if (!oldCategory) throw missing('Category');
    if (oldCategory.active === active) return oldCategory;
    const category = await tx.category.update({ where: { id: oldCategory.id }, data: { active } });
    await auditCategory(tx, active ? 'CATEGORY_ACTIVATED' : 'CATEGORY_DEACTIVATED', category, actorId, oldCategory);
    return category;
  });

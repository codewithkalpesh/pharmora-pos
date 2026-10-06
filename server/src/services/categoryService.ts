import { Prisma } from '@prisma/client';
import { database, duplicate, invalid, missing, withTransaction, type DbClient } from './domainUtils.js';

export type CategoryInput = { name: string };

const normalizeName = (name: string) => {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2) throw invalid('Category name must contain at least two characters');
  return normalized;
};

const categorySnapshot = (category: { id: string; name: string; active: boolean }) => ({
  id: category.id,
  name: category.name,
  active: category.active,
});

const auditCategory = (
  tx: Prisma.TransactionClient,
  action: string,
  category: { id: string; name: string; active: boolean },
  actorId?: string,
  oldCategory?: { id: string; name: string; active: boolean },
) => tx.auditLog.create({
  data: {
    userId: actorId,
    action,
    entityType: 'Category',
    entityId: category.id,
    oldValue: oldCategory ? categorySnapshot(oldCategory) : Prisma.JsonNull,
    newValue: categorySnapshot(category),
  },
});

const ensureUniqueName = async (tx: Prisma.TransactionClient, name: string, excludingId?: string) => {
  const existing = await tx.category.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, id: excludingId ? { not: excludingId } : undefined },
    select: { id: true },
  });
  if (existing) throw duplicate('A category with this name already exists');
};

export const listCategories = (filters: { search?: string; active?: boolean } = {}, client?: DbClient) => {
  const search = filters.search?.trim();
  return database(client).category.findMany({
    where: {
      active: filters.active,
      name: search ? { contains: search, mode: 'insensitive' } : undefined,
    },
    include: { _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  });
};

export const createCategory = (input: CategoryInput, client?: DbClient, actorId?: string) =>
  withTransaction(client, async (tx) => {
    const name = normalizeName(input.name);
    await ensureUniqueName(tx, name);
    const category = await tx.category.create({ data: { name } });
    await auditCategory(tx, 'CATEGORY_CREATED', category, actorId);
    return category;
  });

export const updateCategory = async (id: string, input: CategoryInput, client?: DbClient, actorId?: string) =>
  withTransaction(client, async (tx) => {
    if (!id) throw invalid('Category ID is required');
    const oldCategory = await tx.category.findUnique({ where: { id } });
    if (!oldCategory) throw missing('Category');
    const name = normalizeName(input.name);
    await ensureUniqueName(tx, name, id);
    const category = await tx.category.update({ where: { id }, data: { name } });
    await auditCategory(tx, 'CATEGORY_UPDATED', category, actorId, oldCategory);
    return category;
  });

export const setCategoryActive = async (id: string, active: boolean, client?: DbClient, actorId?: string) =>
  withTransaction(client, async (tx) => {
    if (!id || typeof active !== 'boolean') throw invalid('Valid category ID and active state are required');
    const oldCategory = await tx.category.findUnique({ where: { id } });
    if (!oldCategory) throw missing('Category');
    if (oldCategory.active === active) return oldCategory;
    const category = await tx.category.update({ where: { id }, data: { active } });
    await auditCategory(tx, active ? 'CATEGORY_ACTIVATED' : 'CATEGORY_DEACTIVATED', category, actorId, oldCategory);
    return category;
  });

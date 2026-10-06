import { Prisma, type Prisma as PrismaTypes } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { database, duplicate, invalid, missing, nonNegativeQuantity, withTransaction, type DbClient } from './domainUtils.js';
import { nonNegativeMoney, type MoneyInput } from './cashbookMath.js';

export type ProductInput = {
  name: string;
  genericName?: string;
  brand?: string;
  barcode?: string;
  sku?: string;
  hsn?: string;
  gst?: MoneyInput | null;
  mrp?: MoneyInput | null;
  sellingPrice?: MoneyInput | null;
  purchasePrice?: MoneyInput | null;
  minStock?: number;
  maxStock?: number;
  reorderLevel?: number;
  active?: boolean;
  rackLocation?: string;
  supplierId?: string | null;
  categoryId?: string | null;
};

const validateProduct = (input: ProductInput) => {
  if (!input.name?.trim()) throw invalid('Product name is required');
  for (const field of ['gst', 'mrp', 'sellingPrice', 'purchasePrice'] as const) {
    if (input[field] !== undefined && input[field] !== null) nonNegativeMoney(input[field]!, field);
  }
  for (const field of ['minStock', 'maxStock', 'reorderLevel'] as const) {
    if (input[field] !== undefined) nonNegativeQuantity(input[field]!, field);
  }
  if (input.minStock !== undefined && input.maxStock !== undefined && input.maxStock < input.minStock) {
    throw invalid('Maximum stock cannot be below minimum stock');
  }
};

const decimalOrNull = (value: MoneyInput | null | undefined) =>
  value === undefined || value === null ? value : nonNegativeMoney(value);

const productData = (input: ProductInput): PrismaTypes.ProductUncheckedCreateInput => {
  validateProduct(input);
  return {
    name: input.name.trim(),
    genericName: input.genericName?.trim() || null,
    brand: input.brand?.trim() || null,
    barcode: input.barcode?.trim() || null,
    sku: input.sku?.trim() || null,
    hsn: input.hsn?.trim() || null,
    gst: decimalOrNull(input.gst),
    mrp: decimalOrNull(input.mrp),
    sellingPrice: decimalOrNull(input.sellingPrice),
    purchasePrice: decimalOrNull(input.purchasePrice),
    minStock: input.minStock ?? 0,
    maxStock: input.maxStock,
    reorderLevel: input.reorderLevel ?? 0,
    active: input.active ?? true,
    rackLocation: input.rackLocation?.trim() || null,
    supplierId: input.supplierId,
    categoryId: input.categoryId,
  };
};

const productSnapshot = (product: {
  id: string; name: string; genericName: string | null; brand: string | null; barcode: string | null; sku: string | null;
  categoryId: string | null; gst: PrismaTypes.Decimal | null; mrp: PrismaTypes.Decimal | null;
  sellingPrice: PrismaTypes.Decimal | null; purchasePrice: PrismaTypes.Decimal | null; minStock: number; maxStock: number | null;
  reorderLevel: number; rackLocation: string | null; active: boolean;
}) => ({
  id: product.id,
  name: product.name,
  genericName: product.genericName,
  brand: product.brand,
  barcode: product.barcode,
  sku: product.sku,
  categoryId: product.categoryId,
  gst: product.gst?.toFixed(2) ?? null,
  mrp: product.mrp?.toFixed(2) ?? null,
  sellingPrice: product.sellingPrice?.toFixed(2) ?? null,
  purchasePrice: product.purchasePrice?.toFixed(2) ?? null,
  minStock: product.minStock,
  maxStock: product.maxStock,
  reorderLevel: product.reorderLevel,
  rackLocation: product.rackLocation,
  active: product.active,
});

const auditProduct = (
  tx: PrismaTypes.TransactionClient,
  action: string,
  product: Parameters<typeof productSnapshot>[0],
  actorId?: string,
  oldProduct?: Parameters<typeof productSnapshot>[0],
) => tx.auditLog.create({
  data: {
    userId: actorId,
    action,
    entityType: 'Product',
    entityId: product.id,
    oldValue: oldProduct ? productSnapshot(oldProduct) : Prisma.JsonNull,
    newValue: productSnapshot(product),
  },
});

const validateRelations = async (tx: PrismaTypes.TransactionClient, input: Pick<ProductInput, 'categoryId' | 'supplierId'>) => {
  if (input.categoryId) {
    const category = await tx.category.findUnique({ where: { id: input.categoryId } });
    if (!category) throw missing('Category');
    if (!category.active) throw invalid('Cannot assign an inactive category to a product');
  }
  if (input.supplierId && !(await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true } }))) {
    throw missing('Supplier');
  }
};

const validateProductCodes = async (
  tx: PrismaTypes.TransactionClient,
  input: Pick<ProductInput, 'barcode' | 'sku'>,
  excludingId?: string,
) => {
  const conditions: PrismaTypes.ProductWhereInput[] = [];
  if (input.barcode) conditions.push({ barcode: input.barcode.trim() });
  if (input.sku) conditions.push({ sku: input.sku.trim() });
  if (!conditions.length) return;
  const match = await tx.product.findFirst({
    where: { OR: conditions, id: excludingId ? { not: excludingId } : undefined },
    select: { barcode: true, sku: true },
  });
  if (match?.barcode && match.barcode === input.barcode?.trim()) throw duplicate('A product with this barcode already exists');
  if (match?.sku && match.sku === input.sku?.trim()) throw duplicate('A product with this SKU already exists');
};

export const createProduct = (input: ProductInput, client?: DbClient, actorId?: string) =>
  withTransaction(client, async (tx) => {
    const data = productData(input);
    await validateRelations(tx, input);
    await validateProductCodes(tx, input);
    const product = await tx.product.create({ data });
    await auditProduct(tx, 'PRODUCT_CREATED', product, actorId);
    return product;
  });

export const updateProduct = async (id: string, input: Partial<ProductInput>, client?: DbClient, actorId?: string) => {
  if (!id) throw invalid('Product ID is required');
  validateProduct({ name: 'existing', ...input });
  return withTransaction(client, async (tx) => {
    const existing = await tx.product.findUnique({ where: { id } });
    if (!existing) throw missing('Product');
    const mergedMin = input.minStock ?? existing.minStock;
    const mergedMax = input.maxStock === undefined ? existing.maxStock : input.maxStock;
    if (mergedMax !== null && mergedMax < mergedMin) throw invalid('Maximum stock cannot be below minimum stock');
    await validateRelations(tx, input);
    await validateProductCodes(tx, input, id);
    const data: PrismaTypes.ProductUncheckedUpdateInput = {};
    for (const key of ['name', 'genericName', 'brand', 'barcode', 'sku', 'hsn', 'rackLocation'] as const) {
      const value = input[key];
      if (typeof value === 'string') data[key] = value.trim() as never;
      else if (value === null && key !== 'name') data[key] = null as never;
    }
    for (const key of ['gst', 'mrp', 'sellingPrice', 'purchasePrice'] as const) {
      const value = input[key];
      if (value !== undefined) data[key] = decimalOrNull(value);
    }
    for (const key of ['minStock', 'maxStock', 'reorderLevel', 'active', 'supplierId', 'categoryId'] as const) {
      if (input[key] !== undefined) data[key] = input[key] as never;
    }
    const product = await tx.product.update({ where: { id }, data });
    await auditProduct(tx, 'PRODUCT_UPDATED', product, actorId, existing);
    return product;
  });
};

export const getProduct = async (id: string, client?: DbClient) => {
  const product = await database(client).product.findUnique({
    where: { id },
    include: { category: true, supplier: true, batches: { orderBy: { expiryDate: 'asc' } } },
  });
  if (!product) throw missing('Product');
  return product;
};

export type ProductListFilters = {
  search?: string;
  categoryId?: string;
  active?: boolean;
  page?: number;
  pageSize?: number;
};

export const listProducts = (search?: string, client?: DbClient) =>
  listProductsPage({ search }, client).then((result) => result.items);

export const listProductsPage = async (filters: ProductListFilters = {}, client?: DbClient) => {
  const query = filters.search?.trim();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw invalid('Invalid pagination values');
  }
  const where: PrismaTypes.ProductWhereInput = {
    categoryId: filters.categoryId,
    active: filters.active,
    OR: query
      ? [
          { name: { contains: query, mode: 'insensitive' } },
          { genericName: { contains: query, mode: 'insensitive' } },
          { brand: { contains: query, mode: 'insensitive' } },
          { barcode: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
        ]
      : undefined,
  };
  const db = database(client);
  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      include: { category: true, supplier: true },
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.product.count({ where }),
  ]);
  return { items, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } };
};

export const setProductActive = async (id: string, active: boolean, client?: DbClient, actorId?: string) => {
  if (typeof active !== 'boolean') throw invalid('Active must be a boolean');
  return withTransaction(client, async (tx) => {
    const existing = await tx.product.findUnique({ where: { id } });
    if (!existing) throw missing('Product');
    if (existing.active === active) return existing;
    const product = await tx.product.update({ where: { id }, data: { active } });
    await auditProduct(tx, active ? 'PRODUCT_ACTIVATED' : 'PRODUCT_DEACTIVATED', product, actorId, existing);
    return product;
  });
};

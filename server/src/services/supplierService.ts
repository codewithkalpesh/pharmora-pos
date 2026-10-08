import { Prisma } from '@prisma/client';
import { database, invalid, missing, nonNegativeAmount, type DbClient } from './domainUtils.js';

type SupplierInput = {
  shopId?: string;
  name: string;
  phone?: string;
  gstin?: string;
  address?: string;
  paymentTerms?: string;
  creditLimit?: number;
};

const validate = (input: Partial<SupplierInput>) => {
  if (input.name !== undefined && !input.name.trim()) throw invalid('Supplier name is required');
  if (input.creditLimit !== undefined) nonNegativeAmount(input.creditLimit, 'Credit limit');
};

const supplierSnapshot = (supplier: any) => ({
  id: supplier.id,
  shopId: supplier.shopId,
  name: supplier.name,
  phone: supplier.phone ?? null,
  gstin: supplier.gstin ?? null,
  address: supplier.address ?? null,
  paymentTerms: supplier.paymentTerms ?? null,
  creditLimit: supplier.creditLimit ? Number(supplier.creditLimit) : null,
  outstanding: supplier.outstanding ? Number(supplier.outstanding) : 0,
});

const auditSupplier = async (
  db: DbClient,
  action: string,
  supplier: any,
  actorId?: string,
  oldSupplier?: any,
) => {
  if ('auditLog' in db && typeof (db as any).auditLog?.create === 'function') {
    await (db as any).auditLog.create({
      data: {
        shopId: supplier.shopId,
        userId: actorId || null,
        action,
        entityType: 'Supplier',
        entityId: supplier.id,
        oldValue: oldSupplier ? supplierSnapshot(oldSupplier) : Prisma.JsonNull,
        newValue: supplierSnapshot(supplier),
      },
    });
  }
};

export const createSupplier = async (input: SupplierInput, client?: DbClient, actorId?: string, shopId?: string) => {
  validate(input);
  const db = database(client);
  const targetShopId = shopId || input.shopId || 'default-shop-pharmora';
  const supplier = await db.supplier.create({
    data: {
      ...input,
      name: input.name.trim(),
      shopId: targetShopId,
    },
  });
  await auditSupplier(db, 'SUPPLIER_CREATED', supplier, actorId);
  return supplier;
};

export const updateSupplier = async (id: string, input: Partial<SupplierInput>, client?: DbClient, actorId?: string, shopId?: string) => {
  validate(input);
  const db = database(client);
  const existing = db.supplier.findFirst
    ? await db.supplier.findFirst({ where: { id, ...(shopId ? { shopId } : {}) } })
    : await db.supplier.findUnique({ where: { id } });
  if (!existing) throw missing('Supplier');
  const updated = await db.supplier.update({ where: { id: existing.id }, data: input });
  await auditSupplier(db, 'SUPPLIER_UPDATED', updated, actorId, existing);
  return updated;
};

export const listSuppliers = async (search?: string, client?: DbClient, shopId?: string) => {
  const query = search?.trim();
  const db = database(client);
  const targetShopId = shopId || 'default-shop-pharmora';
  const suppliers = await db.supplier.findMany({
    where: {
      shopId: targetShopId,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { phone: { contains: query, mode: 'insensitive' } },
              { gstin: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      purchases: { select: { id: true, totalAmount: true, paidAmount: true, outstandingAmount: true } },
      supplierPayments: { select: { id: true, amount: true } },
    },
    orderBy: { name: 'asc' },
  });

  return suppliers.map((supplier) => {
    const calculatedOutstanding = supplier.purchases.reduce((total, p) => total + Number(p.outstandingAmount ?? 0), 0);
    return {
      ...supplier,
      outstanding: Math.round(calculatedOutstanding * 100) / 100,
      totalPurchases: supplier.purchases.length,
    };
  });
};

export const getSupplier = async (id: string, client?: DbClient, shopId?: string) => {
  const db = database(client);
  const supplier = db.supplier.findFirst
    ? await db.supplier.findFirst({
        where: { id, ...(shopId ? { shopId } : {}) },
        include: {
          purchases: {
            include: { items: { include: { product: true, batch: true } }, supplierPayments: true },
            orderBy: { invoiceDate: 'desc' },
          },
          supplierPayments: { orderBy: { paymentDate: 'desc' } },
        },
      })
    : await db.supplier.findUnique({
        where: { id },
        include: {
          purchases: {
            include: { items: { include: { product: true, batch: true } }, supplierPayments: true },
            orderBy: { invoiceDate: 'desc' },
          },
          supplierPayments: { orderBy: { paymentDate: 'desc' } },
        },
      });
  if (!supplier || (shopId && (supplier as any).shopId && (supplier as any).shopId !== shopId)) throw missing('Supplier');

  const calculatedOutstanding = supplier.purchases.reduce((total, purchase) => {
    return total + Math.max(0, Number(purchase.outstandingAmount ?? (Number(purchase.totalAmount) - Number(purchase.paidAmount))));
  }, 0);

  return {
    ...supplier,
    outstanding: Math.round(calculatedOutstanding * 100) / 100,
    outstandingPayable: Math.round(calculatedOutstanding * 100) / 100,
  };
};

import { database, invalid, missing, type DbClient } from './domainUtils.js';

type CustomerInput = { name: string; phone?: string; address?: string; notes?: string; shopId?: string };

export const createCustomer = (input: CustomerInput, client?: DbClient, shopId?: string) => {
  if (!input.name?.trim()) throw invalid('Customer name is required');
  const targetShopId = shopId || input.shopId || 'default-shop-pharmora';
  return database(client).customer.create({
    data: {
      ...input,
      name: input.name.trim(),
      shopId: targetShopId,
    },
  });
};

export const updateCustomer = async (id: string, input: Partial<CustomerInput>, client?: DbClient, shopId?: string) => {
  if (input.name !== undefined && !input.name.trim()) throw invalid('Customer name is required');
  const db = database(client);
  const existing = await db.customer.findFirst({
    where: { id, ...(shopId ? { shopId } : {}) },
    select: { id: true },
  });
  if (!existing) throw missing('Customer');
  return db.customer.update({ where: { id: existing.id }, data: input });
};

export const listCustomers = (search?: string, client?: DbClient, shopId?: string) => {
  const query = search?.trim();
  const targetShopId = shopId || 'default-shop-pharmora';
  return database(client).customer.findMany({
    where: {
      shopId: targetShopId,
      ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { phone: { contains: query } }] } : {}),
    },
    orderBy: { name: 'asc' },
  });
};

export const getCustomer = async (id: string, client?: DbClient, shopId?: string) => {
  const db = database(client);
  const customer = db.customer.findFirst
    ? await db.customer.findFirst({
        where: { id, ...(shopId ? { shopId } : {}) },
        include: {
          sales: { include: { items: true, payments: true }, orderBy: { saleDate: 'desc' } },
          payments: { orderBy: { paymentDate: 'desc' } },
          customerCredits: { orderBy: { createdAt: 'desc' } },
        },
      })
    : await db.customer.findUnique({
        where: { id },
        include: {
          sales: { include: { items: true, payments: true }, orderBy: { saleDate: 'desc' } },
          payments: { orderBy: { paymentDate: 'desc' } },
          customerCredits: { orderBy: { createdAt: 'desc' } },
        },
      });
  if (!customer || (shopId && (customer as any).shopId && (customer as any).shopId !== shopId)) {
    throw missing('Customer');
  }
  const outstandingCredit = (customer.customerCredits || []).reduce((sum: number, credit: any) => sum + Number(credit.balanceAmount), 0);
  return { ...customer, outstanding: Math.round(outstandingCredit * 100) / 100 };
};

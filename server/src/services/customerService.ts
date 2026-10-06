import { database, invalid, missing, type DbClient } from './domainUtils.js';

type CustomerInput = { name: string; phone?: string; address?: string; notes?: string };

export const createCustomer = (input: CustomerInput, client?: DbClient) => {
  if (!input.name?.trim()) throw invalid('Customer name is required');
  return database(client).customer.create({ data: { ...input, name: input.name.trim() } });
};

export const updateCustomer = async (id: string, input: Partial<CustomerInput>, client?: DbClient) => {
  if (input.name !== undefined && !input.name.trim()) throw invalid('Customer name is required');
  const db = database(client);
  if (!(await db.customer.findUnique({ where: { id }, select: { id: true } }))) throw missing('Customer');
  return db.customer.update({ where: { id }, data: input });
};

export const listCustomers = (search?: string, client?: DbClient) => {
  const query = search?.trim();
  return database(client).customer.findMany({
    where: query ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { phone: { contains: query } }] } : undefined,
    orderBy: { name: 'asc' },
  });
};

export const getCustomer = async (id: string, client?: DbClient) => {
  const customer = await database(client).customer.findUnique({
    where: { id },
    include: {
      sales: { include: { items: true, payments: true }, orderBy: { saleDate: 'desc' } },
      payments: { orderBy: { paymentDate: 'desc' } },
      customerCredits: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!customer) throw missing('Customer');
  const outstandingCredit = customer.customerCredits.reduce((sum, credit) => sum + Number(credit.balanceAmount), 0);
  return { ...customer, outstanding: Math.round(outstandingCredit * 100) / 100 };
};

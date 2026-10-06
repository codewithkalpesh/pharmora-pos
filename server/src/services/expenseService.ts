import type { PaymentMethod, PrismaClient } from '@prisma/client';
import { writeCashbookEntry } from './cashbookService.js';
import { database, duplicate, idempotencyKey, invalid, isUniqueConstraintError, nonNegativeAmount, withTransaction, type DbClient } from './domainUtils.js';
import { paymentAccounts } from './transactionUtils.js';
import { sendExpenseSummary } from './telegramService.js';

export const createExpense = async (input: {
  shopId?: string;
  category: string;
  amount: number;
  expenseDate?: Date;
  paymentMethod: PaymentMethod;
  cashAmount?: number;
  upiAmount?: number;
  description?: string;
  receiptUrl?: string;
  createdById?: string;
}, key: string, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const targetShopId = input.shopId || shopId;
  const stableKey = idempotencyKey(key);
  if (!input.category?.trim()) throw invalid('Expense category is required');
  nonNegativeAmount(input.amount, 'Expense amount');
  if (input.amount === 0) throw invalid('Expense amount must be greater than zero');
  if (input.expenseDate && Number.isNaN(input.expenseDate.getTime())) throw invalid('Expense date is invalid');
  const accounts = paymentAccounts(input.paymentMethod, input.amount, input.cashAmount, input.upiAmount);
  const db = database(client);
  const prior = await db.expense.findUnique({ where: { idempotencyKey: stableKey } });
  if (prior) return prior;
  try {
    const createdExpense = await withTransaction(client, async (tx) => {
      const expense = await tx.expense.create({
        data: {
          shopId: targetShopId,
          category: input.category.trim(),
          amount: input.amount,
          expenseDate: input.expenseDate ?? new Date(),
          paymentMethod: input.paymentMethod,
          cashAmount: input.cashAmount,
          upiAmount: input.upiAmount,
          description: input.description,
          receiptUrl: input.receiptUrl,
          referenceType: 'EXPENSE',
          idempotencyKey: stableKey,
          createdById: input.createdById,
        },
      });
      for (const [index, account] of accounts.entries()) {
        await writeCashbookEntry(tx, {
          shopId: targetShopId,
          entryType: 'EXPENSE',
          direction: 'OUT',
          amount: account.amount,
          paymentMethod: account.method,
          sourceType: 'EXPENSE',
          sourceId: expense.id,
          notes: input.description,
          createdById: input.createdById,
          idempotencyKey: `${stableKey.slice(0, 112)}:entry-${index}`,
        });
      }
      return expense;
    });

    if (createdExpense) {
      setImmediate(() => {
        sendExpenseSummary(createdExpense.id, client, input.createdById, targetShopId).catch(() => {});
      });
    }

    return createdExpense;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const original = await db.expense.findUnique({ where: { idempotencyKey: stableKey } });
      if (original) return original;
      throw duplicate('Expense idempotency key already exists');
    }
    throw error;
  }
};

export const listExpenses = (filters: { category?: string; from?: Date; to?: Date; shopId?: string } = {}, client?: PrismaClient, shopId = 'default-shop-pharmora') => {
  const targetShopId = filters.shopId || shopId;
  if (filters.from && Number.isNaN(filters.from.getTime())) throw invalid('Start date is invalid');
  if (filters.to && Number.isNaN(filters.to.getTime())) throw invalid('End date is invalid');
  return database(client).expense.findMany({
    where: {
      shopId: targetShopId,
      category: filters.category,
      expenseDate: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
    },
    orderBy: { expenseDate: 'desc' },
  });
};

export const listExpenseCategories = async (client?: PrismaClient, shopId = 'default-shop-pharmora') => {
  const rows = await database(client).expense.findMany({
    where: { shopId },
    distinct: ['category'],
    select: { category: true },
    orderBy: { category: 'asc' },
  });
  return rows.map((row) => row.category);
};

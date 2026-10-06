import type { CashbookDirection, CashbookEntryType, PaymentMethod, Prisma, PrismaClient } from '@prisma/client';
import { Prisma as PrismaRuntime } from '@prisma/client';
import { AppError } from '../utils/appError.js';
import { database, duplicate, idempotencyKey, invalid, missing, ruleViolation, withTransaction, type DbClient } from './domainUtils.js';
import {
  applyOpeningCorrections,
  calculateClosingDifference,
  calculateDrawerTotals,
  closingStatus,
  moneyDecimal,
  moneyString,
  nonNegativeMoney,
  positiveMoney,
  type MoneyInput,
} from './cashbookMath.js';
import { sendDailyClosingSummary } from './telegramService.js';

const openingTypes = new Set<CashbookEntryType>(['OPENING_CASH', 'OPENING_CASH_CORRECTION']);
const inflowTypes = new Set<CashbookEntryType>([
  'CASH_SALE', 'CUSTOMER_PAYMENT', 'OTHER_INCOME', 'CASH_RECEIVED', 'SALE', 'MONEY_IN', 'BANK_TO_CASH',
]);
const outflowTypes = new Set<CashbookEntryType>([
  'CASH_PURCHASE', 'EXPENSE', 'SUPPLIER_PAYMENT', 'CUSTOMER_REFUND', 'MONEY_OUT',
]);
const physicalCashTypes = new Set<CashbookEntryType>([
  'CASH_SALE', 'CASH_PURCHASE', 'OTHER_INCOME', 'CASH_RECEIVED', 'CASH_ADJUSTMENT',
  'CUSTOMER_REFUND', 'OPENING_CASH', 'OPENING_CASH_CORRECTION', 'BANK_DEPOSIT',
]);

export type CashbookEntryInput = {
  shopId?: string;
  entryType: CashbookEntryType;
  direction: CashbookDirection;
  amount: MoneyInput;
  paymentMethod: PaymentMethod;
  sourceType: string;
  sourceId: string;
  businessDate?: Date | string;
  description?: string;
  notes?: string;
  createdById?: string;
  paymentId?: string;
  idempotencyKey?: string;
};

export const normalizeBusinessDate = (value: Date | string = new Date()) => {
  const parsed = value instanceof Date ? value : /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw invalid('Business date is invalid');
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
};

const nextBusinessDate = (date: Date) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
};

const businessDateKey = (date: Date) => date.toISOString().slice(0, 10);
const centsText = (amount: PrismaRuntime.Decimal) => amount.toFixed(2);

const validateEntrySemantics = (input: CashbookEntryInput) => {
  if (!input.sourceType.trim() || !input.sourceId.trim()) throw invalid('Cashbook source reference is required');
  const method = input.paymentMethod;
  if (physicalCashTypes.has(input.entryType) && input.entryType !== 'BANK_DEPOSIT' && method !== 'CASH') {
    throw invalid('This entry type must affect physical cash');
  }
  if (input.entryType === 'OPENING_CASH' && (method !== 'CASH' || input.direction !== 'IN')) {
    throw invalid('Opening cash must be recorded as a cash inflow');
  }
  if (input.entryType === 'OPENING_CASH_CORRECTION' && method !== 'CASH') {
    throw invalid('Opening cash corrections must affect physical cash');
  }
  if (input.entryType === 'BANK_DEPOSIT' && !((method === 'CASH' && input.direction === 'OUT') || (method === 'BANK' && input.direction === 'IN'))) {
    throw invalid('A bank deposit requires a cash outflow and a matching bank inflow');
  }
  if (input.entryType === 'CASH_TO_BANK' && !((method === 'CASH' && input.direction === 'OUT') || (method === 'BANK' && input.direction === 'IN'))) {
    throw invalid('Cash-to-bank transfer directions are invalid');
  }
  if (input.entryType === 'BANK_TO_CASH' && !((method === 'BANK' && input.direction === 'OUT') || (method === 'CASH' && input.direction === 'IN'))) {
    throw invalid('Bank-to-cash transfer directions are invalid');
  }
  if (inflowTypes.has(input.entryType) && input.direction !== 'IN') throw invalid('This cashbook type must be an inflow');
  if (outflowTypes.has(input.entryType) && input.direction !== 'OUT') throw invalid('This cashbook type must be an outflow');
};

const auditEntry = (tx: Prisma.TransactionClient, entry: {
  id: string;
  shopId: string;
  entryType: CashbookEntryType;
  direction: CashbookDirection;
  amount: PrismaRuntime.Decimal;
  paymentMethod: PaymentMethod | null;
  businessDate: Date;
  sourceType: string | null;
  sourceId: string | null;
  notes: string | null;
  createdById: string | null;
}) => tx.auditLog.create({
  data: {
    shopId: entry.shopId,
    userId: entry.createdById,
    action: 'CASHBOOK_ENTRY_CREATED',
    entityType: 'CashbookEntry',
    entityId: entry.id,
    oldValue: PrismaRuntime.JsonNull,
    newValue: {
      entryType: entry.entryType,
      direction: entry.direction,
      amount: centsText(entry.amount),
      paymentMethod: entry.paymentMethod,
      businessDate: businessDateKey(entry.businessDate),
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      notes: entry.notes,
    },
  },
});

const bankBalanceFor = async (tx: Prisma.TransactionClient, accountId: string, shopId = 'default-shop-pharmora') => {
  const account = await tx.bankAccount.findFirst({ where: { id: accountId, shopId } });
  if (!account) throw missing('Bank account');
  const transactions = await tx.bankTransaction.findMany({
    where: { bankAccountId: accountId, shopId },
    select: { transactionType: true, amount: true },
  });
  return transactions.reduce((balance, transaction) => {
    const amount = moneyDecimal(transaction.amount);
    return transaction.transactionType === 'CREDIT' ? balance.plus(amount) : balance.minus(amount);
  }, moneyDecimal(account.openingBalance));
};

export const writeCashbookEntry = async (tx: Prisma.TransactionClient, input: CashbookEntryInput) => {
  const targetShopId = input.shopId || 'default-shop-pharmora';
  validateEntrySemantics(input);
  const amount = input.entryType === 'OPENING_CASH'
    ? nonNegativeMoney(input.amount)
    : positiveMoney(input.amount);
  const businessDate = normalizeBusinessDate(input.businessDate);
  const key = idempotencyKey(input.idempotencyKey);
  const existing = await tx.cashbookEntry.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    const matches = existing.entryType === input.entryType
      && existing.direction === input.direction
      && existing.paymentMethod === input.paymentMethod
      && existing.businessDate.getTime() === businessDate.getTime()
      && moneyDecimal(existing.amount).equals(amount)
      && existing.sourceType === input.sourceType
      && existing.sourceId === input.sourceId;
    if (!matches) throw duplicate('Idempotency key was already used for a different cashbook entry');
    return existing;
  }

  const isClosed = tx.dailyClosing?.findFirst
    ? await tx.dailyClosing.findFirst({ where: { closingDate: businessDate, shopId: targetShopId }, select: { id: true } })
    : (tx.dailyClosing?.findUnique ? await (tx.dailyClosing.findUnique as any)({ where: { closingDate_shopId: { closingDate: businessDate, shopId: targetShopId } } }) : null);
  if (isClosed) {
    throw ruleViolation('This business date is already closed; record a correction on an open business date');
  }

  let bankPosting: { accountId: string; balanceAfter: PrismaRuntime.Decimal; transactionType: 'CREDIT' | 'DEBIT' } | undefined;
  if (input.paymentMethod === 'BANK') {
    const account = tx.bankAccount?.findFirst
      ? await tx.bankAccount.findFirst({ where: { isActive: true, shopId: targetShopId }, orderBy: { isPrimary: 'desc' } })
      : (tx.bankAccount?.findUnique ? await tx.bankAccount.findUnique({ where: { id: 'primary' } }) : null);
    if (!account) throw ruleViolation('An active bank account is required for bank transactions');
    const current = await bankBalanceFor(tx, account.id, targetShopId);
    const balanceAfter = input.direction === 'IN' ? current.plus(amount) : current.minus(amount);
    if (balanceAfter.isNegative()) throw ruleViolation('Insufficient bank balance');
    bankPosting = { accountId: account.id, balanceAfter, transactionType: input.direction === 'IN' ? 'CREDIT' : 'DEBIT' };
  }

  const notes = input.description?.trim() || input.notes?.trim() || null;
  const entry = await tx.cashbookEntry.create({
    data: {
      shopId: targetShopId,
      entryType: input.entryType,
      direction: input.direction,
      amount,
      paymentMethod: input.paymentMethod,
      businessDate,
      referenceType: input.sourceType,
      referenceId: input.sourceId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      notes,
      createdById: input.createdById,
      paymentId: input.paymentId,
      idempotencyKey: key,
    },
  });

  if (bankPosting) {
    await tx.bankTransaction.create({
      data: {
        shopId: targetShopId,
        bankAccountId: bankPosting.accountId,
        transactionType: bankPosting.transactionType,
        amount,
        balanceAfter: bankPosting.balanceAfter,
        referenceType: input.sourceType,
        referenceId: input.sourceId,
        notes,
        createdById: input.createdById,
      },
    });
    if (tx.bankAccount?.updateMany) {
      await tx.bankAccount.updateMany({ where: { id: bankPosting.accountId, shopId: targetShopId }, data: { currentBalance: bankPosting.balanceAfter } });
    } else if (tx.bankAccount?.update) {
      await tx.bankAccount.update({ where: { id: bankPosting.accountId }, data: { currentBalance: bankPosting.balanceAfter } });
    }
  }

  await auditEntry(tx, entry);
  return entry;
};

export const createCashbookEntry = (input: CashbookEntryInput, client?: DbClient) =>
  withTransaction(client, (tx) => writeCashbookEntry(tx, input));

const getOpeningCashState = async (client: DbClient, businessDate: Date, shopId = 'default-shop-pharmora') => {
  const priorDate = new Date(businessDate);
  priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  const previousClosing = client.dailyClosing?.findFirst
    ? await client.dailyClosing.findFirst({
        where: { closingDate: priorDate, shopId },
        select: { id: true, closingDate: true, actualCash: true },
      })
    : (client.dailyClosing?.findUnique
        ? await (client.dailyClosing.findUnique as any)({
            where: { closingDate_shopId: { closingDate: priorDate, shopId } },
            select: { id: true, closingDate: true, actualCash: true },
          })
        : null);
  const baseline = previousClosing
    ? null
    : (client.cashbookEntry?.findFirst
        ? await client.cashbookEntry.findFirst({
            where: { businessDate, entryType: 'OPENING_CASH', paymentMethod: 'CASH', shopId },
            orderBy: { createdAt: 'asc' },
          })
        : null);
  const corrections = await client.cashbookEntry.findMany({
    where: { businessDate, entryType: 'OPENING_CASH_CORRECTION', paymentMethod: 'CASH', shopId },
    select: { direction: true, amount: true },
    orderBy: { createdAt: 'asc' },
  });
  const base = previousClosing?.actualCash ?? baseline?.amount ?? new PrismaRuntime.Decimal(0);
  const amount = applyOpeningCorrections(base, corrections);
  return {
    amount,
    isSet: Boolean(previousClosing || baseline),
    source: previousClosing ? 'PREVIOUS_CLOSING' as const : baseline ? 'MANUAL' as const : 'UNSET' as const,
    previousClosingDate: previousClosing?.closingDate ?? null,
  };
};

export const getOpeningCash = async (date: Date | string, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const businessDate = normalizeBusinessDate(date);
  const result = await getOpeningCashState(database(client), businessDate, shopId);
  return {
    businessDate: businessDateKey(businessDate),
    openingCash: moneyString(result.amount),
    isSet: result.isSet,
    source: result.source,
    previousClosingDate: result.previousClosingDate ? businessDateKey(result.previousClosingDate) : null,
  };
};

export const setOpeningCash = async (input: {
  shopId?: string;
  businessDate: Date | string;
  amount: MoneyInput;
  reason?: string;
  idempotencyKey: string;
  createdById?: string;
}, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const targetShopId = input.shopId || shopId;
  const businessDate = normalizeBusinessDate(input.businessDate);
  const targetAmount = nonNegativeMoney(input.amount, 'Opening cash');
  const key = idempotencyKey(input.idempotencyKey);
  return withTransaction(client, async (tx) => {
    const repeated = await tx.cashbookEntry.findUnique({ where: { idempotencyKey: key } });
    if (repeated) {
      if (!openingTypes.has(repeated.entryType) || repeated.businessDate.getTime() !== businessDate.getTime()) {
        throw duplicate('Idempotency key was already used for a different financial operation');
      }
      const current = await getOpeningCashState(tx, businessDate, targetShopId);
      if (!current.amount.equals(targetAmount)) throw duplicate('Idempotency key was already used for a different opening cash value');
      return getOpeningCash(businessDate, tx, targetShopId);
    }
    const isClosed = tx.dailyClosing?.findFirst
      ? await tx.dailyClosing.findFirst({ where: { closingDate: businessDate, shopId: targetShopId }, select: { id: true } })
      : (tx.dailyClosing?.findUnique ? await (tx.dailyClosing.findUnique as any)({ where: { closingDate_shopId: { closingDate: businessDate, shopId: targetShopId } } }) : null);
    if (isClosed) {
      throw ruleViolation('Opening cash cannot be changed after the day has been closed');
    }
    const current = await getOpeningCashState(tx, businessDate, targetShopId);
    if (!current.isSet) {
      await writeCashbookEntry(tx, {
        shopId: targetShopId,
        entryType: 'OPENING_CASH',
        direction: 'IN',
        amount: targetAmount,
        paymentMethod: 'CASH',
        sourceType: 'OPENING_CASH',
        sourceId: businessDateKey(businessDate),
        businessDate,
        description: input.reason,
        createdById: input.createdById,
        idempotencyKey: key,
      });
    } else if (!targetAmount.equals(current.amount)) {
      if (!input.reason?.trim()) throw invalid('A reason is required to correct opening cash');
      const difference = targetAmount.minus(current.amount);
      await writeCashbookEntry(tx, {
        shopId: targetShopId,
        entryType: 'OPENING_CASH_CORRECTION',
        direction: difference.isPositive() ? 'IN' : 'OUT',
        amount: difference.abs(),
        paymentMethod: 'CASH',
        sourceType: 'OPENING_CASH_CORRECTION',
        sourceId: businessDateKey(businessDate),
        businessDate,
        description: input.reason,
        createdById: input.createdById,
        idempotencyKey: key,
      });
    }
    return getOpeningCash(businessDate, tx, targetShopId);
  });
};

export const getDailyCashSummary = async (date: Date | string, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const businessDate = normalizeBusinessDate(date);
  const db = database(client);
  const opening = await getOpeningCashState(db, businessDate, shopId);
  const entries = await db.cashbookEntry.findMany({
    where: { shopId, businessDate: { gte: businessDate, lt: nextBusinessDate(businessDate) } },
    orderBy: { createdAt: 'desc' },
  });
  const totals = calculateDrawerTotals(opening.amount, entries);
  const closing = db.dailyClosing?.findFirst
    ? await db.dailyClosing.findFirst({ where: { closingDate: businessDate, shopId } })
    : (db.dailyClosing?.findUnique ? await (db.dailyClosing.findUnique as any)({ where: { closingDate_shopId: { closingDate: businessDate, shopId } } }) : null);
  return {
    businessDate: businessDateKey(businessDate),
    openingCash: moneyString(totals.openingCash),
    openingCashSet: opening.isSet,
    openingSource: opening.source,
    cashInflows: moneyString(totals.cashInflows),
    cashOutflows: moneyString(totals.cashOutflows),
    expectedDrawerCash: moneyString(totals.expectedDrawerCash),
    actualDrawerCash: closing ? moneyString(moneyDecimal(closing.actualCash)) : null,
    difference: closing ? moneyString(moneyDecimal(closing.difference)) : null,
    closingStatus: closing?.status ?? null,
    isClosed: Boolean(closing),
  };
};

export const listCashbookEntries = async (filters: {
  shopId?: string;
  date?: Date | string;
  from?: Date | string;
  to?: Date | string;
  paymentMethod?: PaymentMethod;
} = {}, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const targetShopId = filters.shopId || shopId;
  let businessDateFilter: Prisma.DateTimeFilter<'CashbookEntry'> | undefined;
  if (filters.date) {
    const date = normalizeBusinessDate(filters.date);
    businessDateFilter = { gte: date, lt: nextBusinessDate(date) };
  } else if (filters.from || filters.to) {
    const from = filters.from ? normalizeBusinessDate(filters.from) : undefined;
    const to = filters.to ? nextBusinessDate(normalizeBusinessDate(filters.to)) : undefined;
    if (from && to && from >= to) throw invalid('Start date must not be after end date');
    businessDateFilter = { gte: from, lt: to };
  }
  return database(client).cashbookEntry.findMany({
    where: { shopId: targetShopId, businessDate: businessDateFilter, paymentMethod: filters.paymentMethod },
    include: { createdBy: true },
    orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
  });
};

export const getDailyClosing = async (date: Date | string, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const businessDate = normalizeBusinessDate(date);
  const db = database(client);
  return db.dailyClosing?.findFirst
    ? db.dailyClosing.findFirst({ where: { closingDate: businessDate, shopId }, include: { closedBy: true } })
    : (db.dailyClosing?.findUnique ? (db.dailyClosing.findUnique as any)({ where: { closingDate_shopId: { closingDate: businessDate, shopId } }, include: { closedBy: true } }) : null);
};

export const createDailyClosing = async (input: {
  shopId?: string;
  businessDate: Date | string;
  actualCash: MoneyInput;
  notes?: string;
  closedById?: string;
}, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const targetShopId = input.shopId || shopId;
  const businessDate = normalizeBusinessDate(input.businessDate);
  const actualCash = nonNegativeMoney(input.actualCash, 'Actual cash');
  const createdClosing = await withTransaction(client, async (tx) => {
    const existing = tx.dailyClosing?.findFirst
      ? await tx.dailyClosing.findFirst({ where: { closingDate: businessDate, shopId: targetShopId } })
      : (tx.dailyClosing?.findUnique ? await (tx.dailyClosing.findUnique as any)({ where: { closingDate_shopId: { closingDate: businessDate, shopId: targetShopId } } }) : null);
    if (existing) throw duplicate('This business date has already been closed; previous closings are never overwritten');
    const summary = await getDailyCashSummary(businessDate, tx, targetShopId);
    const expectedCash = moneyDecimal(summary.expectedDrawerCash);
    const difference = calculateClosingDifference(actualCash, expectedCash);
    const status = closingStatus(difference);
    const closing = await tx.dailyClosing.create({
      data: {
        shopId: targetShopId,
        closingDate: businessDate,
        openingCash: summary.openingCash,
        cashInflows: summary.cashInflows,
        cashOutflows: summary.cashOutflows,
        expectedCash,
        actualCash,
        difference,
        status,
        notes: input.notes?.trim() || null,
        closedById: input.closedById,
      },
      include: { closedBy: true },
    });
    await tx.auditLog.create({
      data: {
        shopId: targetShopId,
        userId: input.closedById,
        action: 'DAILY_CLOSING_CREATED',
        entityType: 'DailyClosing',
        entityId: closing.id,
        oldValue: PrismaRuntime.JsonNull,
        newValue: {
          businessDate: businessDateKey(businessDate),
          openingCash: summary.openingCash,
          cashInflows: summary.cashInflows,
          cashOutflows: summary.cashOutflows,
          expectedCash: centsText(expectedCash),
          actualCash: centsText(actualCash),
          difference: centsText(difference),
          status,
          notes: input.notes?.trim() ?? null,
        },
      },
    });
    return closing;
  });

  if (createdClosing) {
    setImmediate(() => {
      sendDailyClosingSummary(createdClosing.closingDate, client, input.closedById, targetShopId).catch(() => {});
    });
  }

  return createdClosing;
};

export const createAdjustment = async (input: {
  shopId?: string;
  direction: CashbookDirection;
  amount: MoneyInput;
  businessDate?: Date | string;
  description: string;
  createdById?: string;
  idempotencyKey: string;
}, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const targetShopId = input.shopId || shopId;
  if (!input.description.trim()) throw invalid('A reason is required for a cash adjustment');
  return createCashbookEntry({
    shopId: targetShopId,
    entryType: 'CASH_ADJUSTMENT',
    direction: input.direction,
    amount: input.amount,
    paymentMethod: 'CASH',
    sourceType: 'CASH_ADJUSTMENT',
    sourceId: idempotencyKey(input.idempotencyKey),
    businessDate: input.businessDate,
    description: input.description,
    createdById: input.createdById,
    idempotencyKey: input.idempotencyKey,
  }, client);
};

export const transferCashAndBank = async (input: {
  shopId?: string;
  direction: 'CASH_TO_BANK' | 'BANK_TO_CASH';
  amount: MoneyInput;
  businessDate?: Date | string;
  description?: string;
  createdById?: string;
  idempotencyKey: string;
}, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const targetShopId = input.shopId || shopId;
  const amount = positiveMoney(input.amount);
  const key = idempotencyKey(input.idempotencyKey);
  const entryPrefix = key.slice(0, 120);
  const businessDate = normalizeBusinessDate(input.businessDate);
  return withTransaction(client, async (tx) => {
    const existing = await tx.cashbookEntry.findUnique({ where: { idempotencyKey: `${entryPrefix}:cash` } });
    if (existing) {
      return tx.cashbookEntry.findMany({
        where: { sourceType: 'BANK_TRANSFER', sourceId: key, shopId: targetShopId },
        orderBy: { createdAt: 'asc' },
      });
    }
    const cashToBank = input.direction === 'CASH_TO_BANK';
    const type: CashbookEntryType = cashToBank ? 'BANK_DEPOSIT' : 'BANK_TO_CASH';
    const cashEntry = await writeCashbookEntry(tx, {
      shopId: targetShopId,
      entryType: type,
      direction: cashToBank ? 'OUT' : 'IN',
      amount,
      paymentMethod: 'CASH',
      sourceType: 'BANK_TRANSFER',
      sourceId: key,
      businessDate,
      description: input.description,
      createdById: input.createdById,
      idempotencyKey: `${entryPrefix}:cash`,
    });
    const bankEntry = await writeCashbookEntry(tx, {
      shopId: targetShopId,
      entryType: type,
      direction: cashToBank ? 'IN' : 'OUT',
      amount,
      paymentMethod: 'BANK',
      sourceType: 'BANK_TRANSFER',
      sourceId: key,
      businessDate,
      description: input.description,
      createdById: input.createdById,
      idempotencyKey: `${entryPrefix}:bank`,
    });
    return [cashEntry, bankEntry];
  });
};

export const getCurrentCashPosition = async (client?: DbClient, shopId = 'default-shop-pharmora') => {
  const db = database(client);
  const today = normalizeBusinessDate(new Date());
  const summary = await getDailyCashSummary(today, db, shopId);
  const bankAccounts = await db.bankAccount.findMany({ where: { isActive: true, shopId }, select: { id: true, openingBalance: true } });
  let bank = new PrismaRuntime.Decimal(0);
  for (const account of bankAccounts) bank = bank.plus(await bankBalanceFor(db as Prisma.TransactionClient, account.id, shopId));
  const upiEntries = await db.cashbookEntry.findMany({
    where: { paymentMethod: 'UPI', shopId },
    select: { direction: true, amount: true },
  });
  const upi = upiEntries.reduce((balance, entry) => {
    const amount = moneyDecimal(entry.amount);
    return entry.direction === 'IN' ? balance.plus(amount) : balance.minus(amount);
  }, new PrismaRuntime.Decimal(0));
  return {
    businessDate: summary.businessDate,
    physicalCash: summary.isClosed ? summary.actualDrawerCash! : summary.expectedDrawerCash,
    bank: moneyString(bank),
    upi: moneyString(upi),
    closingStatus: summary.closingStatus,
  };
};

export const getCashbookBalances = getCurrentCashPosition;

export const getCashbookEntry = async (id: string, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const entry = await database(client).cashbookEntry.findFirst({ where: { id, shopId }, include: { createdBy: true } });
  if (!entry) throw missing('Cashbook entry');
  return entry;
};
import type { Prisma, PrismaClient } from '@prisma/client';
import { type DbClient, database, duplicate, idempotencyKey, invalid, isUniqueConstraintError, missing, nonNegativeAmount, ruleViolation, withTransaction } from './domainUtils.js';
import { writeCashbookEntry } from './cashbookService.js';
import { normalizeBusinessDate } from './cashbookLedgerService.js';

export type DailySalesInput = {
  shopId?: string;
  businessDate: string | Date;
  cashSales: number;
  upiSales: number;
  otherSales?: number;
  notes?: string;
  createdById?: string;
};

export type DailySalesReconciliation = {
  businessDate: string;
  posCashSales: number;
  posUpiSales: number;
  posCreditSales: number;
  posTotalSales: number;
  recordedDailyCash: number;
  recordedDailyUpi: number;
  recordedDailyOther: number;
  recordedDailyTotal: number;
  nonPosCashSales: number;
  nonPosUpiSales: number;
  nonPosOtherSales: number;
  nonPosTotalSales: number;
  totalSales: number;
  reconciliationStatus: 'NOT_ENTERED' | 'BALANCED' | 'PENDING' | 'INVALID';
  isClosed: boolean;
  dailySaleId?: string;
};

const round = (val: number) => Math.round(val * 100) / 100;

export const getPosSalesTotalsForDate = async (tx: Prisma.TransactionClient | PrismaClient, businessDate: Date, shopId = 'default-shop-pharmora') => {
  const startOfDay = new Date(Date.UTC(businessDate.getUTCFullYear(), businessDate.getUTCMonth(), businessDate.getUTCDate(), 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(businessDate.getUTCFullYear(), businessDate.getUTCMonth(), businessDate.getUTCDate(), 23, 59, 59, 999));

  const sales = await tx.sale.findMany({
    where: {
      shopId,
      saleDate: { gte: startOfDay, lte: endOfDay },
      status: 'COMPLETED',
    },
    include: {
      payments: { include: { splits: true } },
      credits: true,
    },
  });

  let posCash = 0;
  let posUpi = 0;
  let posCredit = 0;

  for (const sale of sales) {
    if (sale.payments && sale.payments.length > 0) {
      for (const pmt of sale.payments) {
        if (pmt.splits && pmt.splits.length > 0) {
          for (const split of pmt.splits) {
            if (split.paymentMethod === 'CASH') posCash += Number(split.amount);
            else if (split.paymentMethod === 'UPI' || split.paymentMethod === 'BANK') posUpi += Number(split.amount);
          }
        } else {
          if (pmt.paymentMethod === 'CASH') posCash += Number(pmt.amount);
          else if (pmt.paymentMethod === 'UPI' || pmt.paymentMethod === 'BANK') posUpi += Number(pmt.amount);
          else if (pmt.paymentMethod === 'BOTH') {
            posCash += Number(pmt.cashAmount ?? 0);
            posUpi += Number(pmt.upiAmount ?? 0);
          }
        }
      }
    } else if (sale.paymentMethod === 'CASH') {
      posCash += Number(sale.paidAmount);
    } else if (sale.paymentMethod === 'UPI') {
      posUpi += Number(sale.paidAmount);
    } else if (sale.paymentMethod === 'BOTH') {
      posCash += Number(sale.paidAmount);
    }

    if (sale.credits && sale.credits.length > 0) {
      for (const credit of sale.credits) {
        posCredit += Number(credit.amount);
      }
    } else if (sale.paymentMethod === 'CREDIT' || Number(sale.totalAmount) > Number(sale.paidAmount)) {
      posCredit += Math.max(0, Number(sale.totalAmount) - Number(sale.paidAmount));
    }
  }

  return {
    posCashSales: round(posCash),
    posUpiSales: round(posUpi),
    posCreditSales: round(posCredit),
    posTotalSales: round(posCash + posUpi + posCredit),
  };
};

export const getDailySalesReconciliation = async (
  dateInput: string | Date,
  client?: PrismaClient,
  shopId = 'default-shop-pharmora',
): Promise<DailySalesReconciliation> => {
  const db = database(client);
  const normalizedDate = normalizeBusinessDate(dateInput);
  const dateStr = normalizedDate.toISOString().slice(0, 10);

  const [closing, dailySale, posTotals] = await Promise.all([
    db.dailyClosing.findFirst
      ? db.dailyClosing.findFirst({ where: { closingDate: normalizedDate, shopId } })
      : db.dailyClosing.findUnique({ where: { closingDate: normalizedDate } as any }),
    db.dailySale.findFirst
      ? db.dailySale.findFirst({ where: { businessDate: normalizedDate, shopId } })
      : db.dailySale.findUnique({ where: { businessDate: normalizedDate } as any }),
    getPosSalesTotalsForDate(db, normalizedDate, shopId),
  ]);

  const isClosed = closing !== null;

  if (dailySale) {
    const recordedCash = Number(dailySale.cashSales);
    const recordedUpi = Number(dailySale.upiSales);
    const recordedOther = Number(dailySale.otherSales ?? 0);
    const recordedTotal = Number(dailySale.totalSales);

    const nonPosCash = Math.max(0, round(recordedCash - posTotals.posCashSales));
    const nonPosUpi = Math.max(0, round(recordedUpi - posTotals.posUpiSales));
    const nonPosOther = round(recordedOther);
    const nonPosTotal = round(nonPosCash + nonPosUpi + nonPosOther);
    const totalSales = round(posTotals.posTotalSales + nonPosTotal);

    let status: 'BALANCED' | 'INVALID' = 'BALANCED';
    if (recordedCash < posTotals.posCashSales || recordedUpi < posTotals.posUpiSales) {
      status = 'INVALID';
    }

    return {
      businessDate: dateStr,
      posCashSales: posTotals.posCashSales,
      posUpiSales: posTotals.posUpiSales,
      posCreditSales: posTotals.posCreditSales,
      posTotalSales: posTotals.posTotalSales,
      recordedDailyCash: recordedCash,
      recordedDailyUpi: recordedUpi,
      recordedDailyOther: recordedOther,
      recordedDailyTotal: recordedTotal,
      nonPosCashSales: nonPosCash,
      nonPosUpiSales: nonPosUpi,
      nonPosOtherSales: nonPosOther,
      nonPosTotalSales: nonPosTotal,
      totalSales,
      reconciliationStatus: status,
      isClosed,
      dailySaleId: dailySale.id,
    };
  }

  return {
    businessDate: dateStr,
    posCashSales: posTotals.posCashSales,
    posUpiSales: posTotals.posUpiSales,
    posCreditSales: posTotals.posCreditSales,
    posTotalSales: posTotals.posTotalSales,
    recordedDailyCash: 0,
    recordedDailyUpi: 0,
    recordedDailyOther: 0,
    recordedDailyTotal: 0,
    nonPosCashSales: 0,
    nonPosUpiSales: 0,
    nonPosOtherSales: 0,
    nonPosTotalSales: 0,
    totalSales: posTotals.posTotalSales,
    reconciliationStatus: posTotals.posTotalSales > 0 ? 'PENDING' : 'NOT_ENTERED',
    isClosed,
  };
};

export const createDailySales = async (
  input: DailySalesInput,
  key: string,
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  const targetShopId = input.shopId || shopId;
  const stableKey = idempotencyKey(key);
  nonNegativeAmount(input.cashSales, 'Cash sales');
  nonNegativeAmount(input.upiSales, 'UPI sales');
  if (input.otherSales !== undefined) nonNegativeAmount(input.otherSales, 'Other sales');

  const normalizedDate = normalizeBusinessDate(input.businessDate);
  const db = database(client);

  const prior = await db.dailySale.findUnique({
    where: { idempotencyKey: stableKey },
  });
  if (prior) {
    if (
      round(Number(prior.cashSales)) !== round(input.cashSales) ||
      round(Number(prior.upiSales)) !== round(input.upiSales) ||
      (input.otherSales !== undefined && round(Number(prior.otherSales)) !== round(input.otherSales))
    ) {
      throw invalid('Idempotency key reuse with different daily sales data is forbidden');
    }
    return prior;
  }

  try {
    return await withTransaction(client, async (tx) => {
      const closing = tx.dailyClosing.findFirst
        ? await tx.dailyClosing.findFirst({ where: { closingDate: normalizedDate, shopId: targetShopId } })
        : await tx.dailyClosing.findUnique({ where: { closingDate: normalizedDate } as any });
      if (closing) {
        throw ruleViolation('Daily sales cannot be recorded for a closed business day');
      }

      const existingForDate = tx.dailySale.findFirst
        ? await tx.dailySale.findFirst({ where: { businessDate: normalizedDate, shopId: targetShopId } })
        : await tx.dailySale.findUnique({ where: { businessDate: normalizedDate } as any });
      if (existingForDate) {
        throw ruleViolation('Daily sales already exists for this business date. Use update instead.');
      }

      const posTotals = await getPosSalesTotalsForDate(tx, normalizedDate, targetShopId);

      if (round(input.cashSales) < posTotals.posCashSales) {
        throw ruleViolation(`Daily cash sales (₹${input.cashSales}) cannot be less than POS cash sales (₹${posTotals.posCashSales})`);
      }
      if (round(input.upiSales) < posTotals.posUpiSales) {
        throw ruleViolation(`Daily UPI sales (₹${input.upiSales}) cannot be less than POS UPI sales (₹${posTotals.posUpiSales})`);
      }

      const nonPosCash = round(input.cashSales - posTotals.posCashSales);
      const nonPosUpi = round(input.upiSales - posTotals.posUpiSales);
      const otherSales = round(input.otherSales ?? 0);
      const nonPosTotal = round(nonPosCash + nonPosUpi + otherSales);
      const totalSales = round(input.cashSales + input.upiSales + otherSales);

      const record = await tx.dailySale.create({
        data: {
          shopId: targetShopId,
          businessDate: normalizedDate,
          cashSales: input.cashSales,
          upiSales: input.upiSales,
          otherSales,
          totalSales,
          posCashSales: posTotals.posCashSales,
          posUpiSales: posTotals.posUpiSales,
          posCreditSales: posTotals.posCreditSales,
          posTotalSales: posTotals.posTotalSales,
          nonPosCashSales: nonPosCash,
          nonPosUpiSales: nonPosUpi,
          nonPosTotalSales: nonPosTotal,
          notes: input.notes,
          createdById: input.createdById,
          idempotencyKey: stableKey,
        },
      });

      if (nonPosCash > 0) {
        await writeCashbookEntry(tx, {
          shopId: targetShopId,
          entryType: 'SALE',
          direction: 'IN',
          amount: nonPosCash,
          paymentMethod: 'CASH',
          sourceType: 'DAILY_SALES',
          sourceId: record.id,
          businessDate: normalizedDate,
          createdById: input.createdById,
          notes: 'Non-POS daily cash sales',
          idempotencyKey: `${stableKey}:cash`,
        });
      }

      if (nonPosUpi > 0) {
        await writeCashbookEntry(tx, {
          shopId: targetShopId,
          entryType: 'SALE',
          direction: 'IN',
          amount: nonPosUpi,
          paymentMethod: 'UPI',
          sourceType: 'DAILY_SALES',
          sourceId: record.id,
          businessDate: normalizedDate,
          createdById: input.createdById,
          notes: 'Non-POS daily UPI sales',
          idempotencyKey: `${stableKey}:upi`,
        });
      }

      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            shopId: targetShopId,
            userId: input.createdById,
            action: 'DAILY_SALES_CREATED',
            entityType: 'DailySale',
            entityId: record.id,
            newValue: {
              businessDate: record.businessDate,
              cashSales: input.cashSales,
              upiSales: input.upiSales,
              totalSales,
              nonPosCash,
              nonPosUpi,
            },
          },
        });
      }

      return record;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const original = await db.dailySale.findUnique({
        where: { idempotencyKey: stableKey },
      });
      if (original) return original;
      throw duplicate('Daily sales record or idempotency key already exists');
    }
    throw error;
  }
};

export const updateDailySales = async (
  id: string,
  input: {
    shopId?: string;
    cashSales: number;
    upiSales: number;
    otherSales?: number;
    notes?: string;
    createdById?: string;
  },
  key: string,
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  const targetShopId = input.shopId || shopId;
  const stableKey = idempotencyKey(key);
  nonNegativeAmount(input.cashSales, 'Cash sales');
  nonNegativeAmount(input.upiSales, 'UPI sales');
  if (input.otherSales !== undefined) nonNegativeAmount(input.otherSales, 'Other sales');

  return await withTransaction(client, async (tx) => {
    const existing = tx.dailySale.findFirst
      ? await tx.dailySale.findFirst({ where: { id, shopId: targetShopId } })
      : await tx.dailySale.findUnique({ where: { id } as any });
    if (!existing) throw missing('Daily sales record');

    const closing = tx.dailyClosing.findFirst
      ? await tx.dailyClosing.findFirst({ where: { closingDate: existing.businessDate, shopId: targetShopId } })
      : await tx.dailyClosing.findUnique({ where: { closingDate: existing.businessDate } as any });
    if (closing) {
      throw ruleViolation('Daily sales cannot be modified for a closed business day');
    }

    const posTotals = await getPosSalesTotalsForDate(tx, existing.businessDate, targetShopId);

    if (round(input.cashSales) < posTotals.posCashSales) {
      throw ruleViolation(`Daily cash sales (₹${input.cashSales}) cannot be less than POS cash sales (₹${posTotals.posCashSales})`);
    }
    if (round(input.upiSales) < posTotals.posUpiSales) {
      throw ruleViolation(`Daily UPI sales (₹${input.upiSales}) cannot be less than POS UPI sales (₹${posTotals.posUpiSales})`);
    }

    const oldNonPosCash = Number(existing.nonPosCashSales);
    const oldNonPosUpi = Number(existing.nonPosUpiSales);

    const newNonPosCash = round(input.cashSales - posTotals.posCashSales);
    const newNonPosUpi = round(input.upiSales - posTotals.posUpiSales);
    const otherSales = round(input.otherSales ?? Number(existing.otherSales ?? 0));
    const newNonPosTotal = round(newNonPosCash + newNonPosUpi + otherSales);
    const newTotalSales = round(input.cashSales + input.upiSales + otherSales);

    const cashDiff = round(newNonPosCash - oldNonPosCash);
    const upiDiff = round(newNonPosUpi - oldNonPosUpi);

    if (cashDiff > 0) {
      await writeCashbookEntry(tx, {
        shopId: targetShopId,
        entryType: 'SALE',
        direction: 'IN',
        amount: cashDiff,
        paymentMethod: 'CASH',
        sourceType: 'DAILY_SALES_ADJUSTMENT',
        sourceId: existing.id,
        businessDate: existing.businessDate,
        createdById: input.createdById,
        notes: 'Daily sales cash adjustment (+)',
        idempotencyKey: `${stableKey}:cash-in`,
      });
    } else if (cashDiff < 0) {
      await writeCashbookEntry(tx, {
        shopId: targetShopId,
        entryType: 'MONEY_OUT',
        direction: 'OUT',
        amount: Math.abs(cashDiff),
        paymentMethod: 'CASH',
        sourceType: 'DAILY_SALES_ADJUSTMENT',
        sourceId: existing.id,
        businessDate: existing.businessDate,
        createdById: input.createdById,
        notes: 'Daily sales cash downward adjustment (-)',
        idempotencyKey: `${stableKey}:cash-out`,
      });
    }

    if (upiDiff > 0) {
      await writeCashbookEntry(tx, {
        shopId: targetShopId,
        entryType: 'SALE',
        direction: 'IN',
        amount: upiDiff,
        paymentMethod: 'UPI',
        sourceType: 'DAILY_SALES_ADJUSTMENT',
        sourceId: existing.id,
        businessDate: existing.businessDate,
        createdById: input.createdById,
        notes: 'Daily sales UPI adjustment (+)',
        idempotencyKey: `${stableKey}:upi-in`,
      });
    } else if (upiDiff < 0) {
      await writeCashbookEntry(tx, {
        shopId: targetShopId,
        entryType: 'MONEY_OUT',
        direction: 'OUT',
        amount: Math.abs(upiDiff),
        paymentMethod: 'UPI',
        sourceType: 'DAILY_SALES_ADJUSTMENT',
        sourceId: existing.id,
        businessDate: existing.businessDate,
        createdById: input.createdById,
        notes: 'Daily sales UPI downward adjustment (-)',
        idempotencyKey: `${stableKey}:upi-out`,
      });
    }

    const updated = await tx.dailySale.update({
      where: { id },
      data: {
        cashSales: input.cashSales,
        upiSales: input.upiSales,
        otherSales,
        totalSales: newTotalSales,
        posCashSales: posTotals.posCashSales,
        posUpiSales: posTotals.posUpiSales,
        posCreditSales: posTotals.posCreditSales,
        posTotalSales: posTotals.posTotalSales,
        nonPosCashSales: newNonPosCash,
        nonPosUpiSales: newNonPosUpi,
        nonPosTotalSales: newNonPosTotal,
        notes: input.notes !== undefined ? input.notes : existing.notes,
      },
    });

    if (tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          shopId: targetShopId,
          userId: input.createdById,
          action: 'DAILY_SALES_UPDATED',
          entityType: 'DailySale',
          entityId: existing.id,
          oldValue: {
            cashSales: existing.cashSales,
            upiSales: existing.upiSales,
            totalSales: existing.totalSales,
            nonPosCashSales: existing.nonPosCashSales,
            nonPosUpiSales: existing.nonPosUpiSales,
          },
          newValue: {
            cashSales: input.cashSales,
            upiSales: input.upiSales,
            totalSales: newTotalSales,
            nonPosCashSales: newNonPosCash,
            nonPosUpiSales: newNonPosUpi,
          },
        },
      });
    }

    return updated;
  });
};

export const getDailySale = async (id: string, client?: PrismaClient, shopId = 'default-shop-pharmora') => {
  const db = database(client);
  const sale = db.dailySale.findFirst
    ? await db.dailySale.findFirst({ where: { id, shopId }, include: { createdBy: true } })
    : await db.dailySale.findUnique({ where: { id } as any, include: { createdBy: true } });
  if (!sale) throw missing('Daily sales record');
  return sale;
};

export const getDailySaleForDate = async (dateInput: string | Date, client?: PrismaClient, shopId = 'default-shop-pharmora') => {
  const db = database(client);
  const normalizedDate = normalizeBusinessDate(dateInput);
  return db.dailySale.findFirst
    ? db.dailySale.findFirst({ where: { businessDate: normalizedDate, shopId }, include: { createdBy: true } })
    : db.dailySale.findUnique({ where: { businessDate: normalizedDate } as any, include: { createdBy: true } });
};

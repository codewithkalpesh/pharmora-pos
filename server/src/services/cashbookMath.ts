import { Prisma } from '@prisma/client';
import type { CashbookDirection, CashbookEntryType, PaymentMethod } from '@prisma/client';
import { AppError } from '../utils/appError.js';

export type MoneyInput = string | number | Prisma.Decimal;

export type CashbookFlow = {
  entryType: CashbookEntryType;
  direction: CashbookDirection;
  amount: MoneyInput;
  paymentMethod: PaymentMethod | null;
};

const zero = () => new Prisma.Decimal(0);

export const moneyDecimal = (value: MoneyInput, label = 'Amount') => {
  let result: Prisma.Decimal;
  try {
    result = new Prisma.Decimal(value);
  } catch {
    throw new AppError(`${label} is invalid`, 400);
  }
  if (!result.isFinite() || result.decimalPlaces() > 2) {
    throw new AppError(`${label} must be a valid amount with at most two decimal places`, 400);
  }
  return result;
};

export const nonNegativeMoney = (value: MoneyInput, label = 'Amount') => {
  const result = moneyDecimal(value, label);
  if (result.isNegative()) throw new AppError(`${label} cannot be negative`, 400);
  return result;
};

export const positiveMoney = (value: MoneyInput, label = 'Amount') => {
  const result = moneyDecimal(value, label);
  if (!result.greaterThan(0)) throw new AppError(`${label} must be greater than zero`, 400);
  return result;
};

export const isOpeningEntry = (entryType: CashbookEntryType) =>
  entryType === 'OPENING_CASH' || entryType === 'OPENING_CASH_CORRECTION';

export const calculateDrawerTotals = (openingCash: MoneyInput, entries: CashbookFlow[]) => {
  let cashInflows = zero();
  let cashOutflows = zero();

  for (const entry of entries) {
    if (entry.paymentMethod !== 'CASH' || isOpeningEntry(entry.entryType)) continue;
    const amount = moneyDecimal(entry.amount);
    if (entry.direction === 'IN') cashInflows = cashInflows.plus(amount);
    else cashOutflows = cashOutflows.plus(amount);
  }

  const opening = nonNegativeMoney(openingCash, 'Opening cash');
  return {
    openingCash: opening,
    cashInflows,
    cashOutflows,
    expectedDrawerCash: opening.plus(cashInflows).minus(cashOutflows),
  };
};

export const calculateClosingDifference = (actualCash: MoneyInput, expectedCash: MoneyInput) =>
  nonNegativeMoney(actualCash, 'Actual cash').minus(moneyDecimal(expectedCash, 'Expected cash'));

export const closingStatus = (difference: Prisma.Decimal): 'BALANCED' | 'CASH_SHORT' | 'CASH_EXCESS' => {
  if (difference.isZero()) return 'BALANCED';
  return difference.isNegative() ? 'CASH_SHORT' : 'CASH_EXCESS';
};

export const applyOpeningCorrections = (
  openingCash: MoneyInput,
  corrections: Array<Pick<CashbookFlow, 'direction' | 'amount'>>,
) => {
  let result = nonNegativeMoney(openingCash, 'Opening cash');
  for (const entry of corrections) {
    const amount = positiveMoney(entry.amount, 'Opening cash correction');
    result = entry.direction === 'IN' ? result.plus(amount) : result.minus(amount);
  }
  if (result.isNegative()) throw new AppError('Opening cash corrections cannot produce a negative opening balance', 422);
  return result;
};

export const moneyString = (value: Prisma.Decimal) => value.toFixed(2);
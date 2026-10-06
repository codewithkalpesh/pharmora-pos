import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/appError.js';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export const database = (client?: DbClient) => client ?? prisma;
export const transactionalDatabase = (client?: PrismaClient) => client ?? prisma;
export const withTransaction = <T>(
  client: DbClient | undefined,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { maxWait?: number; timeout?: number } = { maxWait: 15000, timeout: 60000 },
) => {
  if (client && !('$transaction' in client)) return operation(client);
  return (client ?? (prisma as PrismaClient)).$transaction(operation, options);
};
export const invalid = (message: string) => new AppError(message, 400);
export const missing = (resource: string) => new AppError(`${resource} not found`, 404);
export const duplicate = (message: string) => new AppError(message, 409);
export const ruleViolation = (message: string) => new AppError(message, 422);

export const positiveAmount = (value: number, label = 'Amount') => {
  if (!Number.isFinite(value) || value <= 0) throw invalid(`${label} must be greater than zero`);
  return Math.round(value * 100) / 100;
};

export const nonNegativeAmount = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) throw invalid(`${label} cannot be negative`);
  return Math.round(value * 100) / 100;
};

export const positiveQuantity = (value: number, label = 'Quantity') => {
  if (!Number.isInteger(value) || value <= 0) throw invalid(`${label} must be a positive integer`);
  return value;
};

export const nonNegativeQuantity = (value: number, label = 'Quantity') => {
  if (!Number.isInteger(value) || value < 0) throw invalid(`${label} cannot be negative`);
  return value;
};

export const cents = (value: number) => Math.round(value * 100);
export const fromCents = (value: number) => value / 100;

export const validatePaymentSplit = (
  method: string,
  amount: number,
  cashAmount?: number,
  upiAmount?: number,
) => {
  positiveAmount(amount);
  if (method === 'BOTH') {
    if (cashAmount === undefined || upiAmount === undefined) {
      throw invalid('Cash and UPI amounts are required for split payments');
    }
    nonNegativeAmount(cashAmount, 'Cash amount');
    nonNegativeAmount(upiAmount, 'UPI amount');
    if (cents(cashAmount) + cents(upiAmount) !== cents(amount)) {
      throw ruleViolation('Cash and UPI amounts must equal the transaction total');
    }
    if (cashAmount === 0 && upiAmount === 0) throw invalid('Payment split cannot be zero');
  } else if (cashAmount !== undefined || upiAmount !== undefined) {
    throw invalid('Cash/UPI split amounts are only valid for BOTH payments');
  }
};

export const isUniqueConstraintError = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

export const idempotencyKey = (key: string | undefined) => {
  const normalized = key?.trim();
  if (!normalized || normalized.length > 128) {
    throw invalid('A valid Idempotency-Key header is required');
  }
  return normalized;
};

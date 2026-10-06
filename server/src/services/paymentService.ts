import type { PaymentMethod, Prisma, PrismaClient } from '@prisma/client';
import { writeCashbookEntry } from './cashbookService.js';
import { database, duplicate, idempotencyKey, invalid, isUniqueConstraintError, missing, positiveAmount, ruleViolation, transactionalDatabase, withTransaction, type DbClient } from './domainUtils.js';
import { paymentAccounts } from './transactionUtils.js';

const entryKey = (key: string, suffix: string) => `${key.slice(0, 112)}:${suffix}`;

export const createSalePayment = async (
  tx: Prisma.TransactionClient,
  input: {
    shopId?: string;
    saleId: string;
    amount: number;
    paymentMethod: PaymentMethod;
    cashAmount?: number;
    upiAmount?: number;
    idempotencyKey: string;
    createdById?: string;
  },
  shopId = 'default-shop-pharmora',
) => {
  const targetShopId = input.shopId || shopId;
  if (input.paymentMethod === 'CREDIT') throw ruleViolation('Credit sale payments are not accepted');
  const accounts = input.paymentMethod === 'BOTH'
    ? paymentAccounts(input.paymentMethod, input.amount, input.cashAmount, input.upiAmount)
    : paymentAccounts(input.paymentMethod, input.amount);
  const payment = await tx.payment.create({
    data: {
      shopId: targetShopId,
      saleId: input.saleId,
      paymentMethod: input.paymentMethod,
      amount: input.amount,
      cashAmount: input.paymentMethod === 'BOTH' ? input.cashAmount : undefined,
      upiAmount: input.paymentMethod === 'BOTH' ? input.upiAmount : undefined,
      idempotencyKey: input.idempotencyKey,
      createdById: input.createdById,
      splits: input.paymentMethod === 'BOTH'
        ? { create: accounts.map((account) => ({ paymentMethod: account.method, amount: account.amount })) }
        : undefined,
    },
  });
  for (const account of accounts) {
    await writeCashbookEntry(tx, {
      shopId: targetShopId,
      entryType: 'SALE',
      direction: 'IN',
      amount: account.amount,
      paymentMethod: account.method,
      sourceType: 'SALE',
      sourceId: input.saleId,
      createdById: input.createdById,
      paymentId: payment.id,
      idempotencyKey: entryKey(input.idempotencyKey, account.method),
    });
  }
  return payment;
};

export const recordSalePayment = async (input: {
  shopId?: string;
  saleId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  cashAmount?: number;
  upiAmount?: number;
  createdById?: string;
}, key: string, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const targetShopId = input.shopId || shopId;
  const stableKey = idempotencyKey(key);
  positiveAmount(input.amount);
  const db = database(client);
  const prior = await db.payment.findUnique({ where: { idempotencyKey: stableKey }, include: { splits: true } });
  if (prior) return prior;
  try {
    return await withTransaction(client, async (tx) => {
      const sale = tx.sale.findFirst
        ? await tx.sale.findFirst({ where: { id: input.saleId, shopId: targetShopId } })
        : await tx.sale.findUnique({ where: { id: input.saleId } });
      if (!sale || (targetShopId && (sale as any).shopId && (sale as any).shopId !== targetShopId)) throw missing('Sale');
      if (sale.paymentMethod === 'CREDIT') throw ruleViolation('Credit sales must be settled through customer payments');
      const outstanding = Number(sale.totalAmount) - Number(sale.paidAmount);
      if (input.amount > outstanding) throw ruleViolation('Payment cannot exceed the outstanding sale amount');
      const payment = await createSalePayment(tx, { ...input, shopId: targetShopId, idempotencyKey: stableKey }, targetShopId);
      if (tx.sale.updateMany) {
        await tx.sale.updateMany({ where: { id: sale.id, shopId: targetShopId }, data: { paidAmount: { increment: input.amount } } });
      } else {
        await tx.sale.update({ where: { id: sale.id }, data: { paidAmount: { increment: input.amount } } });
      }
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            shopId: targetShopId,
            userId: input.createdById,
            action: 'SALE_PAYMENT_RECORDED',
            entityType: 'Payment',
            entityId: payment.id,
            newValue: { saleId: input.saleId, amount: input.amount, paymentMethod: input.paymentMethod },
          },
        });
      }
      return payment;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const original = await db.payment.findUnique({ where: { idempotencyKey: stableKey }, include: { splits: true } });
      if (original) return original;
      throw duplicate('Payment idempotency key already exists');
    }
    throw error;
  }
};

export const recordCustomerPayment = async (input: {
  shopId?: string;
  customerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  cashAmount?: number;
  upiAmount?: number;
  notes?: string;
  createdById?: string;
}, key: string, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const targetShopId = input.shopId || shopId;
  const stableKey = idempotencyKey(key);
  const accounts = input.paymentMethod === 'BOTH'
    ? paymentAccounts(input.paymentMethod, input.amount, input.cashAmount, input.upiAmount)
    : paymentAccounts(input.paymentMethod, input.amount);
  const db = database(client);
  const prior = await db.customerPayment.findUnique({ where: { idempotencyKey: stableKey } });
  if (prior) return prior;
  try {
    return await withTransaction(client, async (tx) => {
      const customer = tx.customer.findFirst
        ? await tx.customer.findFirst({ where: { id: input.customerId, shopId: targetShopId }, select: { id: true } })
        : await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw missing('Customer');
      const credits = await tx.customerCredit.findMany({
        where: { customerId: input.customerId, shopId: targetShopId, balanceAmount: { gt: 0 } },
        orderBy: { createdAt: 'asc' },
      });
      const outstanding = credits.reduce((sum, credit) => sum + Math.round(Number(credit.balanceAmount) * 100), 0);
      if (Math.round(input.amount * 100) > outstanding) throw ruleViolation('Payment cannot exceed customer outstanding credit');
      const payment = await tx.customerPayment.create({
        data: {
          shopId: targetShopId,
          customerId: input.customerId,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          cashAmount: input.paymentMethod === 'BOTH' ? input.cashAmount : undefined,
          upiAmount: input.paymentMethod === 'BOTH' ? input.upiAmount : undefined,
          notes: input.notes,
          createdById: input.createdById,
          idempotencyKey: stableKey,
        },
      });
      let remainingCents = Math.round(input.amount * 100);
      for (const credit of credits) {
        if (remainingCents <= 0) break;
        const balanceCents = Math.round(Number(credit.balanceAmount) * 100);
        const appliedCents = Math.min(balanceCents, remainingCents);
        const nextBalance = (balanceCents - appliedCents) / 100;
        if (tx.customerCredit.updateMany) {
          await tx.customerCredit.updateMany({
            where: { id: credit.id, shopId: targetShopId },
            data: {
              paidAmount: { increment: appliedCents / 100 },
              balanceAmount: nextBalance,
              status: nextBalance === 0 ? 'PAID' : 'PARTIAL',
            },
          });
        } else {
          await tx.customerCredit.update({
            where: { id: credit.id },
            data: {
              paidAmount: { increment: appliedCents / 100 },
              balanceAmount: nextBalance,
              status: nextBalance === 0 ? 'PAID' : 'PARTIAL',
            },
          });
        }
        remainingCents -= appliedCents;
      }
      if (tx.customer?.updateMany) {
        await tx.customer.updateMany({
          where: { id: input.customerId, shopId: targetShopId },
          data: { outstanding: { decrement: input.amount } },
        });
      } else if (tx.customer?.update) {
        await tx.customer.update({
          where: { id: input.customerId },
          data: { outstanding: { decrement: input.amount } },
        });
      }
      for (const [index, account] of accounts.entries()) {
        await writeCashbookEntry(tx, {
          shopId: targetShopId,
          entryType: 'CUSTOMER_PAYMENT',
          direction: 'IN',
          amount: account.amount,
          paymentMethod: account.method,
          sourceType: 'CUSTOMER_PAYMENT',
          sourceId: payment.id,
          createdById: input.createdById,
          notes: input.notes,
          idempotencyKey: entryKey(stableKey, `account-${index}`),
        });
      }
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            shopId: targetShopId,
            userId: input.createdById,
            action: 'CUSTOMER_PAYMENT_CREATED',
            entityType: 'CustomerPayment',
            entityId: payment.id,
            newValue: { amount: payment.amount, paymentMethod: payment.paymentMethod, customerId: input.customerId },
          },
        });
      }
      return payment;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const original = await db.customerPayment.findUnique({ where: { idempotencyKey: stableKey } });
      if (original) return original;
      throw duplicate('Customer payment idempotency key already exists');
    }
    throw error;
  }
};

export const recordSupplierPayment = async (input: {
  shopId?: string;
  supplierId: string;
  purchaseId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  cashAmount?: number;
  upiAmount?: number;
  notes?: string;
  createdById?: string;
}, key: string, client?: DbClient, shopId = 'default-shop-pharmora') => {
  const targetShopId = input.shopId || shopId;
  const stableKey = idempotencyKey(key);
  const accounts = input.paymentMethod === 'BOTH'
    ? paymentAccounts(input.paymentMethod, input.amount, input.cashAmount, input.upiAmount)
    : paymentAccounts(input.paymentMethod, input.amount);
  const db = database(client);
  const prior = await db.supplierPayment.findUnique({ where: { idempotencyKey: stableKey } });
  if (prior) return prior;
  try {
    return await withTransaction(client, async (tx) => {
      const purchase = tx.purchase.findFirst
        ? await tx.purchase.findFirst({ where: { id: input.purchaseId, shopId: targetShopId } })
        : await tx.purchase.findUnique({ where: { id: input.purchaseId } });
      if (!purchase || purchase.supplierId !== input.supplierId) throw missing('Supplier purchase');
      const dueCents = Math.max(0, Math.round((Number(purchase.totalAmount) - Number(purchase.paidAmount)) * 100));
      const amountCents = Math.round(input.amount * 100);
      if (amountCents <= 0 || amountCents > dueCents) throw ruleViolation('Payment must be positive and cannot exceed the purchase payable');
      const payment = await tx.supplierPayment.create({
        data: {
          shopId: targetShopId,
          supplierId: input.supplierId,
          purchaseId: input.purchaseId,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          cashAmount: input.cashAmount,
          upiAmount: input.upiAmount,
          notes: input.notes,
          createdById: input.createdById,
          idempotencyKey: stableKey,
        },
      });
      const paidAmount = Number(purchase.paidAmount) + input.amount;
      const outstandingAmount = Number(purchase.totalAmount) - paidAmount;
      if (tx.purchase.updateMany) {
        await tx.purchase.updateMany({
          where: { id: purchase.id, shopId: targetShopId },
          data: {
            paidAmount,
            outstandingAmount,
            status: outstandingAmount === 0 ? 'PAID' : 'PARTIAL',
            paymentMethod: input.paymentMethod,
          },
        });
      } else {
        await tx.purchase.update({
          where: { id: purchase.id },
          data: {
            paidAmount,
            outstandingAmount,
            status: outstandingAmount === 0 ? 'PAID' : 'PARTIAL',
            paymentMethod: input.paymentMethod,
          },
        });
      }
      if (tx.supplier.updateMany) {
        await tx.supplier.updateMany({
          where: { id: input.supplierId, shopId: targetShopId },
          data: { outstanding: { decrement: input.amount } },
        });
      } else {
        await tx.supplier.update({
          where: { id: input.supplierId },
          data: { outstanding: { decrement: input.amount } },
        });
      }
      for (const [index, account] of accounts.entries()) {
        await writeCashbookEntry(tx, {
          shopId: targetShopId,
          entryType: 'SUPPLIER_PAYMENT',
          direction: 'OUT',
          amount: account.amount,
          paymentMethod: account.method,
          sourceType: 'SUPPLIER_PAYMENT',
          sourceId: payment.id,
          createdById: input.createdById,
          notes: input.notes,
          idempotencyKey: entryKey(stableKey, `account-${index}`),
        });
      }
      await tx.auditLog.create({
        data: {
          shopId: targetShopId,
          userId: input.createdById,
          action: 'SUPPLIER_PAYMENT_CREATED',
          entityType: 'SupplierPayment',
          entityId: payment.id,
          newValue: { amount: payment.amount, paymentMethod: payment.paymentMethod, supplierId: input.supplierId, purchaseId: input.purchaseId },
        },
      });
      return payment;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const original = await db.supplierPayment.findUnique({ where: { idempotencyKey: stableKey } });
      if (original) return original;
      throw duplicate('Supplier payment idempotency key already exists');
    }
    throw error;
  }
};

export const listPayments = (client?: PrismaClient, shopId = 'default-shop-pharmora') =>
  database(client).payment.findMany({ where: { shopId }, include: { splits: true, sale: true, purchase: true }, orderBy: { paidAt: 'desc' } });

export const getPayment = async (id: string, client?: PrismaClient, shopId = 'default-shop-pharmora') => {
  const payment = await database(client).payment.findFirst({ where: { id, shopId }, include: { splits: true, sale: true, purchase: true } });
  if (!payment) throw missing('Payment');
  return payment;
};
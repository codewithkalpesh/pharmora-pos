import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import {
  applyOpeningCorrections,
  calculateClosingDifference,
  calculateDrawerTotals,
  closingStatus,
  moneyString,
  nonNegativeMoney,
  positiveMoney,
} from '../src/services/cashbookMath.js';

test('expected drawer matches the required cash-only reconciliation formula', () => {
  const result = calculateDrawerTotals('10000.00', [
    { entryType: 'CASH_SALE', direction: 'IN', amount: '2000.00', paymentMethod: 'CASH' },
    { entryType: 'OTHER_INCOME', direction: 'IN', amount: '500.00', paymentMethod: 'CASH' },
    { entryType: 'CASH_PURCHASE', direction: 'OUT', amount: '1000.00', paymentMethod: 'CASH' },
    { entryType: 'EXPENSE', direction: 'OUT', amount: '300.00', paymentMethod: 'CASH' },
    { entryType: 'SUPPLIER_PAYMENT', direction: 'OUT', amount: '500.00', paymentMethod: 'CASH' },
    { entryType: 'BANK_DEPOSIT', direction: 'OUT', amount: '1000.00', paymentMethod: 'CASH' },
    { entryType: 'CUSTOMER_REFUND', direction: 'OUT', amount: '200.00', paymentMethod: 'CASH' },
    { entryType: 'CASH_ADJUSTMENT', direction: 'IN', amount: '100.00', paymentMethod: 'CASH' },
    { entryType: 'CASH_SALE', direction: 'IN', amount: '900.00', paymentMethod: 'UPI' },
    { entryType: 'BANK_DEPOSIT', direction: 'IN', amount: '1000.00', paymentMethod: 'BANK' },
  ]);

  assert.equal(moneyString(result.expectedDrawerCash), '9600.00');
  assert.equal(moneyString(result.cashInflows), '2600.00');
  assert.equal(moneyString(result.cashOutflows), '3000.00');
});

test('UPI sales and bank-side deposit legs do not change physical drawer cash', () => {
  const result = calculateDrawerTotals('100.00', [
    { entryType: 'SALE', direction: 'IN', amount: '50.00', paymentMethod: 'UPI' },
    { entryType: 'BANK_DEPOSIT', direction: 'IN', amount: '50.00', paymentMethod: 'BANK' },
  ]);
  assert.equal(moneyString(result.expectedDrawerCash), '100.00');
});

test('cash-side bank deposit reduces cash and is not classified as an expense', () => {
  const result = calculateDrawerTotals('100.00', [
    { entryType: 'BANK_DEPOSIT', direction: 'OUT', amount: '25.00', paymentMethod: 'CASH' },
  ]);
  assert.equal(moneyString(result.expectedDrawerCash), '75.00');
  assert.equal(result.cashOutflows.toFixed(2), '25.00');
});

test('closing difference and status classify balanced, short, and excess counts', () => {
  const balanced = calculateClosingDifference('96.00', '96.00');
  const short = calculateClosingDifference('95.00', '96.00');
  const excess = calculateClosingDifference('97.00', '96.00');
  assert.equal(moneyString(balanced), '0.00');
  assert.equal(closingStatus(balanced), 'BALANCED');
  assert.equal(moneyString(short), '-1.00');
  assert.equal(closingStatus(short), 'CASH_SHORT');
  assert.equal(moneyString(excess), '1.00');
  assert.equal(closingStatus(excess), 'CASH_EXCESS');
});

test('opening corrections apply directionally and reject missing value below zero', () => {
  const corrected = applyOpeningCorrections('100.00', [
    { direction: 'IN', amount: '5.25' },
    { direction: 'OUT', amount: '2.25' },
  ]);
  assert.equal(moneyString(corrected), '103.00');
  assert.throws(() => applyOpeningCorrections('1.00', [{ direction: 'OUT', amount: '2.00' }]));
});

test('money arithmetic retains exact decimal precision', () => {
  const total = new Prisma.Decimal('0.10').plus(new Prisma.Decimal('0.20'));
  assert.equal(total.toFixed(2), '0.30');
});

test('negative values and forbidden zero transaction amounts are rejected', () => {
  assert.throws(() => nonNegativeMoney('-0.01'));
  assert.throws(() => positiveMoney('0.00'));
  assert.throws(() => positiveMoney('1.001'));
});

test('zero opening cash is valid for the first business day', () => {
  const result = calculateDrawerTotals('0.00', []);
  assert.equal(moneyString(result.expectedDrawerCash), '0.00');
});
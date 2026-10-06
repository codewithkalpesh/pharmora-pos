import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateFefo,
  calculateStockStatus,
  classifyExpiry,
  orderFefoBatches,
  suggestedReorderQuantity,
} from '../src/services/inventoryMath.js';

const businessDate = '2026-10-05';
const futureDate = (days: number) => {
  const date = new Date(`${businessDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};
const batch = (id: string, expiryDate: Date | null, quantity = 1, active = true) => ({
  id,
  batchNumber: id,
  expiryDate,
  quantity,
  active,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

test('expiry classification covers exact date buckets and boundaries', () => {
  assert.equal(classifyExpiry(futureDate(-1), businessDate), 'EXPIRED');
  assert.equal(classifyExpiry(futureDate(0), businessDate), 'DAYS_0_30');
  assert.equal(classifyExpiry(futureDate(30), businessDate), 'DAYS_0_30');
  assert.equal(classifyExpiry(futureDate(31), businessDate), 'DAYS_31_60');
  assert.equal(classifyExpiry(futureDate(60), businessDate), 'DAYS_31_60');
  assert.equal(classifyExpiry(futureDate(61), businessDate), 'DAYS_61_90');
  assert.equal(classifyExpiry(futureDate(90), businessDate), 'DAYS_61_90');
  assert.equal(classifyExpiry(futureDate(91), businessDate), 'DAYS_91_180');
  assert.equal(classifyExpiry(futureDate(180), businessDate), 'DAYS_91_180');
  assert.equal(classifyExpiry(futureDate(181), businessDate), 'SAFE');
  assert.equal(classifyExpiry(null, businessDate), 'SAFE');
});

test('FEFO sorts by earliest expiry and deterministic tie breakers', () => {
  const batches = [
    batch('c', new Date('2027-01-01T00:00:00.000Z'), 50),
    batch('a', new Date('2026-11-01T00:00:00.000Z'), 20),
    batch('b', new Date('2026-10-15T00:00:00.000Z'), 30),
  ];
  assert.deepEqual(orderFefoBatches(batches, businessDate).map((item) => item.id), ['b', 'a', 'c']);
});

test('FEFO ignores zero, inactive, and expired batches and orders null expiry last', () => {
  const batches = [
    batch('null-expiry', null, 5),
    batch('zero-stock', new Date('2026-10-10T00:00:00.000Z'), 0),
    batch('expired', new Date('2026-10-04T00:00:00.000Z'), 10),
    batch('inactive', new Date('2026-10-06T00:00:00.000Z'), 10, false),
    batch('valid', new Date('2026-10-06T00:00:00.000Z'), 3),
  ];
  assert.deepEqual(orderFefoBatches(batches, businessDate).map((item) => item.id), ['valid', 'null-expiry']);
});

test('FEFO allocation returns enough stock in earliest-expiry order', () => {
  const batches = [
    batch('a', new Date('2026-11-01T00:00:00.000Z'), 20),
    batch('b', new Date('2026-10-15T00:00:00.000Z'), 30),
    batch('c', new Date('2027-01-01T00:00:00.000Z'), 50),
  ];
  const result = allocateFefo(batches, 40, businessDate);
  assert.equal(result.totalAvailable, 100);
  assert.deepEqual(result.allocations.map(({ batch: item, quantity }) => [item.id, quantity]), [['b', 30], ['a', 10]]);
  assert.throws(() => allocateFefo(batches, 101, businessDate));
});

test('low-stock status and suggested reorder quantity follow centralized rules', () => {
  assert.equal(calculateStockStatus(0, 10), 'OUT_OF_STOCK');
  assert.equal(calculateStockStatus(10, 10), 'LOW_STOCK');
  assert.equal(calculateStockStatus(11, 10), 'NORMAL');
  assert.equal(suggestedReorderQuantity(4, 10, 30), 26);
  assert.equal(suggestedReorderQuantity(4, 10, null), 6);
});

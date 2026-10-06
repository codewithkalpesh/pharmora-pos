import assert from 'node:assert/strict';
import test from 'node:test';
import { getStoreSettings, updateStoreSettings, getReceiptData } from '../src/services/receiptService.js';
import { generateInvoicePdfBuffer } from '../src/services/invoicePdfService.js';

test('1. Store Settings: returns default values when unset and updates correctly', async () => {
  const mockSettings: any[] = [];
  const mockDb: any = {
    setting: {
      findMany: async () => mockSettings,
      upsert: async ({ where, update, create }: any) => {
        const existingIdx = mockSettings.findIndex((s) => s.key === where.key);
        if (existingIdx >= 0) {
          mockSettings[existingIdx] = { key: where.key, value: update.value };
        } else {
          mockSettings.push({ key: create.key, value: create.value });
        }
        return { key: where.key, value: update?.value ?? create.value };
      },
    },
  };

  const defaults = await getStoreSettings(mockDb);
  assert.strictEqual(defaults.storeName, 'PHARMORA PHARMACY');
  assert.ok(defaults.phone);
  assert.ok(defaults.address);

  // Update store settings
  const updated = await updateStoreSettings(
    {
      storeName: 'PHARMORA HEALTHCARE & SURGICALS',
      phone: '+91 99999 88888',
      gstin: '27ABCDE1234F1Z5',
      receiptFooter: 'Medicines bring healing, smiles bring health!',
    },
    mockDb,
  );

  assert.strictEqual(updated.storeName, 'PHARMORA HEALTHCARE & SURGICALS');
  assert.strictEqual(updated.phone, '+91 99999 88888');
  assert.strictEqual(updated.gstin, '27ABCDE1234F1Z5');
  assert.strictEqual(updated.receiptFooter, 'Medicines bring healing, smiles bring health!');
});

test('2. Thermal Receipt Data: accurately calculates subtotal, discount, taxable base, CGST/SGST split, and grand total', async () => {
  const saleId = 'sale-rec-1';
  const mockDb: any = {
    setting: {
      findMany: async () => [
        { key: 'STORE_NAME', value: 'Test Pharmacy POS' },
        { key: 'STORE_PHONE', value: '+91 98765 00000' },
      ],
    },
    sale: {
      findUnique: async () => ({
        id: saleId,
        saleNumber: 'POS-2026-00123',
        saleDate: new Date('2026-10-06T10:30:00Z'),
        saleType: 'POS',
        status: 'COMPLETED',
        paymentMethod: 'CASH',
        totalAmount: 1180.0, // 1000 + 18% GST
        paidAmount: 1180.0,
        createdBy: { id: 'user-1', name: 'John Cashier' },
        customer: { id: 'cust-1', name: 'Aarav Sharma', phone: '9876543210', address: 'Flat 101, City' },
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            quantity: 10,
            sellingPrice: 100.0,
            discount: 0.0,
            gst: 18.0,
            product: { name: 'Amoxicillin 500mg', brand: 'Cipla', genericName: 'Amoxicillin', hsn: '3004' },
            batch: { batchNumber: 'BAT-AMX-99', expiryDate: new Date('2028-05-31'), mrp: 120.0 },
          },
        ],
        payments: [
          {
            id: 'pay-1',
            amount: 1180.0,
            splits: [{ paymentMethod: 'CASH', amount: 1180.0 }],
          },
        ],
      }),
    },
  };

  const receipt = await getReceiptData(saleId, mockDb);

  assert.strictEqual(receipt.store.storeName, 'Test Pharmacy POS');
  assert.strictEqual(receipt.sale.invoiceNumber, 'POS-2026-00123');
  assert.strictEqual(receipt.sale.cashierName, 'John Cashier');
  assert.strictEqual(receipt.customer.name, 'Aarav Sharma');
  assert.strictEqual(receipt.customer.phone, '9876543210');

  // Line items
  assert.strictEqual(receipt.items.length, 1);
  const it = receipt.items[0];
  assert.strictEqual(it.productName, 'Amoxicillin 500mg');
  assert.strictEqual(it.batchNumber, 'BAT-AMX-99');
  assert.strictEqual(it.quantity, 10);
  assert.strictEqual(it.unitPrice, 100);
  assert.strictEqual(it.taxableAmount, 1000);
  assert.strictEqual(it.gstRate, 18);
  assert.strictEqual(it.cgstAmount, 90);
  assert.strictEqual(it.sgstAmount, 90);
  assert.strictEqual(it.totalGst, 180);
  assert.strictEqual(it.lineTotal, 1180);

  // Totals
  assert.strictEqual(receipt.totals.subtotal, 1000);
  assert.strictEqual(receipt.totals.totalDiscount, 0);
  assert.strictEqual(receipt.totals.taxableAmount, 1000);
  assert.strictEqual(receipt.totals.cgstTotal, 90);
  assert.strictEqual(receipt.totals.sgstTotal, 90);
  assert.strictEqual(receipt.totals.totalGst, 180);
  assert.strictEqual(receipt.totals.grandTotal, 1180);

  // Payment
  assert.strictEqual(receipt.payment.paymentMethod, 'CASH');
  assert.strictEqual(receipt.payment.paidAmount, 1180);
  assert.strictEqual(receipt.payment.balanceDue, 0);
  assert.strictEqual(receipt.payment.isFullyPaid, true);

  // WhatsApp share
  assert.ok(receipt.whatsapp.shareUrl.includes('919876543210'));
  assert.ok(receipt.whatsapp.shareText.includes('POS-2026-00123'));
  assert.ok(receipt.whatsapp.shareText.includes('Amoxicillin 500mg'));
});

test('3. Split Payment & Partial Credit Receipt: handles cash/UPI split amounts and credit balance', async () => {
  const saleId = 'sale-split-1';
  const mockDb: any = {
    setting: { findMany: async () => [] },
    sale: {
      findUnique: async () => ({
        id: saleId,
        saleNumber: 'POS-SPLIT-01',
        saleDate: new Date('2026-10-06T11:00:00Z'),
        saleType: 'POS',
        status: 'COMPLETED',
        paymentMethod: 'BOTH',
        totalAmount: 1500.0,
        paidAmount: 1000.0,
        createdBy: { id: 'u1', name: 'Cashier' },
        customer: { id: 'c1', name: 'Credit Customer', phone: '9111122222', outstanding: 500 },
        items: [
          {
            id: 'it-1',
            productId: 'p1',
            quantity: 5,
            sellingPrice: 300.0,
            discount: 0,
            gst: 0,
            product: { name: 'Health Tonic', brand: 'HealthCo' },
            batch: { batchNumber: 'B-01' },
          },
        ],
        payments: [
          {
            id: 'pay-split',
            amount: 1000.0,
            splits: [
              { paymentMethod: 'CASH', amount: 400.0 },
              { paymentMethod: 'UPI', amount: 600.0 },
            ],
          },
        ],
      }),
    },
  };

  const receipt = await getReceiptData(saleId, mockDb);

  assert.strictEqual(receipt.totals.grandTotal, 1500);
  assert.strictEqual(receipt.payment.paidAmount, 1000);
  assert.strictEqual(receipt.payment.cashAmount, 400);
  assert.strictEqual(receipt.payment.upiAmount, 600);
  assert.strictEqual(receipt.payment.balanceDue, 500);
  assert.strictEqual(receipt.payment.isFullyPaid, false);
});

test('4. A4 GST Invoice PDF: generates valid non-empty PDF binary buffer with PDF magic header', async () => {
  const saleId = 'sale-pdf-1';
  const mockDb: any = {
    setting: { findMany: async () => [] },
    sale: {
      findUnique: async () => ({
        id: saleId,
        saleNumber: 'INV-A4-9988',
        saleDate: new Date('2026-10-06T12:00:00Z'),
        saleType: 'POS',
        status: 'COMPLETED',
        paymentMethod: 'UPI',
        totalAmount: 590.0,
        paidAmount: 590.0,
        createdBy: { id: 'u1', name: 'Pharmacist' },
        customer: { id: 'c1', name: 'Priya Verma', phone: '9888877777', address: 'Pune, Maharashtra' },
        items: [
          {
            id: 'it-1',
            productId: 'p1',
            quantity: 2,
            sellingPrice: 250.0,
            discount: 0,
            gst: 18.0,
            product: { name: 'Cetirizine 10mg Syrup', brand: 'PharmaPlus', hsn: '3004' },
            batch: { batchNumber: 'BAT-CET-01', expiryDate: new Date('2027-10-31') },
          },
        ],
        payments: [],
      }),
    },
  };

  const result = await generateInvoicePdfBuffer(saleId, mockDb);

  assert.ok(result.buffer instanceof Buffer);
  assert.strictEqual(result.buffer.length > 500, true);
  // Verify PDF header magic bytes: "%PDF-"
  const header = result.buffer.subarray(0, 5).toString('ascii');
  assert.strictEqual(header, '%PDF-');
  assert.strictEqual(result.filename, 'Invoice-INV-A4-9988.pdf');
});

test('5. Financial Safety: Receipt and PDF generation is strictly read-only with 0 state mutations', async () => {
  let writeAttempted = false;
  const mockDb: any = {
    setting: { findMany: async () => [] },
    sale: {
      findUnique: async () => ({
        id: 'safety-sale',
        saleNumber: 'POS-SAFE-01',
        saleDate: new Date(),
        totalAmount: 100,
        paidAmount: 100,
        paymentMethod: 'CASH',
        items: [],
        payments: [],
      }),
      create: () => { writeAttempted = true; },
      update: () => { writeAttempted = true; },
    },
    saleItem: { create: () => { writeAttempted = true; } },
    cashbookEntry: { create: () => { writeAttempted = true; } },
    stockMovement: { create: () => { writeAttempted = true; } },
  };

  await getReceiptData('safety-sale', mockDb);
  await generateInvoicePdfBuffer('safety-sale', mockDb);

  assert.strictEqual(writeAttempted, false, 'No database mutations should occur during receipt or PDF generation');
});

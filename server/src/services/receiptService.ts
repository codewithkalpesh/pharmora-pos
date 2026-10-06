import type { PrismaClient } from '@prisma/client';
import { database, missing, invalid, type DbClient } from './domainUtils.js';

export type StoreSettings = {
  storeName: string;
  tagline?: string;
  address: string;
  phone: string;
  email: string;
  gstin?: string;
  dlNumber?: string;
  fssaiNumber?: string;
  receiptFooter: string;
  invoiceTerms: string;
};

const DEFAULT_SETTINGS: StoreSettings = {
  storeName: 'PHARMORA PHARMACY',
  tagline: 'Healthcare & Wellness Partner',
  address: 'Shop No. 4, Medical Square, Central Hospital Road',
  phone: '+91 98765 43210',
  email: 'care@pharmora.local',
  gstin: '27AAAAA0000A1Z5',
  dlNumber: 'MH-MZ2-123456 / MH-MZ3-123457',
  fssaiNumber: '11521000000000',
  receiptFooter: 'Thank you for your visit! Wishing you a speedy recovery.',
  invoiceTerms: '1. Goods once sold will be taken back as per medicine return policy.\n2. Please consult your physician before consuming any medicines.\n3. Keep medicines out of reach of children.',
};

const round = (num: number) => Math.round(num * 100) / 100;

export const getStoreSettings = async (client?: DbClient, shopId = 'default-shop-pharmora'): Promise<StoreSettings> => {
  const db = database(client);
  const shop = db.shop ? await db.shop.findUnique({ where: { id: shopId } }).catch(() => null) : null;
  const settingsRows = await db.setting.findMany({
    where: {
      shopId,
      key: {
        in: [
          'STORE_NAME',
          'STORE_TAGLINE',
          'STORE_ADDRESS',
          'STORE_PHONE',
          'STORE_EMAIL',
          'STORE_GSTIN',
          'STORE_DL_NUMBER',
          'STORE_FSSAI_NUMBER',
          'RECEIPT_FOOTER',
          'INVOICE_TERMS',
        ],
      },
    },
  });

  const map = new Map(settingsRows.map((s) => [s.key, s.value]));

  const shopAddress = [shop?.address, shop?.city, shop?.state, shop?.pincode].filter(Boolean).join(', ');

  return {
    storeName: map.get('STORE_NAME') || shop?.name || DEFAULT_SETTINGS.storeName,
    tagline: map.get('STORE_TAGLINE') || DEFAULT_SETTINGS.tagline,
    address: map.get('STORE_ADDRESS') || (shopAddress || DEFAULT_SETTINGS.address),
    phone: map.get('STORE_PHONE') || shop?.phone || DEFAULT_SETTINGS.phone,
    email: map.get('STORE_EMAIL') || shop?.email || DEFAULT_SETTINGS.email,
    gstin: map.get('STORE_GSTIN') || shop?.gstin || DEFAULT_SETTINGS.gstin,
    dlNumber: map.get('STORE_DL_NUMBER') || shop?.drugLicenseNumber || DEFAULT_SETTINGS.dlNumber,
    fssaiNumber: map.get('STORE_FSSAI_NUMBER') || DEFAULT_SETTINGS.fssaiNumber,
    receiptFooter: map.get('RECEIPT_FOOTER') || DEFAULT_SETTINGS.receiptFooter,
    invoiceTerms: map.get('INVOICE_TERMS') || DEFAULT_SETTINGS.invoiceTerms,
  };
};

export const updateStoreSettings = async (input: Partial<StoreSettings>, client?: DbClient, shopId = 'default-shop-pharmora'): Promise<StoreSettings> => {
  const db = database(client);
  const updates: Array<{ key: string; value: string }> = [];

  if (input.storeName !== undefined) updates.push({ key: 'STORE_NAME', value: input.storeName });
  if (input.tagline !== undefined) updates.push({ key: 'STORE_TAGLINE', value: input.tagline });
  if (input.address !== undefined) updates.push({ key: 'STORE_ADDRESS', value: input.address });
  if (input.phone !== undefined) updates.push({ key: 'STORE_PHONE', value: input.phone });
  if (input.email !== undefined) updates.push({ key: 'STORE_EMAIL', value: input.email });
  if (input.gstin !== undefined) updates.push({ key: 'STORE_GSTIN', value: input.gstin });
  if (input.dlNumber !== undefined) updates.push({ key: 'STORE_DL_NUMBER', value: input.dlNumber });
  if (input.fssaiNumber !== undefined) updates.push({ key: 'STORE_FSSAI_NUMBER', value: input.fssaiNumber });
  if (input.receiptFooter !== undefined) updates.push({ key: 'RECEIPT_FOOTER', value: input.receiptFooter });
  if (input.invoiceTerms !== undefined) updates.push({ key: 'INVOICE_TERMS', value: input.invoiceTerms });

  for (const item of updates) {
    await db.setting.upsert({
      where: { key_shopId: { key: item.key, shopId } },
      update: { value: item.value },
      create: { key: item.key, value: item.value, shopId },
    });
  }

  return getStoreSettings(client, shopId);
};

export type ReceiptLineItem = {
  srNo: number;
  productId: string;
  productName: string;
  brand?: string | null;
  genericName?: string | null;
  hsn?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  quantity: number;
  unitPrice: number;
  mrp?: number | null;
  discount: number;
  taxableAmount: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  totalGst: number;
  lineTotal: number;
};

export type ReceiptData = {
  store: StoreSettings;
  sale: {
    id: string;
    invoiceNumber: string;
    saleDate: string;
    saleType: string;
    status: string;
    cashierName: string;
  };
  customer: {
    id?: string;
    name: string;
    phone?: string | null;
    address?: string | null;
    outstanding?: number;
  };
  items: ReceiptLineItem[];
  totals: {
    itemCount: number;
    totalQuantity: number;
    subtotal: number;
    totalDiscount: number;
    taxableAmount: number;
    cgstTotal: number;
    sgstTotal: number;
    totalGst: number;
    grandTotal: number;
  };
  payment: {
    paymentMethod: string;
    paidAmount: number;
    cashAmount?: number;
    upiAmount?: number;
    creditAmount: number;
    balanceDue: number;
    isFullyPaid: boolean;
  };
  whatsapp: {
    phoneNumber?: string | null;
    shareText: string;
    shareUrl: string;
  };
};

export const getReceiptData = async (saleId: string, client?: DbClient, shopId = 'default-shop-pharmora'): Promise<ReceiptData> => {
  const db = database(client);

  const [store, sale] = await Promise.all([
    getStoreSettings(client, shopId),
    db.sale.findFirst
      ? db.sale.findFirst({
          where: { id: saleId, shopId },
          include: {
            customer: true,
            createdBy: { select: { id: true, name: true } },
            items: {
              include: {
                product: true,
                batch: true,
              },
            },
            payments: {
              include: { splits: true },
            },
          },
        })
      : db.sale.findUnique({
          where: { id: saleId },
          include: {
            customer: true,
            createdBy: { select: { id: true, name: true } },
            items: {
              include: {
                product: true,
                batch: true,
              },
            },
            payments: {
              include: { splits: true },
            },
          },
        }),
  ]);

  if (!sale) {
    throw missing('Sale');
  }

  let subtotal = 0;
  let totalDiscount = 0;
  let taxableAmount = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalQuantity = 0;

  const items: ReceiptLineItem[] = sale.items.map((it, idx) => {
    const qty = it.quantity;
    totalQuantity += qty;

    const rate = Number(it.sellingPrice);
    const disc = Number(it.discount ?? 0);
    const grossLine = rate * qty;
    const netBase = Math.max(0, grossLine - disc);
    const gstPct = Number(it.gst ?? 0);

    const lineGst = (gstPct * netBase) / 100;
    const cgst = lineGst / 2;
    const sgst = lineGst / 2;
    const lineTotal = netBase + lineGst;

    subtotal += grossLine;
    totalDiscount += disc;
    taxableAmount += netBase;
    totalCgst += cgst;
    totalSgst += sgst;

    return {
      srNo: idx + 1,
      productId: it.productId,
      productName: it.product?.name ?? 'Unknown Item',
      brand: it.product?.brand ?? null,
      genericName: it.product?.genericName ?? null,
      hsn: it.product?.hsn ?? null,
      batchNumber: it.batch?.batchNumber ?? null,
      expiryDate: it.batch?.expiryDate ? it.batch.expiryDate.toISOString().slice(0, 10) : null,
      quantity: qty,
      unitPrice: round(rate),
      mrp: it.batch?.mrp ? Number(it.batch.mrp) : (it.product?.mrp ? Number(it.product.mrp) : null),
      discount: round(disc),
      taxableAmount: round(netBase),
      gstRate: gstPct,
      cgstAmount: round(cgst),
      sgstAmount: round(sgst),
      totalGst: round(lineGst),
      lineTotal: round(lineTotal),
    };
  });

  const totalGst = round(totalCgst + totalSgst);
  const grandTotal = round(Number(sale.totalAmount));
  const paidAmount = round(Number(sale.paidAmount));
  const creditAmount = round(Math.max(0, grandTotal - paidAmount));

  let cashAmount: number | undefined;
  let upiAmount: number | undefined;

  for (const payment of sale.payments) {
    for (const split of payment.splits) {
      if (split.paymentMethod === 'CASH') cashAmount = (cashAmount ?? 0) + Number(split.amount);
      if (split.paymentMethod === 'UPI' || split.paymentMethod === 'BANK') upiAmount = (upiAmount ?? 0) + Number(split.amount);
    }
  }

  const invoiceNumber = sale.saleNumber || sale.id;
  const customerName = sale.customer?.name || 'Walk-in Customer';
  const customerPhone = sale.customer?.phone || null;

  const waLines = [
    `*${store.storeName}*`,
    `Invoice: *#${invoiceNumber}*`,
    `Date: ${new Date(sale.saleDate).toLocaleDateString('en-IN')}`,
    `Customer: ${customerName}`,
    `-------------------------`,
    ...items.map(
      (it) =>
        `• ${it.productName}${it.batchNumber ? ` (B: ${it.batchNumber})` : ''} x${it.quantity} = ₹${it.lineTotal.toFixed(2)}`,
    ),
    `-------------------------`,
    `Subtotal: ₹${round(subtotal).toFixed(2)}`,
    totalDiscount > 0 ? `Discount: -₹${round(totalDiscount).toFixed(2)}` : '',
    totalGst > 0 ? `GST Included: ₹${totalGst.toFixed(2)}` : '',
    `*Grand Total: ₹${grandTotal.toFixed(2)}*`,
    `Payment: ${sale.paymentMethod} (Paid: ₹${paidAmount.toFixed(2)})`,
    creditAmount > 0 ? `*Balance Due: ₹${creditAmount.toFixed(2)}*` : '',
    `-------------------------`,
    store.receiptFooter,
  ].filter(Boolean);

  const shareText = waLines.join('\n');
  const cleanPhone = customerPhone ? customerPhone.replace(/\D/g, '') : '';
  const shareUrl = cleanPhone
    ? `https://wa.me/${cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone}?text=${encodeURIComponent(shareText)}`
    : `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  return {
    store,
    sale: {
      id: sale.id,
      invoiceNumber,
      saleDate: sale.saleDate.toISOString(),
      saleType: sale.saleType,
      status: sale.status,
      cashierName: sale.createdBy?.name || 'Cashier',
    },
    customer: {
      id: sale.customer?.id,
      name: customerName,
      phone: customerPhone,
      address: sale.customer?.address || null,
      outstanding: sale.customer?.outstanding ? Number(sale.customer.outstanding) : undefined,
    },
    items,
    totals: {
      itemCount: items.length,
      totalQuantity,
      subtotal: round(subtotal),
      totalDiscount: round(totalDiscount),
      taxableAmount: round(taxableAmount),
      cgstTotal: round(totalCgst),
      sgstTotal: round(totalSgst),
      totalGst,
      grandTotal,
    },
    payment: {
      paymentMethod: sale.paymentMethod,
      paidAmount,
      cashAmount: cashAmount !== undefined ? round(cashAmount) : undefined,
      upiAmount: upiAmount !== undefined ? round(upiAmount) : undefined,
      creditAmount,
      balanceDue: creditAmount,
      isFullyPaid: creditAmount <= 0,
    },
    whatsapp: {
      phoneNumber: customerPhone,
      shareText,
      shareUrl,
    },
  };
};

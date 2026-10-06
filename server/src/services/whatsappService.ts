import type { Prisma } from '@prisma/client';
import { database, missing, type DbClient } from './domainUtils.js';

export type WhatsAppPayload = {
  phoneNumber: string | null;
  cleanPhone: string | null;
  messageText: string;
  shareUrl: string;
};

const round = (num: number) => Math.round(num * 100) / 100;

export const formatWhatsAppPhoneNumber = (phoneNumber?: string | null): string | null => {
  if (!phoneNumber) return null;
  const digits = phoneNumber.replace(/\D/g, '');
  if (!digits) return null;
  // If 10 digits (common standard Indian mobile number), prepend 91
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

export const createWhatsAppUrl = (messageText: string, phoneNumber?: string | null): string => {
  const cleanPhone = formatWhatsAppPhoneNumber(phoneNumber);
  const encoded = encodeURIComponent(messageText);
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
};

/**
 * 1. Generate Customer Invoice WhatsApp Message
 */
export const generateCustomerInvoiceWhatsApp = async (
  saleId: string,
  client?: DbClient,
): Promise<WhatsAppPayload> => {
  const db = database(client);
  const sale = await db.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: true,
      items: { include: { product: true } },
      credits: true,
    },
  });

  if (!sale) throw missing('Sale');

  const customerName = sale.customer?.name || 'Customer';
  const customerPhone = sale.customer?.phone || null;
  const invoiceNumber = sale.saleNumber || `POS-${sale.id.slice(0, 8).toUpperCase()}`;
  const saleDateStr = new Date(sale.saleDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const totalAmount = Number(sale.totalAmount);
  const paidAmount = Number(sale.paidAmount);
  const balance = Math.max(0, round(totalAmount - paidAmount));

  const lines = [
    `Hello ${customerName},`,
    '',
    `Invoice: ${invoiceNumber}`,
    `Date: ${saleDateStr}`,
    `Total: ₹${totalAmount.toFixed(2)}`,
    `Paid: ₹${paidAmount.toFixed(2)}`,
    `Balance: ₹${balance.toFixed(2)}`,
    '',
    'Thank you for shopping with us.',
  ];

  const messageText = lines.join('\n');
  const cleanPhone = formatWhatsAppPhoneNumber(customerPhone);
  const shareUrl = createWhatsAppUrl(messageText, customerPhone);

  return {
    phoneNumber: customerPhone,
    cleanPhone,
    messageText,
    shareUrl,
  };
};

/**
 * 2. Generate Customer Payment Receipt WhatsApp Message
 */
export const generateCustomerPaymentReceiptWhatsApp = async (
  customerPaymentId: string,
  client?: DbClient,
): Promise<WhatsAppPayload> => {
  const db = database(client);
  const payment = await db.customerPayment.findUnique({
    where: { id: customerPaymentId },
    include: {
      customer: {
        include: {
          customerCredits: true,
        },
      },
    },
  });

  if (!payment) throw missing('Customer payment');

  const customer = payment.customer;
  const customerName = customer?.name || 'Customer';
  const customerPhone = customer?.phone || null;
  const paymentAmount = Number(payment.amount);
  const paymentDateStr = new Date(payment.paymentDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Current remaining outstanding
  const remainingDue = customer
    ? round(customer.customerCredits.reduce((sum, c) => sum + Number(c.balanceAmount), 0))
    : 0;
  const previousDue = round(remainingDue + paymentAmount);

  const lines = [
    'PAYMENT RECEIVED',
    '',
    `Customer: ${customerName}`,
    `Amount: ₹${paymentAmount.toFixed(2)}`,
    `Payment Method: ${payment.paymentMethod}`,
    `Date: ${paymentDateStr}`,
    '',
    `Previous Due: ₹${previousDue.toFixed(2)}`,
    `Payment: ₹${paymentAmount.toFixed(2)}`,
    `Remaining Due: ₹${remainingDue.toFixed(2)}`,
    '',
    'Thank you.',
  ];

  const messageText = lines.join('\n');
  const cleanPhone = formatWhatsAppPhoneNumber(customerPhone);
  const shareUrl = createWhatsAppUrl(messageText, customerPhone);

  return {
    phoneNumber: customerPhone,
    cleanPhone,
    messageText,
    shareUrl,
  };
};

/**
 * 3. Generate Customer Due Reminder WhatsApp Message
 */
export const generateCustomerDueReminderWhatsApp = async (
  customerId: string,
  client?: DbClient,
): Promise<WhatsAppPayload> => {
  const db = database(client);
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      customerCredits: true,
    },
  });

  if (!customer) throw missing('Customer');

  const customerName = customer.name;
  const customerPhone = customer.phone || null;
  const outstanding = round(
    customer.customerCredits.reduce((sum, c) => sum + Number(c.balanceAmount), 0),
  );

  const lines = [
    `Hello ${customerName},`,
    '',
    `Your current outstanding balance at Pharmora is ₹${outstanding.toFixed(2)}.`,
    '',
    'Please contact us if you have already made the payment.',
    '',
    'Thank you.',
  ];

  const messageText = lines.join('\n');
  const cleanPhone = formatWhatsAppPhoneNumber(customerPhone);
  const shareUrl = createWhatsAppUrl(messageText, customerPhone);

  return {
    phoneNumber: customerPhone,
    cleanPhone,
    messageText,
    shareUrl,
  };
};

/**
 * 4. Generate Purchase Order WhatsApp Message
 */
export const generatePurchaseOrderWhatsApp = async (
  purchaseOrderId: string,
  client?: DbClient,
): Promise<WhatsAppPayload> => {
  const db = database(client);
  const order = await db.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      supplierRel: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!order) throw missing('Purchase order');

  const supplierName = order.supplierRel?.name || order.supplier;
  const supplierPhone = order.supplierRel?.phone || null;
  const orderDateStr = new Date(order.orderDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const lines = [
    'PURCHASE ORDER',
    '',
    `Supplier: ${supplierName}`,
    `Date: ${orderDateStr}`,
    order.orderNumber ? `PO#: ${order.orderNumber}` : '',
    '',
    'Items:',
  ].filter(Boolean);

  let totalEstimated = 0;
  for (const item of order.items) {
    const itemUnitPrice = Number(item.unitPrice ?? item.product.purchasePrice ?? 0);
    totalEstimated += itemUnitPrice * item.quantity;
    const note = item.notes ? ` (${item.notes})` : '';
    lines.push(`• ${item.product.name} × ${item.quantity}${note}`);
  }

  const grandTotal = order.totalAmount ? Number(order.totalAmount) : totalEstimated;
  lines.push('');
  lines.push('Estimated Total:');
  lines.push(`₹${grandTotal.toFixed(2)}`);

  if (order.notes) {
    lines.push('');
    lines.push(`Notes: ${order.notes}`);
  }

  const messageText = lines.join('\n');
  const cleanPhone = formatWhatsAppPhoneNumber(supplierPhone);
  const shareUrl = createWhatsAppUrl(messageText, supplierPhone);

  return {
    phoneNumber: supplierPhone,
    cleanPhone,
    messageText,
    shareUrl,
  };
};

import { cents, fromCents, invalid, validatePaymentSplit } from './domainUtils.js';

export const lineTotal = (quantity: number, unitPrice: number, discount = 0, gst = 0) => {
  if (!Number.isInteger(quantity) || quantity <= 0) throw invalid('Quantity must be a positive integer');
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw invalid('Unit price cannot be negative');
  if (!Number.isFinite(discount) || discount < 0) throw invalid('Discount cannot be negative');
  if (!Number.isFinite(gst) || gst < 0) throw invalid('GST cannot be negative');
  const base = cents(quantity * unitPrice);
  const discounted = base - cents(discount);
  if (discounted < 0) throw invalid('Discount cannot exceed the line amount');
  return fromCents(discounted + Math.round(discounted * gst / 100));
};

export const paymentAccounts = (method: string, amount: number, cashAmount?: number, upiAmount?: number) => {
  validatePaymentSplit(method, amount, cashAmount, upiAmount);
  if (method === 'CASH') return [{ method: 'CASH' as const, amount }];
  if (method === 'UPI') return [{ method: 'UPI' as const, amount }];
  if (method === 'BANK') return [{ method: 'BANK' as const, amount }];
  if (method === 'BOTH') {
    return [
      ...(cashAmount! > 0 ? [{ method: 'CASH' as const, amount: cashAmount! }] : []),
      ...(upiAmount! > 0 ? [{ method: 'UPI' as const, amount: upiAmount! }] : []),
    ];
  }
  return [];
};

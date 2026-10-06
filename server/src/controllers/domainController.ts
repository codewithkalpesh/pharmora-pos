import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { PaymentMethod } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/appError.js';
import * as batches from '../services/batchService.js';
import * as cashbook from '../services/cashbookService.js';
import * as customers from '../services/customerService.js';
import * as expenses from '../services/expenseService.js';
import * as inventory from '../services/inventoryService.js';
import * as payments from '../services/paymentService.js';
import * as purchases from '../services/purchaseService.js';
import * as sales from '../services/saleService.js';
import * as stock from '../services/stockService.js';
import * as suppliers from '../services/supplierService.js';
import * as dailySales from '../services/dailySalesService.js';
import * as dashboard from '../services/dashboardService.js';
import * as purchaseOrders from '../services/purchaseOrderService.js';
import * as returns from '../services/returnsService.js';
import * as reports from '../services/reportsService.js';
import * as receipts from '../services/receiptService.js';
import * as invoicePdf from '../services/invoicePdfService.js';
import * as telegram from '../services/telegramService.js';
import * as whatsapp from '../services/whatsappService.js';

const endpoint = (operation: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void operation(req, res).catch(next); };
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join(', ');
    throw new AppError(`Invalid request input: ${details}`, 400);
  }
  return result.data;
};
const requiredKey = (req: Request) => req.get('Idempotency-Key') ?? '';
const actorId = (req: Request) => req.user?.id;
const paymentMethod = z.enum(['CASH', 'UPI', 'BANK', 'BOTH', 'CREDIT']);
const settledMethod = z.enum(['CASH', 'UPI', 'BANK', 'BOTH']);
const positiveInt = z.coerce.number().int().positive();
const nonNegative = z.coerce.number().nonnegative();
const cashbookAmount = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a non-negative decimal with at most two places');
const inventoryMoney = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a decimal string with at most two places');

const batchSchema = z.object({
  productId: z.string().min(1),
  batchNumber: z.string().trim().min(1),
  purchaseRate: inventoryMoney,
  mrp: inventoryMoney.optional(),
  sellingPrice: inventoryMoney.optional(),
  gst: inventoryMoney.optional(),
  quantity: z.coerce.number().int().nonnegative().optional(),
  freeQuantity: z.coerce.number().int().nonnegative().optional(),
  purchaseDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  supplierId: z.string().optional(),
});

export const listBatches = endpoint(async (req, res) => res.json({ success: true, data: await batches.listBatches(String(req.params.productId)) }));
export const listExpiredBatches = endpoint(async (_req, res) => res.json({ success: true, data: await batches.listExpiredBatches() }));
export const listNearExpiryBatches = endpoint(async (req, res) => {
  const days = parse(z.coerce.number().int().positive().default(30), req.query.days);
  return res.json({ success: true, data: await batches.listNearExpiryBatches(days) });
});
export const getExpiryDashboard = endpoint(async (_req, res) => res.json({ success: true, data: await batches.getExpiryDashboard() }));
export const createBatch = endpoint(async (req, res) => res.status(201).json({ success: true, data: await batches.createBatch({ ...parse(batchSchema, req.body), createdById: actorId(req) }, undefined, actorId(req)) }));
export const updateBatch = endpoint(async (req, res) => {
  const input = parse(batchSchema.pick({ expiryDate: true, mrp: true, sellingPrice: true, gst: true }).partial(), req.body);
  return res.json({ success: true, data: await batches.updateBatch(String(req.params.id), input, undefined, actorId(req)) });
});

const inventoryFiltersSchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const inventoryFilters = (req: Request) => {
  const parsed = parse(inventoryFiltersSchema, req.query);
  return { ...parsed, active: parsed.active === undefined ? undefined : parsed.active === 'true' };
};
export const listInventory = endpoint(async (req, res) => res.json({ success: true, data: await inventory.getInventoryList(inventoryFilters(req)) }));
export const listLowStockInventory = endpoint(async (req, res) => res.json({ success: true, data: await inventory.getLowStockProducts(inventoryFilters(req)) }));
export const listOutOfStockInventory = endpoint(async (req, res) => res.json({ success: true, data: await inventory.getOutOfStockProducts(inventoryFilters(req)) }));
export const listExpiryInventory = endpoint(async (req, res) => {
  const bucket = parse(z.enum(['EXPIRED', 'DAYS_0_30', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_91_180', 'SAFE']), req.query.bucket);
  return res.json({ success: true, data: await inventory.getExpiryInventory(bucket, inventoryFilters(req)) });
});
export const getProductStockSummary = endpoint(async (req, res) => res.json({ success: true, data: await inventory.getProductStockSummary(String(req.params.id)) }));
export const getFefoAvailability = endpoint(async (req, res) => {
  const query = parse(z.object({ quantity: z.coerce.number().int().positive().optional(), businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
  return res.json({ success: true, data: await inventory.getFefoBatchAvailability(String(req.params.id), query.quantity, query.businessDate) });
});
export const adjustInventoryStock = endpoint(async (req, res) => {
  const input = parse(z.object({
    productId: z.string().min(1),
    batchId: z.string().optional(),
    quantityChange: z.coerce.number().int().refine((value) => value !== 0),
    reason: z.enum(['DAMAGE', 'EXPIRED', 'FOUND', 'COUNT_CORRECTION', 'OTHER']),
    note: z.string().trim().min(1).max(250),
  }), req.body);
  return res.status(201).json({
    success: true,
    data: await inventory.adjustInventoryStock({ ...input, actorId: actorId(req) ?? '', idempotencyKey: requiredKey(req) }),
  });
});

const stockMovementSchema = z.object({
  productId: z.string().min(1),
  batchId: z.string().min(1),
  quantity: positiveInt,
  movementType: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'OPENING_STOCK']),
  reason: z.string().optional(),
});
export const adjustStock = endpoint(async (req, res) => {
  const input = parse(stockMovementSchema, req.body);
  const key = requiredKey(req);
  return res.status(201).json({ success: true, data: await stock.adjustStock({ ...input, referenceType: 'MANUAL_ADJUSTMENT', referenceId: key, idempotencyKey: key, createdById: actorId(req) }) });
});
export const recordDamage = endpoint(async (req, res) => {
  const input = parse(stockMovementSchema.omit({ movementType: true }), req.body);
  const key = requiredKey(req);
  return res.status(201).json({ success: true, data: await stock.recordDamage({ ...input, referenceType: 'DAMAGE', referenceId: key, idempotencyKey: key, createdById: actorId(req) }) });
});
export const recordExpiry = endpoint(async (req, res) => {
  const input = parse(stockMovementSchema.omit({ movementType: true }), req.body);
  const key = requiredKey(req);
  return res.status(201).json({ success: true, data: await stock.recordExpiry({ ...input, referenceType: 'EXPIRY', referenceId: key, idempotencyKey: key, createdById: actorId(req) }) });
});
export const recordReturn = endpoint(async (req, res) => {
  const input = parse(stockMovementSchema.omit({ movementType: true }).extend({ direction: z.enum(['IN', 'OUT']) }), req.body);
  const key = requiredKey(req);
  return res.status(201).json({ success: true, data: await stock.returnStock({ ...input, referenceType: 'RETURN', referenceId: key, idempotencyKey: key, createdById: actorId(req) }) });
});
export const listStockMovements = endpoint(async (req, res) => {
  const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;
  return res.json({ success: true, data: await prisma.stockMovement.findMany({ where: { productId }, include: { product: true, batch: true }, orderBy: { createdAt: 'desc' } }) });
});

const supplierSchema = z.object({
  name: z.string().trim().min(1), phone: z.string().optional(), gstin: z.string().optional(),
  address: z.string().optional(), paymentTerms: z.string().optional(), creditLimit: nonNegative.optional(),
});
export const listSuppliers = endpoint(async (req, res) => res.json({ success: true, data: await suppliers.listSuppliers(typeof req.query.search === 'string' ? req.query.search : undefined) }));
export const createSupplier = endpoint(async (req, res) => res.status(201).json({ success: true, data: await suppliers.createSupplier(parse(supplierSchema, req.body)) }));
export const updateSupplier = endpoint(async (req, res) => res.json({ success: true, data: await suppliers.updateSupplier(String(req.params.id), parse(supplierSchema.partial(), req.body)) }));
export const getSupplier = endpoint(async (req, res) => res.json({ success: true, data: await suppliers.getSupplier(String(req.params.id)) }));

const purchaseSchema = z.object({
  supplierId: z.string().min(1), invoiceNumber: z.string().trim().min(1), invoiceDate: z.coerce.date(),
  paymentMethod: paymentMethod.optional(), paidAmount: nonNegative.optional(),
  cashAmount: nonNegative.optional(), upiAmount: nonNegative.optional(), notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().min(1), batchNumber: z.string().trim().min(1), quantity: positiveInt,
    freeQty: z.coerce.number().int().nonnegative().optional(), purchaseRate: nonNegative,
    mrp: nonNegative.optional(), sellingPrice: nonNegative.optional(), gst: nonNegative.optional(),
    discount: nonNegative.optional(), expiryDate: z.coerce.date().optional(),
  })).min(1),
});
export const listPurchases = endpoint(async (req, res) => res.json({ success: true, data: await purchases.listPurchases(typeof req.query.supplierId === 'string' ? req.query.supplierId : undefined) }));
export const createPurchase = endpoint(async (req, res) => res.status(201).json({ success: true, data: await purchases.createPurchase({ ...parse(purchaseSchema, req.body), createdById: actorId(req) }, requiredKey(req)) }));
export const getPurchase = endpoint(async (req, res) => res.json({ success: true, data: await purchases.getPurchase(String(req.params.id)) }));

const customerSchema = z.object({ name: z.string().trim().min(1), phone: z.string().optional(), address: z.string().optional(), notes: z.string().optional() });
export const listCustomers = endpoint(async (req, res) => res.json({ success: true, data: await customers.listCustomers(typeof req.query.search === 'string' ? req.query.search : undefined) }));
export const createCustomer = endpoint(async (req, res) => res.status(201).json({ success: true, data: await customers.createCustomer(parse(customerSchema, req.body)) }));
export const updateCustomer = endpoint(async (req, res) => res.json({ success: true, data: await customers.updateCustomer(String(req.params.id), parse(customerSchema.partial(), req.body)) }));
export const getCustomer = endpoint(async (req, res) => res.json({ success: true, data: await customers.getCustomer(String(req.params.id)) }));

const saleSchema = z.object({
  saleNumber: z.string().optional(), customerId: z.string().optional(), paymentMethod,
  paidAmount: nonNegative.optional(),
  cashAmount: nonNegative.optional(), upiAmount: nonNegative.optional(),
  items: z.array(z.object({ productId: z.string().min(1), batchId: z.string().optional(), quantity: positiveInt, sellingPrice: nonNegative.optional(), discount: nonNegative.optional(), gst: nonNegative.optional() })).min(1),
});
export const listSales = endpoint(async (_req, res) => res.json({ success: true, data: await sales.listSales() }));
export const createSale = endpoint(async (req, res) => res.status(201).json({ success: true, data: await sales.createSale({ ...parse(saleSchema, req.body), createdById: actorId(req) }, requiredKey(req)) }));
export const getSale = endpoint(async (req, res) => res.json({ success: true, data: await sales.getSale(String(req.params.id)) }));

const paymentSchema = z.object({ amount: z.coerce.number().positive(), paymentMethod: settledMethod, cashAmount: nonNegative.optional(), upiAmount: nonNegative.optional(), notes: z.string().optional() });
export const listPayments = endpoint(async (_req, res) => res.json({ success: true, data: await payments.listPayments() }));
export const getPayment = endpoint(async (req, res) => res.json({ success: true, data: await payments.getPayment(String(req.params.id)) }));
export const recordSalePayment = endpoint(async (req, res) => {
  const input = parse(paymentSchema, req.body);
  return res.status(201).json({ success: true, data: await payments.recordSalePayment({ ...input, paymentMethod: input.paymentMethod as PaymentMethod, saleId: String(req.params.saleId), createdById: actorId(req) }, requiredKey(req)) });
});
export const recordCustomerPayment = endpoint(async (req, res) => {
  const input = parse(paymentSchema, req.body);
  return res.status(201).json({ success: true, data: await payments.recordCustomerPayment({ ...input, paymentMethod: input.paymentMethod as PaymentMethod, customerId: String(req.params.customerId), createdById: actorId(req) }, requiredKey(req)) });
});
export const recordSupplierPayment = endpoint(async (req, res) => {
  const input = parse(paymentSchema, req.body);
  return res.status(201).json({ success: true, data: await payments.recordSupplierPayment({ ...input, paymentMethod: input.paymentMethod as PaymentMethod, supplierId: String(req.params.supplierId), purchaseId: String(req.params.purchaseId), createdById: actorId(req) }, requiredKey(req)) });
});

export const listCashbookEntries = endpoint(async (req, res) => {
  const filterSchema = z.object({ date: z.string().optional(), from: z.string().optional(), to: z.string().optional(), paymentMethod: settledMethod.optional() });
  const input = parse(filterSchema, req.query);
  return res.json({ success: true, data: await cashbook.listCashbookEntries(input) });
});
const todayBusinessDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const cashbookDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
export const getCashbookBalances = endpoint(async (_req, res) => res.json({ success: true, data: await cashbook.getCurrentCashPosition() }));
export const getCashbookSummary = endpoint(async (req, res) => {
  const date = parse(cashbookDate, req.query.date) ?? todayBusinessDate();
  return res.json({ success: true, data: await cashbook.getDailyCashSummary(date) });
});
export const getOpeningCash = endpoint(async (req, res) => {
  const date = parse(cashbookDate, req.query.date) ?? todayBusinessDate();
  return res.json({ success: true, data: await cashbook.getOpeningCash(date) });
});
export const setOpeningCash = endpoint(async (req, res) => {
  const input = parse(z.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: cashbookAmount, reason: z.string().trim().optional() }), req.body);
  return res.json({ success: true, data: await cashbook.setOpeningCash({ ...input, createdById: actorId(req), idempotencyKey: requiredKey(req) }) });
});
export const getDailyClosing = endpoint(async (req, res) => {
  const date = parse(cashbookDate, req.query.date) ?? todayBusinessDate();
  return res.json({ success: true, data: await cashbook.getDailyClosing(date) });
});
export const createDailyClosing = endpoint(async (req, res) => {
  const input = parse(z.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), actualCash: cashbookAmount, notes: z.string().trim().max(500).optional() }), req.body);
  return res.status(201).json({ success: true, data: await cashbook.createDailyClosing({ ...input, closedById: actorId(req) }) });
});
export const createCashbookAdjustment = endpoint(async (req, res) => {
  const input = parse(z.object({
    direction: z.enum(['IN', 'OUT']),
    amount: cashbookAmount,
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().trim().min(1).max(250),
  }), req.body);
  const key = requiredKey(req);
  return res.status(201).json({ success: true, data: await cashbook.createAdjustment({ ...input, createdById: actorId(req), idempotencyKey: key }) });
});
export const transferCashAndBank = endpoint(async (req, res) => {
  const input = parse(z.object({ direction: z.enum(['CASH_TO_BANK', 'BANK_TO_CASH']), amount: cashbookAmount, businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), description: z.string().optional() }), req.body);
  const key = requiredKey(req);
  return res.status(201).json({ success: true, data: await cashbook.transferCashAndBank({ ...input, createdById: actorId(req), idempotencyKey: key }) });
});

const expenseSchema = z.object({
  category: z.string().trim().min(1), amount: z.coerce.number().positive(), expenseDate: z.coerce.date().optional(),
  paymentMethod: settledMethod, cashAmount: nonNegative.optional(), upiAmount: nonNegative.optional(),
  description: z.string().optional(), receiptUrl: z.string().url().optional(),
});
export const listExpenses = endpoint(async (req, res) => {
  const filters = parse(z.object({ category: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
  return res.json({ success: true, data: await expenses.listExpenses(filters) });
});
export const listExpenseCategories = endpoint(async (_req, res) => res.json({ success: true, data: await expenses.listExpenseCategories() }));
export const createExpense = endpoint(async (req, res) => res.status(201).json({ success: true, data: await expenses.createExpense({ ...parse(expenseSchema, req.body), createdById: actorId(req) }, requiredKey(req)) }));

const dailySalesSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cashSales: nonNegative,
  upiSales: nonNegative,
  otherSales: nonNegative.optional(),
  notes: z.string().trim().max(500).optional(),
});

export const getDailySalesReconciliation = endpoint(async (req, res) => {
  const date = parse(cashbookDate, req.query.date) ?? todayBusinessDate();
  return res.json({ success: true, data: await dailySales.getDailySalesReconciliation(date) });
});

export const getDailySale = endpoint(async (req, res) => {
  return res.json({ success: true, data: await dailySales.getDailySale(String(req.params.id)) });
});

export const getDailySaleForDate = endpoint(async (req, res) => {
  const date = parse(cashbookDate, req.query.date) ?? todayBusinessDate();
  return res.json({ success: true, data: await dailySales.getDailySaleForDate(date) });
});

export const createDailySales = endpoint(async (req, res) => {
  const input = parse(dailySalesSchema, req.body);
  const key = requiredKey(req);
  return res.status(201).json({
    success: true,
    data: await dailySales.createDailySales({ ...input, createdById: actorId(req) }, key),
  });
});

export const updateDailySales = endpoint(async (req, res) => {
  const input = parse(dailySalesSchema.omit({ businessDate: true }), req.body);
  const key = requiredKey(req);
  return res.json({
    success: true,
    data: await dailySales.updateDailySales(String(req.params.id), { ...input, createdById: actorId(req) }, key),
  });
});

export const getDashboardSummary = endpoint(async (req, res) => {
  const date = parse(cashbookDate, req.query.date) ?? todayBusinessDate();
  return res.json({ success: true, data: await dashboard.getDashboardSummary(date) });
});

const createPurchaseOrderSchema = z.object({
  supplier: z.string().trim().min(1).optional(),
  supplierId: z.string().optional(),
  expectedDate: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
    unitPrice: z.coerce.number().nonnegative().optional(),
    notes: z.string().trim().max(500).optional(),
  })).min(1),
});

const updatePurchaseOrderSchema = z.object({
  supplier: z.string().trim().min(1).optional(),
  supplierId: z.string().optional(),
  expectedDate: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
    unitPrice: z.coerce.number().nonnegative().optional(),
    notes: z.string().trim().max(500).optional(),
  })).min(1).optional(),
});

export const getPurchaseList = endpoint(async (req, res) => {
  const filter = parse(z.object({
    supplierId: z.string().optional(),
    search: z.string().optional(),
    filter: z.enum(['ALL', 'LOW_STOCK', 'OUT_OF_STOCK']).optional(),
  }), req.query);
  return res.json({ success: true, data: await purchaseOrders.getPurchaseList(filter) });
});

export const listPurchaseOrders = endpoint(async (req, res) => {
  const filter = parse(z.object({
    status: z.string().optional(),
    supplierId: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(50),
  }), req.query);
  return res.json({ success: true, data: await purchaseOrders.listPurchaseOrders(filter) });
});

export const getPurchaseOrder = endpoint(async (req, res) => {
  return res.json({ success: true, data: await purchaseOrders.getPurchaseOrder(String(req.params.id)) });
});

export const createPurchaseOrder = endpoint(async (req, res) => {
  const input = parse(createPurchaseOrderSchema, req.body);
  const key = requiredKey(req);
  return res.status(201).json({
    success: true,
    data: await purchaseOrders.createPurchaseOrder(
      { ...input, supplier: input.supplier ?? '', createdById: actorId(req) },
      key,
    ),
  });
});

export const updatePurchaseOrder = endpoint(async (req, res) => {
  const input = parse(updatePurchaseOrderSchema, req.body);
  return res.json({
    success: true,
    data: await purchaseOrders.updatePurchaseOrder(
      String(req.params.id),
      input,
      actorId(req),
    ),
  });
});

export const updatePurchaseOrderStatus = endpoint(async (req, res) => {
  const input = parse(z.object({
    status: z.enum(['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']),
    notes: z.string().trim().max(1000).optional(),
  }), req.body);
  return res.json({
    success: true,
    data: await purchaseOrders.updatePurchaseOrderStatus(
      String(req.params.id),
      input.status,
      input.notes,
      actorId(req),
    ),
  });
});

export const cancelPurchaseOrder = endpoint(async (req, res) => {
  const input = parse(z.object({
    reason: z.string().trim().max(1000).optional(),
  }), req.body);
  return res.json({
    success: true,
    data: await purchaseOrders.cancelPurchaseOrder(
      String(req.params.id),
      input.reason,
      actorId(req),
    ),
  });
});

export const reorderPurchaseOrder = endpoint(async (req, res) => {
  const key = requiredKey(req);
  return res.status(201).json({
    success: true,
    data: await purchaseOrders.reorderPurchaseOrder(
      String(req.params.id),
      actorId(req),
      key,
    ),
  });
});

export const getPurchaseOrderText = endpoint(async (req, res) => {
  const order = await purchaseOrders.getPurchaseOrder(String(req.params.id));
  const text = purchaseOrders.generateOrderText(order);
  const phone = order.supplierRel?.phone ?? null;
  const whatsappUrl = purchaseOrders.generateWhatsAppUrl(text, phone);
  return res.json({
    success: true,
    data: {
      text,
      whatsappUrl,
      supplierPhone: phone,
    },
  });
});

// ==========================================
// Returns Management Controllers
// ==========================================

const createSaleReturnSchema = z.object({
  saleId: z.string().min(1),
  items: z.array(z.object({
    saleItemId: z.string().min(1),
    quantity: positiveInt,
    condition: z.enum(['RESTOCKABLE', 'DAMAGED', 'EXPIRED', 'OTHER']).optional(),
    unitPrice: z.coerce.number().nonnegative().optional(),
    reason: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(500).optional(),
  })).min(1),
  refundMethod: paymentMethod.optional(),
  reason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
  businessDate: z.string().optional(),
});

export const listSaleReturns = endpoint(async (req, res) => {
  const filter = parse(z.object({
    saleId: z.string().optional(),
    customerId: z.string().optional(),
    search: z.string().optional(),
  }), req.query);
  return res.json({ success: true, data: await returns.listSaleReturns(filter) });
});

export const getSaleReturn = endpoint(async (req, res) => {
  return res.json({ success: true, data: await returns.getSaleReturn(String(req.params.id)) });
});

export const createSaleReturn = endpoint(async (req, res) => {
  const input = parse(createSaleReturnSchema, req.body);
  const key = requiredKey(req);
  return res.status(201).json({
    success: true,
    data: await returns.createSaleReturn({
      ...input,
      createdById: actorId(req),
      idempotencyKey: key,
    }),
  });
});

const createPurchaseReturnSchema = z.object({
  supplierId: z.string().min(1),
  purchaseId: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    batchId: z.string().min(1),
    quantity: positiveInt,
    unitPrice: z.coerce.number().nonnegative().optional(),
    purchaseItemId: z.string().optional(),
    reason: z.string().trim().max(500).optional(),
  })).min(1),
  refundMethod: paymentMethod.optional(),
  reason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
  businessDate: z.string().optional(),
});

export const listPurchaseReturns = endpoint(async (req, res) => {
  const filter = parse(z.object({
    supplierId: z.string().optional(),
    purchaseId: z.string().optional(),
    search: z.string().optional(),
  }), req.query);
  return res.json({ success: true, data: await returns.listPurchaseReturns(filter) });
});

export const getPurchaseReturn = endpoint(async (req, res) => {
  return res.json({ success: true, data: await returns.getPurchaseReturn(String(req.params.id)) });
});

export const createPurchaseReturn = endpoint(async (req, res) => {
  const input = parse(createPurchaseReturnSchema, req.body);
  const key = requiredKey(req);
  return res.status(201).json({
    success: true,
    data: await returns.createPurchaseReturn({
      ...input,
      createdById: actorId(req),
      idempotencyKey: key,
    }),
  });
});

// ==========================================
// Phase 9 Reports & Financial Analytics
// ==========================================

const reportFilterSchema = z.object({
  preset: z.enum(['TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH', 'PREV_MONTH', 'THIS_YEAR', 'CUSTOM']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  categoryId: z.string().optional(),
  supplierId: z.string().optional(),
  customerId: z.string().optional(),
});

export const getSalesReport = endpoint(async (req, res) => {
  const filter = parse(reportFilterSchema, req.query);
  return res.json({ success: true, data: await reports.getSalesReport(filter) });
});

export const getPurchaseReport = endpoint(async (req, res) => {
  const filter = parse(reportFilterSchema, req.query);
  return res.json({ success: true, data: await reports.getPurchaseReport(filter) });
});

export const getExpenseReport = endpoint(async (req, res) => {
  const filter = parse(reportFilterSchema, req.query);
  return res.json({ success: true, data: await reports.getExpenseReport(filter) });
});

export const getCashbookReport = endpoint(async (req, res) => {
  const filter = parse(reportFilterSchema, req.query);
  return res.json({ success: true, data: await reports.getCashbookReport(filter) });
});

export const getProfitReport = endpoint(async (req, res) => {
  const filter = parse(reportFilterSchema, req.query);
  return res.json({ success: true, data: await reports.getProfitReport(filter) });
});

export const getGstReport = endpoint(async (req, res) => {
  const filter = parse(reportFilterSchema, req.query);
  return res.json({ success: true, data: await reports.getGstReport(filter) });
});

export const getInventoryValuationReport = endpoint(async (req, res) => {
  const filter = parse(z.object({
    categoryId: z.string().optional(),
    supplierId: z.string().optional(),
  }), req.query);
  return res.json({ success: true, data: await reports.getInventoryValuationReport(filter) });
});

export const getCustomerOutstandingReport = endpoint(async (_req, res) => {
  return res.json({ success: true, data: await reports.getCustomerOutstandingReport() });
});

export const getSupplierOutstandingReport = endpoint(async (_req, res) => {
  return res.json({ success: true, data: await reports.getSupplierOutstandingReport() });
});

export const getProductAnalyticsReport = endpoint(async (req, res) => {
  const filter = parse(reportFilterSchema, req.query);
  return res.json({ success: true, data: await reports.getProductAnalyticsReport(filter) });
});

export const getCategoryAnalyticsReport = endpoint(async (req, res) => {
  const filter = parse(reportFilterSchema, req.query);
  return res.json({ success: true, data: await reports.getCategoryAnalyticsReport(filter) });
});

export const getMonthlyTargetReport = endpoint(async (req, res) => {
  const query = parse(z.object({
    year: z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }), req.query);
  return res.json({ success: true, data: await reports.getMonthlyTargetReport(query.year, query.month) });
});

export const setMonthlyTarget = endpoint(async (req, res) => {
  const body = parse(z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
    targetAmount: z.coerce.number().positive(),
  }), req.body);
  return res.json({
    success: true,
    data: await reports.setMonthlyTarget(body.year, body.month, body.targetAmount, actorId(req)),
  });
});

// ==========================================
// PHASE 10: RECEIPTS, INVOICE PDF & SETTINGS
// ==========================================

export const getSaleReceipt = endpoint(async (req, res) => {
  const data = await receipts.getReceiptData(String(req.params.id));
  return res.json({ success: true, data });
});

export const getSaleInvoicePdf = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { buffer, filename } = await invoicePdf.generateInvoicePdfBuffer(String(req.params.id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    return next(err);
  }
};

export const getStoreSettings = endpoint(async (_req, res) => {
  const data = await receipts.getStoreSettings();
  return res.json({ success: true, data });
});

export const updateStoreSettings = endpoint(async (req, res) => {
  const schema = z.object({
    storeName: z.string().trim().min(1).optional(),
    tagline: z.string().trim().optional(),
    address: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    gstin: z.string().trim().optional(),
    dlNumber: z.string().trim().optional(),
    fssaiNumber: z.string().trim().optional(),
    receiptFooter: z.string().trim().optional(),
    invoiceTerms: z.string().trim().optional(),
  });
  const parsed = parse(schema, req.body);
  const data = await receipts.updateStoreSettings(parsed);
  return res.json({ success: true, data });
});

// ==========================================
// PHASE 11: TELEGRAM & WHATSAPP INTEGRATION
// ==========================================

export const getTelegramStatus = endpoint(async (_req, res) => {
  const config = await telegram.getTelegramConfig();
  return res.json({ success: true, data: config });
});

export const updateTelegramConfig = endpoint(async (req, res) => {
  const schema = z.object({
    botToken: z.string().trim().optional(),
    chatId: z.string().trim().optional(),
    enabled: z.boolean().optional(),
    preferences: z.object({
      dailySummary: z.boolean().optional(),
      purchaseNotifications: z.boolean().optional(),
      expenseNotifications: z.boolean().optional(),
      dailyClosing: z.boolean().optional(),
      lowStockAlert: z.boolean().optional(),
      expiryAlert: z.boolean().optional(),
      customerDues: z.boolean().optional(),
      supplierDues: z.boolean().optional(),
      monthlySummary: z.boolean().optional(),
    }).optional(),
  });
  const parsed = parse(schema, req.body);
  const data = await telegram.updateTelegramConfig(parsed, undefined, actorId(req));
  return res.json({ success: true, data });
});

export const testTelegramConnection = endpoint(async (req, res) => {
  const result = await telegram.testTelegramConnection(undefined, actorId(req));
  return res.json({ success: result.success, data: result });
});

export const triggerDailySummary = endpoint(async (req, res) => {
  const result = await telegram.sendDailySummary(req.body?.date, undefined, actorId(req));
  return res.json({ success: result.success, data: result });
});

export const triggerMonthlySummary = endpoint(async (req, res) => {
  const result = await telegram.sendMonthlySummary(req.body?.year, req.body?.month, undefined, actorId(req));
  return res.json({ success: result.success, data: result });
});

export const triggerLowStockAlert = endpoint(async (req, res) => {
  const result = await telegram.sendLowStockAlert(undefined, actorId(req));
  return res.json({ success: result.success, data: result });
});

export const triggerExpiryAlert = endpoint(async (req, res) => {
  const result = await telegram.sendExpiryAlert(undefined, actorId(req));
  return res.json({ success: result.success, data: result });
});

export const triggerCustomerDuesAlert = endpoint(async (req, res) => {
  const result = await telegram.sendCustomerDueSummary(undefined, actorId(req));
  return res.json({ success: result.success, data: result });
});

export const triggerSupplierDuesAlert = endpoint(async (req, res) => {
  const result = await telegram.sendSupplierDueSummary(undefined, actorId(req));
  return res.json({ success: result.success, data: result });
});

export const listNotificationHistory = endpoint(async (_req, res) => {
  const events = await prisma.telegramEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return res.json({ success: true, data: events });
});

// WhatsApp Endpoints
export const getWhatsAppInvoice = endpoint(async (req, res) => {
  const data = await whatsapp.generateCustomerInvoiceWhatsApp(String(req.params.saleId));
  return res.json({ success: true, data });
});

export const getWhatsAppPaymentReceipt = endpoint(async (req, res) => {
  const data = await whatsapp.generateCustomerPaymentReceiptWhatsApp(String(req.params.paymentId));
  return res.json({ success: true, data });
});

export const getWhatsAppDueReminder = endpoint(async (req, res) => {
  const data = await whatsapp.generateCustomerDueReminderWhatsApp(String(req.params.customerId));
  return res.json({ success: true, data });
});

export const getWhatsAppPurchaseOrder = endpoint(async (req, res) => {
  const data = await whatsapp.generatePurchaseOrderWhatsApp(String(req.params.orderId));
  return res.json({ success: true, data });
});







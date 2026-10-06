import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/appError.js';
import * as products from '../services/productService.js';

const productSchema = z.object({
  name: z.string().trim().min(2),
  genericName: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  sku: z.string().trim().optional(),
  hsn: z.string().trim().optional(),
  gst: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  mrp: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  purchasePrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  minStock: z.coerce.number().int().nonnegative().optional(),
  maxStock: z.coerce.number().int().nonnegative().optional(),
  reorderLevel: z.coerce.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
  rackLocation: z.string().trim().optional(),
  supplierId: z.string().optional(),
  categoryId: z.string().optional(),
});

const endpoint = (operation: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void operation(req, res).catch(next); };

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError('Invalid request input', 400);
  return result.data;
};

export const listProducts = endpoint(async (req, res) => {
  const filters = parse(z.object({
    search: z.string().optional(),
    categoryId: z.string().optional(),
    active: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(50),
  }), req.query);
  const result = await products.listProductsPage({
    ...filters,
    active: filters.active === undefined ? undefined : filters.active === 'true',
  });
  return res.json({ success: true, data: result });
});

export const getProduct = endpoint(async (req, res) =>
  res.json({ success: true, data: await products.getProduct(String(req.params.id)) }));

export const createProduct = endpoint(async (req, res) => {
  const input = parse(productSchema.required({ name: true }), req.body);
  return res.status(201).json({ success: true, data: await products.createProduct(input, undefined, req.user?.id) });
});

export const updateProduct = endpoint(async (req, res) => {
  const input = parse(productSchema.partial(), req.body);
  return res.json({ success: true, data: await products.updateProduct(String(req.params.id), input, undefined, req.user?.id) });
});

export const setProductActive = endpoint(async (req, res) => {
  const input = parse(z.object({ active: z.boolean() }), req.body);
  return res.json({ success: true, data: await products.setProductActive(String(req.params.id), input.active, undefined, req.user?.id) });
});
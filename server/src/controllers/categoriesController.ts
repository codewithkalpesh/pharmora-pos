import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/appError.js';
import * as categories from '../services/categoryService.js';

const endpoint = (operation: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void operation(req, res).catch(next); };

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError('Invalid request input', 400);
  return result.data;
};

const nameSchema = z.object({ name: z.string().trim().min(2).max(100) });

export const listCategories = endpoint(async (req, res) => {
  const query = parse(z.object({ search: z.string().optional(), active: z.enum(['true', 'false']).optional() }), req.query);
  const result = await categories.listCategories({
    search: query.search,
    active: query.active === undefined ? undefined : query.active === 'true',
  });
  return res.json({ success: true, data: result });
});

export const createCategory = endpoint(async (req, res) => {
  const input = parse(nameSchema, req.body);
  return res.status(201).json({ success: true, data: await categories.createCategory(input, undefined, req.user?.id) });
});

export const updateCategory = endpoint(async (req, res) => {
  const input = parse(nameSchema, req.body);
  return res.json({ success: true, data: await categories.updateCategory(String(req.params.id), input, undefined, req.user?.id) });
});

export const setCategoryActive = endpoint(async (req, res) => {
  const input = parse(z.object({ active: z.boolean() }), req.body);
  return res.json({ success: true, data: await categories.setCategoryActive(String(req.params.id), input.active, undefined, req.user?.id) });
});
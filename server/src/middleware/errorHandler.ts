import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/appError.js';

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const prismaCode = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined;
  const statusCode = err instanceof AppError
    ? err.statusCode
    : prismaCode === 'P2002'
      ? 409
      : prismaCode === 'P2025'
        ? 404
        : prismaCode === 'P2003'
          ? 422
          : prismaCode === 'P2028'
            ? 503
            : 500;
  const message = err instanceof AppError
    ? err.message
    : prismaCode === 'P2002'
      ? 'A record with these unique values already exists'
      : prismaCode === 'P2025'
        ? 'Resource not found'
        : prismaCode === 'P2003'
          ? 'The request conflicts with related records'
          : prismaCode === 'P2028'
            ? 'Database transaction timed out. Please retry.'
            : 'Internal server error';

  if (process.env.NODE_ENV !== 'production') {
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    message,
  });
};

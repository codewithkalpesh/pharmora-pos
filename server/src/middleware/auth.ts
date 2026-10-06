import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import env from '../config/env.js';
import { AppError } from '../utils/appError.js';

export const protect = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError('Unauthorized', 401));
    }

    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, env.jwtSecret) as { sub: string; role: string };

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      return next(new AppError('Unauthorized', 401));
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role.name,
    };

    return next();
  } catch (_error) {
    return next(new AppError('Unauthorized', 401));
  }
};

export const authorizeRoles = (...allowedRoles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(new AppError('Forbidden', 403));
    }

    return next();
  };
};

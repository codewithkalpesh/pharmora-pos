import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z, ZodError } from 'zod';
import env from '../config/env.js';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/appError.js';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, 'Password is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

const sanitizeUser = (user: any) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  isActive: user.isActive,
  role: user.role ? { id: user.role.id, name: user.role.name } : null,
});

export const login = async (req: any, res: any, next: any) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return next(new AppError('Invalid email or password', 401));
    }

    if (!user.isActive) {
      return next(new AppError('Account is deactivated. Please contact the administrator.', 401));
    }

    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role.name,
      },
      env.jwtSecret,
      { expiresIn: '8h' },
    );

    return res.json({
      success: true,
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return next(new AppError('Validation failed', 400));
    }

    return next(error);
  }
};

export const getMe = async (req: any, res: any, next: any) => {
  try {
    if (!req.user) {
      return next(new AppError('Unauthorized', 401));
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { role: true },
    });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    if (!user.isActive) {
      return next(new AppError('Account is deactivated', 401));
    }

    return res.json({
      success: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return next(error);
  }
};

export const changePassword = async (req: any, res: any, next: any) => {
  try {
    if (!req.user) {
      return next(new AppError('Unauthorized', 401));
    }

    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return next(new AppError('Incorrect current password', 400));
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword },
    });

    return res.json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return next(new AppError('Validation failed', 400));
    }
    return next(error);
  }
};

export const logout = async (_req: any, res: any) => {
  return res.json({
    success: true,
    message: 'Logged out successfully',
  });
};


import { z, ZodError } from 'zod';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/appError.js';

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phone: z.string().trim().optional(),
  roleName: z.enum(['OWNER', 'MANAGER', 'CASHIER', 'PHARMACIST', 'STAFF']),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  phone: z.string().trim().optional(),
  roleName: z.enum(['OWNER', 'MANAGER', 'CASHIER', 'PHARMACIST', 'STAFF']),
});

const statusSchema = z.object({
  isActive: z.boolean(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

const sanitizeUser = (user: any) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role ? { id: user.role.id, name: user.role.name } : null,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const listUsers = async (_req: any, res: any, next: any) => {
  try {
    const users = await prisma.user.findMany({
      include: { role: true },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      success: true,
      users: users.map(sanitizeUser),
    });
  } catch (error) {
    return next(error);
  }
};

export const createUser = async (req: any, res: any, next: any) => {
  try {
    const payload = createUserSchema.parse(req.body);

    const role = await prisma.role.findUnique({ where: { name: payload.roleName } });
    if (!role) {
      return next(new AppError('Role not found', 404));
    }

    const existing = await prisma.user.findUnique({ where: { email: payload.email.toLowerCase() } });
    if (existing) {
      return next(new AppError('A user with this email already exists', 409));
    }

    const password = await bcrypt.hash(payload.password, 10);

    const user = await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email.toLowerCase(),
        password,
        phone: payload.phone || null,
        roleId: role.id,
        isActive: true,
      },
      include: { role: true },
    });

    return res.status(201).json({
      success: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return next(new AppError('Validation failed: ' + error.issues.map((e: any) => e.message).join(', '), 400));
    }
    return next(error);
  }
};

export const updateUser = async (req: any, res: any, next: any) => {
  try {
    const { id } = req.params;
    const payload = updateUserSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const role = await prisma.role.findUnique({ where: { name: payload.roleName } });
    if (!role) {
      return next(new AppError('Role not found', 404));
    }

    // Safety: If changing role away from OWNER on an active owner, verify they aren't the last active owner
    if (user.role.name === 'OWNER' && payload.roleName !== 'OWNER' && user.isActive) {
      const activeOwnerCount = await prisma.user.count({
        where: {
          isActive: true,
          role: { name: 'OWNER' },
        },
      });

      if (activeOwnerCount <= 1) {
        return next(new AppError('Cannot change role of the last active OWNER account', 400));
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        name: payload.name,
        phone: payload.phone || null,
        roleId: role.id,
      },
      include: { role: true },
    });

    return res.json({
      success: true,
      user: sanitizeUser(updated),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return next(new AppError('Validation failed: ' + error.issues.map((e: any) => e.message).join(', '), 400));
    }
    return next(error);
  }
};

export const setUserStatus = async (req: any, res: any, next: any) => {
  try {
    const { id } = req.params;
    const { isActive } = statusSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Safety: prevent deactivating the last active OWNER
    if (!isActive && user.role.name === 'OWNER' && user.isActive) {
      const activeOwnerCount = await prisma.user.count({
        where: {
          isActive: true,
          role: { name: 'OWNER' },
        },
      });

      if (activeOwnerCount <= 1) {
        return next(new AppError('Cannot deactivate the last active OWNER account', 400));
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive },
      include: { role: true },
    });

    return res.json({
      success: true,
      user: sanitizeUser(updated),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return next(new AppError('Validation failed: ' + error.issues.map((e: any) => e.message).join(', '), 400));
    }
    return next(error);
  }
};

export const resetUserPassword = async (req: any, res: any, next: any) => {
  try {
    const { id } = req.params;
    const { newPassword } = resetPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });

    return res.json({
      success: true,
      message: 'User password reset successfully',
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return next(new AppError('Validation failed: ' + error.issues.map((e: any) => e.message).join(', '), 400));
    }
    return next(error);
  }
};

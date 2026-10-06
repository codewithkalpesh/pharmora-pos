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

export const signupSchema = z
  .object({
    shopName: z.string().trim().min(2, 'Shop name must be at least 2 characters'),
    ownerName: z.string().trim().min(2, 'Owner name must be at least 2 characters'),
    email: z.string().trim().email('Invalid email address'),
    phone: z.string().trim().min(10, 'Mobile number must be at least 10 digits').optional().or(z.literal('')),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().optional().or(z.literal('')),
    address: z.string().trim().optional().or(z.literal('')),
    city: z.string().trim().optional().or(z.literal('')),
    state: z.string().trim().optional().or(z.literal('')),
    pincode: z.string().trim().optional().or(z.literal('')),
    gstin: z.string().trim().optional().or(z.literal('')),
    drugLicenseNumber: z.string().trim().optional().or(z.literal('')),
  })
  .refine((data) => !data.confirmPassword || data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

const sanitizeUser = (user: any) => ({
  id: user.id,
  shopId: user.shopId,
  name: user.name,
  email: user.email,
  phone: user.phone,
  isActive: user.isActive,
  role: user.role ? { id: user.role.id, name: user.role.name } : null,
  shop: user.shop
    ? {
        id: user.shop.id,
        name: user.shop.name,
        ownerName: user.shop.ownerName,
        phone: user.shop.phone,
        email: user.shop.email,
        address: user.shop.address,
        city: user.shop.city,
        state: user.shop.state,
        pincode: user.shop.pincode,
        gstin: user.shop.gstin,
        drugLicenseNumber: user.shop.drugLicenseNumber,
      }
    : null,
});

export const signup = async (req: any, res: any, next: any) => {
  try {
    const input = signupSchema.parse(req.body);
    const normalizedEmail = input.email.toLowerCase();

    // Check if user with email already exists across the system
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return next(new AppError('An account with this email already exists', 400));
    }

    // Ensure OWNER role exists in DB
    let ownerRole = await prisma.role.findUnique({
      where: { name: 'OWNER' },
    });

    if (!ownerRole) {
      ownerRole = await prisma.role.create({
        data: { name: 'OWNER' },
      });
    }

    const hashedPassword = await bcrypt.hash(input.password, 10);

    // Atomic transaction: create Shop, default Settings, and OWNER User
    const result = await prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          name: input.shopName,
          ownerName: input.ownerName,
          email: normalizedEmail,
          phone: input.phone || null,
          address: input.address || null,
          city: input.city || null,
          state: input.state || null,
          pincode: input.pincode || null,
          gstin: input.gstin || null,
          drugLicenseNumber: input.drugLicenseNumber || null,
        },
      });

      // Default Store Settings
      await tx.setting.createMany({
        data: [
          { shopId: shop.id, key: 'STORE_NAME', value: input.shopName },
          { shopId: shop.id, key: 'STORE_TAGLINE', value: 'Healthcare & Retail Pharmacy' },
          { shopId: shop.id, key: 'STORE_ADDRESS', value: input.address || '' },
          { shopId: shop.id, key: 'STORE_PHONE', value: input.phone || '' },
          { shopId: shop.id, key: 'STORE_EMAIL', value: normalizedEmail },
          { shopId: shop.id, key: 'STORE_GSTIN', value: input.gstin || '' },
          { shopId: shop.id, key: 'STORE_DL_NUMBER', value: input.drugLicenseNumber || '' },
          { shopId: shop.id, key: 'RECEIPT_FOOTER', value: 'Thank you for your visit! Wishing you good health.' },
          {
            shopId: shop.id,
            key: 'INVOICE_TERMS',
            value: '1. Goods once sold will be taken back as per return policy.\n2. Please consult your physician before consuming medicines.',
          },
        ],
      });

      const user = await tx.user.create({
        data: {
          shopId: shop.id,
          roleId: ownerRole.id,
          name: input.ownerName,
          email: normalizedEmail,
          password: hashedPassword,
          phone: input.phone || null,
          isActive: true,
        },
        include: { role: true, shop: true },
      });

      return { user, shop };
    });

    const token = jwt.sign(
      {
        sub: result.user.id,
        role: 'OWNER',
        shopId: result.shop.id,
      },
      env.jwtSecret,
      { expiresIn: '8h' },
    );

    return res.status(201).json({
      success: true,
      token,
      user: sanitizeUser(result.user),
      shop: {
        id: result.shop.id,
        name: result.shop.name,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const messages = error.issues.map((i) => i.message).join(', ');
      return next(new AppError(messages || 'Validation failed', 400));
    }
    return next(error);
  }
};

export const login = async (req: any, res: any, next: any) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true, shop: true },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return next(new AppError('Invalid email or password', 401));
    }

    if (!user.isActive) {
      return next(new AppError('Account is deactivated. Please contact the administrator.', 401));
    }

    if (user.shop && !user.shop.isActive) {
      return next(new AppError('Shop account is deactivated. Please contact support.', 403));
    }

    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role.name,
        shopId: user.shopId,
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
      include: { role: true, shop: true },
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

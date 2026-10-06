import bcrypt from 'bcryptjs';
import prisma from './lib/prisma.js';

async function seed() {
  const roleNames = ['OWNER', 'MANAGER', 'CASHIER', 'PHARMACIST', 'STAFF'] as const;

  for (const roleName of roleNames) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }

  const ownerRole = await prisma.role.findUnique({ where: { name: 'OWNER' } });

  if (!ownerRole) {
    throw new Error('OWNER role was not created');
  }

  const ownerPassword = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { email: 'owner@pharmora.local' },
    update: {
      password: ownerPassword,
      name: 'Pharmora Owner',
      isActive: true,
      roleId: ownerRole.id,
    },
    create: {
      email: 'owner@pharmora.local',
      name: 'Pharmora Owner',
      password: ownerPassword,
      phone: '+91 90000 00000',
      roleId: ownerRole.id,
    },
  });

  const categoryNames = ['Pain Relief', 'Vitamins', 'General Medicine', 'Hygiene'];

  for (const name of categoryNames) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const painRelief = await prisma.category.findUnique({ where: { name: 'Pain Relief' } });
  const vitamins = await prisma.category.findUnique({ where: { name: 'Vitamins' } });
  const generalMedicine = await prisma.category.findUnique({ where: { name: 'General Medicine' } });

  const productData = [
    {
      name: 'Paracetamol 650',
      genericName: 'Paracetamol',
      brand: 'Pharmora',
      barcode: '890123456001',
      sku: 'PAR-650',
      hsn: '3004',
      gst: 5,
      mrp: 35,
      sellingPrice: 32,
      purchasePrice: 22,
      minStock: 20,
      reorderLevel: 15,
      categoryId: painRelief?.id,
    },
    {
      name: 'Vitamin C Plus',
      genericName: 'Vitamin C',
      brand: 'Pharmora',
      barcode: '890123456002',
      sku: 'VIT-C-PLUS',
      hsn: '3004',
      gst: 12,
      mrp: 150,
      sellingPrice: 140,
      purchasePrice: 98,
      minStock: 12,
      reorderLevel: 8,
      categoryId: vitamins?.id,
    },
    {
      name: 'Cough Syrup',
      genericName: 'Cough Relief',
      brand: 'Pharmora',
      barcode: '890123456003',
      sku: 'COUGH-100',
      hsn: '3004',
      gst: 12,
      mrp: 120,
      sellingPrice: 110,
      purchasePrice: 74,
      minStock: 18,
      reorderLevel: 10,
      categoryId: generalMedicine?.id,
    },
  ];

  for (const product of productData) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {
        ...product,
      },
      create: {
        ...product,
      },
    });
  }

  console.log('Database seeded with default roles, owner account, categories, and sample products.');
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Seeding failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });

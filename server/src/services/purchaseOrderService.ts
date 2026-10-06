import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../utils/appError.js';
import { database, duplicate, idempotencyKey, invalid, missing, isUniqueConstraintError, withTransaction, type DbClient } from './domainUtils.js';
import { calculateStockStatus } from './inventoryMath.js';

export type PurchaseOrderStatus = 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export type PurchaseOrderItemInput = {
  productId: string;
  quantity: number;
  unitPrice?: number | string | null;
  notes?: string | null;
};

export type CreatePurchaseOrderInput = {
  shopId?: string;
  supplier: string;
  supplierId?: string | null;
  expectedDate?: Date | string | null;
  notes?: string | null;
  items: PurchaseOrderItemInput[];
  createdById?: string | null;
};

export type PurchaseOrderFilter = {
  shopId?: string;
  status?: string;
  supplierId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type PurchaseListFilter = {
  shopId?: string;
  supplierId?: string;
  search?: string;
  filter?: 'ALL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['ORDERED', 'CANCELLED'],
  ORDERED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
};

const formatOrderNumber = (date: Date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `PO-${y}${m}${d}-${rand}`;
};

export const calculateSuggestedOrderQty = (
  currentStock: number,
  reorderLevel: number,
  maxStock: number | null,
): number => {
  if (currentStock <= reorderLevel) {
    if (maxStock !== null && maxStock > currentStock) {
      return maxStock - currentStock;
    }
    if (reorderLevel === 0 && currentStock === 0) {
      return 10;
    }
    return Math.max(reorderLevel * 2 - currentStock, 1);
  }
  return 0;
};

export const getPurchaseList = async (
  filter: PurchaseListFilter = {},
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  const targetShopId = filter.shopId || shopId;
  const db = database(client);
  const search = filter.search?.trim();

  const where: Prisma.ProductWhereInput = {
    shopId: targetShopId,
    active: true,
    supplierId: filter.supplierId ? filter.supplierId : undefined,
    OR: search
      ? [
          { name: { contains: search, mode: 'insensitive' } },
          { genericName: { contains: search, mode: 'insensitive' } },
          { brand: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ]
      : undefined,
  };

  const products = await db.product.findMany({
    where,
    include: {
      supplier: true,
      category: true,
      batches: {
        select: {
          id: true,
          quantity: true,
          expiryDate: true,
        },
      },
      purchaseItems: {
        take: 2,
        orderBy: {
          purchase: {
            invoiceDate: 'desc',
          },
        },
        include: {
          purchase: {
            include: {
              supplier: true,
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const list = products.map((product) => {
    const currentStock = product.batches.reduce((sum, b) => sum + b.quantity, 0);
    const stockStatus = calculateStockStatus(currentStock, product.reorderLevel);
    const suggestedQuantity = calculateSuggestedOrderQty(
      currentStock,
      product.reorderLevel,
      product.maxStock,
    );

    const latestPurchaseItem = product.purchaseItems[0];
    const previousPurchaseItem = product.purchaseItems[1];

    const latestPurchasePrice = latestPurchaseItem
      ? Number(latestPurchaseItem.purchaseRate)
      : (product.purchasePrice ? Number(product.purchasePrice) : null);

    const previousPurchasePrice = previousPurchaseItem
      ? Number(previousPurchaseItem.purchaseRate)
      : null;

    const lastPurchaseDate = latestPurchaseItem
      ? latestPurchaseItem.purchase.invoiceDate
      : null;

    const lastSupplierName = latestPurchaseItem?.purchase?.supplier?.name ?? null;

    return {
      id: product.id,
      name: product.name,
      genericName: product.genericName,
      brand: product.brand,
      barcode: product.barcode,
      sku: product.sku,
      supplierId: product.supplierId,
      supplierName: product.supplier?.name ?? (lastSupplierName ?? 'Supplier not assigned'),
      currentStock,
      reorderLevel: product.reorderLevel,
      minStock: product.minStock,
      maxStock: product.maxStock,
      stockStatus,
      suggestedQuantity,
      latestPurchasePrice,
      previousPurchasePrice,
      lastPurchaseDate,
      productPurchasePrice: product.purchasePrice ? Number(product.purchasePrice) : null,
      sellingPrice: product.sellingPrice ? Number(product.sellingPrice) : null,
    };
  });

  if (filter.filter === 'OUT_OF_STOCK') {
    return list.filter((item) => item.stockStatus === 'OUT_OF_STOCK');
  }
  if (filter.filter === 'LOW_STOCK') {
    return list.filter((item) => item.stockStatus === 'OUT_OF_STOCK' || item.stockStatus === 'LOW_STOCK');
  }

  return list;
};

export const createPurchaseOrder = async (
  input: CreatePurchaseOrderInput,
  key?: string,
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  const targetShopId = input.shopId || shopId;
  const stableKey = key ? idempotencyKey(key) : undefined;
  if (!input.items || input.items.length === 0) {
    throw invalid('Purchase order must contain at least one item');
  }

  const supplierName = input.supplier?.trim();
  if (!supplierName && !input.supplierId) {
    throw invalid('Supplier name or supplier ID is required');
  }

  const productIds = new Set<string>();
  for (const item of input.items) {
    if (!item.productId) throw invalid('Product ID is required for each item');
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw invalid('Quantity must be a positive integer');
    }
    if (productIds.has(item.productId)) {
      throw duplicate('Duplicate product in the same purchase order is not allowed');
    }
    productIds.add(item.productId);
  }

  const db = database(client);

  if (stableKey) {
    const prior = await db.purchaseOrder.findUnique({
      where: { idempotencyKey: stableKey },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (prior) {
      if (
        prior.supplier !== (supplierName || prior.supplier) ||
        prior.items.length !== input.items.length ||
        input.items.some((it) => !prior.items.some((pi) => pi.productId === it.productId && pi.quantity === it.quantity))
      ) {
        throw duplicate('Idempotency key reused with different payload');
      }
      return prior;
    }
  }

  try {
    return await withTransaction(client, async (tx) => {
      let finalSupplierName = supplierName;
      let finalSupplierId = input.supplierId ?? null;

      if (finalSupplierId) {
        const sup = tx.supplier.findFirst
          ? await tx.supplier.findFirst({ where: { id: finalSupplierId, shopId: targetShopId } })
          : await tx.supplier.findUnique({ where: { id: finalSupplierId } });
        if (!sup) throw missing('Supplier');
        if (!finalSupplierName) finalSupplierName = sup.name;
      }

      if (!finalSupplierName) {
        throw invalid('Supplier name could not be determined');
      }

      // Fetch products and verify active
      const products = await tx.product.findMany({
        where: { id: { in: Array.from(productIds) }, shopId: targetShopId },
        include: {
          batches: true,
          purchaseItems: {
            take: 1,
            orderBy: { purchase: { invoiceDate: 'desc' } },
          },
        },
      });

      if (products.length !== productIds.size) {
        throw missing('One or more products were not found');
      }

      for (const p of products) {
        if (!p.active) {
          throw invalid(`Product '${p.name}' is inactive and cannot be ordered`);
        }
      }

      const productMap = new Map(products.map((p) => [p.id, p]));

      let totalQuantity = 0;
      let totalAmount = 0;

      const orderNumber = formatOrderNumber();

      const order = await tx.purchaseOrder.create({
        data: {
          shopId: targetShopId,
          orderNumber,
          supplier: finalSupplierName,
          supplierId: finalSupplierId,
          status: 'DRAFT',
          orderDate: new Date(),
          expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
          notes: input.notes?.trim() || null,
          createdById: input.createdById || null,
          idempotencyKey: stableKey || null,
        },
      });

      for (const item of input.items) {
        const prod = productMap.get(item.productId)!;
        const currentStock = prod.batches.reduce((sum, b) => sum + b.quantity, 0);

        let unitPrice = 0;
        if (item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== '') {
          unitPrice = Number(item.unitPrice);
          if (unitPrice < 0) throw invalid('Unit price cannot be negative');
        } else if (prod.purchaseItems[0]) {
          unitPrice = Number(prod.purchaseItems[0].purchaseRate);
        } else if (prod.purchasePrice) {
          unitPrice = Number(prod.purchasePrice);
        }

        const lineAmount = item.quantity * unitPrice;
        totalQuantity += item.quantity;
        totalAmount += lineAmount;

        await tx.purchaseOrderItem.create({
          data: {
            shopId: targetShopId,
            purchaseOrderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: unitPrice > 0 ? unitPrice : null,
            currentStockSnapshot: currentStock,
            reorderLevelSnapshot: prod.reorderLevel,
            notes: item.notes?.trim() || null,
          },
        });
      }

      const updatedOrder = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          totalQuantity,
          totalAmount: Math.round(totalAmount * 100) / 100,
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          supplierRel: true,
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          shopId: targetShopId,
          userId: input.createdById || null,
          action: 'PURCHASE_ORDER_CREATED',
          entityType: 'PurchaseOrder',
          entityId: order.id,
          newValue: {
            orderNumber: updatedOrder.orderNumber,
            supplier: updatedOrder.supplier,
            status: updatedOrder.status,
            totalQuantity: updatedOrder.totalQuantity,
            totalAmount: updatedOrder.totalAmount,
            itemCount: updatedOrder.items.length,
          },
        },
      });

      return updatedOrder;
    });
  } catch (error) {
    if (isUniqueConstraintError(error) && stableKey) {
      const original = await db.purchaseOrder.findUnique({
        where: { idempotencyKey: stableKey },
        include: {
          items: {
            include: { product: true },
          },
        },
      });
      if (original) return original;
    }
    throw error;
  }
};

export const updatePurchaseOrder = async (
  id: string,
  input: Partial<CreatePurchaseOrderInput>,
  actorId?: string,
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  const targetShopId = input.shopId || shopId;
  return await withTransaction(client, async (tx) => {
    const existing = tx.purchaseOrder.findFirst
      ? await tx.purchaseOrder.findFirst({
          where: { id, shopId: targetShopId },
          include: { items: true },
        })
      : await tx.purchaseOrder.findUnique({
          where: { id },
          include: { items: true },
        });
    if (!existing) throw missing('Purchase order');

    if (existing.status !== 'DRAFT') {
      throw invalid('Only DRAFT purchase orders can be edited');
    }

    let finalSupplier = existing.supplier;
    let finalSupplierId = existing.supplierId;

    if (input.supplierId !== undefined) {
      finalSupplierId = input.supplierId;
      if (finalSupplierId) {
        const sup = tx.supplier.findFirst
          ? await tx.supplier.findFirst({ where: { id: finalSupplierId, shopId: targetShopId } })
          : await tx.supplier.findUnique({ where: { id: finalSupplierId } });
        if (!sup) throw missing('Supplier');
        finalSupplier = input.supplier?.trim() || sup.name;
      }
    } else if (input.supplier) {
      finalSupplier = input.supplier.trim();
    }

    if (input.items) {
      if (input.items.length === 0) {
        throw invalid('Purchase order must contain at least one item');
      }

      const productIds = new Set<string>();
      for (const item of input.items) {
        if (!item.productId) throw invalid('Product ID is required for each item');
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
          throw invalid('Quantity must be a positive integer');
        }
        if (productIds.has(item.productId)) {
          throw duplicate('Duplicate product in the same purchase order is not allowed');
        }
        productIds.add(item.productId);
      }

      const products = await tx.product.findMany({
        where: { id: { in: Array.from(productIds) }, shopId: targetShopId },
        include: {
          batches: true,
          purchaseItems: {
            take: 1,
            orderBy: { purchase: { invoiceDate: 'desc' } },
          },
        },
      });

      if (products.length !== productIds.size) {
        throw missing('One or more products were not found');
      }

      for (const p of products) {
        if (!p.active) {
          throw invalid(`Product '${p.name}' is inactive and cannot be ordered`);
        }
      }

      const productMap = new Map(products.map((p) => [p.id, p]));

      // Delete existing items
      await tx.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: id, shopId: targetShopId },
      });

      let totalQuantity = 0;
      let totalAmount = 0;

      for (const item of input.items) {
        const prod = productMap.get(item.productId)!;
        const currentStock = prod.batches.reduce((sum, b) => sum + b.quantity, 0);

        let unitPrice = 0;
        if (item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== '') {
          unitPrice = Number(item.unitPrice);
          if (unitPrice < 0) throw invalid('Unit price cannot be negative');
        } else if (prod.purchaseItems[0]) {
          unitPrice = Number(prod.purchaseItems[0].purchaseRate);
        } else if (prod.purchasePrice) {
          unitPrice = Number(prod.purchasePrice);
        }

        totalQuantity += item.quantity;
        totalAmount += item.quantity * unitPrice;

        await tx.purchaseOrderItem.create({
          data: {
            shopId: targetShopId,
            purchaseOrderId: id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: unitPrice > 0 ? unitPrice : null,
            currentStockSnapshot: currentStock,
            reorderLevelSnapshot: prod.reorderLevel,
            notes: item.notes?.trim() || null,
          },
        });
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplier: finalSupplier,
          supplierId: finalSupplierId,
          expectedDate: input.expectedDate !== undefined ? (input.expectedDate ? new Date(input.expectedDate) : null) : existing.expectedDate,
          notes: input.notes !== undefined ? (input.notes?.trim() || null) : existing.notes,
          totalQuantity,
          totalAmount: Math.round(totalAmount * 100) / 100,
        },
        include: {
          items: { include: { product: true } },
          supplierRel: true,
        },
      });

      await tx.auditLog.create({
        data: {
          shopId: targetShopId,
          userId: actorId || null,
          action: 'PURCHASE_ORDER_UPDATED',
          entityType: 'PurchaseOrder',
          entityId: id,
          oldValue: {
            supplier: existing.supplier,
            totalQuantity: existing.totalQuantity,
            totalAmount: existing.totalAmount,
            itemCount: existing.items.length,
          },
          newValue: {
            supplier: updated.supplier,
            totalQuantity: updated.totalQuantity,
            totalAmount: updated.totalAmount,
            itemCount: updated.items.length,
          },
        },
      });

      return updated;
    }

    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplier: finalSupplier,
        supplierId: finalSupplierId,
        expectedDate: input.expectedDate !== undefined ? (input.expectedDate ? new Date(input.expectedDate) : null) : existing.expectedDate,
        notes: input.notes !== undefined ? (input.notes?.trim() || null) : existing.notes,
      },
      include: {
        items: { include: { product: true } },
        supplierRel: true,
      },
    });

    await tx.auditLog.create({
      data: {
        shopId: targetShopId,
        userId: actorId || null,
        action: 'PURCHASE_ORDER_UPDATED',
        entityType: 'PurchaseOrder',
        entityId: id,
        oldValue: { supplier: existing.supplier, notes: existing.notes },
        newValue: { supplier: updated.supplier, notes: updated.notes },
      },
    });

    return updated;
  });
};

export const updatePurchaseOrderStatus = async (
  id: string,
  newStatus: PurchaseOrderStatus,
  notes?: string,
  actorId?: string,
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  return await withTransaction(client, async (tx) => {
    const existing = tx.purchaseOrder.findFirst
      ? await tx.purchaseOrder.findFirst({ where: { id, shopId } })
      : await tx.purchaseOrder.findUnique({ where: { id } });
    if (!existing) throw missing('Purchase order');

    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(newStatus)) {
      throw invalid(`Invalid status transition from ${existing.status} to ${newStatus}`);
    }

    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: newStatus,
        notes: notes ? (existing.notes ? `${existing.notes}\n${notes}` : notes) : existing.notes,
      },
      include: {
        items: { include: { product: true } },
        supplierRel: true,
      },
    });

    await tx.auditLog.create({
      data: {
        shopId,
        userId: actorId || null,
        action: newStatus === 'CANCELLED' ? 'PURCHASE_ORDER_CANCELLED' : 'PURCHASE_ORDER_STATUS_CHANGED',
        entityType: 'PurchaseOrder',
        entityId: id,
        oldValue: { status: existing.status },
        newValue: { status: newStatus, notes: updated.notes },
      },
    });

    return updated;
  });
};

export const cancelPurchaseOrder = async (
  id: string,
  reason?: string,
  actorId?: string,
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  return updatePurchaseOrderStatus(id, 'CANCELLED', reason, actorId, client, shopId);
};

export const reorderPurchaseOrder = async (
  id: string,
  actorId?: string,
  key?: string,
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  const db = database(client);
  const existing = db.purchaseOrder.findFirst
    ? await db.purchaseOrder.findFirst({
        where: { id, shopId },
        include: { items: true },
      })
    : await db.purchaseOrder.findUnique({
        where: { id },
        include: { items: true },
      });
  if (!existing) throw missing('Purchase order');

  const items = existing.items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice ? Number(item.unitPrice) : null,
    notes: item.notes,
  }));

  const newOrder = await createPurchaseOrder(
    {
      shopId,
      supplier: existing.supplier,
      supplierId: existing.supplierId,
      notes: `Reordered from #${existing.orderNumber ?? existing.id}`,
      items,
      createdById: actorId,
    },
    key,
    client,
    shopId,
  );

  await db.auditLog.create({
    data: {
      shopId,
      userId: actorId || null,
      action: 'PURCHASE_ORDER_REORDERED',
      entityType: 'PurchaseOrder',
      entityId: newOrder.id,
      newValue: {
        reorderedFromId: existing.id,
        reorderedFromNumber: existing.orderNumber,
        newOrderNumber: newOrder.orderNumber,
      },
    },
  });

  return newOrder;
};

export const listPurchaseOrders = async (
  filter: PurchaseOrderFilter = {},
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  const targetShopId = filter.shopId || shopId;
  const db = database(client);
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 50;
  const search = filter.search?.trim();

  const where: Prisma.PurchaseOrderWhereInput = {
    shopId: targetShopId,
    status: filter.status ? filter.status : undefined,
    supplierId: filter.supplierId ? filter.supplierId : undefined,
    OR: search
      ? [
          { orderNumber: { contains: search, mode: 'insensitive' } },
          { supplier: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
        ]
      : undefined,
  };

  const [orders, total] = await Promise.all([
    db.purchaseOrder.findMany({
      where,
      include: {
        supplierRel: true,
        createdBy: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                genericName: true,
                brand: true,
                sku: true,
                barcode: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.purchaseOrder.count({ where }),
  ]);

  return {
    items: orders,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
};

export const getPurchaseOrder = async (
  id: string,
  client?: DbClient,
  shopId = 'default-shop-pharmora',
) => {
  const db = database(client);
  const order = await db.purchaseOrder.findFirst({
    where: { id, shopId },
    include: {
      supplierRel: true,
      createdBy: { select: { id: true, name: true, email: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              genericName: true,
              brand: true,
              sku: true,
              barcode: true,
              reorderLevel: true,
              minStock: true,
              maxStock: true,
              purchasePrice: true,
              sellingPrice: true,
            },
          },
        },
      },
    },
  });

  if (!order) throw missing('Purchase order');
  return order;
};

export const generateOrderText = (order: {
  orderNumber?: string | null;
  supplier: string;
  orderDate?: Date | string | null;
  totalQuantity?: number | null;
  totalAmount?: number | Prisma.Decimal | null;
  notes?: string | null;
  items: Array<{
    quantity: number;
    unitPrice?: number | Prisma.Decimal | null;
    notes?: string | null;
    product: {
      name: string;
      genericName?: string | null;
      brand?: string | null;
    };
  }>;
}) => {
  const dateStr = order.orderDate
    ? new Date(order.orderDate).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    `*Order for ${order.supplier}*`,
    `PO#: ${order.orderNumber || 'Draft'} | Date: ${dateStr}`,
    '',
  ];

  order.items.forEach((item, index) => {
    const prodName = item.product.name;
    const note = item.notes ? ` (${item.notes})` : '';
    lines.push(`${index + 1}. ${prodName} - ${item.quantity} pcs${note}`);
  });

  const totalQty = order.totalQuantity ?? order.items.reduce((sum, i) => sum + i.quantity, 0);
  lines.push('');
  lines.push(`Total Items: ${order.items.length} | Total Qty: ${totalQty}`);
  if (order.totalAmount) {
    const val = typeof order.totalAmount === 'number' ? order.totalAmount : Number(order.totalAmount);
    lines.push(`Est. Value: ₹${val.toFixed(2)}`);
  }
  if (order.notes) {
    lines.push(`Notes: ${order.notes}`);
  }

  return lines.join('\n');
};

export const generateWhatsAppUrl = (
  orderText: string,
  phoneNumber?: string | null,
) => {
  const cleanPhone = phoneNumber ? phoneNumber.replace(/\D/g, '') : '';
  const encoded = encodeURIComponent(orderText);
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
};

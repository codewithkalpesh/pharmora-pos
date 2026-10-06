-- CreateTable Shop
CREATE TABLE IF NOT EXISTS "Shop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "gstin" TEXT,
    "drugLicenseNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- Insert Default Shop for existing store data
INSERT INTO "Shop" (
    "id", "name", "ownerName", "email", "phone", "address",
    "drugLicenseNumber", "isActive", "createdAt", "updatedAt"
)
VALUES (
    'default-shop-pharmora',
    'SHREE RAJLAXMI MEDICAL AND GENERAL STORES',
    'Pharmora Owner',
    'care@pharmora.local',
    '+91 98765 43210',
    'Shop No. 4, Medical Square, Central Hospital Road',
    'MH-MZ2-123456 / MH-MZ3-123457',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- Add shopId columns and backfill existing data to default-shop-pharmora
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "User" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "User" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "Category" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "Category" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "Supplier" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "Supplier" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "Customer" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "Customer" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "Product" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "Product" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "ProductBatch" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "ProductBatch" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "ProductBatch" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "Purchase" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "Purchase" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "Sale" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "Sale" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "SaleReturn" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "SaleReturn" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "SaleReturn" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "PurchaseReturn" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "PurchaseReturn" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "Payment" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "Payment" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "Expense" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "Expense" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "CashbookEntry" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "CashbookEntry" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "CashbookEntry" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "CustomerPayment" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "CustomerPayment" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "CustomerPayment" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "CustomerCredit" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "CustomerCredit" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "CustomerCredit" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "SupplierPayment" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "SupplierPayment" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "SupplierPayment" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "DailyClosing" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "DailyClosing" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "DailyClosing" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "DailySale" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "DailySale" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "DailySale" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "BankAccount" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "BankAccount" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "PurchaseOrder" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "SalesTarget" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "SalesTarget" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "SalesTarget" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "ReportSnapshot" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "ReportSnapshot" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "ReportSnapshot" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "Setting" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;
ALTER TABLE "Setting" ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "AuditLog" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "Notification" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;

ALTER TABLE "TelegramEvent" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
UPDATE "TelegramEvent" SET "shopId" = 'default-shop-pharmora' WHERE "shopId" IS NULL;

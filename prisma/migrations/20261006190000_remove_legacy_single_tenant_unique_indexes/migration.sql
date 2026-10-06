-- Drop legacy single-column unique indexes that prevent multi-tenancy
DROP INDEX IF EXISTS "Setting_key_key";
DROP INDEX IF EXISTS "Product_barcode_key";
DROP INDEX IF EXISTS "Product_sku_key";
DROP INDEX IF EXISTS "Category_name_key";
DROP INDEX IF EXISTS "DailySale_businessDate_key";
DROP INDEX IF EXISTS "DailyClosing_closingDate_key";

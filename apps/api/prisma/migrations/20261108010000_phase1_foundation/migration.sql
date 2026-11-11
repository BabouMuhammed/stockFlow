-- Additive Phase 1 migration; abort atomically if legacy data violates tenant constraints.
BEGIN;
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'CASHIER');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'COMPLETED', 'VOIDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIPT', 'SALE', 'DAMAGE', 'EXPIRY', 'RETURN', 'ADJUSTMENT', 'COUNT');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "StockLevel" DROP CONSTRAINT "StockLevel_productId_fkey";

-- DropForeignKey
ALTER TABLE "StockReceiptItem" DROP CONSTRAINT "StockReceiptItem_receiptId_fkey";

-- DropForeignKey
ALTER TABLE "StockReceiptItem" DROP CONSTRAINT "StockReceiptItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_productId_fkey";

-- DropForeignKey
ALTER TABLE "SaleItem" DROP CONSTRAINT "SaleItem_saleId_fkey";

-- DropForeignKey
ALTER TABLE "SaleItem" DROP CONSTRAINT "SaleItem_productId_fkey";

-- DropIndex
DROP INDEX "StockLevel_productId_key";

-- DropIndex
DROP INDEX "StockLevel_businessId_productId_key";

-- DropIndex
DROP INDEX "StockReceipt_businessId_createdAt_idx";

-- DropIndex
DROP INDEX "StockMovement_businessId_createdAt_idx";

-- DropIndex
DROP INDEX "Sale_businessId_createdAt_idx";

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'unit',
ALTER COLUMN "lowStockThreshold" SET DEFAULT 5,
ALTER COLUMN "lowStockThreshold" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "StockLevel" ADD COLUMN     "branchId" UUID,
ALTER COLUMN "quantity" SET DEFAULT 0,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "StockReceipt" ADD COLUMN     "branchId" UUID,
ADD COLUMN     "supplierId" UUID,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "StockReceiptItem" ADD COLUMN     "businessId" UUID,
ADD COLUMN     "productName" TEXT,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "branchId" UUID,
ALTER COLUMN "movementType" TYPE "MovementType" USING "movementType"::"MovementType",
ALTER COLUMN "quantityDelta" SET DATA TYPE DECIMAL(18,3),
ALTER COLUMN "quantityAfter" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "branchId" UUID,
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "SaleStatus" USING "status"::"SaleStatus",
ALTER COLUMN "status" SET DEFAULT 'DRAFT',
ALTER COLUMN "paymentMethod" TYPE "PaymentMethod" USING "paymentMethod"::"PaymentMethod";

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "businessId" UUID,
ADD COLUMN     "productName" TEXT,
ADD COLUMN     "productSku" TEXT,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(18,3);

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedById" UUID,
    "approvedById" UUID,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountItem" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "expectedQuantity" DECIMAL(18,3) NOT NULL,
    "countedQuantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "StockCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Preserve existing prototype rows; a legacy branch belongs to each existing business.
INSERT INTO "Branch" ("id", "businessId", "name", "code", "updatedAt")
SELECT "id", "id", 'Legacy main branch', 'MAIN', CURRENT_TIMESTAMP FROM "Business";
UPDATE "StockLevel" SET "branchId" = "businessId" WHERE "branchId" IS NULL;
ALTER TABLE "StockLevel" ALTER COLUMN "branchId" SET NOT NULL;
UPDATE "StockReceipt" SET "branchId" = "businessId" WHERE "branchId" IS NULL;
ALTER TABLE "StockReceipt" ALTER COLUMN "branchId" SET NOT NULL;
UPDATE "StockMovement" SET "branchId" = "businessId" WHERE "branchId" IS NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "branchId" SET NOT NULL;
UPDATE "Sale" SET "branchId" = "businessId" WHERE "branchId" IS NULL;
ALTER TABLE "Sale" ALTER COLUMN "branchId" SET NOT NULL;
UPDATE "StockReceiptItem" i SET "businessId" = r."businessId", "productName" = p."name"
FROM "StockReceipt" r, "Product" p WHERE i."receiptId" = r."id" AND i."productId" = p."id";
UPDATE "SaleItem" i SET "businessId" = s."businessId", "productName" = p."name", "productSku" = p."sku"
FROM "Sale" s, "Product" p WHERE i."saleId" = s."id" AND i."productId" = p."id";
ALTER TABLE "StockReceiptItem" ALTER COLUMN "businessId" SET NOT NULL, ALTER COLUMN "productName" SET NOT NULL;
ALTER TABLE "SaleItem" ALTER COLUMN "businessId" SET NOT NULL, ALTER COLUMN "productName" SET NOT NULL, ALTER COLUMN "productSku" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "StockReceipt" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Sale" ALTER COLUMN "updatedAt" DROP DEFAULT;
-- Historical payment data already existed on Sale; preserve it in the normalized table.
INSERT INTO "Payment" ("id", "businessId", "saleId", "method", "amountMinor", "createdAt")
SELECT "id", "businessId", "id", "paymentMethod", "totalMinor", "createdAt" FROM "Sale" WHERE "status" = 'COMPLETED';

-- CreateIndex
CREATE UNIQUE INDEX "Branch_businessId_id_key" ON "Branch"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_businessId_code_key" ON "Branch"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "User_businessId_id_key" ON "User"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "User_businessId_email_key" ON "User"("businessId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_businessId_userId_expiresAt_idx" ON "UserSession"("businessId", "userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Supplier_businessId_name_idx" ON "Supplier"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_businessId_id_key" ON "Supplier"("businessId", "id");

-- CreateIndex
CREATE INDEX "Payment_businessId_saleId_idx" ON "Payment"("businessId", "saleId");

-- CreateIndex
CREATE INDEX "StockCount_businessId_branchId_status_idx" ON "StockCount"("businessId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_businessId_id_key" ON "StockCount"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountItem_businessId_countId_productId_key" ON "StockCountItem"("businessId", "countId", "productId");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_businessId_id_key" ON "Category"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Product_businessId_id_key" ON "Product"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_businessId_branchId_productId_key" ON "StockLevel"("businessId", "branchId", "productId");

-- CreateIndex
CREATE INDEX "StockReceipt_businessId_branchId_createdAt_idx" ON "StockReceipt"("businessId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceipt_businessId_id_key" ON "StockReceipt"("businessId", "id");

-- CreateIndex
CREATE INDEX "StockReceiptItem_businessId_receiptId_idx" ON "StockReceiptItem"("businessId", "receiptId");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_branchId_createdAt_idx" ON "StockMovement"("businessId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_productId_createdAt_idx" ON "StockMovement"("businessId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_businessId_branchId_createdAt_idx" ON "Sale"("businessId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_businessId_id_key" ON "Sale"("businessId", "id");

-- CreateIndex
CREATE INDEX "SaleItem_businessId_saleId_idx" ON "SaleItem"("businessId", "saleId");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_businessId_userId_fkey" FOREIGN KEY ("businessId", "userId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_categoryId_fkey" FOREIGN KEY ("businessId", "categoryId") REFERENCES "Category"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_businessId_supplierId_fkey" FOREIGN KEY ("businessId", "supplierId") REFERENCES "Supplier"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_businessId_receiptId_fkey" FOREIGN KEY ("businessId", "receiptId") REFERENCES "StockReceipt"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_businessId_saleId_fkey" FOREIGN KEY ("businessId", "saleId") REFERENCES "Sale"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_saleId_fkey" FOREIGN KEY ("businessId", "saleId") REFERENCES "Sale"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_businessId_branchId_fkey" FOREIGN KEY ("businessId", "branchId") REFERENCES "Branch"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_businessId_submittedById_fkey" FOREIGN KEY ("businessId", "submittedById") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_businessId_approvedById_fkey" FOREIGN KEY ("businessId", "approvedById") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_businessId_countId_fkey" FOREIGN KEY ("businessId", "countId") REFERENCES "StockCount"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_businessId_userId_fkey" FOREIGN KEY ("businessId", "userId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check" CHECK ("amountMinor" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_delta_check" CHECK ("quantityDelta" <> 0);
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_quantities_check" CHECK ("expectedQuantity" >= 0 AND "countedQuantity" >= 0);
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_approval_check" CHECK (
 "status" <> 'APPROVED' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "submittedById" IS NOT NULL AND "approvedById" <> "submittedById")
);
-- Ledger rows are append-only, including for maintenance scripts.
CREATE FUNCTION stockflow_reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'StockFlow ledger is append-only'; END;
$$;
CREATE TRIGGER stockflow_movement_immutable BEFORE UPDATE OR DELETE ON "StockMovement"
FOR EACH ROW EXECUTE FUNCTION stockflow_reject_ledger_mutation();
CREATE TRIGGER stockflow_audit_immutable BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION stockflow_reject_ledger_mutation();

COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'BANK_TRANSFER';
ALTER TYPE "PaymentMethod" ADD VALUE 'CARD';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "defaultLowStockThreshold" DECIMAL(18,3) NOT NULL DEFAULT 5,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "receiptFooter" TEXT NOT NULL DEFAULT 'Thank you for shopping with us.',
ADD COLUMN     "receiptHeader" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Africa/Banjul';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "verification" TEXT NOT NULL DEFAULT 'MANUAL_RECORD';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "imageKey" TEXT,
ADD COLUMN     "supplierId" UUID;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "amountReceivedMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "cashierId" UUID,
ADD COLUMN     "cashierName" TEXT,
ADD COLUMN     "changeMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "customerId" UUID,
ADD COLUMN     "discountMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "receiptSnapshot" JSONB;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "discountMinor" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "actorId" UUID,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT;

-- AlterTable
ALTER TABLE "StockReceipt" ADD COLUMN     "actorId" UUID,
ADD COLUMN     "requestHash" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "contactPerson" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "refundMinor" BIGINT NOT NULL,
    "refundMethod" "PaymentMethod" NOT NULL,
    "refundStatus" TEXT NOT NULL DEFAULT 'MANUALLY_RECORDED',
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_businessId_name_idx" ON "Customer"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_businessId_id_key" ON "Customer"("businessId", "id");

-- CreateIndex
CREATE INDEX "Expense_businessId_date_idx" ON "Expense"("businessId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_businessId_id_key" ON "Expense"("businessId", "id");

-- CreateIndex
CREATE INDEX "SaleReturn_businessId_saleId_idx" ON "SaleReturn"("businessId", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_businessId_id_key" ON "SaleReturn"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_businessId_idempotencyKey_key" ON "SaleReturn"("businessId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_businessId_idempotencyKey_key" ON "StockMovement"("businessId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_supplierId_fkey" FOREIGN KEY ("businessId", "supplierId") REFERENCES "Supplier"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_customerId_fkey" FOREIGN KEY ("businessId", "customerId") REFERENCES "Customer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_businessId_saleId_fkey" FOREIGN KEY ("businessId", "saleId") REFERENCES "Sale"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve operational history in the database, including against accidental maintenance writes.
CREATE TRIGGER stockflow_sale_item_immutable BEFORE UPDATE OR DELETE ON "SaleItem"
FOR EACH ROW EXECUTE FUNCTION stockflow_reject_ledger_mutation();
CREATE TRIGGER stockflow_payment_immutable BEFORE UPDATE OR DELETE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION stockflow_reject_ledger_mutation();
CREATE TRIGGER stockflow_return_immutable BEFORE UPDATE OR DELETE ON "SaleReturn"
FOR EACH ROW EXECUTE FUNCTION stockflow_reject_ledger_mutation();
CREATE FUNCTION stockflow_protect_completed_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'COMPLETED' THEN RAISE EXCEPTION 'Completed sale is immutable; create a return'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stockflow_sale_immutable BEFORE UPDATE OR DELETE ON "Sale"
FOR EACH ROW EXECUTE FUNCTION stockflow_protect_completed_sale();
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_amount_check" CHECK ("refundMinor" >= 0);
CREATE INDEX "Sale_businessId_cashierId_createdAt_idx" ON "Sale"("businessId","cashierId","createdAt");

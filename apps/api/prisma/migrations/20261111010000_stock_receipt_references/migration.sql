-- Preserve all existing reference strings. NULL internalReference identifies legacy receipts.
ALTER TABLE "StockReceipt" ADD COLUMN "internalReference" TEXT,
  ADD COLUMN "supplierInvoiceReference" TEXT;
CREATE UNIQUE INDEX "StockReceipt_businessId_internalReference_key"
  ON "StockReceipt"("businessId", "internalReference");
CREATE INDEX "StockReceipt_businessId_supplierId_supplierInvoiceReference_idx"
  ON "StockReceipt"("businessId", "supplierId", "supplierInvoiceReference");
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_internal_reference_check"
  CHECK ("internalReference" IS NULL OR "reference" = "internalReference");

CREATE TABLE "StockReceiptCounter" (
  "businessId" UUID NOT NULL,
  "nextValue" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "StockReceiptCounter_pkey" PRIMARY KEY ("businessId"),
  CONSTRAINT "StockReceiptCounter_positive_check" CHECK ("nextValue" > 0),
  CONSTRAINT "StockReceiptCounter_businessId_fkey" FOREIGN KEY ("businessId")
    REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Seed above occupied SR codes; never derive a reference by counting receipts.
INSERT INTO "StockReceiptCounter" ("businessId", "nextValue")
SELECT b.id, COALESCE(MAX(CASE WHEN r.reference ~ '^SR-[0-9]{1,18}$'
  THEN substring(r.reference FROM 4)::bigint END),0)+1
FROM "Business" b LEFT JOIN "StockReceipt" r ON r."businessId"=b.id GROUP BY b.id;

CREATE FUNCTION stockflow_stock_receipt_reference_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference IS DISTINCT FROM OLD.reference OR
    NEW."internalReference" IS DISTINCT FROM OLD."internalReference" THEN
    RAISE EXCEPTION 'Stock receipt references are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stockflow_stock_receipt_reference_immutable
  BEFORE UPDATE OF reference, "internalReference" ON "StockReceipt"
  FOR EACH ROW EXECUTE FUNCTION stockflow_stock_receipt_reference_immutable();

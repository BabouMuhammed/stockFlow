-- Additive only. Do not infer historical purchase dates or payment status.
ALTER TABLE "StockReceipt"
  ADD COLUMN "receivedAt" TIMESTAMP(3),
  ADD COLUMN "notes" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "settlementKnown" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reconciliationKey" TEXT,
  ADD COLUMN "reconciliationHash" TEXT;
CREATE UNIQUE INDEX "StockReceipt_businessId_id_supplierId_key" ON "StockReceipt"("businessId", "id", "supplierId");
CREATE UNIQUE INDEX "StockReceipt_businessId_reconciliationKey_key" ON "StockReceipt"("businessId", "reconciliationKey");

CREATE TABLE "SupplierPayment" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "receiptId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "actorId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversalOfId" UUID,
  CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierPayment_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "SupplierPayment_no_self_reversal" CHECK ("reversalOfId" IS DISTINCT FROM "id")
);
CREATE UNIQUE INDEX "SupplierPayment_businessId_id_key" ON "SupplierPayment"("businessId", "id");
CREATE UNIQUE INDEX "SupplierPayment_businessId_receiptId_supplierId_id_key" ON "SupplierPayment"("businessId", "receiptId", "supplierId", "id");
CREATE UNIQUE INDEX "SupplierPayment_businessId_reversalOfId_key" ON "SupplierPayment"("businessId", "reversalOfId");
CREATE UNIQUE INDEX "SupplierPayment_businessId_idempotencyKey_key" ON "SupplierPayment"("businessId", "idempotencyKey");
CREATE INDEX "SupplierPayment_businessId_supplierId_date_idx" ON "SupplierPayment"("businessId", "supplierId", "date");
CREATE INDEX "SupplierPayment_businessId_receiptId_idx" ON "SupplierPayment"("businessId", "receiptId");
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_receipt_fkey" FOREIGN KEY ("businessId", "receiptId", "supplierId") REFERENCES "StockReceipt"("businessId", "id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplier_fkey" FOREIGN KEY ("businessId", "supplierId") REFERENCES "Supplier"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_actor_fkey" FOREIGN KEY ("businessId", "actorId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_reversal_fkey" FOREIGN KEY ("businessId", "receiptId", "supplierId", "reversalOfId") REFERENCES "SupplierPayment"("businessId", "receiptId", "supplierId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION stockflow_supplier_payment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Supplier settlements are immutable; append a reversal';
END;
$$;
CREATE TRIGGER stockflow_supplier_payment_immutable BEFORE UPDATE OR DELETE ON "SupplierPayment"
FOR EACH ROW EXECUTE FUNCTION stockflow_supplier_payment_immutable();

-- Defense in depth for maintenance writes; API additionally serializes receipt settlements.
CREATE FUNCTION stockflow_supplier_payment_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "SupplierPayment"%ROWTYPE; purchase_total NUMERIC; paid NUMERIC;
BEGIN
  PERFORM 1 FROM "StockReceipt" WHERE "businessId"=NEW."businessId" AND id=NEW."receiptId"
    AND "supplierId"=NEW."supplierId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier receipt not found'; END IF;
  IF NEW."reversalOfId" IS NOT NULL THEN
    SELECT * INTO original FROM "SupplierPayment" WHERE "businessId"=NEW."businessId" AND id=NEW."reversalOfId";
    IF NOT FOUND OR original."reversalOfId" IS NOT NULL OR original."receiptId"<>NEW."receiptId"
      OR original."supplierId"<>NEW."supplierId" OR original."amountMinor"<>NEW."amountMinor"
      OR original.method<>NEW.method OR NEW.date<original.date THEN
      RAISE EXCEPTION 'Invalid supplier payment reversal';
    END IF;
  ELSE
    SELECT COALESCE(SUM(ROUND(quantity*"unitCostMinor")),0) INTO purchase_total
      FROM "StockReceiptItem" WHERE "businessId"=NEW."businessId" AND "receiptId"=NEW."receiptId";
    SELECT COALESCE(SUM(CASE WHEN "reversalOfId" IS NULL THEN "amountMinor" ELSE -"amountMinor" END),0)
      INTO paid FROM "SupplierPayment" WHERE "businessId"=NEW."businessId" AND "receiptId"=NEW."receiptId";
    IF paid+NEW."amountMinor">purchase_total THEN RAISE EXCEPTION 'Supplier overpayment'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stockflow_supplier_payment_validate BEFORE INSERT ON "SupplierPayment"
FOR EACH ROW EXECUTE FUNCTION stockflow_supplier_payment_validate();

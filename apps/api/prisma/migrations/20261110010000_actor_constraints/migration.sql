BEGIN;
-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_businessId_actorId_fkey" FOREIGN KEY ("businessId", "actorId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_businessId_actorId_fkey" FOREIGN KEY ("businessId", "actorId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_cashierId_fkey" FOREIGN KEY ("businessId", "cashierId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_businessId_actorId_fkey" FOREIGN KEY ("businessId", "actorId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_businessId_actorId_fkey" FOREIGN KEY ("businessId", "actorId") REFERENCES "User"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Sale" ADD CONSTRAINT "Sale_discount_check" CHECK ("discountMinor" >= 0 AND "discountMinor" <= "subtotalMinor");
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_received_check" CHECK ("amountReceivedMinor" >= 0 AND "changeMinor" >= 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_snapshot_totals_check" CHECK ("receiptSnapshot" IS NULL OR ("totalMinor" = "subtotalMinor" - "discountMinor" AND "amountReceivedMinor" >= "totalMinor" AND "changeMinor" = "amountReceivedMinor" - "totalMinor"));
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_discount_check" CHECK ("discountMinor" >= 0 AND "discountMinor" <= "lineTotalMinor");
COMMIT;

-- Widen exact minor units without resetting or rewriting business values.
BEGIN;
ALTER TABLE "Product" ALTER COLUMN "purchaseCostMinor" TYPE BIGINT USING "purchaseCostMinor"::BIGINT,
ALTER COLUMN "sellingPriceMinor" TYPE BIGINT USING "sellingPriceMinor"::BIGINT;
ALTER TABLE "StockReceiptItem" ALTER COLUMN "unitCostMinor" TYPE BIGINT USING "unitCostMinor"::BIGINT;
ALTER TABLE "Sale" ALTER COLUMN "subtotalMinor" TYPE BIGINT USING "subtotalMinor"::BIGINT,
ALTER COLUMN "totalMinor" TYPE BIGINT USING "totalMinor"::BIGINT;
ALTER TABLE "SaleItem" ALTER COLUMN "unitPriceMinor" TYPE BIGINT USING "unitPriceMinor"::BIGINT,
ALTER COLUMN "unitCostMinor" TYPE BIGINT USING "unitCostMinor"::BIGINT,
ALTER COLUMN "lineTotalMinor" TYPE BIGINT USING "lineTotalMinor"::BIGINT;
ALTER TABLE "Payment" ALTER COLUMN "amountMinor" TYPE BIGINT USING "amountMinor"::BIGINT;
COMMIT;

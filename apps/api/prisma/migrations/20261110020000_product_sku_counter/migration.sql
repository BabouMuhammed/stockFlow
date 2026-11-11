BEGIN;
CREATE TABLE "ProductSkuCounter" (
  "businessId" UUID NOT NULL,
  "nextValue" BIGINT NOT NULL DEFAULT 1 CHECK ("nextValue" > 0),
  CONSTRAINT "ProductSkuCounter_pkey" PRIMARY KEY ("businessId"),
  CONSTRAINT "ProductSkuCounter_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Seed counters above existing sequential-looking SKUs; never rewrite existing product codes.
-- Bound numeric parsing safely; allocation also checks and skips any occupied code.
INSERT INTO "ProductSkuCounter" ("businessId", "nextValue")
SELECT "businessId", MAX(SUBSTRING(sku FROM 5)::bigint) + 1
FROM "Product" WHERE sku ~ '^PRD-[0-9]{6,18}$' GROUP BY "businessId";
COMMIT;

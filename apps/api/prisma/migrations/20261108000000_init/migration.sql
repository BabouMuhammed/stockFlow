CREATE TABLE "Business" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "address" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'GMD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Category" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Product" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "categoryId" UUID,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "barcode" TEXT,
  "purchaseCostMinor" INTEGER NOT NULL CHECK ("purchaseCostMinor" >= 0),
  "sellingPriceMinor" INTEGER NOT NULL CHECK ("sellingPriceMinor" > 0),
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 5 CHECK ("lowStockThreshold" >= 0),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StockLevel" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0 CHECK ("quantity" >= 0),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StockReceipt" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "reference" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "supplierName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StockReceiptItem" (
  "id" UUID NOT NULL,
  "receiptId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "unitCostMinor" INTEGER NOT NULL CHECK ("unitCostMinor" >= 0),
  CONSTRAINT "StockReceiptItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StockMovement" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "movementType" TEXT NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "quantityAfter" INTEGER NOT NULL CHECK ("quantityAfter" >= 0),
  "referenceType" TEXT NOT NULL,
  "referenceId" UUID,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Sale" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "subtotalMinor" INTEGER NOT NULL CHECK ("subtotalMinor" >= 0),
  "totalMinor" INTEGER NOT NULL CHECK ("totalMinor" >= 0),
  "paymentMethod" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SaleItem" (
  "id" UUID NOT NULL,
  "saleId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "unitPriceMinor" INTEGER NOT NULL CHECK ("unitPriceMinor" > 0),
  "unitCostMinor" INTEGER NOT NULL CHECK ("unitCostMinor" >= 0),
  "lineTotalMinor" INTEGER NOT NULL CHECK ("lineTotalMinor" >= 0),
  CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Category_businessId_name_key" ON "Category"("businessId", "name");
CREATE UNIQUE INDEX "Product_businessId_sku_key" ON "Product"("businessId", "sku");
CREATE UNIQUE INDEX "Product_businessId_barcode_key" ON "Product"("businessId", "barcode");
CREATE INDEX "Product_businessId_name_idx" ON "Product"("businessId", "name");
CREATE UNIQUE INDEX "StockLevel_productId_key" ON "StockLevel"("productId");
CREATE UNIQUE INDEX "StockLevel_businessId_productId_key" ON "StockLevel"("businessId", "productId");
CREATE UNIQUE INDEX "StockReceipt_businessId_idempotencyKey_key" ON "StockReceipt"("businessId", "idempotencyKey");
CREATE INDEX "StockReceipt_businessId_createdAt_idx" ON "StockReceipt"("businessId", "createdAt");
CREATE INDEX "StockMovement_businessId_createdAt_idx" ON "StockMovement"("businessId", "createdAt");
CREATE UNIQUE INDEX "Sale_businessId_receiptNumber_key" ON "Sale"("businessId", "receiptNumber");
CREATE UNIQUE INDEX "Sale_businessId_idempotencyKey_key" ON "Sale"("businessId", "idempotencyKey");
CREATE INDEX "Sale_businessId_createdAt_idx" ON "Sale"("businessId", "createdAt");
ALTER TABLE "Category" ADD CONSTRAINT "Category_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

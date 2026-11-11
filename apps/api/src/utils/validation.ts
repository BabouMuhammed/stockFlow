import { z } from 'zod';
export const MAX_MINOR = 9223372036854775807n;
export const minorUnits = z
  .string()
  .max(19)
  .regex(/^(0|[1-9][0-9]*)$/, 'Use integer minor units as a string')
  .refine(
    (value) => /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 19 && BigInt(value) <= MAX_MINOR,
    'Use minor units within the PostgreSQL BIGINT range',
  )
  .transform((value) => BigInt(value));
export const positiveMinorUnits = minorUnits.refine(
  (value) => value > 0n,
  'Selling price must be positive',
);
export const decimalQuantity = z
  .string()
  .max(19)
  .regex(
    /^(0|[1-9][0-9]{0,14})(\.[0-9]{1,3})?$/,
    'Use a nonnegative quantity with up to 3 decimal places',
  );
export const uuid = z.string().uuid();
export const text = (max: number) => z.string().trim().min(1).max(max);
export const productInput = z
  .object({
    name: text(120),
    description: z.string().trim().max(2000).optional(),
    supplierId: uuid.nullable().optional(),
    sku: text(60),
    barcode: z.string().trim().max(80).nullable().optional(),
    categoryId: uuid.nullable().optional(),
    unit: text(30).default('unit'),
    purchaseCostMinor: minorUnits,
    sellingPriceMinor: positiveMinorUnits,
    lowStockThreshold: decimalQuantity.default('5.000'),
    isActive: z.boolean().default(true),
  })
  .strict();
export const productCreateInput = productInput.extend({
  sku: z.string().trim().max(60).optional(),
  openingStock: decimalQuantity.optional(),
  lowStockThreshold: decimalQuantity.optional(),
});
// Zod 4 applies inner defaults inside optional schemas. PATCH must never reset omitted fields.
export const productUpdate = productInput.partial().extend({
  unit: text(30).optional(),
  lowStockThreshold: decimalQuantity.optional(),
  isActive: z.boolean().optional(),
});
export const categoryInput = z.object({ name: text(80) }).strict();
export const categoryUpdate = categoryInput
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict();
export const supplierInput = z
  .object({
    name: text(120),
    phone: z.string().trim().max(40).nullable().optional(),
    contactPerson: z.string().trim().max(120).nullable().optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    notes: z.string().trim().max(2000).optional(),
    address: z.string().trim().max(240).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .strict();
export const supplierUpdate = supplierInput.partial().extend({ isActive: z.boolean().optional() });
export const productQuery = z
  .object({
    search: z.string().trim().max(120).default(''),
    categoryId: uuid.optional(),
    active: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    sort: z.enum(['name', 'price', 'newest']).default('name'),
  })
  .strict();

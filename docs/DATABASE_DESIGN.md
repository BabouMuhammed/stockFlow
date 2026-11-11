# PostgreSQL database design

The authoritative schema is apps/api/prisma/schema.prisma. apps/api/prisma/migrations contains the original prototype migration and an additive Phase 1 migration. Existing migration history is preserved.

## Entities

| Entity           | Purpose and ownership                                                        |
| ---------------- | ---------------------------------------------------------------------------- |
| Business         | Tenant root, GMD currency, explicit demo marker                              |
| Branch           | Business location; code unique per business                                  |
| User             | Business identity, role, password hash, active flag                          |
| UserSession      | Hash of an opaque token, business/user scope, expiry and revocation          |
| Category         | Business-specific catalogue grouping                                         |
| Product          | Business SKU/barcode, current integer prices, unit and reorder threshold     |
| Supplier         | Business supplier contact and active flag                                    |
| StockLevel       | Current decimal balance per business/branch/product                          |
| StockMovement    | Immutable signed decimal movement and resulting balance, source and reason   |
| StockReceipt     | Branch delivery header, supplier and idempotency key                         |
| StockReceiptItem | Decimal received quantity, product name and unit cost snapshot               |
| Sale             | Branch transaction, status, integer totals, request hash and idempotency key |
| SaleItem         | Decimal quantity, immutable name/SKU and price/cost/line-total snapshots     |
| Payment          | Sale-linked method, exact minor-unit amount and optional manual reference    |
| StockCount       | Branch count lifecycle, submitter/approver identities and timestamps         |
| StockCountItem   | Unique product per count with expected and physical quantities               |
| AuditLog         | Append-only action/entity metadata with tenant and optional actor            |

All entities use UUID primary keys. Mutable entities have created/updated timestamps; immutable items inherit transaction timing from their parent, while movements/payments/audit rows have their own creation time.

## Relationships and constraints

Business has many branches, users, products, suppliers and transaction headers. Branches own stock balances, deliveries, sales and counts. Headers own items/payments. All tenant-bearing child references use composite businessId + target id foreign keys, with parent composite unique indexes. Thus a valid UUID from a different tenant still fails the database constraint.

StockLevel is unique by business/branch/product. Product SKU and optional barcode and category names are business-unique. Sales receipt numbers and idempotency keys are business-unique. Session token hashes are globally unique. Financial/inventory relations use ON DELETE RESTRICT; deactivate catalogue/staff records instead of deleting history.

SQL checks enforce positive transaction quantities, nonnegative balances, prices, costs and payment amounts. Movements require a nonzero delta. Stock counts require nonnegative expected/counted amounts. An approved count requires a submitter, a distinct approver and approval timestamp. Triggers reject UPDATE/DELETE of StockMovement and AuditLog. Future application services must also expose no mutation methods for ledger records.

Indexes cover product name/SKU/barcode and business/branch date filtering on sales/receipts/movements; product movement history, sessions, count status and audit dates are indexed. Contains search can start with a tenant-filtered scan; add PostgreSQL trigram search only after measuring catalogue size and query plans.

## Exact arithmetic

Phase 2A widens all nine monetary fields to Prisma BigInt / PostgreSQL BIGINT while preserving the existing minor-unit values. API monetary inputs and outputs are canonical integer strings in 0..9223372036854775807; selling prices must be positive. No monetary JSON number is accepted. The Express JSON replacer serializes nested BigInt values safely. Shared display/form conversion uses BigInt and decimal strings, including amounts beyond JavaScript Number precision. Validate every future intermediate financial total against BIGINT bounds before persistence. Quantities use DECIMAL(18,3); Prisma Decimal values serialize as strings. The Phase 1 gallery retains safe integer fixtures, while the operational catalogue uses database strings. The disabled operational cart performs preview arithmetic entirely with BigInt and never submits a financial transaction.

Future fractional pricing must multiply a Prisma Decimal quantity by integer minor-unit prices, then round the final line to the nearest minor unit using an explicit half-up policy. Sum rounded lines to the sale total. COGS uses the same documented rounding rule. Never convert decimal quantities into JavaScript Number for stock accounting. Operational quantity/pricing workflows are intentionally absent in Phase 1.

## Stock accounting and concurrency plan

StockMovement is the source ledger; StockLevel is a materialized balance maintained in the same database transaction. Reconciliation checks opening balance plus movement deltas against StockLevel. Receipts and completed sales create immutable snapshots. Use a PostgreSQL serializable transaction with bounded retry on serialization/deadlock failures. Lock branch/product balances in stable product-id order and conditionally decrement only when quantity >= requested quantity. Persist sale/items/payments/movements/balances/audit in one commit. A failure rolls everything back.

Require an Idempotency-Key and canonical request hash. Within the tenant, the same key and same payload return the original transaction; the same key with a different hash returns 409. Concurrent uniqueness conflicts must reload the winning transaction after rollback and compare the hash. Keep the client key stable across retries. The archived prototype did not satisfy all of these rules and is not active.

## Count approval plan

DRAFT -> SUBMITTED freezes physical observations and records submitter/time. An authorized owner/manager other than the submitter reviews discrepancies and approves or rejects, with a reason. Approval locks the count and relevant balances and confirms the observation basis still matches current stock; otherwise require recount/rebase. A single transaction writes approved status, compensating COUNT movements, balances and audit records. Conditional status update prevents double approval. No balance changes occur at submission. Implement role, state and concurrency tests before enabling these operations.

## Migration behavior

The Phase 1 migration is transactional and preserves legacy quantities, movement types, sale status and payment methods with explicit enum casts. It creates a MAIN branch for every existing business, backfills child business IDs from headers, and fills missing product name/SKU snapshots from current catalogue values. Historical names before migration cannot be recovered. Completed legacy sales receive matching Payment rows. Existing businesses remain isDemo=false; no customer business is silently reclassified for seed eligibility. Inconsistent cross-tenant legacy data causes an atomic migration failure requiring investigation, not silent reassignment.

Verified locally against PostgreSQL 18: fresh migration deployment, zero Prisma schema drift, repeat-safe seed, tenant foreign keys, unique SKUs, exact fractional balances, nonnegative checks and ledger/restricted-delete behavior. A separate populated legacy database verified backfilled payments and preserved sales, costs, balances and movements. Docker is unavailable; Compose itself has not been executed.

## Phase 2A migration and catalogue writes

20261108020000_phase2a_bigint transactionally widens Product.purchaseCostMinor/sellingPriceMinor, StockReceiptItem.unitCostMinor, Sale.subtotalMinor/totalMinor, SaleItem.unitPriceMinor/unitCostMinor/lineTotalMinor and Payment.amountMinor. It drops no records, preserves existing checks/relations and does not change DECIMAL(18,3) stock. Back up and apply it during a local maintenance window because ALTER TYPE takes table locks; no reset is required.

A live automated test creates a new isolated schema in the dedicated PostgreSQL test database, applies the exact Phase 1 migrations, populates all five monetary tables near the old INTEGER maximum, captures values/quantities, applies the new migration and compares every snapshot. It also verifies all nine columns change from integer to bigint and subsequently persist the BIGINT maximum exactly. The schema and fixtures are retained, not dropped. Existing test/legacy records remain untouched.

Products/categories/suppliers are now persisted through session-scoped APIs. Each write and audit event uses the same transaction. PATCH schemas deliberately omit creation defaults (including active state, unit and threshold). These operations never write branch balances or movement/financial ledgers. Branch authorization and all transactional stock operations remain future work.

# StockFlow requirements

StockFlow is a standalone POS and inventory product for minimarkets and supermarkets in The Gambia. The eventual MVP covers products/categories, supplier deliveries, checkout, exact stock deductions, damage/expiry/returns/adjustments, approved stock reconciliation, staff activities, daily/weekly/monthly reports and printable receipts. Mobile-money payments will be manually recorded; no provider integration is implied.

## Phase 1 acceptance scope

- npm workspace foundation: React/Vite/TypeScript web, Express/TypeScript API, shared TypeScript presentation helpers.
- PostgreSQL/Prisma architecture for all 17 required entities and future businesses/branches.
- Local setup, validated environment, migrations, guarded illustrative seed, lint/format/build/test commands.
- Responsive emerald UI with login, dashboard, POS, products, inventory, receipts, counts, sales, reports, staff and settings shells.
- Clearly separated health/readiness endpoints and planned module routes. No fabricated successful business operations.
- Explicit sample-data labels, loading/error/empty states, accessible fields, native modal and keyboard focus styles.
- Authentication implementation is deferred under the brief's allowance. Account/session schema and role policy exist; no production access is enabled.

## Roles

| Role    | Intended permissions                                                                      |
| ------- | ----------------------------------------------------------------------------------------- |
| OWNER   | All operations within the authenticated business                                          |
| MANAGER | Inventory, operational reports, permitted staff operations; cannot grant owner access     |
| CASHIER | Checkout and specifically authorized sale lookups; no cost/profit or staff administration |

Phase 2A now enforces authenticated catalogue permissions on the server. Branch operations and financial modules remain 501; no broad policy permission alone grants access to an unavailable workflow.

## Business rules

1. Every operational row belongs to one business; branch stock is separate. Composite foreign keys prevent cross-business references.
2. UUID keys; SKU and optional barcode are unique within a business. Null barcodes may repeat.
3. Money is integer minor units (100 bututs per dalasi); no binary floating-point money arithmetic. Quantity is exact decimal with three places.
4. Sale prices/costs and receipt costs are immutable transaction snapshots. Gross profit is revenue minus snapshot COGS, not net profit.
5. Sale, payment, movement and balance updates must commit atomically. Never allow negative stock. No partial financial workflows in Phase 1.
6. Ledger/audit records are append-only. Corrections require compensating records; financial and inventory parents use restricted deletion.
7. Counts require independent approval before balance adjustments. Reasons and approver identity must be audited.
8. Cash and manual mobile-money recording are future workflows. No transfers, tax-compliance claims or fiscal receipts are implemented.
9. Seed data is illustrative, opt-in and local only; it must not overwrite any existing product or real business.

## Outside Phase 1

Operational authentication, invitations, catalogue mutations, supplier delivery workflows, checkout/payment execution, refunds/voids, real reports, receipt printing, external payments, tax rules, multi-branch administration, offline sync, production infrastructure, backups and hosting. No deployment, push or publication is authorized. Phase 2 requires user approval.

## Phase 2A acceptance scope

Completed scope adds dependency advisory review, exact BIGINT monetary migration/serialization, scrypt cookie-session authentication, guarded interactive first-owner bootstrap, server role/tenant enforcement, audited product/category/supplier management and operational PostgreSQL-backed frontend pages. OWNER/MANAGER administer the catalogue; CASHIER reads active products/categories without purchase costs. Category/supplier/product updates preserve historical references and never directly modify stock. The separate labelled Phase 1 preview remains accessible. Checkout, receipts, adjustments, reconciliation and financial reports are explicitly outside Phase 2A, as are public registration and staff/account recovery administration. See PHASE_2A_REPORT.md for verification and remaining advisory risks.

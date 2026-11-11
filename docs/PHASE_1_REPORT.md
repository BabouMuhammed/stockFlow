# StockFlow Phase 1 report

Date: 8 November 2026. Scope: foundation only. Nothing was deployed, pushed, published or connected to hosting.

## Review and continuation

Reviewed all application source, configuration, schema/migration, seed/reset code, tests, lockfile/package setup and existing documentation before implementation. Copilot had left a local single-business prototype with operational-looking checkout/receipt/report routes, whole-unit stock and no authentication. Its baseline tests executed: one frontend test passed and two PostgreSQL tests skipped. The historical report claimed only builds/UI verification.

The active implementation now follows the supplied Phase 1 brief. Original source, tests, seed/reset and schema are retained under docs/archive, and PROTOTYPE_REPORT.md is marked historical. Unverified business actions are not exposed. The existing apps/api + apps/web workspace layout is preserved; shared was added for fixtures/exact currency display. README contains the complete maintained source tree and local commands.

## Completed

- All 17 normalized UUID-based Prisma entities, five enums, exact decimal stock, integer minor-unit money, restricted deletion and composite tenant constraints.
- Branch-scoped balances and business-scoped SKU/barcode/receipt/idempotency uniqueness; relevant search/date/status indexes.
- Additive transactional migration, legacy branch/snapshot/payment backfills, database checks and append-only movement/audit triggers.
- Explicit local-only, create-only illustrative seed with no seeded staff/passwords, atomic opening balances/receipts/movements and refusal when non-demo data exists.
- Validated root environment, loopback server, bounded JSON bodies, configured CORS, consistent errors and graceful Prisma shutdown.
- Liveness/readiness endpoints, honest 501 business-module boundaries and a tested role-policy foundation. Authentication is deferred, not simulated.
- Responsive emerald workspace, sidebar/topbar, accessible navigation/fields/native modal, notifications, sample catalogue search/category filters/card/table views, product detail, temporary integer-quantity cart and disabled checkout/print actions.
- Login, dashboard, POS, products, inventory, stock receipts, stock counts, sales history, reports, staff and settings routes. No fabricated revenue or transaction history. All sample business/product/stock/price data is labelled illustrative.
- ESLint/Prettier, local build/test scripts, Docker Compose PostgreSQL setup and required architecture/security/API documentation; future transaction acceptance specifications.

## Database verification

PostgreSQL 18 binaries were found outside PATH. A new isolated cluster under ignored .local/pg-phase1 on loopback port 55432 was initialized for verification; the user's running PostgreSQL service and existing databases were untouched. Verification databases were stockflow_test and stockflow_test_legacy. The temporary instance was stopped after verification.

- Prisma schema validation and client generation passed.
- Both checked-in migrations applied successfully on a fresh PostgreSQL database.
- Prisma migrate status reported up to date; migrate diff found no schema differences.
- A separate database containing the original nine-model schema and populated product/category/balance/receipt/movement/sale/item records upgraded successfully.
- SQL assertions verified legacy completed status, cash method, totals, purchase-cost snapshots, balances and movement deltas were preserved, and payment/name/SKU backfills existed.
- New name/SKU snapshots for old rows necessarily reflect current catalogue values; pre-migration historical product names cannot be reconstructed.
- No migration was applied to an existing customer/development database. Docker Compose was not executed because Docker is unavailable.

## Routes and implementation status

Frontend: /login; /dashboard and /; /pos; /products; /inventory; /inventory/receipts; /inventory/counts; /sales; /reports; /staff; /settings; unknown-path not-found page.

Backend implemented: GET /api/v1/health (200 process liveness); GET /api/v1/health/ready (200 database/schema ready, 503 unavailable).

/auth, /business, /categories, /products, /inventory, /sales, /reports and /staff are reserved route groups returning 501 for reads/writes. They are planned, not authenticated functional endpoints. See API_CONTRACT.md for intended future methods/roles.

## Executed checks

Final verification: **31 tests passed, 0 skipped** with the dedicated PostgreSQL database configured (11 API/database tests and 20 frontend tests). ESLint, Prettier formatting checks, API TypeScript compilation and Vite production build passed. A real compiled-server smoke check returned 200 for liveness/readiness and 501 for the product module. Tests include environment validation, live migration/connectivity, tenant foreign keys, uniqueness, exact decimal balances, nonnegative quantities, immutable ledger/restricted deletes, seed repeatability/customer-data refusal, health/readiness/error/CORS handling, policy permissions, every route, mobile navigation, catalogue search/empty state/dialog, temporary cart totals, disabled business actions, login validation and exact currency formatting.

Browser verification used isolated headless Edge profiles with actual viewport emulation: 1440px and 390px product pages had no horizontal overflow. Desktop/mobile screenshots were visually inspected. This is focused browser validation, not a full accessibility audit or cross-browser certification.

## Known limitations and unfinished work

- No sign-in/session/password hashing runtime, staff creation or branch access controls. Password/session security design and schema are documented; HTTP business routes remain unavailable.
- No operational product edits, supplier receipts, counts/approvals, checkout/payment/refund/void/receipt printing or real financial reports. Temporary carts are lost on navigation/reload.
- Static UI fixtures are independent of database records and do not claim to show live inventory.
- Monetary database fields are 32-bit minor units; future input/total bounds and explicit fractional line rounding require tested service implementation.
- No production backup/restore, monitoring, tax integration, deployment or mobile-money processing.
- Dependency auditing reports inherited advisories, including test-tool worker dependencies. React Router was updated within version 6 and unused packages/ambient Lucide declarations were removed; major dependency upgrades remain a release prerequisite. Final npm audit reported **19 advisories: 12 moderate, 5 high and 2 critical**. This is an unresolved release limitation; resolving all advisories requires separately tested dependency upgrades. Do not deploy this phase.
- The enclosing Git repository belongs to a parent directory; no git initialization, broad staging, commits or changes outside StockFlow were performed.

## Recommended Phase 2 (requires approval)

1. Resolve dependency advisories with reviewed upgrades and rerun the full test/build matrix. Establish dedicated repeatable PostgreSQL CI databases.
2. Implement and test scrypt password verification, opaque revocable cookie sessions, CSRF/rate limiting, server permissions, branch scope and tenant-safe DTOs.
3. Implement catalogue/supplier CRUD, then idempotent stock receipts and ledger reconciliation.
4. Implement checkout with exact decimal arithmetic, immutable snapshots, stable request hashes/keys, atomic payments/balances/ledger/audit and real concurrent-connection oversell tests.
5. Add independently approved physical counts, compensating damage/expiry/return/refund/void workflows and audit views.
6. Build status-aware daily/weekly/monthly reports and printable receipts against persisted records; verify financial reconciliation and restore procedures.

Stop after Phase 1. No Phase 2 operational workflow has been started.

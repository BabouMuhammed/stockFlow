# StockFlow implementation progress

## Audit — 10 November 2026

- Existing: npm workspaces, React/Vite/TypeScript, Express/Prisma/PostgreSQL; cookie sessions, scrypt passwords, origin + CSRF validation, rate-limited login, tenant-scoped product/category/supplier CRUD and exact BIGINT minor-unit money.
- Reusable: WorkspaceShell, product cards, dialogs, forms, React Query, API client, session provider, existing green responsive styling, catalogue and reference modules.
- Models: Business, Branch, User, UserSession, Category, Product, Supplier, StockLevel, StockReceipt/Item, StockMovement, Sale/Item, Payment, StockCount/Item, AuditLog. Existing composite tenant foreign keys and append-only stock/audit triggers must remain.
- Missing: registration, employee administration, stock mutations, real POS checkout, payment recording, immutable printable receipts, sales/returns, expenses/customers, dashboard analytics, reports and editable settings. The public preview is isolated UI fixtures; authenticated POS is currently only a cart preview.
- Environment: root .env is loaded by API, Prisma scripts and Vite; only VITE-prefixed values enter frontend. Secrets were not printed or changed. PostgreSQL on 5432 is connected and all three existing migrations are applied.
- Tests: Vitest + Supertest API tests and React Testing Library frontend tests exist. PostgreSQL suites require a separate guarded TEST_DATABASE_URL and otherwise skip. Some assertions intentionally expect Phase 2A-disabled operations and must change as those operations are completed.
- Migration plan: additive operational fields on existing models; retain all migrations and business records. Keep money in integer minor units and quantities in Decimal(18,3).
- Risks: existing login requires business UUID because email is tenant-unique; preserve that workflow while adding email-only login for unambiguous accounts. Never add global email uniqueness over existing tenant records. Avoid overwriting legacy receipt snapshots. Restrict all mutations on the backend; derive business and main branch from the session.

## Ordered implementation plan

1. B–C: transactional business registration, session creation, email login, owner-only staff access and session revocation.
2. D–E: preserve catalogue; add auditable opening/receiving/adjustment operations, stock reads and low-stock detection.
3. F–G: server-priced checkout, stock concurrency, request idempotency, exact money, manually recorded external payments, receipt snapshots/printing.
4. H–J: sales/returns, operating expenses, suppliers, customers and staff workflows.
5. K–L: database-derived dashboard/reports, exports, settings and accessible UI integration.
6. M: meaningful unit/integration/frontend checks, lint, build and documentation.

## Current status

The audit above records the initial state. The verified implementation checkpoint and remaining scope follow below. No deployment, push, database reset or deletion of existing application records was performed.

## Implementation checkpoint — 10 November 2026

Core local business workflows have been implemented in the existing application. This is not a claim that every optional feature in the master brief or production readiness is complete.

| Phase | Implemented behavior                                                                                                                                                                                                  | Verification                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A     | Audited workspaces, all source modules/screens, Prisma schema and migrations, environment loading, tests and preview fixtures                                                                                         | PostgreSQL connected; original three migrations retained                                                                     |
| B–C   | Business registration with owner/main branch/settings/session transaction; email login with legacy optional business UUID; existing HttpOnly sessions/CSRF; owner/manager/cashier permissions and tenant isolation    | API integration tests, browser registration/login/logout                                                                     |
| D     | Existing product/category/supplier management extended with descriptions, supplier links, sorting, category archive, opening stock, safe local image uploads and actual stock availability                            | API CRUD/upload/isolation tests; browser product creation; catalogue tests                                                   |
| E     | Opening stock, receiving with purchase costs/references/suppliers, corrections/damage, stock ledger and history, low-stock filter                                                                                     | Duplicate receiving/opening safeguards, negative-stock rejection, inventory isolation and concurrent sale tests              |
| F–G   | Actual POS with integer/fractional quantities, fixed/percentage discounts, server pricing, payments, change, transactional stock deductions, idempotency and immutable receipt snapshots                              | Required D390/D300/D90 scenario; concurrent last-item and duplicate checkout tests; browser cashier checkout and receipt PDF |
| H     | Paginated sales/history, date/payment/cashier filtering, receipt reprint, authorized partial returns with reasons/restock decisions and manually recorded refunds                                                     | Receipt snapshot/immutability, excess-return, refund rounding and return replay tests                                        |
| I–J   | Operating expenses with audit snapshots for edits, category/date filters and totals; supplier contact details and linked receipts; customers/purchase history; staff creation/role/status/password reset and activity | Tenant isolation, role restrictions, session revocation; browser cashier creation and expense recording                      |
| K     | Real dashboard and reports: revenue/refunds/COGS/gross profit/estimated result, stock valuation, daily/weekly/monthly charts, category/product/cashier/expense data; paged CSV exports and browser PDF printing       | Exact database summary assertions; browser reports; CSV/isolation tests                                                      |
| L     | Editable business/receipt/default threshold settings, profile/password/session actions; mobile navigation, feedback, empty states and checkout retry behavior                                                         | Frontend tests; browser 390/1440 px checks; no horizontal overflow on checked pages                                          |
| M     | Additive migrations, immutable financial ledgers, composite tenant actor foreign keys, exact-money constraints, password/session controls, upload limits, structured sanitized error logging                          | Test/build/lint results below; preservation tested with populated legacy schemas                                             |

### Database changes

- `20261110000000_retail_operations`: additive operational/settings/product fields, payment-method enum values, Customer, Expense and SaleReturn; immutable completed sale/item/payment/return triggers.
- `20261110010000_actor_constraints`: composite tenant foreign keys for stock actors, cashiers, expense actors and return actors; nonnegative payment/discount and snapshot-total checks. Checks preserve legacy sales without inventing missing receipt snapshots.
- Both new migrations applied to the existing local application database with `migrate deploy`. `db:status` reports all five migrations applied. No reset or destructive migration was used. Existing secrets and ports were preserved.
- Integration tests ran against a separate loopback `stockflow_test_retail_20261110` database. Random test accounts/fixtures stay there, not in the application database.

### Verification evidence

- Full API suite: **44 passed**, including real PostgreSQL suites (not skipped).
- Frontend suite: **48 passed**.
- Required scenario: owner registers, product cost D100 / price D130 / opening 50, creates cashier, cashier sells three for D390, receives D500, change D110, stock 47; revenue D390, COGS D300, gross profit D90.
- Concurrency: only one of two buyers can purchase the final unit; repeated identical concurrent checkout requests create one sale and one movement.
- Fractional returns: two 0.5-unit returns refund exactly the discounted original total and reverse the original 101-minor-unit cost without losing a minor unit.
- Security: business isolation covers products/inventory/sales/expenses/customers/employees; cashier costs are removed from both sale items and embedded return JSON; denied mutations and cross-tenant actor foreign keys are tested.
- Browser: headless Edge registration, opening-stock product creation, cashier creation/login, cash checkout, printable PDF, owner reports, receiving, expenses and logout passed. Zero browser runtime exceptions. POS/sales/settings checked at 390 and 1440 px, and reports at both widths, without horizontal page overflow.
- Artifacts are retained under ignored `.local/`: `retail-pos-desktop.png`, `retail-receipt.png`, `retail-receipt.pdf`, `retail-reports-390.png`, `retail-reports-1440.png` and browser-check scripts. The preview used the test database and was stopped after checking.
- Final checks passed: 44 API/PostgreSQL tests, 48 frontend tests, lint, Prettier, API TypeScript build and frontend TypeScript/Vite build. Vite emits existing non-fatal Zod annotation warnings, and Prisma warns about its deprecated package.json configuration.
- Windows sandbox initially blocked Vite/esbuild configuration loading; authorized external execution succeeded. Prisma regeneration initially hit a Windows DLL lock while the temporary preview ran; stopping the owned preview and regenerating resolved it.

### Remaining scope and limits

- Business-logo uploads, expense supporting documents, configurable receipt printer preferences and configurable cashier permissions/discount limits are absent.
- The legacy `/inventory/counts` URL displays audited stock history; physical-count submission/approval is not implemented.
- Multi-branch trading/access assignment, owner email recovery, distributed deployment/security operations, uploads scanning/re-encoding, advanced inventory costing and load testing remain outside this verified local checkpoint.
- PDFs use browser printing. A real thermal printer has not been physically tested.
- Sales/item/receipt snapshots are immutable for new sales; legacy records preserve their original item data but cannot gain historical business snapshots retroactively.
- Directory lists for suppliers/categories/staff are not paginated. Customer purchase-history UI currently shows its first page; the endpoint supports pagination. Analytics panels cap grouped results at 25; CSV exports iterate full matching records on the server. Reports are limited to 366 days per request.
- Checkout retry keys survive an uncertain request within the mounted POS screen, but are not persisted across browser reloads. Check sales history before recreating an interrupted order. There is no offline trading mode.
- Costs use the product cost at sale time; inventory valuation uses latest product cost, not FIFO or weighted average. Estimated operating result includes only recorded costs. External payments and refunds are manual records, not electronic verification/transfers.
- No deployment, publication, GitHub push, new paid service or production account with a hardcoded password was created.

### Continuation instruction

Continue from this existing local implementation. Read this progress file and README first. Address the remaining features above in small backend/frontend increments with additive migrations and tenant/financial regression tests. Do not rebuild, reset the database, overwrite environment secrets, deploy or push. Verify the preserved D390/D300/D90 workflow after financial changes.

## Local CORS and session fix — 10 November 2026

- Replaced the fixed single-origin CORS header with an exact allowlist shared by CORS, login/registration origin checks and authenticated CSRF checks. Local defaults allow only http://localhost:5173 and http://127.0.0.1:5173. An explicit validated WEB_ORIGINS overrides those defaults; WEB_ORIGIN remains supported. No wildcard origins were introduced.
- Preserved credentialed fetch, HttpOnly/host-only/SameSite=Strict cookies, session expiration, JSON validation and timing-safe CSRF-token comparison. Unlisted origins receive no allow-origin header and cannot pass mutation-origin validation.
- Added the Vite `/api` development proxy, preserving the browser Origin header while forwarding to the existing localhost API port. Updated only WEB_ORIGINS and VITE_API_URL in the local .env, documented them in .env.example, and centralized API base URLs for normal requests, image URLs and report exports. Browser requests use `/api/v1`, avoiding cross-site localhost/127.0.0.1 cookie blocking.
- Verified the existing 5000/5173 servers: both exact origins receive matching credentialed preflight headers; an untrusted origin receives no allow-origin header; the proxied session endpoint returns the expected 401 without a session.
- Passed 30 targeted API tests, including real PostgreSQL registration/session/login/logout and CSRF checks for both origins, and 48 frontend tests. API/frontend builds, lint and formatting passed.
- Headless Edge verified registration, HttpOnly/SameSite=Strict cookies, session persistence after refresh, valid CSRF requests, missing-token rejection and logout from both localhost and 127.0.0.1. Browser verification used isolated test ports 5001/5175 and the existing separate test database, leaving the user's running 5000/5173 servers untouched. Temporary verification servers were stopped.
- No PostgreSQL settings, application database records or migrations were changed by this fix. No reset or deployment occurred.

## Automatic SKUs and exact checkout input — 10 November 2026

- Inspected the existing Product/Business/Sale/Payment Prisma models, tenant-unique SKU/barcode constraints, product create/update routes, frontend product/POS forms, BIGINT money helpers and Decimal(18,3) inventory before changing them.
- Added the `ProductSkuCounter` model and additive `20261110020000_product_sku_counter` migration. Existing products and SKUs are not rewritten. Counters are business-specific, start above existing bounded `PRD-` codes, persist across future edits, and skip occupied/custom/archived/imported codes. All API product creation and explicit SKU edits share a business-specific transaction lock; the existing `(businessId, sku)` unique constraint remains the final guard. Counter allocation is atomic with product/opening-stock/audit creation.
- Product creation now accepts an omitted/blank SKU and generates `PRD-000001` onward. A custom SKU remains optional and receives a clear 409 on a business-local duplicate. Name/category updates do not regenerate codes. The form displays “Automatically generated” and a separate optional custom-SKU input; barcode remains separate. Existing product details, catalogue, inventory and POS search display/use the stored SKU.
- Checkout accepts `amountReceived` as an exact GMD decimal string with zero, one or two decimal places, while retaining the original `amountReceivedMinor` API. Exactly one amount field is required. Normalization preserves existing legacy request-hash ordering and treats equivalent GMD/minor-unit requests identically for retry keys.
- Cashiers can enter 390, 390.5, 390.50, 1000, 1000.75 and 0.01 without trailing-zero restrictions; the amount field uses plain text with decimal keyboard hints. Received/change display with two decimal places, and Enter submits checkout. Negative/invalid amounts and more than two decimal places are rejected, never rounded. The backend still calculates all prices, discounts, totals, settled payments and change from database records.
- Preserved all monetary BIGINT columns. Currency amounts use exact string-to-BIGINT parsing; quantities have an independent three-decimal scale. Fractional cart quantities now remain decimal strings/scaled BIGINT instead of passing through Number, including at Decimal(18,3) limits. Extended prices round half up once per line. Refund proration and cost reversals use integer arithmetic, avoiding default Decimal precision loss at large amounts and cumulative rounding drift.
- Partial payments and taxes are not implemented in the current product: underpayment and client-supplied totals/tax fields remain rejected. External-payment confirmation behavior and receipt snapshots are unchanged. Payments store the settled total, while Sale separately records amount tendered and change.
- Applied only the additive counter migration to the local application database; all six migrations are applied. No reset, monetary-type change, financial-history rewrite, deployment or GitHub push occurred. Readiness now checks the counter table too.
- Full automated results: **89 API/PostgreSQL tests + 61 frontend tests = 150 passed**. Coverage includes business-local sequences, custom/duplicate codes, concurrent automatic/custom allocations, SKU preservation and migration backfill, all requested natural payment inputs, exact 0.10 + 0.20, invalid precision/negative inputs, underpayment rollback, fractional quantities and large values, cumulative refunds, and receipt/sale totals reloaded from PostgreSQL and a remounted UI.
- Required scenario passed: D529.00 × 1.25 = D661.25; D700 received; D38.75 change; payment 66125 minor units, amount received 70000, change 3875, remaining stock 8.75 from 10. Equivalent retry requests create one sale. Existing inventory/POS/authentication/isolation tests also passed.
- API/frontend TypeScript builds, Vite build, lint, Prettier and Prisma schema validation passed. A direct Prisma CLI invocation initially omitted the root environment; using the existing environment-loading wrapper resolved validation. The running Windows server held the Prisma engine DLL, so client files were regenerated separately and refreshed only after verifying an identical engine hash, leaving the loaded engine and the user's servers untouched.
- Final browser verification passed automatic `PRD-000001` creation without entering a SKU, optional `SHOP-CUSTOM`, separate barcode display, generated SKU in inventory, rejection of excess payment decimals, Enter-to-checkout, the exact D661.25/D700/D38.75 sale/payment records in PostgreSQL, and refreshed sales/receipt totals. There were no browser runtime exceptions. The browser used isolated ports 5001/5175 and the separate test database; those temporary servers were stopped. `.local/sku-money-receipt.png` retains the receipt screenshot. The user's existing 5000/5173 servers were preserved, and the application readiness endpoint returned 200 with database connected.

## Fast exact-cash checkout - 10 November 2026

- Inspected the current checkout form, API validation/transaction, Prisma BIGINT/Decimal models, receipts and existing tests. Kept the POS interface and monetary schema.
- Blank cash input now displays Exact payment with the estimated total and zero change. Confirm checkout explicitly acknowledges receipt of full cash payment. The browser sends exactPayment: true without a client amount; no sale happens when merely adding a product.
- The API permits exactly one explicit major/minor amount or the cash-only exactPayment flag. It resolves exact cash from current database prices, fractional quantities and authorized discounts inside the existing serializable transaction. Existing explicit-amount retry hashes remain compatible. Retries return the original completed sale even after a price change.
- Preserved integer-butut arithmetic and half-up rounding once per extended sale line. Negative/invalid/excess-precision input, underpayment and forged totals remain rejected. External methods still require an explicit amount, independent receipt confirmation and reference; they remain manual records, not payment processing.
- Added a synchronous in-flight guard alongside the existing disabled loading button and backend idempotency lock. Cart contents remain until confirmed backend success; definitive failures allow correction, uncertain failures retain the original retry payload/key. Success opens the printable receipt and announces completion.
- Verification: 101 API/PostgreSQL tests and 72 frontend tests passed (173 total). Coverage includes scenarios A-H, concurrent duplicate exact-cash requests, payment/stock consistency, transactional rollback after a later line fails, current database prices, fractional rounding with discounts, invalid precision, insufficient payment, and all three external methods. API/frontend builds, lint and formatting passed; only existing non-fatal Zod build-annotation warnings remain.
- Headless Edge against the separate test database verified blank cash input for D4750, zero change, double-click producing one sale/payment/stock deduction, D4700 rejection with cart retained, D5000 yielding D250 change, existing fractional checkout, and refreshed persisted receipts. Zero browser runtime exceptions. Temporary ports 5001/5175 were stopped; the user's servers were preserved.
- No migrations, database resets, changes to existing application financial records, or deployments were required.

# StockFlow

StockFlow is a local retail workspace for businesses in The Gambia. It extends the existing React/Vite frontend and Express/Prisma backend with PostgreSQL-backed registration, inventory, checkout, receipts, sales returns, expenses, customer records, staff administration, settings and reports. The existing green interface and npm workspaces are retained.

Production configuration and Vercel/Render setup are documented in [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md). Production uses exact HTTPS frontend origins, an explicit no-trust proxy policy or verified proxy networks, same-origin `/api/v1` forwarding and disabled image uploads until persistent storage is configured. Hosted acceptance checks remain required after deployment.

Multi-product purchasing, supplier settlements, test results and the client walkthrough are documented in [Purchasing implementation](docs/PURCHASING_IMPLEMENTATION.md). The existing working prototype at http://127.0.0.1:5173 now includes these features after an approved, backed-up additive migration. For a fresh isolated local demo, run `npm run build` then `npm run demo:local` and open http://127.0.0.1:5175/register. This creates a separate database and lets you choose your own demo login. Each run creates a new demo database; earlier databases are retained.

## Local setup

Use Node.js 22.12+ on the 22 release line, Node 24, or another version allowed by package.json, and PostgreSQL 18 on port 5432.

```powershell
npm install
# For a NEW installation only; preserve an existing .env and its credentials.
Copy-Item .env.example .env
# Configure your own local DATABASE_URL in .env.
npm run db:generate
npm run db:deploy
npm run db:status
npm run dev
```

Open http://localhost:5173/register or http://127.0.0.1:5173/register to create a business and owner account. Existing users can use `/login` on either frontend address. Both exact origins are allowed for local CORS and CSRF checks. The API listens on port 5000; no PostgreSQL or backend port change is required.

`WEB_ORIGINS` is a comma-separated list of exact loopback origins, shared by CORS, registration/login origin validation and authenticated CSRF checks. The default pair is `http://localhost:5173,http://127.0.0.1:5173`. `WEB_ORIGIN` remains supported as the primary/legacy setting; an explicit `WEB_ORIGINS` overrides the default pair. Wildcards, non-loopback hosts, origin paths and other ports are not implicitly allowed.

Use `VITE_API_URL=/api/v1` for local development. Vite forwards `/api` to `http://localhost:5000` (or the configured API `PORT`) without changing the browser's Origin header. This keeps the browser's API requests same-site whether the frontend uses localhost or 127.0.0.1, preserving HttpOnly, host-only, SameSite=Strict session cookies. Calling a localhost API directly from a 127.0.0.1 page is cross-site and can block those cookies even when CORS allows the request. Each frontend hostname has its own cookie session; sign in again when switching hostnames.

After changing `.env` or Vite proxy configuration, restart `npm run dev` and reload the page. In browser Network tools, registration should POST to `/api/v1/auth/register` on the current frontend host and return 201; `/api/v1/auth/session` should return 200 after registration and after a page refresh. Requests from unlisted origins and authenticated mutations without the CSRF header remain rejected.

Root .env is loaded by the API, Prisma wrapper and Vite. Shell variables take precedence. Only VITE-prefixed variables enter the browser. Keep DATABASE_URL server-side, exclude .env from Git and do not overwrite working secrets. .env.example documents configuration with example values only. The application intentionally supports local development/test environments; it is not a production deployment configuration.

Prisma migrations extend the existing schema without a reset. `npm run db:deploy` means apply checked-in **database migrations**, not deploy the application. Never use database reset commands on business records. Existing migrations remain intact. Back up valuable databases using your PostgreSQL tools before maintenance.

## Daily workflow

1. Register a business. Its main store, owner, settings and authenticated cookie session are created together.
2. Add categories and products. Enter cost/selling prices in GMD and optional opening quantities. Opening stock produces audited inventory movements.
3. Receive multiple purchased products through Inventory / Stock receipts with supplier, receipt date and buying prices. StockFlow generates the internal `SR-…` receipt number automatically; the supplier invoice/delivery note number is optional and separate. Open the saved receipt to record full or partial supplier payments and check the balance. Historical receipts remain unreconciled until explicitly verified. Inventory purchases and supplier payments are separate from operating expenses. See [automatic receipt references](docs/STOCK_RECEIPT_REFERENCES.md).
4. Create a cashier under Staff with a unique email and a new password of at least 12 characters. Communicate their initial password privately.
5. The cashier signs in, opens POS, searches by name/SKU/barcode, adds available products, reviews the cart, selects a payment method and confirms checkout.
6. Print the receipt or choose Save as PDF in the browser print dialog. Historical receipts can be reopened through Sales history.
7. Owners/managers can record authorized returns, stock corrections and operating expenses, then review Dashboard and Reports.

Checkout recalculates prices on the server and records the sale, item snapshots, payment, stock deductions, movements and audit entry in one serializable transaction. Quantities support three decimals. Money uses exact integer minor units (100 bututs = D1), with half-up rounding per line. Fixed and percentage discounts require an owner/manager. Cashiers can see only their own sales and cannot access product costs or financial reports.

Product SKUs are generated by the backend per business (`PRD-000001`, `PRD-000002`, and so on). Leave Custom SKU empty for automatic generation, or supply an existing business code. An additive `ProductSkuCounter` table and a business-specific transaction lock serialize allocation, and the existing `(businessId, sku)` unique constraint remains the final safeguard. Existing products/codes are preserved; the migration seeds counters above existing bounded sequential codes, and allocation skips any occupied code, including archived/imported/custom products. Codes are never regenerated by name/category edits. Barcode remains a separate field and identifier. Custom codes retain the existing case-sensitive uniqueness semantics.

Cashiers can enter `390`, `390.5`, `390.50`, `1000`, `1000.75` or `0.01`; trailing zeros are optional. The input stays editable and displays exact received/change amounts to two places. Press Enter in the amount field to confirm checkout. Negative/invalid inputs and more than two currency decimal places are rejected with an explanation, never silently rounded. Fractional quantities retain their separate three-decimal precision, including quantities beyond JavaScript Number precision; extended prices are rounded half up once per sale line in minor units. Discount allocation, payment, change and cumulative refunds use integer arithmetic. Partial payments and tax configuration are not currently supported; underpayment and client-supplied totals/tax fields are rejected.

For cash, leave the amount blank for **Exact payment** and press **Confirm checkout** after receiving the full payment. The POS sends `exactPayment: true` without an amount; the backend uses its own current product prices, quantities and discounts to determine the received amount, with zero change. Adding a product never completes a sale. Enter an amount when change is needed. Non-cash methods still require an explicit amount, receipt confirmation and a payment reference; StockFlow records independently verified payments and does not process transfers.

The checkout API accepts `amountReceived` as a GMD **decimal string**, such as `"700"`, and parses it exactly on the server. Older clients can continue to send `amountReceivedMinor: "70000"`. Send exactly one of these amount fields or `exactPayment: true` (cash only); floating-point JSON numbers and ambiguous/mixed fields are rejected. Explicit amounts normalize to the same minor-unit amount and preserve existing checkout retry-key behavior. Exact-cash retries retain the original completed sale even if product prices subsequently change. Payments store the settled sale total, while the sale separately records amount tendered and change: a D661.25 sale with D700 tendered records 66125 minor units as payment, 70000 received and 3875 change. Historical money values and BIGINT database types are unchanged.

Cash can be recorded directly. Card, bank transfer and mobile-money payments require manual confirmation and a reference after the operator receives payment separately. StockFlow does **not** transfer money or electronically verify these payments. Refunds likewise record an independently arranged refund; they do not send funds.

Repeated stock/checkout/return requests reuse UUID idempotency keys. A changed request with a previously used key is rejected. If checkout reports an uncertain result, use **Retry this checkout**, which resubmits the same request key. Do not create another order to resolve an uncertain result. Pending cart requests are held in component memory; reloading the page clears them, so check Sales history before recreating an interrupted order.

## Roles and isolation

- OWNER: business administration, staff, settings and all operational records.
- MANAGER: catalogue, inventory, sales/returns, expenses and reports; no staff or business-settings administration.
- CASHIER: POS, available catalogue, customer registration/search, their own sales/receipts, and their account settings.

Business identity comes from an authenticated server session, never from submitted business IDs. Trading uses the business's MAIN branch. Multi-branch selection and per-employee branch permissions are not implemented. Employee role/password/status changes revoke their existing sessions. Account password changes revoke all of that user's sessions. Password recovery by email is not configured; owners can reset employee access locally.

New accounts use unique email addresses. Older databases may contain the same email in different businesses: those accounts must provide the optional Business ID at login. The existing guarded `owner:bootstrap` CLI remains available for initial owner recovery on businesses with no accounts; it does not overwrite existing owners.

## Inventory and financial reports

Inventory movements and audit logs are append-only in PostgreSQL. Completed sales, sale items, payments and returns also have database immutability triggers. Archive/restore products instead of deleting historical references.

Reports support today, yesterday, last seven days, last 30 days, this month and custom ranges of up to 366 days. Business dates use Africa/Banjul (UTC). Daily, weekly and monthly chart grouping uses actual sales records. CSV exports cover sales/refunds, product sales, inventory valuation, low stock, expenses, cashier performance and gross-profit/operating-result metrics. Print the report for a browser PDF.

Financial definitions:

- Sales revenue: completed sale totals, including discounts, before returns.
- Net revenue: sales revenue less refunds recorded within the report period.
- COGS: quantity sold multiplied by the product cost snapshotted at sale time; subtract cost reversals only for sellable restocked returns recorded in the period.
- Gross profit: net revenue less that COGS.
- Estimated operating result: gross profit less recorded operating expenses. This is not a claim of complete net profit.
- Inventory value: current main-store stock, including archived products, at the latest product purchase cost. This remains an estimate, not FIFO or weighted-average valuation. Weighted-average arithmetic is experimental and inactive pending opening-value reconciliation.

Charts for product/category/cashier sales show sales before returns; category grouping uses current catalogue categories. Sales CSV includes cumulative refunds per sale, while financial summary reports apply refunds by return date. Top-product/category/cashier panels show up to 25 groups; CSV exports page through the full matching dataset server-side. Product, inventory, sales, customer, expense and movement lists have bounded pagination. Reference category/supplier and staff lists currently return their directory without pagination.

## Local product images

Owners/managers can upload PNG, JPEG and WebP product photos from product details, up to 2 MB. The API checks MIME type and file signatures, creates random filenames, stores files under ignored `.local/uploads/<business UUID>/`, and serves them only through authenticated tenant-scoped product-image endpoints. Arbitrary files and SVG uploads are not served. Product cards have fallback images.

This is a local-development adapter. Back up `.local/uploads` with PostgreSQL. Replacing an image retains the previous file; automatic orphan cleanup, object storage, business-logo uploads and expense-document attachments are not implemented.

## Verification

```powershell
# Create a separate LOCAL database whose name starts with stockflow_test.
# Never point this at the application database.
$env:TEST_DATABASE_URL='postgresql://YOUR_TEST_USER:YOUR_ENCODED_PASSWORD@localhost:5432/stockflow_test?schema=public'
npm test
npm run lint
npm run format:check
npm run build
Remove-Item Env:TEST_DATABASE_URL
```

The PostgreSQL suites refuse the application database and non-loopback targets. They apply migrations and create randomized test tenants without resetting databases. Test fixtures and uniquely named historical-migration schemas are retained for inspection. Without TEST_DATABASE_URL, database suites are explicitly skipped; that does not verify PostgreSQL behavior. On Windows, the execution sandbox may prevent Vite/esbuild from resolving configuration; run these commands from a normal authorized local terminal if that occurs.

The required Cooking Oil scenario is an integration test: D100 cost, D130 price, stock 50, cashier sells three, receives D500, returns D110 change, records revenue D390 / COGS D300 / gross profit D90, and leaves stock 47. These records are created only in the dedicated test database, never seeded into application records.

Current results and remaining scope are in [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md). Existing docs/PHASE_1_REPORT.md and docs/PHASE_2A_REPORT.md describe historical checkpoints, not current functionality.

## Commands and source

- `npm run dev`, `dev:api`, `dev:web`: local servers.
- `npm run db:generate`, `db:deploy`, `db:status`: Prisma client and safe checked-in migrations.
- `npm run db:migrate`: author future development migrations; inspect SQL before applying.
- `npm run owner:bootstrap -- --confirm-local-owner`: guarded interactive first-owner setup; requires ALLOW_OWNER_BOOTSTRAP=true and a loopback configuration.
- `npm test`, `npm run lint`, `npm run format:check`, `npm run build`: verification.

Backend modules live in `apps/api/src/modules/`: auth, catalogue, inventory, sales, management, reports, operations and images. Prisma models/migrations are in `apps/api/prisma/`. Frontend features live in `apps/web/src/features/` with the existing components and styles. `shared/src/index.ts` contains exact currency utilities and isolated illustrative fixtures used by the preview gallery.

The public `/preview/*` gallery remains explicitly labelled and uses separate UI fixtures. It never submits real stock, sales or payment mutations. Authenticated pages do not substitute illustrative records for missing database data.

## Remaining limitations

This is a local retail implementation, not verified production readiness. Production hosting/TLS, backups and restore drills, distributed rate limiting/session operations, operational monitoring, real electronic payment integrations, owner email recovery, uploads scanning/re-encoding, and load testing require separate work. No application deployment or GitHub push was performed.

Business logo uploads, expense supporting documents, receipt-printer device preferences, configurable cashier discount/adjustment permissions, a physical-count approval workflow, direct server-rendered PDFs and advanced inventory costing are not implemented. The current `/inventory/counts` compatibility route displays stock movement history. Receipt PDFs use the browser print dialog. A real thermal printer has not been physically tested.

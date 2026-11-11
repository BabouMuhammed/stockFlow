> Historical Copilot report, superseded by PHASE_1_REPORT.md. Describes archived prototype code, not current functionality.

# StockFlow Prototype Report

## Scope and status

This is a local demonstration prototype, not a production POS. No deployment, hosting, or external publishing was performed.

### Implemented in the source

- Business, category, product, stock balance, receipt, stock movement, sale, and sale-item models with PostgreSQL migration SQL.
- Product search, category filtering, add/edit/activate/deactivate, integer-minor-unit prices, SKU and barcode uniqueness, and zero initial stock.
- Atomic receipt creation and stock increase, receipt idempotency keys, and movement history.
- POS product search and barcode/SKU keyboard lookup, cart quantity controls, cash/mobile-money recording, authoritative-price checkout, stock availability checks, atomic deductions, idempotency, immutable sale snapshots, and printable receipts.
- Sales history, persisted dashboard totals/trend/best sellers, date-range reports, low-stock list, CSV export, and business receipt settings.
- Fictional StockFlow Demo Mart data. Opening stock is entered through idempotent receipt records.
- Responsive React interface, loading/error/empty states, and a 80mm print layout.

### Not verified or incomplete

- Verified: Prisma client generation, API TypeScript build, frontend TypeScript/Vite production build, and the frontend POS cart-to-receipt test.
- Not run: PostgreSQL migration application, demo seed, or persisted checkout/receipt workflows. Docker and `psql` were not available in the implementation environment.
- The two API integration tests require a dedicated PostgreSQL database configured by `TEST_DATABASE_URL`; both were skipped here. Checkout idempotency and concurrent oversell behavior therefore remain unverified against a live database.
- No refund or void workflow, fractional stock, authentication, user roles, production tenant isolation, operational backups, or real mobile-money processing.
- Typography uses local system font stacks; the app does not load external images, font assets, or services.

## Routes and API

Frontend: `/dashboard`, `/products`, `/inventory`, `/inventory/receipts`, `/pos`, `/sales`, `/reports`, `/settings`.

API prefix `/api/v1`: `GET /health`; `GET/PATCH /business`; `GET/POST /categories`; `GET/POST /products`; `GET/PATCH /products/:id`; `GET /inventory`; `GET /inventory/movements`; `GET/POST /inventory/receipts`; `GET /sales`; `GET /sales/:id`; `POST /sales`; `GET /reports/summary`; `GET /reports/sales`; `GET /reports/products`; `GET /reports/low-stock`.

## Database relationships

A business owns categories, products, receipts, stock levels, stock movements, and sales. Products optionally belong to a category and have one current stock balance. Receipts have receipt items; sales have immutable sale items linked to products. Movement rows link a product to a receipt or sale reference. Prices and costs are stored as integer minor units. Stock is whole units.

## Local commands

See [README.md](../README.md) for requirements and startup. Expected URLs are http://localhost:5173 and http://localhost:5000. Configure `.env`, start PostgreSQL, install dependencies, apply migrations, seed, then run `npm run dev`.

## Security and next phase

This unauthenticated single-business backend is intended only for a trusted local demonstration. Do not expose it publicly or enter sensitive data. The next development phase is to run migrations and integration tests against a dedicated PostgreSQL instance, fix any database-specific issues, and verify checkout/receipt idempotency and concurrent oversell rejection before considering a controlled shop demo. Production use additionally requires authentication/authorization, backups, audit/void/refund policy, operational monitoring, and security review.

# Automatic stock receipt references

Stock receiving now creates an internal `SR-000001` style code on the backend.
Numbering is independent per business, uses a persistent counter (not receipt
counts), and is allocated inside the receipt/stock transaction. A business-scoped
transaction lock, Prisma mutation retries and a database unique constraint protect
concurrent creation. Idempotent retries return the original receipt and code.

## Supplier documents

The form labels the separate optional field **Supplier invoice / delivery note
number (optional)** and explains that it comes from the supplier's paperwork.
Leaving it empty is valid and saves NULL; no supplier number is invented.
The internal number displays **Automatically generated** before saving. A successful
save opens the receipt details and shows its actual generated number.

When provided, supplier documents are checked case-insensitively within the current
business and supplier. The existing repeat/partial-delivery reason is still required
for a repeated document and is saved with the supplier and internal references in
the receipt's audit event. Equal amounts alone never imply duplication.

History, details and purchase CSV exports separate the two references. Searching
receipts matches either reference. Old manually entered references remain unchanged
and accessible as original references. Their invoice field says **Not separately
recorded**, since historical reference strings do not establish document provenance.
Duplicate checks also consider matching original references on legacy receipts.

## API and compatibility

`POST /api/v1/inventory/receipts` continues to require the existing items, supplier
rules and idempotency key. `supplierInvoiceReference` is optional. The old request
field `reference` remains a supplier-document alias for older clients; conflicting
alias/new values are rejected. Existing retry fingerprints are retained. Clients
cannot choose an internal code by supplying either field or `internalReference`.

For new receipts, `reference` and `internalReference` both contain the generated
code, with a database equality constraint to preserve older API consumers. The
separate nullable `supplierInvoiceReference` stores only the actual supplied value.
Historical receipts retain their original `reference`, with both new columns NULL.
Internal references are immutable in PostgreSQL and are not changed by edits to
product names, categories, costs, reconciliation or supplier settlements.

## Migration

`20261111010000_stock_receipt_references` adds:

- Nullable `StockReceipt.internalReference` and `supplierInvoiceReference`.
- Unique `(businessId, internalReference)` and a supplier-document lookup index.
- `StockReceiptCounter`, linked to its business.
- A consistency constraint and reference immutability trigger.

The migration never updates or renumbers existing receipts. Counter seeds use the
maximum occupied bounded `SR-…` code; they never count receipts. Allocation also
skips subsequently imported occupied references. Legacy duplicate references remain
valid because their internal-reference column is NULL. Monetary types, receipt
items, payments, sale snapshots and costing calculations are unchanged.

Apply using `prisma migrate deploy` only after backup and verification of the local
target. No database reset, schema push, deployment or Git push is part of this work.
Keep the additive fields/counter if rolling application code back; never remove
receipt history or reuse an issued number to simulate a rollback.

## Verification

Tests cover missing/supplied supplier documents, automatic codes, concurrent receipts,
case-insensitive legacy duplicate checks, supplier-scoped duplicates, documented
partial deliveries, stable idempotent retries, stock increments, immutable codes,
and migration preservation (including old duplicate `SR-…` references). The existing
POS/financial regression suite is retained.

Executed results:

- `npm run test:isolated`: **179 API/PostgreSQL tests passed**, 16 files, no skips.
- `npm run test --workspace apps/web`: **86 frontend tests passed**, 4 files, no skips.
- `npm run lint`: passed.
- `npm run build`: API TypeScript, frontend TypeScript and Vite production build passed.
- Prisma schema validation: passed. Generated Client refreshed using the identical
  existing engine because running Windows processes held its DLL open.
- Headless Edge on an isolated database: no-document receipt, automatic display,
  double-click protection, supplied invoice, retained form after duplicate rejection,
  documented partial delivery, exact stock quantity, persistence after refresh,
  desktop/mobile history and zero browser runtime exceptions all passed.

The first concurrency run exposed raw-query serialization errors that did not enter
the existing retry path. Counter mutations now use Prisma's standard mutation path;
the complete rerun passed, without changing shared transaction or money functions.

The additive migration was applied to the working loopback prototype after a full
backup and archive-list verification. Original rows/columns across **22 tables**
matched their pre-migration hashes. Backup and preservation proof are ignored by Git:

- `.local/backups/pre-receipt-references-1794417809733.dump`
- `.local/backups/pre-receipt-references-1794417809733-preservation.json`

No test receipts were added to the existing application database; browser scenarios
used an isolated database. The working API readiness check passes through the Vite
proxy. Use `http://127.0.0.1:5173/inventory/receipts`, refresh, click **Receive stock**,
leave the optional supplier document empty if none exists, and save. The saved
receipt details show its generated reference. No application deployment was performed.

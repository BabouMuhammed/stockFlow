# Purchasing and costing safety decisions

Receipts retain original item quantities and unit costs. Extended costs are derived
with BigInt: `(unitCostMinor * quantityThousandths + 500) / 1000`, once per line
(round half up to a butut), then summed. The backend rejects overflow, duplicate
product lines, invalid quantities, and tenant mismatches. No client total is trusted.

Existing receipts keep `receivedAt = null` (display/filter fallback: createdAt) and
`settlementKnown = false`. They are UNRECONCILED, never assumed debts or payments.
New supplier-linked receipts explicitly set settlementKnown. New receipts without a
supplier retain an unknown state for legacy-client compatibility. Settlement amounts remain append-only;
reversal entries offset original payments without deleting them. Recorded payments
are manual owner/manager confirmations of outgoing funds, not bank integrations.
Owners may reconcile an old receipt only after recording its complete payment
history and explicitly confirming that the records are complete, with a reason.
Unreconciled receipts may accumulate known payments but remain excluded from verified
debt until this confirmation. A legacy receipt without a supplier cannot be settled;
reconcile its provenance outside this workflow before any future approved repair.

Invoice references are not globally unique: legacy single-item receipts and repeat
deliveries must remain valid. Same-business/supplier/reference repeats require an
explicit reason. An advisory lock serializes that check. Idempotency independently
prevents retries from repeating stock or payments. Payment and reversal checks lock
the receipt so concurrent writes cannot overpay. Reversals cannot predate payments.

Purchases are measured by receipt date; payments and reversals by payment event date.
Balances are CURRENT balances, not historical balances at the report end date.
Historical totals and unreconciled counts/values are identified separately. Expenses
are never created from stock receipts or supplier payments. Historical expense
classification is retained; obvious inventory/settlement category names are rejected
for new entries. Existing suspect expenses are flagged for review, never rewritten.

## Weighted-average activation gate: CLOSED

No existing business is switched from latest recorded cost. Stock has been created
through opening stock, receipts, adjustments, returns, and counts; their original
value bases have not been reconciled. Existing SaleItem snapshots stay immutable.

The experimental pure costing engine tracks total inventory value in integer bututs
and quantity in thousandths. Incoming receipt line costs add to the value pool.
Issues allocate `roundHalfUp(poolValue * issuedQuantity / poolQuantity)`; the last
issue takes the remaining value exactly. Sales, damage, and negative adjustments
use the same allocation; verified opening/positive adjustments require explicit
value. Restocked returns add their original allocated cost. Average unit cost is
display-only and must never replace the value pool. Cumulative return allocation
preserves each sale's allocated cost. No floating-point money is used.

This engine is deliberately NOT connected to live stock writes. Before activation,
add transactional cost-pool persistence and an explicit sale-line allocated-cost
snapshot, reconcile opening value/quantity per product/branch, handle stock counts,
and verify end-to-end receipt/sale/return/adjustment/report tests. An environment flag
alone must not activate it. Latest-cost valuation remains labelled as an estimate.

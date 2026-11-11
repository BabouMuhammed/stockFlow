# Future operational test specifications

These are acceptance specifications, not implemented or passing business features.

| Workflow           | Required tests and invariant                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout           | Authoritative active-product price/cost/name snapshots; exact line rounding for fractional quantities; correct payment total; negative/overflow/duplicate/foreign-tenant inputs rejected; any write failure rolls back every row |
| Idempotency        | Same key/payload returns same sale; conflicting payload returns 409; simultaneous same-key requests produce one sale/payment/ledger change; network retry retains key                                                            |
| Concurrent sales   | Separate connections sell the last unit simultaneously; exactly one succeeds; no negative balance; serialization retry bounded; multi-product lock order avoids deadlock                                                         |
| Stock receipts     | Same rules for repeat/concurrent submissions; supplier scope checked; costs frozen; no partial header/items/ledger/balance state                                                                                                 |
| Reconciliation     | Frozen observation basis; submitted counts do not change balances; stale counts require recount; independent approval; simultaneous approval creates one adjustment; immutable audit reason                                      |
| Refunds/voids      | Link to original sale; never edit original line snapshots; cannot exceed refundable quantity; authorized approval; stock and financial compensation commit once; manual mobile money does not imply automated refund             |
| Financial reports  | Include completed status only; consistent UTC/Gambia date boundaries; day/week/month sums reconcile to transaction items; exact COGS/gross profit including returns; no net-profit claim                                         |
| Sessions and roles | Password hashing round trip; generic login failures; expiry/revocation/logout/disabled user; fixation/CSRF/rate-limit behavior; role matrix and branch restrictions tested through HTTP                                          |
| Tenant isolation   | Read/write/search/export/receipt lookups reject foreign identifiers, including nested items/category/supplier/count approvers; no sensitive hashes/costs in cashier DTOs                                                         |
| Restore            | Backup restored into isolated PostgreSQL; ledger totals match balances; historical snapshots and audit/session policy preserved                                                                                                  |

# StockFlow API contract - Phase 2A

Base: http://localhost:5000/api/v1. The API listener binds to 127.0.0.1. JSON bodies are limited to 32 KiB. All responses use Cache-Control: no-store. Browser CORS permits the exact configured loopback WEB_ORIGIN and credentials; CORS does not replace authentication or CSRF checks.

## Implemented endpoints

| Method | Path            | Access and behavior                                                                        |
| ------ | --------------- | ------------------------------------------------------------------------------------------ |
| GET    | /health         | Public liveness; retains the Phase 1 response { status: "ok", phase: 1 } for compatibility |
| GET    | /health/ready   | Public; 200 when PostgreSQL and the BIGINT migration are ready; otherwise 503              |
| POST   | /auth/login     | Business ID, normalized email and password; exact Origin plus JSON required; rate limited  |
| GET    | /auth/session   | Valid, active, unexpired and unrevoked session                                             |
| POST   | /auth/logout    | Session plus Origin and CSRF token; revoke current session, clear cookie, 204              |
| GET    | /business       | Minimal session-derived business identity; all authenticated roles                         |
| GET    | /products       | All roles; cashiers receive active products only and never purchase costs                  |
| GET    | /products/:id   | Tenant-scoped product; inactive products appear absent to cashiers                         |
| POST   | /products       | OWNER/MANAGER; create catalogue record and audit event without stock changes               |
| PATCH  | /products/:id   | OWNER/MANAGER; partial update and audit event; omitted values preserved                    |
| GET    | /categories     | All authenticated roles; session business only                                             |
| POST   | /categories     | OWNER/MANAGER; create and audit                                                            |
| PATCH  | /categories/:id | OWNER/MANAGER; rename and audit                                                            |
| GET    | /suppliers      | OWNER/MANAGER; list business suppliers                                                     |
| POST   | /suppliers      | OWNER/MANAGER; create and audit                                                            |
| PATCH  | /suppliers/:id  | OWNER/MANAGER; update contact details or active state and audit                            |

No public registration or HTTP owner-bootstrap route exists. Product/category/supplier deletion is unavailable; historical references are retained. Unsupported methods on reserved modules return 501. /inventory, /sales, /reports and /staff remain unavailable, including checkout, receipts, adjustments, counts and financial reports. Branch access is NOT_ASSIGNED; these APIs do not invent per-branch permissions.

## Authentication and CSRF

Login JSON: { businessId: UUID, email: string, password: string }. The business ID is an identity locator only; it grants no authority. Every later business query gets its scope from the verified PostgreSQL session, not request headers, query parameters or posted businessId values. Unknown identities, wrong passwords and inactive accounts receive the same 401 message.

Login/session response:

```json
{
  "user": { "id": "UUID", "name": "Name", "email": "email@example.test", "role": "OWNER" },
  "business": { "id": "UUID", "name": "Business", "isDemo": false, "currency": "GMD" },
  "expiresAt": "ISO-8601 timestamp",
  "csrfToken": "session-derived token",
  "branchAccess": "NOT_ASSIGNED"
}
```

The opaque cookie stockflow_session is HttpOnly, SameSite=Strict, host-only and scoped to /api/v1. Secure is set when HTTPS is configured or used. Raw session tokens are not returned in JSON; PostgreSQL stores only their SHA-256 hashes. All authenticated writes require the exact Origin and X-CSRF-Token from the session response. Login requires the exact Origin and JSON content type; a cross-site form or fetch cannot authenticate another browser.

## Catalogue requests

GET /products accepts search (name/SKU/barcode, case insensitive, max 120 characters), optional categoryId UUID, optional active=true/false, page (1..100000) and limit (1..100, default 24). Results use { data: [], page, limit, total }. Cashier active=false requests still expose only active products. Query/path/body inputs use Zod validation; unknown product/body fields such as businessId or quantity are rejected.

Product create JSON:

```json
{
  "name": "Rice 25kg",
  "sku": "RICE-25",
  "barcode": null,
  "categoryId": null,
  "unit": "bag",
  "purchaseCostMinor": "185000",
  "sellingPriceMinor": "220000",
  "lowStockThreshold": "5.000",
  "isActive": true
}
```

Money is integer minor-unit strings, never JSON numbers. Range: 0..9223372036854775807, with selling price strictly positive. Quantity/threshold strings support up to three decimal places and fifteen whole digits. Defaults on create are unit=unit, threshold=5.000 and active=true. PATCH accepts the same fields optionally, but requires at least one and applies no creation defaults. Barcode null or empty clears it; omitting it preserves it. Category must exist in the same business. Unique business SKU/barcode/category-name conflicts return 409.

Category body: { name: string }, max 80 characters. Supplier body: { name, phone?, address?, isActive? }, with name <=120, phone <=40 and address <=240 characters; create defaults active=true. Supplier PATCH preserves every omitted field. Categories and suppliers currently return arrays rather than paginated lists. Case-normalized category/SKU uniqueness beyond PostgreSQL's current case-sensitive constraint is not implied.

Product DTOs omit purchaseCostMinor for CASHIER. No role receives passwordHash, session token/hash or invented branch balances. Decimal quantities serialize as strings, timestamps as UTC ISO-8601, and all BigInt monetary fields serialize as strings.

## Errors

JSON: { error: human-readable string, code: stable identifier, issues?: [{ path, message }] }.

- 400 VALIDATION_ERROR / INVALID_JSON: correct fields or JSON syntax.
- 401 UNAUTHENTICATED / INVALID_CREDENTIALS: absent/expired/revoked/inactive session or generic failed login.
- 403 FORBIDDEN / CSRF_REJECTED: role, origin or CSRF restriction.
- 404 NOT_FOUND: missing or foreign-business resource.
- 409 DUPLICATE_RECORD / INVALID_REFERENCE: uniqueness or relation conflict.
- 413 PAYLOAD_TOO_LARGE; 429 RATE_LIMITED; 501 NOT_IMPLEMENTED; 503 NOT_READY.
- 500 INTERNAL_ERROR: generic response; internal errors do not echo request bodies or credentials.

Future financial commands must add stable idempotency keys, request hashes and transactional inventory rules before they are enabled.

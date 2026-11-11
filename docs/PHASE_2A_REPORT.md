# StockFlow Phase 2A implementation report

Date: 9 November 2026. Scope: dependency review, monetary widening, authentication/authorization and real catalogue management. The existing npm-workspace architecture and emerald responsive UI are preserved. No deployment, GitHub push, hosting connection, payment processing, operational checkout or stock workflow was performed.

## 1. Files changed

New backend files:

- apps/api/scripts/bootstrap-owner.ts
- apps/api/src/modules/auth.ts and catalogue.ts
- apps/api/src/security/password.ts, session.ts and bootstrap.ts
- apps/api/src/utils/http.ts and validation.ts
- apps/api/src/tests/phase2a.test.ts, phase2a.integration.test.ts and money-migration.integration.test.ts
- apps/api/vitest.config.mts
- apps/api/prisma/migrations/20261108020000_phase2a_bigint/migration.sql

Updated backend files:

- apps/api/prisma/schema.prisma: nine monetary Int fields become BigInt; stock decimals are unchanged.
- apps/api/src/app.ts, index.ts, config/env.ts and middleware/authorization.ts: verified sessions, scoped routes, configuration, JSON serialization and policy.
- apps/api/src/tests/foundation.test.ts: retains foundation coverage and adds invalid/non-loopback Origin validation.
- apps/api/src/tests/foundation.integration.test.ts: preserves original assertions with an exact BigInt expectation and explicit demo-business selection.
- apps/api/package.json, tsconfig.json and src/modules/README.md: scripts, dependency upgrades, source-only test discovery and module status.

Frontend/shared files:

- apps/web/src/App.tsx and api.ts: authenticated workspace, credentialed requests and CSRF/error handling.
- apps/web/src/features/session.tsx, catalogue.tsx, references.tsx and pos.tsx: PostgreSQL-backed views, forms and disabled checkout preview.
- apps/web/src/pages/Login.tsx: real login; PreviewLogin.tsx preserves the original preview.
- apps/web/src/PreviewApp.tsx: explicitly separated Phase 1 gallery under /preview/*.
- apps/web/src/App.test.tsx: retains all original gallery assertions through PreviewApp.
- apps/web/src/OperationalApp.test.tsx: new live-client frontend tests.
- apps/web/src/styles.css: small extensions for operational controls, pagination and scrollable navigation; existing visual identity retained.
- apps/web/package.json and shared/src/index.ts: compatible form dependencies and exact BigInt/string money helpers.

Root/docs:

- package.json, package-lock.json, .env.example, README.md.
- docs/API_CONTRACT.md, DATABASE_DESIGN.md, SECURITY_MODEL.md and REQUIREMENTS.md.
- This report. Phase 1 reports, original migrations and archived Copilot references remain historical records.

Generated build outputs and ignored local verification files are not application source. No project files outside StockFlow were edited, and no broad Git staging/committing occurred.

## 2. Implemented features

- Local owner authentication with scrypt password verification, opaque database sessions, secure cookie attributes, logout/revocation, expiry, active-user enforcement, generic failures, failed-login throttling and CSRF protection.
- Deliberate interactive first-owner bootstrap; no public registration or known shared password.
- Server-enforced catalogue permissions and session-derived tenant scope. Client business headers/posted IDs cannot switch the authenticated tenant.
- Product create/edit/search by name/SKU/barcode, category and active-state filtering, bounded pagination, business-specific uniqueness, units, exact prices/costs, decimal reorder thresholds and activation/deactivation.
- Category create/list/rename and supplier create/list/contact updates/activation/deactivation.
- Every catalogue write and audit event commits in one transaction. Events include actor, entity and changed field names. No product setup operation changes stock or financial records.
- PostgreSQL-backed operational forms and lists with loading, empty, error, validation, retry and success states; role-aware navigation and logout.
- A separate labelled Phase 1 gallery, not a fallback API response. All original route/layout/cart/form tests remain represented.
- POS uses real catalogue prices with temporary BigInt preview arithmetic, while checkout/payment/receipt actions remain disabled. No live stock availability or financial totals are fabricated.

## 3. Database migration

20261108020000_phase2a_bigint uses transactional ALTER COLUMN TYPE BIGINT for:

| Table            | Fields                                        |
| ---------------- | --------------------------------------------- |
| Product          | purchaseCostMinor, sellingPriceMinor          |
| StockReceiptItem | unitCostMinor                                 |
| Sale             | subtotalMinor, totalMinor                     |
| SaleItem         | unitPriceMinor, unitCostMinor, lineTotalMinor |
| Payment          | amountMinor                                   |

Existing minor-unit values, foreign keys, checks and movement/audit protections remain. No table reset, record deletion or stock decimal change occurs. APIs accept canonical integer strings bounded to signed BIGINT's positive range; selling prices must be positive. Nested BigInts serialize to decimal strings; frontend form/display arithmetic uses BigInt/string operations instead of floating point.

Verified against PostgreSQL 18 in the isolated loopback test cluster on port 55432:

- The existing Phase 1 test database accepted the migration without reset.
- A repeatable test creates a new isolated schema, applies both original Phase 1 migrations, populates all five monetary tables near the old INTEGER maximum and snapshots all nine fields plus fractional quantities.
- After applying the new migration, every snapshot matches, all nine columns report bigint, fractional quantities remain exact and the BIGINT maximum persists without precision loss.
- Tenant foreign keys, restricted deletion, nonnegative balances and immutable ledger checks still pass.
- New test schemas and test tenants are retained for inspection, not dropped. Existing customer/development databases were not migrated or reset.

ALTER TYPE takes table locks; use a backup and maintenance window before applying to a database containing actual shop data. This report does not claim operational checkout verification.

## 4. Authentication behavior

The local CLI requires ALLOW_OWNER_BOOTSTRAP=true, --confirm-local-owner, a real interactive terminal, loopback web/database hosts and non-production configuration. It creates a new business/main branch or selects an explicitly supplied existing business UUID. Any existing account in that business causes refusal. Passwords are entered twice without echo; success prints only the business UUID. It never overwrites an existing account. Bootstrap guard policy, non-interactive CLI refusal and new/existing-business core creation paths were tested against the dedicated local database. The human chooses the actual password at setup; no credentials were embedded or printed during verification.

Passwords use scrypt v1 (random 16-byte salt, 64-byte key, N=131072/r=8/p=1, 256 MiB maxmem) and timing-safe verification. Each successful login issues a new 32-byte random session token; PostgreSQL stores only its SHA-256 hash. The cookie is HttpOnly, host-only, SameSite=Strict, path /api/v1, default lifetime eight hours and Secure for HTTPS. Login rotates an existing browser token. Every protected request checks expiry, revocation, active user and current role.

Authenticated mutations require the exact Origin and session-derived X-CSRF-Token. Login requires exact Origin and JSON. Failed logins are generic, with ten unsuccessful requests per IP per fifteen minutes and at most two concurrent verifications. Throttle state is process-local and resets with application restart; sessions persist in PostgreSQL. No localStorage/sessionStorage credentials are used. Branch access is explicitly NOT_ASSIGNED, not inferred from an owner-created branch.

## 5. Role permissions

| Operation                                                              | OWNER       | MANAGER     | CASHIER     |
| ---------------------------------------------------------------------- | ----------- | ----------- | ----------- |
| Read active products/categories                                        | Yes         | Yes         | Yes         |
| Read inactive products and purchase costs                              | Yes         | Yes         | No          |
| Create/edit/activate products                                          | Yes         | Yes         | No          |
| Create/update categories                                               | Yes         | Yes         | No          |
| Read/create/update/deactivate suppliers                                | Yes         | Yes         | No          |
| Read minimal own business identity                                     | Yes         | Yes         | Yes         |
| Checkout, receipts, branch stock/counts, reports, staff administration | Unavailable | Unavailable | Unavailable |

Cross-business identifiers return absent/invalid-reference responses and never grant access. Purchase costs are removed from cashier DTOs on the server. The frontend role controls are only a usability layer.

## 6. API endpoints

Implemented under /api/v1:

- GET /health and /health/ready.
- POST /auth/login, GET /auth/session, POST /auth/logout.
- GET /business.
- GET/POST /products, GET/PATCH /products/:id.
- GET/POST /categories, PATCH /categories/:id.
- GET/POST /suppliers, PATCH /suppliers/:id.

No product/category/supplier deletion or registration endpoint is provided. Reserved inventory/sales/reporting/staff workflows return explicit 501 responses. See API_CONTRACT.md for body examples, pagination, strings for money/quantities, errors and CSRF requirements.

## 7. Dependency security review

The initial full audit reported 19 findings: 2 critical, 5 high and 12 moderate. The reviewed upgrades now produce 12 findings: 0 critical, 3 high and 9 moderate. npm audit --omit=dev still reports 5 findings (3 high, 2 moderate) because Prisma CLI/config is retained via the Prisma client's optional peer relationship. The application is not declared secure merely because the count decreased.

| Initially high/critical chain                  | Classification/reachability                                                                                                                                                                                                                                                                   | Action and status                                                                                                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vitest -> tinypool                             | Development/test worker options; no HTTP catalogue reachability. Untrusted worker options could exercise the gadget.                                                                                                                                                                          | Upgraded Vitest 2.1.9 to 5.1.0; worker critical findings removed; existing tests re-executed.                                                                                                                                                             |
| vitest UI/mocker -> vulnerable Vitest          | Development UI server route could read/execute files if exposed. This project uses run mode, not a public UI server.                                                                                                                                                                          | Upgraded Vitest/mocker to 5.1.0; critical UI and old mocker findings removed.                                                                                                                                                                             |
| vitest/vite-node/mocker -> older Vite/esbuild  | Development server/editor/file handling, including Windows attack paths; local server exposure matters.                                                                                                                                                                                       | Explicit Vite 6.4.5 in root/web removes the vulnerable nested development-server versions; build and browser checks passed.                                                                                                                               |
| API/web -> zod                                 | Runtime request/form validation; bounded JSON reduced exposure but did not fix the underlying oversized-collection advisory.                                                                                                                                                                  | Upgraded both to Zod 4.6.7 and compatible resolver 5.2.2/React Hook Form. Request/form tests pass. Explicit PATCH schemas prevent Zod 4 defaults resetting omitted fields.                                                                                |
| prisma -> @prisma/config -> deepmerge-ts 7.1.5 | Declared development CLI/config dependency; also retained in production-only audit by optional peer installation. Cyclic config merge can exhaust stack. API request handlers do not import its configuration loader; local config is trusted and no remote config extension is enabled here. | Three high findings remain for this single dependency chain. Prisma 6.19.3 is retained; no unverified transitive override or breaking Prisma migration is claimed as a fix. Resolve through a separately validated tooling/client upgrade before release. |

Remaining moderate findings:

- typescript-eslint -> typescript-estree -> minimatch 10.2.6: seven audit nodes for local glob amplification. It consumes trusted local source/lint paths, not catalogue requests. A validated glob/tooling upgrade remains necessary.
- react-router-dom/react-router 6.30.6: two audit nodes for open-redirect and SSR hydration advisories. The app uses fixed local navigation targets and no SSR hydration; neither affected flow accepts user-controlled redirects here. A separately tested router major upgrade remains a release task.

No npm audit fix --force was used. Major Vitest/Zod upgrades were checked against the existing non-database suite and build before feature work, followed by the complete PostgreSQL/frontend checks. Vite emits non-fatal upstream Zod PURE-comment annotation warnings; builds complete successfully without suppressing errors.

Sources used during review: npm audit/lockfile dependency chains, [Vitest migration guidance](https://vitest.dev/guide/migration/), [Vite migration guidance](https://vite.dev/guide/migration.html), [Node crypto documentation](https://nodejs.org/api/crypto.html), and advisory references [deepmerge](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), [tinypool](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## 8. Executed verification

- Complete suite with TEST_DATABASE_URL configured: **56 passed, 0 skipped** (27 API/database tests, 29 frontend tests).
- The 13 authentication/catalogue integration tests were additionally rerun after tightening bootstrap guard coverage and fixing the test helper's lint formatting; all passed.
- API/database coverage: original environment/health/error/CORS/policy/seed constraints; migration preservation; exact JSON/BIGINT bounds; password verification/salts; successful/generic/inactive login; cookie flags; expiry/logout/revocation; rate limit; CSRF; bootstrap refusal; owner/manager/cashier permissions; tenant rejection; create/update/duplicates/prices/search/filter/deactivation; persistence across a new app/Prisma client; audit writes; omitted PATCH field preservation; no stock writes.
- Frontend coverage: all twenty original Phase 1 gallery assertions retained, plus nine operational tests for login/logout, exact form payloads, catalogue search/filtering, category/supplier forms, error/retry behavior, cashier controls, mobile navigation, exact money and disabled checkout.
- Real headless Edge with an isolated test tenant: login; PostgreSQL-backed catalogue at 1440px and 390px without horizontal overflow; product create/edit with persisted price=931/cost=701 minor-unit strings; category/supplier creation; disabled checkout; logout followed by HTTP 401 session lookup; no browser runtime exceptions. Screenshots were visually inspected.
- TypeScript API compilation and Vite production build passed locally.
- ESLint passed after the test helper correction. Final formatting, schema/drift/status and cleanup checks are recorded at the end of this report.

The browser tenant uses generated test-only credentials, never printed or committed. Existing port 5000 was occupied, so verification used API 5051, frontend 5173 and the isolated PostgreSQL port 55432. Existing listeners/customer databases were not modified. Docker Compose is configured but unexecuted because Docker is unavailable.

## 9. Known limitations

- Remaining dependency advisories are reviewed but unresolved; this is not a production release or security certification.
- Only first-owner bootstrap exists. Staff provisioning, invitations, password reset/recovery and an audit viewer are future work.
- No assigned branch access, operational stock reads/writes, receipts, counts, adjustments, checkout, payments, refunds, financial reports or receipt printing.
- Temporary POS carts do not check stock or submit transactions; they disappear on navigation/reload.
- Category/supplier lists are not paginated. Product search uses tenant-filtered contains queries; large-catalogue tuning/trigram indexing is future work.
- Login throttling is a single-process in-memory limit. Session expiry/revocation is checked in PostgreSQL; automatic session-row cleanup/retention is not implemented.
- No production TLS, monitoring, backup/restore or hosting setup. Cookie Secure behavior is tested; no actual production HTTPS service was started.
- The existing 17-model architecture is preserved; future transactional consistency/idempotency/rounding behavior remains a specification, not enabled code.

## 10. Exact PowerShell startup and verification

See README for native PostgreSQL or optional Compose prerequisites. From the StockFlow root:

```powershell
npm install
Copy-Item .env.example .env
# Edit .env for your own existing local PostgreSQL role/database.
# Start PostgreSQL using your installed service, or (if Docker is available):
docker compose up -d postgres
npm run db:generate
npm run db:deploy
npm run db:status
$env:ALLOW_OWNER_BOOTSTRAP='true'
npm run owner:bootstrap -- --confirm-local-owner
Remove-Item Env:ALLOW_OWNER_BOOTSTRAP
npm run dev
```

For an existing business's first owner, append --business-id YOUR_EXISTING_BUSINESS_UUID. Never run bootstrap with a shared password or an already populated account set. Open http://localhost:5173/login with the UUID printed by bootstrap and the credentials you chose. If port 5000 is occupied, set PORT=5051 and VITE_API_URL=http://localhost:5051/api/v1 in .env and restart both apps.

```powershell
# Create a distinct local stockflow_test database first; never reset a customer database.
$env:TEST_DATABASE_URL='postgresql://YOUR_TEST_USER:YOUR_TEST_PASSWORD@localhost:5432/stockflow_test?schema=public'
npm test
npm run lint
npm run format:check
npm run build
npm audit
npm audit --omit=dev
Remove-Item Env:TEST_DATABASE_URL
```

Audit commands currently return a nonzero status for the documented advisories. Without TEST_DATABASE_URL, database tests skip and must not be reported as verified.

## 11. Recommended Phase 2B - approval required

1. Resolve the remaining Prisma/config, router and lint advisory chains with separately tested upgrades; establish a dedicated PostgreSQL CI environment and restricted database roles.
2. Add deliberate staff provisioning/recovery and enforce an explicit branch-membership model before branch workflows.
3. Implement supplier stock receipts first with stable idempotency keys, exact quantities, immutable costs, ledger/balance/audit atomicity and concurrency tests.
4. Only then implement authoritative-price checkout/payment recording with exact rounding, stock locking, idempotency conflict handling and simultaneous oversell tests.
5. Follow with independent stock-count approval, compensating adjustments/returns, reconciled reports, receipt printing and backup/restore verification.

Stop after Phase 2A. None of these Phase 2B operational workflows has been implemented.

## Final verification record

Final checks passed: Prettier formatting, ESLint, Prisma schema validation and local API/frontend builds. Prisma reports all three migrations applied and no schema drift. The final compiled API also passed the complete live-browser flow. Isolated API/frontend/PostgreSQL verification services were stopped, and the temporary plaintext browser-test credential file was removed. No customer records, verification schemas or existing database contents were deleted. Remaining audit counts are the documented 3 high and 9 moderate findings; there are no critical findings.

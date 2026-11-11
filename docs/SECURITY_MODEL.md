# StockFlow security model - Phase 2A

## Local boundary

The Express server binds only to 127.0.0.1. WEB_ORIGIN must be an exact loopback HTTP(S) origin. Production NODE_ENV remains rejected. This phase has not been deployed, published or connected to hosting. Health/readiness are public; catalogue and business data require a verified session. The separate /preview/* gallery retains labelled Phase 1 fixtures and performs no business writes. Operational pages never fall back to fixtures after an API failure.

## Passwords and bootstrap

Node crypto.scrypt uses a random 16-byte salt, 64-byte key, N=131072, r=8, p=1 and a 256 MiB maximum allocation setting. The scrypt$v1 encoding identifies these fixed parameters. Verification uses timingSafeEqual. Bootstrap passwords must be 12..128 characters; login input is bounded to 128. No default owner password or public registration endpoint exists. These parameters have been exercised locally, not certified for a production hardware load.

owner:bootstrap is a separate interactive CLI. It requires ALLOW_OWNER_BOOTSTRAP=true, --confirm-local-owner, a TTY, non-production configuration and loopback database/web hosts. Passwords and confirmation are entered without echo and are never printed. The operator either creates a new business/main branch or explicitly selects an existing business UUID. An advisory lock and serializable transaction protect first-owner creation. Any existing account in the selected business causes refusal; no account/password is overwritten. Success prints only the business UUID. Disable the environment opt-in afterwards. Additional staff provisioning and account recovery are outside this phase.

## Sessions and request protection

Successful login creates a fresh 32-byte random token and rotates any existing browser session. PostgreSQL stores only SHA-256(token), expiry and revocation. The host-only stockflow_session cookie is HttpOnly, SameSite=Strict, path /api/v1 and defaults to an eight-hour lifetime (SESSION_HOURS allows 1..24). Secure is enabled for an HTTPS web origin or secure request. Plain HTTP is permitted only for this loopback development use; no production TLS implementation is claimed.

Every protected request checks the database session, expiry, revocation and active user, and reads the current role. Logout transactionally revokes the current session and writes an audit event before clearing its cookie. Sessions survive application restart and are not held in process memory. The frontend clears private views on logout/expiry/rejection and separates query keys by role; session identity changes remount private views. It stores no credential/token in localStorage or sessionStorage.

The CSRF token is SHA-256 of a domain-separated value containing the raw high-entropy session token. It is returned by login/GET session and held in frontend memory; it is not a substitute for authentication. Authenticated mutations require both the exact configured Origin and the correct X-CSRF-Token, compared in constant time. Login requires the exact Origin plus application/json, preventing cross-site login forms. CORS allows credentials only for the configured origin; duplicate/malformed session cookies are rejected. JSON bodies are limited to 32 KiB and authenticated responses are non-cacheable.

Login is limited to ten unsuccessful requests per source IP per fifteen minutes, with standard retry headers. At most two password verifications run concurrently per app instance. Limits are process-local and restart with the process; they are suitable for the single local process, not a future distributed service. Wrong passwords, missing accounts and inactive accounts receive the same failure message. Nonexistent accounts follow a dummy scrypt verification path.

## Authorization and tenant isolation

OWNER/MANAGER can create/update products, categories and suppliers. CASHIER can read active products and categories; product DTOs omit purchase costs. Supplier data/mutations are denied to CASHIER. The server enforces these rules regardless of UI controls. Staff administration, checkout and branch workflows remain unavailable for every role.

The business UUID in login selects the identity namespace; after login every business query derives businessId from its verified session. Client tenant headers and posted businessId cannot authorize a request. Product/category/supplier lookups and updates include businessId; nested categories are checked inside the write transaction. Composite database foreign keys provide another boundary against cross-business references. Emails created by bootstrap are normalized to lowercase. No branch membership is invented: sessions explicitly report NOT_ASSIGNED, and all branch-specific operations remain unavailable.

## Audits and historical records

Each catalogue create/update and its audit row commit atomically. Events include business, actor, action, entity UUID and changed field names; secrets are not included. Login/logout/bootstrap also record actor events. Existing PostgreSQL triggers reject movement/audit edits and deletes. No product/category/supplier DELETE API is enabled, preserving references. Product setup never creates or modifies StockLevel, StockMovement, receipts, sales or payments.

Secrets remain in ignored .env files or hidden interactive input. .env.example/Compose credentials are examples for local PostgreSQL only. Demo seeding remains explicit, local and create-only; it refuses non-demo businesses and never creates staff credentials. Tests use a separately named local database and retain their own records/schemas for inspection without reset/drop operations.

## Dependency review and release limits

The reviewed dependency upgrades remove the inherited critical test-tool findings and vulnerable Zod versions. Remaining Prisma CLI/config-merger and lint/router advisories are enumerated in PHASE_2A_REPORT.md with chains and reachability; an audit count is not a security guarantee. Prisma CLI reads trusted local configuration, is not an HTTP route, and no Prisma config file accepting remote input exists here. Router links/navigation targets are fixed local paths; no SSR hydration is used. Linting consumes trusted local source paths. Do not deploy this local phase or treat lower reachability as a vulnerability fix.

Future release work still needs reviewed dependency upgrades, privileged staff/recovery procedures, session maintenance, least-privilege database roles, verified TLS, production rate limiting, backup encryption/retention and rehearsed restore. Database superusers can bypass triggers; use a service role without schema-altering privilege for any future rollout.

References: [Node crypto documentation](https://nodejs.org/api/crypto.html), [Vitest migration guide](https://vitest.dev/guide/migration/). No production security certification is claimed.

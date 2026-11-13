# StockFlow deployment readiness

Updated: 11 November 2026 (Europe/London).

Stock receiving now has a second additive purchasing migration for automatic
internal receipt numbers and separate optional supplier documents. It was backed up
and applied locally; all original rows/columns across 22 tables were preserved.
Current verification passes 179 API/PostgreSQL tests and 86 frontend tests; see
[receipt reference implementation](docs/STOCK_RECEIPT_REFERENCES.md). No deployment
or production database connection was made.

**Status: production code configuration is implemented and locally verified; deployment remains gated on actual host configuration, security-advisory review and hosted acceptance checks. No application deployment has been performed.**

This document supersedes the initial readiness audit. The later purchasing implementation adds one additive migration and supplier settlements; see [purchasing implementation and demo readiness](docs/PURCHASING_IMPLEMENTATION.md). Its isolated PostgreSQL verification passed 175 API tests and 85 frontend tests. Following user approval, the existing development database was backed up and migrated; original records across 20 tables matched their prior snapshots. Local .env credentials and historical POS snapshots were preserved. Production database connections have not been made.

## Current Render and Vercel configuration (2026-11-13)

The frontend is https://stock-flow-te4b-gamma.vercel.app and the API upstream is
https://stockflow-l5ai.onrender.com. The Vercel API rewrite was published in
329afd0. A public GET through the frontend's /api/v1/health/ready returned HTTP 200,
database=connected, mode=bootstrap and applicationReady=false. This verifies
forwarding and infrastructure readiness, not hosted login or business workflows.

This revision supports **PROXY_MODE=none**: Express trusts no
forwarded addresses and discards forwarded IP, protocol and host claims from
untrusted peers. Secure cookies are forced by production configuration, independent
of forwarded protocol. Exact HTTPS Origin validation and session CSRF remain
required. No database or financial changes are needed for this mode.

This is suitable for a small controlled demonstration with a limitation: authentication
and staff-access rate limits use the socket address. People sharing a Render ingress
address can share a bucket (10 failed authentication attempts per 15 minutes; 20
staff-access requests per 15 minutes). Limits are process-local and reset on restart.
Independent client limits and multiple-instance operation remain release gates.
Do not raise limits or trust guessed headers to work around shared buckets.

After reviewing and publishing **only the proxy configuration changes**:

1. Deploy that API revision while retaining bootstrap mode first. Check its build
   succeeds. Do not publish unrelated pending purchasing migrations implicitly.
2. In Render, retain the existing DATABASE_URL secret. Set these entries together:
   NODE_ENV=production, DEPLOYMENT_MODE=app, PROXY_MODE=none,
   WEB_ORIGIN=https://stock-flow-te4b-gamma.vercel.app, SESSION_HOURS=8,
   IMAGE_STORAGE=disabled and NODE_VERSION=22. See [.env.render.example](.env.render.example).
3. Remove TRUSTED_PROXY_CIDRS, UPLOAD_DIR and stale WEB_ORIGINS. If WEB_ORIGINS is
   needed, it must include exactly the canonical frontend origin and only other
   explicitly approved HTTPS origins. Do not use localhost or preview wildcards.
4. Keep Render's repository root blank, existing build/start commands and DATABASE_URL.
   Render supplies PORT. On Free, the existing start command remains
   `npm run db:deploy && node apps/api/dist/src/index.js`; migrations must be reviewed
   before publishing a revision because startup applies pending migrations.
5. On Vercel use root apps/web, VITE_API_URL=/api/v1, install command
   `cd ../.. && npm ci --include=dev`, build command
   `cd ../.. && npm run build --workspace apps/web`, output dist. The API rewrite
   already points to the Render service and precedes the SPA fallback.
6. After authorized activation, verify /api/v1/health/ready through Vercel no longer
   reports bootstrap. Register fictional data, check Secure/HttpOnly/Strict cookies,
   refresh, log out, and check rejected Origin/CSRF requests and deep-link refresh.
   Hosted session forwarding remains unverified until these checks pass.

PROXY_MODE=cidr remains available only with verified TRUSTED_PROXY_CIDRS; the prior
CIDR policy remains the default requirement when production mode is not explicitly
set to none. Setting none with nonempty CIDRs fails validation. Do not copy Render
outbound addresses or inbound access restrictions into this variable.

Application activation is a separate operator step. The older sections below
record the original CIDR deployment policy and historical verification. Where they
require CIDRs universally, this explicit no-trust mode supersedes that requirement.

Proxy-change verification in the development workspace (including unpublished
purchasing code): 106 API tests and 86 frontend tests passed.
The 76 PostgreSQL integration tests were intentionally skipped by clearing
TEST_DATABASE_URL for this run; no local or hosted database was changed. Lint,
repository formatting, document formatting, API and frontend TypeScript checks,
both production builds and isolated Prisma generation passed. Vite emitted
nonfatal existing environment/annotation warnings. Normal in-place Prisma generation encountered
the existing Windows engine DLL lock from the running prototype; generating into
an ignored separate directory succeeded without stopping the prototype. The
dependency lockfile is unchanged. Hosted login, cookies and rate-limit usability
still require the acceptance checks after authorized publication and activation.

## Deploying the backend before the frontend

Backend-first infrastructure deployment is supported with DEPLOYMENT_MODE=bootstrap. This mode exposes only /api/v1/health and /api/v1/health/ready. All login, registration and business requests return 503 BOOTSTRAP_MODE, no credentialed CORS is enabled, and forwarded headers are not trusted. Health responses explicitly contain mode=bootstrap and applicationReady=false. A successful readiness check confirms infrastructure only, not an enabled retail application.

Use these Render variables for the first backend deployment:

| Variable        | Value                                                                        |
| --------------- | ---------------------------------------------------------------------------- |
| DATABASE_URL    | The new Render database's Internal Database URL, entered privately in Render |
| NODE_ENV        | production                                                                   |
| DEPLOYMENT_MODE | bootstrap                                                                    |
| NODE_VERSION    | 22                                                                           |
| IMAGE_STORAGE   | disabled                                                                     |
| SESSION_HOURS   | 8                                                                            |

Remove WEB_ORIGIN, WEB_ORIGINS, TRUSTED_PROXY_CIDRS and UPLOAD_DIR from this initial service configuration. Do not substitute localhost, guessed networks or empty origin fields. Render supplies PORT; a manual PORT entry is unnecessary.

Keep Root Directory blank. Build with: npm ci --include=dev && npm run build:production --workspace apps/api.

On a Free single-instance demo service, which has no pre-deploy command, use Start Command: npm run db:deploy && node apps/api/dist/src/index.js. This applies pending migrations to the configured Render database before the server starts; if migration fails the server does not start. It must never be executed against the local application database as part of these instructions. On a paid service, use the separate pre-deploy command and Node start command below. See [Render pre-deploy availability](https://render.com/docs/deploys).

After deployment, open /api/v1/health/ready at the actual Render service URL. Expect ready, database=connected, mode=bootstrap and applicationReady=false. Retain the public backend URL for the Vercel API rewrite. Configure the frontend and verified proxy settings before changing DEPLOYMENT_MODE to app. Full application mode still requires the exact frontend HTTPS origin and explicit trusted proxy boundaries; bootstrap does not bypass or weaken those requirements.

## Resolved code blockers

| Initial blocker                           | Implemented resolution                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production mode rejected                  | NODE_ENV accepts production. Full application mode requires an explicit canonical public HTTPS frontend origin and trusted proxy IP/CIDR configuration. Bootstrap permits health-only backend setup without these values.                                                                                                        |
| Public frontend origins rejected          | Development/test retain loopback-only origins. Production permits only explicitly configured exact HTTPS origins. Malformed URLs, paths, credentials, wildcards, IP/local frontend hosts and mixed local/production allowlists are rejected. An explicit allowlist must include its primary origin.                              |
| Loopback-only API listener                | Production binds 0.0.0.0 using PORT; local development/test keep 127.0.0.1. Startup logs do not print connection credentials.                                                                                                                                                                                                    |
| Unconfigured proxy trust                  | TRUSTED_PROXY_CIDRS accepts explicit IPs/CIDRs, not booleans, hop counts, named aliases, wildcards or /0. Express walks the forwarded chain only through configured trusted addresses. Local default trusts none. Forwarded Host and RFC Forwarded headers are discarded; ambiguous forwarded protocols are discarded.           |
| Cross-site provider-domain authentication | Browser production requests are fixed to /api/v1. apps/web/vercel.json forwards /api paths to Render before the SPA fallback. Secure, HttpOnly, host-only, SameSite=Strict cookies and Origin + CSRF checks are preserved.                                                                                                       |
| Missing SPA routing                       | The second Vercel rewrite maps deep links to /index.html. Tests check the API-first contract, path-prefix preservation and rejection of malformed upstreams.                                                                                                                                                                     |
| Ephemeral production images               | Production defaults to disabled images, with explicit HTTP 503 errors for attempted image operations. Local mode is prohibited in production. Persistent mode requires an absolute upload directory, a provisioned marker and read/write access, checked for readiness and image requests. No temporary-storage fallback exists. |
| Implicit build/start process              | API now has build:production (explicit Prisma generation then TypeScript build) and start (compiled Node) scripts. Existing migrate-deploy workflow remains intact.                                                                                                                                                              |

Implementation locations: apps/api/src/config/{env,origins,proxy,storage}.ts, apps/api/src/index.ts, apps/api/src/app.ts, apps/api/src/modules/images.ts, apps/web/{hosting.ts,vite.config.ts,vercel.json}, and apps/web/src/api.ts. Database-backed authorization, financial arithmetic, sales/idempotency, stock deduction and existing migrations were preserved.

## Remaining release gates

1. **Set the actual Render upstream.** vercel.json deliberately contains https://stockflow-api-not-configured.invalid/api/:path*. It is a reserved, nonworking address, not an assumed service owned by someone else. Replace only that hostname with the reviewed Render service hostname. A Vercel-hosted build (VERCEL=1) fails before bundling while the placeholder remains. Ordinary local builds remain available. No provider services were created to obtain a hostname.
2. **Verify actual proxy boundaries.** Populate TRUSTED_PROXY_CIDRS with the real, narrowly scoped ingress networks for the chosen Render/Vercel path. No trusted network can be safely guessed before the target exists. Verify both direct Render and Vercel-forwarded paths, provider sanitization of forwarded headers, client IP selection and independent rate limits. Do not copy test CIDRs, trust all private networks, use trust proxy=true, or trust the leftmost X-Forwarded-For value indiscriminately.
3. **Choose image availability.** Keep IMAGE_STORAGE=disabled until a persistent disk is mounted and initialized. This permits the rest of the demo with explicit upload errors. If image upload is part of the client demonstration, durable storage is a launch requirement. No external object-storage integration was introduced or enabled.
4. **Review dependency advisories.** Remaining findings and the compatible-fix assessment are documented below. No major Prisma or React Router upgrade was introduced. A proposed deepmerge override was tested for resolution, did not take effect in the installed tree, and was removed; it is not represented as a security fix.
5. **Verify GitHub and clean Linux builds.** The local repository now targets https://github.com/BabouMuhammed/stockFlow.git on main. The target was empty at publication preflight; staged files were checked for local database secrets, credential patterns and private/generated paths. Review subsequent changes and history before future pushes. A clean Linux install and hosted PostgreSQL migration rehearsal remain outstanding.
6. **Complete hosted HTTPS acceptance checks.** Local protocol tests do not prove provider forwarding, browser cookie persistence, database TLS, backups, disk durability or provider IP headers. These must be checked on the subsequently authorized deployment.

## Authentication and proxy design

The browser should use a single canonical frontend HTTPS origin:

```text
Browser https://<frontend-host>/api/v1/...
  -> Vercel external rewrite
  -> https://<render-service>.onrender.com/api/v1/...
```

Use WEB_ORIGIN for that exact frontend origin and, if provided, WEB_ORIGINS for the approved exact frontend origins including the primary. Do not add arbitrary Vercel preview domains or a wildcard. Requests from unauthorized origins cannot pass authenticated CSRF or login/registration Origin checks.

The rewrite must preserve the browser Origin, Cookie, X-CSRF-Token and response Set-Cookie. The cookie has no Domain attribute, so through the proxy it belongs to the frontend host, scoped to /api/v1. Production forces Secure even though Render terminates TLS before Express. HttpOnly and SameSite=Strict remain unchanged. Token hashes remain stored in PostgreSQL; no JWT or session-signing secret was added. Registration and login require approved Origin plus JSON; protected mutations additionally require the existing session CSRF token.

The application does not use forwarded Host for identity or allowed-origin decisions. Proxy trust is configured before authentication rate limiters. Requests from an untrusted socket cannot affect req.ip or req.secure through forwarded headers. When the socket is trusted, address selection stops at the first untrusted address while walking from the nearest proxy toward the client. This prevents attacker-supplied leftmost addresses from overriding a real untrusted client address. Actual provider behavior still needs verification. [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

Direct frontend requests to an unrelated onrender.com domain are not the selected architecture: Strict cookies would be cross-site there. Do not change to SameSite=None or remove CSRF to make that path work. Same-origin external rewrites avoid relying on third-party-cookie exceptions. [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [MDN cookie guidance](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies).

## Exact Render settings

Source root is apps/api, but the Render service Root Directory must remain blank (repository root) so the root lockfile and workspaces are available.

| Setting                 | Value                                                                       |
| ----------------------- | --------------------------------------------------------------------------- |
| Service                 | Node Web Service                                                            |
| Repository/branch       | Intended reviewed StockFlow GitHub repository/branch; not yet verified      |
| Root Directory          | Blank: repository root                                                      |
| Build Command           | npm ci --include=dev && npm run build:production --workspace apps/api       |
| Pre-Deploy Command      | npm run db:deploy                                                           |
| Start Command           | node apps/api/dist/src/index.js                                             |
| Health Check Path       | /api/v1/health/ready                                                        |
| Runtime listener        | 0.0.0.0 and provider PORT                                                   |
| Node                    | Supported Node 22 LTS, at least 22.12, consistently selected for both hosts |
| Region                  | Same region as Render PostgreSQL                                            |
| Instances               | One initially; shared limiter/storage review before adding replicas         |
| Auto-deploy             | Off until controlled release checks are established                         |
| Image storage initially | IMAGE_STORAGE=disabled; no UPLOAD_DIR                                       |

The explicit production build generates Prisma Client on the host before compilation. Never upload a generated Windows engine to Linux. Retain dev dependencies through build and pre-deploy because Prisma CLI, tsx and TypeScript are development dependencies. Runtime uses compiled JavaScript, not tsx watch or Vite. The compiled entry point is apps/api/dist/src/index.js, not apps/api/dist/index.js.

Use a Render plan supporting pre-deploy commands; a persistent disk also requires an appropriate paid service. Render requires a 0.0.0.0 listener and supports database migration commands in the pre-deploy stage. [Render web services](https://render.com/docs/web-services), [Render deployment lifecycle](https://render.com/docs/deploys).

Account for scrypt memory use and Prisma/Node overhead. One gigabyte is a reasonable starting capacity assumption for load testing, not a measured minimum. Existing authentication limiters are process-local, reset on restart and are not a complete registration-abuse defense. Protect a private client demo with an appropriate access policy; CORS is not an anti-bot mechanism.

### Render PostgreSQL

Use a new demonstration database in the same region. Inject its internal connection URL through DATABASE_URL in Render's secret store. Do not upload the existing local database automatically. Restrict external access, preserve required provider connection/TLS options, and do not disable certificate verification as a workaround. Actual connection, pool sizing, TLS and backup/restoration behavior remain unverified. [Render PostgreSQL](https://render.com/docs/postgresql-creating-connecting).

### Optional persistent images

The existing filesystem adapter can use a Render persistent disk; an external provider is not required for this single-instance demo. When ready:

1. Mount the disk at /var/data/stockflow.
2. In an authorized runtime shell with the disk mounted, create /var/data/stockflow/uploads on that disk and ensure the application can read and write it.
3. Create /var/data/stockflow/uploads/.stockflow-storage with the exact text stockflow-persistent-v1 (a trailing newline is allowed).
4. Set IMAGE_STORAGE=persistent and UPLOAD_DIR=/var/data/stockflow/uploads.
5. Restart and require /api/v1/health/ready to succeed before allowing traffic. Missing marker, unreadable marker or missing/unwritable directory keeps readiness at 503. Each image request also checks the storage guard.
6. Upload and view a fictional product image, restart/redeploy, and verify it remains. Back up both the database image keys and disk contents.

The application never provisions this marker itself and does not create an absent configured upload root as a fallback. The marker and access checks are safeguards against a missing/uninitialized mount; they cannot independently prove that an operator selected a durable filesystem. Verify the actual mount and retention. Do not place the marker in an ephemeral directory merely to satisfy readiness.

Disabled storage returns IMAGE_STORAGE_DISABLED; unavailable persistent storage returns IMAGE_STORAGE_UNAVAILABLE. Uploads are rejected explicitly, without claiming success or rewriting product image keys. Existing local files are not moved or deleted. Existing product image reads remain authenticated and tenant-scoped. External object storage is not configured or enabled. [Render disk constraints](https://render.com/docs/disks).

## Exact Vercel settings

| Setting                                     | Value                                          |
| ------------------------------------------- | ---------------------------------------------- |
| Framework                                   | Vite                                           |
| Root Directory                              | apps/web                                       |
| Include source files outside Root Directory | Enabled for shared and root workspace files    |
| Install Command                             | cd ../.. && npm ci --include=dev               |
| Build Command                               | cd ../.. && npm run build --workspace apps/web |
| Output Directory                            | dist, relative to apps/web                     |
| Node                                        | Same supported Node LTS major as Render        |
| Frontend public build variable              | VITE_API_URL=/api/v1                           |
| Rewrites file                               | apps/web/vercel.json                           |

Replace the placeholder hostname before authorizing a hosted build. The committed routing order is:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://<actual-render-service>.onrender.com/api/:path*"
    },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

This example illustrates the required final target; the committed placeholder is intentionally nonworking. Keep the API prefix on both sides and the API rule before the SPA fallback. Vite validates this contract during builds and refuses an absolute or other VITE_API_URL for production. The compiled browser API base is /api/v1 regardless of development endpoint overrides. Vite's localhost proxy is used only by its development server.

Deep links such as /dashboard, /pos and /sales use the SPA fallback. API errors should remain backend JSON responses, not index.html. Local tests validate configuration ordering and target shape; actual Vercel CDN forwarding and static-asset/deep-link behavior remain hosted checks. [Vercel Vite SPA setup](https://vercel.com/docs/frameworks/frontend/vite), [monorepo external sources](https://vercel.com/docs/monorepos/monorepo-faq).

Do not connect arbitrary preview deployments to demonstration data. Use one stable frontend origin or isolated preview backends. Changing Vite public variables requires a rebuild. Never put database credentials or other secrets in VITE_ variables.

## Environment names and policy

DEPLOYMENT_MODE defaults to app. Use bootstrap only for production infrastructure setup; it disables all authentication and business APIs until frontend/proxy configuration is complete.

No secret values are provided here. Domain names and network examples in tests are not provisioned hosting resources.

| Name                  | Scope and requirement                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DATABASE_URL          | Required API secret: target Render PostgreSQL URL, provided only through its host secret store.                                                                                   |
| NODE_ENV              | Set production on Render. Development/test keep local behavior.                                                                                                                   |
| WEB_ORIGIN            | Required in production app mode: exact canonical frontend HTTPS origin. Omit during bootstrap.                                                                                    |
| WEB_ORIGINS           | Optional comma-separated explicit allowlist; if present it must include WEB_ORIGIN. Only public HTTPS origins in production. No implicit localhost pair in production.            |
| TRUSTED_PROXY_CIDRS   | Required in production app mode: verified ingress IPs/CIDRs. Omit during bootstrap; empty by default locally. Rejects /0, wildcard, named aliases and numeric hop-count policies. |
| PORT                  | Render-provided API runtime port; respected by the server. Local default 5000.                                                                                                    |
| SESSION_HOURS         | Optional API lifetime, range 1-24, default 8.                                                                                                                                     |
| IMAGE_STORAGE         | Optional API setting: disabled by default in production; local by default in development/test. Production supports disabled or persistent only.                                   |
| UPLOAD_DIR            | Absolute path, required only with IMAGE_STORAGE=persistent. Omit it completely with disabled/local storage; an empty value is invalid.                                            |
| NODE_VERSION          | Render hosting setting selecting the agreed supported Node version.                                                                                                               |
| VITE_API_URL          | Public frontend build variable: /api/v1.                                                                                                                                          |
| ALLOW_DEMO_SEED       | Leave false/unset in production. Existing seed remains intentionally loopback-only and rejects production.                                                                        |
| ALLOW_OWNER_BOOTSTRAP | Leave false/unset in production. Existing interactive owner bootstrap remains local-only.                                                                                         |
| TEST_DATABASE_URL     | Test-only; absent from hosted runtime. Never target customer/demo application data with the test suite.                                                                           |

No COOKIE_SAMESITE, JWT secret, signing secret, TRUST_PROXY hop count or DIRECT_URL option is wired in. Use only implemented variables. Configuration failures list invalid variable names without serializing secret input values.

.env.example documents new nonsecret settings; the actual local .env was left intact. Root .env loading preserves supplied process variables. .gitignore excludes .env files except .env.example, .local, generated builds, node_modules and logs. That does not prove old commits never contained secrets; repository/history verification is still required.

## Dependency security review

The completed production-dependency scan reports 5 affected package entries: 3 high and 2 moderate, with no critical findings. A complete scan including development tools reports 12 entries: 3 high and 9 moderate. These counts include transitive effects, not that many distinct proven application vulnerabilities. No npm audit fix --force or major Prisma/React Router upgrade was used.

| Finding                                                              | Assessment and remaining action                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deepmerge-ts -> @prisma/config -> prisma, high                       | Prisma 6.19.3 pins deepmerge-ts 7.1.5. The fix is in deepmerge-ts 8, with documented behavior changes. Only the Prisma configuration/tooling dependency path was found, not a StockFlow request handler. No compatible Prisma 6 update was available in the queried metadata. A proposed override was not retained because its resolution was not verified. Review an upstream supported fix or a separately tested override before acceptance. |
| react-router and react-router-dom, moderate                          | Installed 6.30.6. The reported patched line is React Router 7.18+, requiring a major upgrade. StockFlow uses client BrowserRouter/createRoot, not SSR hydration. The SSR advisory is therefore not demonstrated as applicable; the open-redirect advisory still requires navigation-input review. Do not assume lack of SSR resolves all findings.                                                                                              |
| minimatch through TypeScript ESLint, moderate development-tool chain | The complete scan flags glob amplification and its transitive tooling effects. The queried latest TypeScript ESLint 8.72.2 remains in the advisory range; no verified compatible fix was available. This is a build-tool exposure, not the deployed retail request path. Track a supported patch and restrict builds to reviewed source.                                                                                                        |

proxy-addr 2.0.8 and its types were added explicitly for CIDR trust. Existing installed Prisma and React Router major versions are preserved. Do not treat an ignored override or a clean subset scan as a verified fix. Rerun advisories on the exact final lockfile before release and record a reviewed decision on unresolved findings.

References: [deepmerge advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), [Prisma upstream discussion](https://github.com/prisma/orm/issues/30052), [deepmerge behavior changes](https://raw.githubusercontent.com/RebeccaStevens/deepmerge-ts/main/CHANGELOG.md), [Router redirect advisory](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [Router hydration advisory](https://github.com/advisories/GHSA-337j-9hxr-rhxg), [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

## Earlier deployment-only verification results

The results in this section describe deployment-configuration work before the purchasing implementation. Current purchasing verification (175 PostgreSQL/API tests, 85 frontend tests, migration preservation and browser walkthrough) is recorded in [the implementation report](docs/PURCHASING_IMPLEMENTATION.md).

| Check                                                                      | Result                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API non-database tests                                                     | 87 passed, including 33 production security/storage cases and 10 backend-first bootstrap cases.                                                                                        |
| PostgreSQL integration tests                                               | 57 skipped across 6 files, because they migrate/write database records.                                                                                                                |
| Frontend tests                                                             | 79 passed, including 7 deployment-routing cases.                                                                                                                                       |
| Total                                                                      | 166 passed; 57 skipped.                                                                                                                                                                |
| Lint and formatting                                                        | Passed.                                                                                                                                                                                |
| TypeScript and production builds                                           | API compiler and frontend compiler/Vite passed.                                                                                                                                        |
| Prisma schema validation                                                   | Passed without a database connection.                                                                                                                                                  |
| Isolated Prisma generation                                                 | Passed into an ignored audit directory; installed engine was not replaced.                                                                                                             |
| Compiled production API entry                                              | Passed locally with supplied PORT, production public binding and database-free liveness. Only a dummy nonworking database URL was supplied; no readiness query/database call was made. |
| Hosted-build guard                                                         | Verified locally: VERCEL=1 rejects the unconfigured upstream before bundling. This expected rejection is not an ordinary local-build failure.                                          |
| Vercel routing                                                             | API-first rule/prefix and SPA fallback contract verified; real CDN behavior not exercised.                                                                                             |
| Cloud DB/migrations/TLS, disk redeploy persistence and real hosted cookies | Not exercised.                                                                                                                                                                         |

Authentication protocol tests use an in-memory Prisma-shaped double, not PostgreSQL, to verify approved-origin registration/login, Secure/HttpOnly/Strict cookie attributes, session restoration, Origin/CSRF rejection and logout revocation. Proxy tests verify ignored untrusted headers, chain termination at the first untrusted address and rejection of ambiguous protocols. Storage tests use a temporary test directory, never production uploads or a database. No financial implementation was changed; existing financial tests still pass.

Normal generation into the installed Windows Prisma engine directory remains subject to the loaded-DLL EPERM constraint seen in the audit. Isolated generation and schema validation pass. The Render build must generate its own Linux client; a clean Linux build is not yet proven. Existing Zod Rollup annotation and future Prisma package.json configuration deprecation warnings remain nonfatal.

## Future deployment procedure (not executed)

1. Review this implementation, unresolved advisories and the actual intended repository. Scan tracked files and history for secrets, verify branch/ownership, and record a release commit. Do not commit .env, .local or generated clients. Publishing source code does not authorize an application deployment.
2. Run a clean Linux npm ci/build and the unit/frontend checks. The local isolated PostgreSQL migration rehearsal and historical preservation test pass; a target-version/Linux rehearsal and production backup/restore validation remain outstanding. This is not permission to use the existing local application database.
3. Only after separate deployment authorization, create/select the Render demonstration database and API service and the Vercel project. Select supported Node versions, same-region DB/API, backup retention and a stable frontend origin. Do not use real client data.
4. Obtain the actual Render hostname and trusted ingress network information. Replace the reserved rewrite upstream; configure exact frontend origins and verified TRUSTED_PROXY_CIDRS. Test direct/proxied header chains using controlled diagnostics, not a permanently public debug endpoint.
5. Keep images disabled, or provision the persistent disk/root/marker before enabling persistent mode. Do not create a marker during build/pre-deploy: those stages do not have access to the mounted runtime disk.
6. Add only implemented environment names to the relevant host. Store DATABASE_URL as an API secret, never a frontend public variable. Do not copy the local .env to either host.
7. On Render, run the configured build with explicit Prisma generation. In pre-deploy run npm run db:deploy, which executes prisma migrate deploy. Do not use db push, migrate dev, migrate reset or cloud seeding as substitutes. Check migration status and readiness before moving on.
8. Build Vercel with the configured upstream and /api/v1 browser base. Require the API and frontend artifacts to be compatible and verify assets, deep links and backend JSON errors.
9. In the authorized hosted environment, register a fictional business through normal registration, create fictional products/staff/opening stock and execute the acceptance checklist below. Existing local products, users, stock and images do not transfer automatically. Do not bypass local bootstrap/seed restrictions.
10. Record successful checks, deployed versions, operator and rollback identifiers before sharing the client link. Disable automatic deployment until release checks are established.

Six original PostgreSQL migrations remain unchanged: init, phase1_foundation, phase2a_bigint, retail_operations, actor_constraints and product_sku_counter. The additive `20261111000000_supplier_purchasing` migration adds receipt metadata and an immutable supplier settlement ledger without inventing historical payments. Its isolated migration-preservation test passes. Preserve all applied checksums and immutable ledger/payment/sale triggers. Production applies the full chain with migrate deploy only, after authorization and backup verification. A pre-deploy migration can affect the database even if the later application deploy fails; maintain schema compatibility with the previous API.

## Hosted acceptance checklist

- [ ] Real trusted proxy CIDRs are reviewed; untrusted/spoofed forwarded IP, Host and Proto cannot bypass controls. Different clients have independent limiter identities through direct and Vercel paths.
- [ ] API liveness/readiness succeeds and missing DB/migration/storage dependencies produce safe failures without secret logs.
- [ ] Vercel API requests preserve Origin, Cookie, CSRF and Set-Cookie; invalid API paths return JSON rather than the SPA. Deep-link refresh and hashed static assets work.
- [ ] Registration/login/logout, refresh and revocation work over HTTPS. Cookies are Secure, HttpOnly, SameSite=Strict, Path=/api/v1, host-only. Verify Edge/Chrome and Firefox/Safari with third-party cookies blocked.
- [ ] Unauthorized origins, missing/wrong CSRF, unauthenticated access and cross-tenant/role access fail as intended. Unapproved preview URLs cannot access demo sessions/data.
- [ ] Exact cash D4750 with no amount records D4750 received and zero change. D5000 yields D250 change; D4700 is rejected. D390.50/D400 yields D9.50 change. Fractional rounding, duplicate retries and stock-failure rollback remain correct.
- [ ] Unverified external payments remain rejected, and sale/payment/stock totals remain consistent after refresh/restart.
- [ ] Disabled images explicitly fail; when enabled, authenticated tenant image uploads survive restart/redeploy on the mounted disk. No unrelated local files were copied.
- [ ] Actual database TLS/access restrictions, backups and a database-plus-images restoration rehearsal are verified.
- [ ] Registration access/abuse policy, rate limiter capacity, memory and security-advisory decisions are documented before sharing the client URL.
- [ ] Review frontend security headers/CSP, public illustrative preview routes and LOCAL WORKSPACE labels so presentation does not overstate live functionality.

## Rollback

Record the previous API/frontend artifacts, environment settings, migration state, database backup and image snapshot before release. Roll application builds back only when the deployed schema remains compatible. A provider application rollback does not reverse a database migration or restore images.

Prefer forward corrections for failed migrations. Do not edit already-applied migration files, disable financial immutability triggers, truncate records or reset a database to make old code run. Restore backups into a separate database for validation and reconcile any legitimate sales before a deliberate cutover. Database image keys and stored files must remain consistent.

Preserve idempotency keys when retrying uncertain checkouts across restarts. Revert frontend/API routing together if needed; expect a sign-in after incompatible session/origin changes. Rotate genuinely compromised secrets rather than relying on code rollback.

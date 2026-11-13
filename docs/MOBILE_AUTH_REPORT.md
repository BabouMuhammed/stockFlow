# StockFlow mobile, authentication and UI report

13 November 2026. Branch: `feature/mobile-auth-ui`, based on `d830058`.

## Scope and audit

The [pre-implementation audit](MOBILE_AUTH_AUDIT.md) records the source inspection
before edits. This is an improvement of the existing interface, not a rebuild.
Its initial findings were code-based; browser measurements below verify the result.

| Finding                                                                                        | Resolution                                                                                                              |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Two-column auth pages remained narrow on tablets; registration had a separate visual structure | Shared account layout, single column through 900px, matching labels and buttons                                         |
| No password visibility; confirmation errors came only from the server                          | Shared accessible Show/Hide control, frontend length/confirmation validation, associated inline errors                  |
| Helper text polluted the accessible Business ID label during implementation                    | Separate labels and descriptions; login regression tests passed after correction                                        |
| Dense two-column phone KPIs and small form controls                                            | Single-column KPIs at 480px, wrapping financial values, 16px mobile inputs and larger targets                           |
| Date filters squeezed selected text on narrow phones                                           | Stack date-filter fields at 480px                                                                                       |
| Sidebar opened without isolating background or containing keyboard focus                       | Mobile dialog semantics, focus containment/restoration, Escape and in-drawer close controls, close after link selection |
| Tables needed keyboard access while preserving all columns                                     | Focusable, labelled record-table scroll regions; existing product-table region retained                                 |
| Mobile cart shortcut remained over checkout after its anchor was selected                      | Target the containing POS shell rather than expecting the live shortcut inside the cart grid                            |
| Authentication used three product photographs and illustrative navigation                      | Local inventory preview, clearly fictional data; removed auth demo links and photo captions/credits                     |

Native modal dialogs and their scrolling remain intact. Actions wrap at narrow
widths, title text wraps, and modal/side navigation sizing uses dynamic viewport
units. No global horizontal-overflow hiding was introduced. Desktop navigation and
authorized routes remain available. The inaccurate live `LOCAL WORKSPACE` chip was
removed; the existing explicitly labelled preview routes remain accessible by URL.

## Authentication policy and safeguards

The backend already allowed passphrases: **12–128 UTF-16 code units**, spaces and
Unicode, with no uppercase, lowercase, number or symbol requirements. That policy,
scrypt v1 hashing and verification are unchanged. Login still accepts existing
passwords of 1–128 code units; nobody is forced to reset their password.

Forms now say: **Use at least 12 characters. A memorable phrase works well.**
Registration validates length and confirmation before sending requests, without
trimming or normalizing passwords. Existing backend checks remain authoritative.
Staff and account-password forms reuse the visibility control, guidance, native
length constraints and appropriate password-manager autocomplete attributes.
No password-reset workflow exists or was added.

The optional Business ID is retained for legacy accounts sharing an email. Secure,
HttpOnly, Strict session cookies, token hashing, CSRF, Origin validation, login rate
limiting, authorization and business isolation were not modified. Backend changes
in this branch are tests only. There are no schema/migration, financial, stock,
purchasing, Vercel rewrite, Render setting or production-variable changes.

No compromised-password lookup was introduced. A dependable privacy-preserving
provider/corpus and fallback policy remain a separate security decision. Existing
users, pasted passwords and password managers continue to work without a new
external registration dependency.

## Interface changes

Login and registration retain StockFlow's green/white palette, existing self-hosted
Inter font, brand mark and account routes. The primary login button is `Sign In`;
the full-width outlined action is `New business? Register here`. Forms retain input
on errors, expose pending states and synchronously guard rapid duplicate submits.
Registration still enters the workspace only after a successful backend response.
A frontend-only cache flag displays its creation confirmation and clears on session
reload or sign-in; it is never used for authorization or sent as a credential.

The right panel says `A clearer view of your everyday business.` with the requested
supporting description. The inventory preview uses React/CSS and a simple inline
chart; its data is explicitly illustrative. It adds no external image requests or
animation dependency and is hidden on mobile/tablet. Product photographs used in
the actual catalogue remain untouched.

## Verification

| Check                                    | Result                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend automated tests                 | Final full run: **102 passed**, five files, no skips, including duplicate-submit and navigation link-close coverage.                                                                                                                                                                           |
| API/PostgreSQL regression and auth tests | 188 passed in the full run; the two historical migration tests timed out at 60 seconds while browser/build work ran concurrently. Both passed on a focused rerun without that workload, with their assertions and timeouts unchanged. 190 distinct cases verified; no skips.                   |
| New authentication coverage              | 12-character lowercase passphrases, spaces without alteration, Unicode, 64/128 lengths, short/overlong rejection before writes, visibility, paste event, confirmation, duplicate submit and retained form errors                                                                               |
| Existing authentication safeguards       | Existing cookie, CSRF, unauthorized-origin, session, rate-limit, tenant and financial tests retained and passed                                                                                                                                                                                |
| Browser matrix                           | 320, 375, 390, 430, 768, 1024 and 1440px; 127 initial page/form/receipt width measurements, no page overflow or dialog-width failures, no runtime exceptions                                                                                                                                   |
| Confirmation and checkout                | Rechecked page/form widths; fixed the discovered cart shortcut selector, then verified hidden shortcut after cart jump, accessible confirmation, a D661.25/D700 sale with D38.75 change, receipt at 375px and a 480px-high viewport, keyboard registration, logout/login and refreshed session |
| TypeScript and production builds         | API and frontend compilation and Vite production build passed; only existing nonfatal Zod annotation warnings                                                                                                                                                                                  |
| Lint and formatting                      | Lint passed. Windows checkout CRLF initially caused baseline formatting warnings; normalized this isolated checkout to the repository's LF text without staging unrelated source changes, then checked formatting again.                                                                       |
| Design detector                          | Only warnings about the existing Inter font; retained as required by the existing design system                                                                                                                                                                                                |

The [browser measurements](MOBILE_AUTH_BROWSER_RESULTS.json) distinguish the full
matrix from the targeted cart/receipt verification. Browser registration used
paste-style input with leading/trailing spaces and Enter-key submission. Mobile
navigation focus/Escape, supplier/product creation, stock receipt and expense entry
also ran against a fresh isolated loopback database. Existing local and hosted
business databases were not changed. No test records were added to production.

## Modified files

| File                                         | Purpose                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/App.tsx`                       | Remove illustrative navigation; display backend-confirmed registration success                                               |
| `apps/web/src/pages/Login.tsx`               | Focused login actions, labels, guidance and guarded submission                                                               |
| `apps/web/src/pages/Register.tsx`            | Matching layout, schema validation, confirmation and retained input                                                          |
| `apps/web/src/pages/PreviewLogin.tsx`        | Keep preview behavior but reuse account design and remove photos/demo link                                                   |
| `apps/web/src/components/AuthLayout.tsx`     | Shared branding and fictional inventory illustration                                                                         |
| `apps/web/src/components/PasswordField.tsx`  | Accessible visibility, descriptions, autocomplete and password guidance                                                      |
| `apps/web/src/components/WorkspaceShell.tsx` | Mobile drawer focus, background isolation, close controls and accurate live branding                                         |
| `apps/web/src/features/management.tsx`       | Reuse password fields for staff and account changes; expense logic unchanged                                                 |
| `apps/web/src/features/session.tsx`          | Set a frontend-only creation notice after successful registration; credentials, tokens, roles and backend sessions unchanged |
| `apps/web/src/features/workflows.tsx`        | Auth-only synchronous submit guard and keyboard-accessible record tables                                                     |
| `apps/web/src/styles.css`                    | Responsive account pages, values, fields, controls, tables, dialogs and cart shortcut selector                               |
| `apps/web/src/Auth.test.tsx`                 | Account, passphrase, error-retention, duplicate-submit and drawer regression coverage                                        |
| `apps/web/src/OperationalApp.test.tsx`       | Update expectations for the requested `Sign In` button label                                                                 |
| `apps/api/src/tests/production.test.ts`      | HTTP passphrase validation and verification of unaltered passwords                                                           |
| `docs/MOBILE_AUTH_AUDIT.md`                  | Audit before implementation                                                                                                  |
| `docs/MOBILE_AUTH_REPORT.md`                 | Changes, evidence, limits and publication handoff                                                                            |
| `docs/MOBILE_AUTH_BROWSER_RESULTS.json`      | Sanitized local browser metrics; no session tokens or credentials                                                            |

## Screenshots

All screenshots contain fictional QA or illustrative data. These seven files are
also part of the changes:

- [Desktop login](screenshots/mobile-auth/desktop-login.png)
- [Mobile login](screenshots/mobile-auth/mobile-login.png)
- [Desktop registration](screenshots/mobile-auth/desktop-register.png)
- [Mobile registration](screenshots/mobile-auth/mobile-register.png)
- [Mobile dashboard](screenshots/mobile-auth/mobile-dashboard.png)
- [Mobile inventory](screenshots/mobile-auth/mobile-inventory.png)
- [Mobile POS checkout](screenshots/mobile-auth/mobile-pos.png)

## Limits and publication

Testing used headless Edge/Chromium on Windows. Physical iOS/Android devices,
Safari/Firefox, real mobile keyboards and OS clipboard/password-manager integrations
were not exercised. The short-viewport check simulates reduced available height;
it is not a claim about every physical keyboard. Native horizontally scrolled tables
remain intentional. Inventory and profit estimation limitations from the purchasing
report remain unchanged.

The change is for the dedicated feature branch. Do not merge into the production
branch or change hosting variables until approval. No manual deployment was made.
Production authentication still expects its configured exact origin; this work does
not authorize arbitrary preview origins. After an approved merge, repeat login,
registration, refresh, logout and mobile checkout smoke tests on the canonical host.

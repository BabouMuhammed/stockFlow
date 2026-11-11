# StockFlow frontend UI redesign

Date: 9 November 2026. Scope: frontend presentation and navigation refinements only. The existing React, Vite, TypeScript, Tailwind and npm workspace architecture is retained. This is a local review build, not a new implementation phase.

## Review and implementation plan

Read one copy of the repeated redesign prompt and reviewed all active frontend components, routes, API client, session provider, forms, existing tests and stylesheet. Reviewed README, the Phase 1 report and the Phase 2A report to distinguish implemented catalogue/authentication from unfinished stock and transaction services.

Original problems:

- The wide labelled sidebar and oversized decorative welcome panel used space needed by retail operations.
- Products opened as cards rather than a management table. Details appeared in a central modal rather than a side panel.
- The POS lacked category tabs, persistent selection feedback, explicit line removal and a prominent order summary with photo thumbnails.
- Payment presentation, typography, controls and spacing differed between pages. Inter was named in CSS but was not bundled.
- The stylesheet contained several generations of overlapping rules and inconsistent green values.
- Dashboard quick links in the older gallery could leave the `/preview` namespace.

Plan followed: consolidate the design system and shared workspace layout; redesign the product workspace and POS around the supplied references; apply the same system to every existing route; retain API integrations and unavailable operations; verify rendered layouts and document the result.

## References reviewed

1. The attached furniture inventory dashboard on a laptop: slim icon navigation rail, compact page header, left filter panel, white product surfaces, small borders, product detail panel on the right and compact pagination. Its composition is adapted for retail. The explicit requirement for a table-first products page takes precedence over the reference's initial photo grid.
2. The attached restaurant POS: category tabs above a three-column photo catalogue, clear green prices, product selection actions and a prominent right-hand order/payment panel. Restaurant order types, ratings, favourites, fabricated discounts and unrelated food categories were not introduced.

Both references were compared with actual Edge screenshots after implementation. The result follows their layout patterns; it is not a pixel-identical reproduction of the photographed laptop or the restaurant interface.

## Design decisions

- White surfaces on `#F8FAFC`, `#111827` text, `#64748B` secondary text and `#E5E7EB` borders.
- Emerald `#16A34A` for accents and focus; approved dark green `#15803D` for primary buttons and green text to improve contrast with white. Warning and error tokens remain `#F59E0B` and `#DC2626`.
- Locally bundled variable Inter, preloaded by the document. Its SIL Open Font License is retained in `apps/web/public/fonts/OFL.txt`. No runtime font service or additional npm dependency is needed.
- Lucide inline SVG icons through a shared import boundary, consistent rounded controls and restrained shadows.
- An 84px desktop navigation rail with accessible link names and native title tooltips. Mobile navigation expands to a labelled panel; the closed panel is visually hidden and excluded from keyboard navigation by CSS visibility.
- Real product photos from the previous task are retained, with local files, source credits and representative-packaging disclosure. Unknown products use the existing honest photo placeholder.
- Native form controls, field validation, focus outlines, reduced-motion support, accessible tables and native modal dialogs are retained.

## Pages redesigned

| Page                  | Result                                                                                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard             | Compact operational introduction, catalogue/category summary cards, unavailable sales/stock indicators, honest empty sales chart, inventory overview, recent activity and quick access. Authenticated counts come from existing API endpoints; preview counts are labelled sample data. |
| Products              | Table-first workspace with left filters, search, creation action, photo thumbnails, SKU/barcode, role-appropriate cost, selling price, unavailable stock status, lifecycle badges, actions and pagination. Photo cards remain an optional view.                                         |
| Product details/forms | Right-side detail drawer; existing create/edit forms retain validation, exact monetary conversion and API mutations. Drawer becomes full width on small phones.                                                                                                                         |
| POS                   | Category tabs, catalogue search including SKU/barcode on the operational page, product photo cards, quantity-in-cart feedback, prominent sticky desktop cart, item thumbnails, quantity/removal actions, subtotal/total and cash/mobile-money presentation.                             |
| Mobile POS            | Responsive cart panel plus a fixed shortcut. The shortcut hides when the cart is targeted so it does not cover cart controls; a return-to-products link restores the product view.                                                                                                      |
| Inventory             | Operational page shows a stock table structure and unavailable state. The explicitly labelled gallery retains its sample stock table and filters.                                                                                                                                       |
| Stock receipts/counts | Professional table headers, disabled operation actions and explicit unavailable explanations.                                                                                                                                                                                           |
| Categories/suppliers  | Existing live CRUD tables/forms restyled with shared controls, search treatment and status badges.                                                                                                                                                                                      |
| Sales/reports/staff   | Existing authenticated routes retained with unavailable table layouts and disabled actions. The older staff gallery retains its illustrative role descriptions.                                                                                                                         |
| Settings              | Consistent read-only business details, form controls and disabled saving.                                                                                                                                                                                                               |
| Login                 | Consistent branding and Inter typography, clear form hierarchy, split desktop layout and representative product imagery. Preview sign-in remains explicitly separate from real authentication.                                                                                          |

## Component and file changes

- `components/WorkspaceShell.tsx`: shared sidebar, top navigation, page header, currency presentation and connection footer for authenticated and preview workspaces.
- `components/retail.tsx`: reusable category tabs, status badges, photo product cards, product drawer, summary cards, section headings, cart items and unavailable table states.
- `components/CartPanel.tsx`: shared order summary, payment presentation, subtotal/total, disabled checkout/printing and mobile cart access.
- `components/RetailDashboard.tsx`: shared dashboard composition with separate real-data and labelled-preview modes.
- `components/ui.tsx`: existing accessible native dialog extended with a drawer variant; existing notices and empty states retained.
- `components/icons.tsx`: Lucide SVG exports using the already installed dependency.
- `App.tsx`, `PreviewApp.tsx`, catalogue, POS, reference pages and both login pages: integrate the shared design components without replacing data services.
- `styles.css`: consolidated maintained stylesheet replacing the accumulated legacy overrides; shared native button, input, search and table styling across routes.
- `index.html`, `public/fonts/InterVariable.woff2`, `public/fonts/OFL.txt`: local Inter delivery and license.
- Existing test files: retained earlier coverage and added route, category-filter, cart-removal and preview-navigation regression checks. One product-opening selector now targets the exact product-name button because the table also offers an explicit details action.

## Functional behavior preserved

- No Prisma schema, migrations, database constraints, backend code or business records were changed. SHA-256 comparison of all 29 existing backend source/configuration files against the pre-redesign snapshot found no changes.
- The API client and session provider remain unchanged, including credentialed requests, CSRF, expiry handling and tenant/role cache isolation.
- Product, category and supplier CRUD still use their existing APIs. Cashier mutation controls and purchase costs remain restricted.
- Product pricing remains exact integer-minor-unit arithmetic; operational cart arithmetic still uses BigInt.
- Operational pages never fall back to demo fixtures after an API failure. The labelled gallery stays under `/preview/*`, including its dashboard quick links.
- Existing temporary cart limits and add/decrease behavior are preserved; explicit removal is a frontend cart action only. Category filtering uses the existing API's category IDs on operational POS pages.
- Checkout, payments, receipt printing, stock receipts/counts/adjustments, staff administration, report exports and settings writes remain disabled or unavailable. No success transaction, stock deduction, payment transfer, invented sale or financial chart was added.
- All previous routes, including not-found handling, remain present. No deployment, GitHub push, hosting connection or next-phase work occurred.

## Verification

- Frontend tests: **46 passed**, including all previous workflow coverage plus 17 added regression cases. Final test command: `npm --workspace apps/web test -- --maxWorkers=1 --testTimeout=15000`. An earlier parallel run encountered machine-contention timeouts; the controlled single-worker run passed without removing assertions.
- Browser: **44 route/viewport combinations passed** in headless Microsoft Edge, with zero page overflow, zero JavaScript runtime exceptions and zero business API requests from the public preview. This covers the 12 existing preview/not-found routes at 1440px and 390px, plus dashboard/products/inventory/POS at 1366, 1024, 768, 620 and 320px.
- Product drawers and optional card views were exercised; the POS screenshots contain three selected sample items. Checkout was confirmed disabled. Inter loaded locally.
- Desktop/mobile screenshots were opened and visually inspected. A genuine small-screen overflow caused by absolutely positioned screen-reader text outside the table scroll containing block was corrected. Desktop navigation visibility and cart row density were also corrected after inspecting renders.
- Authenticated route coverage and login/logout, exact form submissions, role controls, query errors/retries, category/supplier mutations and disabled checkout are verified by frontend tests using isolated mocked API responses, not by a new live database session. No backend/database services or accounts were created for this task.

Final checks passed:

- `npm run lint`: passed across the existing apps/shared sources.
- `npm run format:check`: passed for all matched project files.
- `npm run build --workspace apps/web`: TypeScript and Vite build passed. Vite still emits the existing non-fatal upstream Zod PURE-comment warnings documented in Phase 2A.
- Two additional focused 390px browser checks passed after the final refinements: the product drawer fills the phone viewport, and targeting the mobile cart hides its fixed shortcut. Both screenshots were reopened and inspected. Results: `.local/ui-redesign/verification-final-details.json`; script: `.local/ui-redesign-final-details.mjs`.
- Final backend hash comparison: 29 files checked, zero changed. The local frontend remains available on port 5173 and the POS preview returned HTTP 200.

## Screenshots and review links

Review the running frontend at:

- `http://localhost:5173/preview/dashboard`
- `http://localhost:5173/preview/products`
- `http://localhost:5173/preview/pos`
- `http://localhost:5173/preview/inventory`

The preview does not require an account. `/login` and the authenticated workspace need the existing local API/database setup described in README; they do not imply a working backend merely because the preview is accessible.

Screenshots are local, ignored verification artifacts in `.local/ui-redesign/`:

- `dashboard-1440.png`, `dashboard-390.png`
- `products-1440.png`, `products-390.png`
- `inventory-1440.png`, `inventory-390.png`
- `pos-1440.png`, `pos-390.png`, `pos-cart-390.png`
- `product-cards-1440.png`, `product-cards-390.png`
- `product-drawer-1440.png`, `product-drawer-390.png`
- `login-1440.png`, `login-390.png`
- `verification.json`: measured results from the full 44-layout check.

Automation script: `.local/ui-redesign-check.mjs`. Earlier `overflow-390.png` records the first failed inspection and is not a final screenshot. Before-redesign product/POS screenshots remain in `.local/photo-products-*.png` and `.local/photo-pos-*.png`.

## Limitations and future dependencies

- Exact brands/pack sizes in the representative product photos can differ from the generic catalogue labels. Product-specific image upload/storage is outside the existing API and was not added.
- Wide product tables scroll inside their labelled container on small screens; optional photo cards provide an alternative. There is no horizontal page overflow in the verified widths.
- The dashboard cannot show revenue/profit trends or low-stock counts until real transaction/reporting services and branch stock access exist. No placeholder financial curve is presented as business data.
- Actual stock availability, receipts, movements, physical counts/approvals, refunds, voids, payments and receipt printing require the unfinished backend phases. They remain unavailable.
- The public gallery is illustrative. Its sample stock quantities are independent of PostgreSQL and are never used on authenticated operational pages.
- This is focused Edge desktop/mobile and frontend regression verification, not a full assistive-technology audit or cross-browser certification. Existing Phase 2A dependency advisories remain outside this visual task.

Stop after the frontend redesign for user review. No next phase is authorised by this report.

## Follow-up: consistent product photography

The user requested larger, more consistent photos in the POS cards. Revisited internet sources and replaced the five mismatched rice, oil, flour, soft-drink and soap photographs. The replacement set uses single-product pack shots on light backgrounds rather than shelf/table scenes. The rice photograph now depicts a 25kg sack; oil, flour and soft drink match their corresponding product types. Existing sugar, milk and water shots remain.

The shared card image area now uses a consistent neutral background, ten-pixel desktop padding and a 196px height. POS details occupy a consistent lower section. At 390px the image area is 164px high. All eight rendered POS cards measured approximately **54.5% image area on desktop and 51.25% on mobile**, matching the requested half-card composition. Photos retain their proportions; the wide soap shot uses a centred cover fit inside its image area. Thumbnail and detail views continue to share the corresponding product image.

Source files are stored locally. Updated `public/images/products/sources.json` and `credits.html` distinguish the Open Food Facts Creative Commons photos from three retailer reference images whose copyrights remain with their sources; no open-license permission is claimed for retailer photographs. These are local design-preview assets. No photo source files were retouched; backgrounds are blended by CSS for consistent presentation.

Focused Edge verification passed ten Products/POS viewport combinations, including 1440, 1024, 768, 390 and 320px, with no horizontal page overflow, runtime exceptions or preview business API calls. All eight POS images loaded and the half-card ratios were checked. Desktop/mobile screenshots were opened and inspected at `.local/card-photo-review/pos-1440.png` and `pos-390.png`; measurements are in `.local/card-photo-review/verification.json` and the script is `.local/card-photo-check.mjs`.

Follow-up checks passed: all 46 frontend tests, ESLint, formatting checks for the changed files and the frontend TypeScript/Vite build. Backend and transaction behavior remain unchanged.

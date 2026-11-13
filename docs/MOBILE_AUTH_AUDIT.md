# Mobile and authentication audit

Audit before implementation, 13 November 2026.

## Confirmed code findings

- `pages/Login.tsx` and `pages/Register.tsx` use different form structures. Registration
  has no client-side confirmation feedback; neither page offers password visibility.
  Login has two competing text links and three product photographs. The session-error
  screen in `App.tsx` also exposes illustrative navigation.
- `styles.css` retains the two-column login grid until 620px, leaving tablet form
  columns narrow. Mobile form controls use 12px input text, which can trigger browser
  zoom, and many icon/quantity controls are smaller than comfortable touch targets.
- Dashboard KPIs remain in two columns at 320px, while `.stat-value` uses large
  unbroken financial values. Grid/flex children and modal actions need explicit
  shrink/wrap behavior rather than clipping the page.
- Wide tables already have `.table-scroll` wrappers. Preserve columns and financial
  information, constrain their containing panels, and make scrolling keyboard accessible.
- `WorkspaceShell.tsx` already has a collapsible sidebar and closes links on click,
  but lacks focus containment, background isolation and an in-drawer close button.
  Its desktop menu control is hidden on mobile after opening if focus moves poorly.
- Shared `ui.tsx` dialogs already use native modal behavior and dynamic viewport
  heights. Keep that behavior and improve narrow-screen spacing/actions.

## Authentication and compatibility

Backend registration, staff passwords, password changes and scrypt hashing already
accept 12–128 UTF-16 code units without composition restrictions, trimming or Unicode
normalization. Login accepts 1–128 to preserve compatibility with existing accounts.
There is no password-reset workflow. Password changes revoke sessions. Frontend
registration has native length checks but no matching accessible inline validation;
staff/change-password controls do not consistently expose autocomplete or visibility.

Dependencies: React Hook Form/Zod login validation, React Query mutations, scrypt v1,
PostgreSQL sessions, exact Origin checks, CSRF tokens and existing rate limiters.
Keep these controls and the optional Business ID for ambiguous legacy email accounts.
No external compromised-password lookup currently exists. Do not add an availability
dependency or a weak substitute blocklist during this UI change.

## Implementation scope

Preserve the existing green-and-white design and Inter font. Use matching login and
registration layouts with a lightweight, clearly illustrative inventory preview.
Hide decorative content on mobile/tablet; retain all real form fields and navigation.
Add accessible password controls and consistent feedback. Repair grid sizing, input
targets, report values, table containment, drawer focus and modal actions at their
own components. No global overflow hiding, database schema, finance, purchasing,
authorization, hosting or production configuration changes are planned.

Use `feature/mobile-auth-ui` in an isolated worktree. Publish that feature branch;
production merge/deployment remains a separate approval. Browser verification must
cover 320, 375, 390, 430, 768, 1024 and desktop widths before claiming visual results.

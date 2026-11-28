# WAMA CRM: context for whoever picks this up

This file is the handoff from the build sessions so far. Claude Code reads it automatically. Read it
fully before changing anything.

## What the product is

**WAMA CRM** (WhatsApp Marketing Agent CRM) by Magnetora AI. Live at **https://wamacrm.magnetora.in**.
A multi-tenant SaaS for Indian small businesses: one WhatsApp inbox for the team, AI replies (English,
Telugu, Hindi and mixes), campaigns with approved templates, a flow builder, tickets, contacts, and
"connectors" (apps a business switches on for its kind of work):

- **Front Desk** (was "Spa & Salon"): bookings, walk-in bills with GST invoices sent on WhatsApp,
  reviews after visits, staff performance and commission. For salons, clinics, studios, service centres.
- **E-commerce**: Meta catalog in WhatsApp, cart, UPI / card / COD payments, orders.
- **Sales Pipeline**: deals by stage, follow-ups, reports. (Page lives at `/dashboard/leads`.)

Also: billing (₹3,000/month plan via Razorpay, free trial), an AI wallet (₹300 free, top-ups),
team roles, a Super Admin console, and a public REST API for integrators (`/api/v1`, docs at `/developers`).

## How the owner likes to work (important)

- The owner (Teja) writes in **Telugu-English mix** ("Tenglish"). Reply in plain, simple English.
- **Branch: `v4`.** Develop, commit and push there only. No pull requests unless asked.
- **Never deploy to production unless the owner says so** (e.g. "Deploy it"). "Push it" means git push only.
- **Design: simple colours.** Navy `#0E1B3D` for text, **one green `#008069`** (hover `#006d5b`, soft background
  `#e7f5f0`, light border `#8fcfbf`, dark-mode green `#00a884` / Tailwind `emerald-*` in `dark:`), the same WhatsApp
  green as the mobile app (owner, 28 Nov 2026: "change colour to previous green", whole website + dashboard; it was
  blue `#1D5BEA` from 22 to 28 Nov). Greys (`#f4f6fa #eef1f6 #e3e8f2 #d5ddeb #4a5672 #6B7894 #8a94a8`), and red
  `#b91c1c` / `#fdf0f0` **only** for things needing attention. **No gradients, no rainbow colours.** Businesses' own
  pages (store, booking, website, chat widget, feedback, membership card) keep the business's colour; role badges
  (Admin blue, Manager teal, Agent emerald) and Meta / Facebook / chart colours are left as they are.
- **100% responsive**: every screen must work from 320px phones to desktop, with no sideways scroll.
  Phones use the bottom bar (see "Connector bottom bar").
- **Never put secrets in the repo** (it is public): no API keys, tokens, passwords, Razorpay keys.
  Use environment variables only. Never ask the owner to paste secrets in chat.
- Don't touch payment integration for Twilio / the Consular Helpdesk tenant.
- Don't set `META_WEBHOOK_ALLOW_UNSIGNED`.
- No AI model names in commits or code.
- Write user-facing text in plain words a shopkeeper understands ("follow-up", "bill", "deal"),
  not jargon.

## Stack and commands

- Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4 (container queries `@container`, `@xl:` etc.),
  Supabase (Postgres + auth + storage), deployed on Vercel. `lucide-react` icons.
- Install: `npm install` (lockfiles for npm and pnpm both exist).
- Dev: `npm run dev`
- Tests: `npm test` → `node --test tests/*.test.cjs` (about 495 tests; they import `.ts` files through
  `tests/register-typescript.cjs`; `tests/salon-fake-db.cjs` is an in-memory stand-in for Supabase).
- Typecheck: `npx tsc --noEmit -p .` (then `git checkout -- tsconfig.tsbuildinfo` to keep the diff clean).
- Production build check: `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54329 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon SUPABASE_SERVICE_ROLE_KEY=service npx next build`,
  then `git checkout -- tsconfig.tsbuildinfo next-env.d.ts`.
- ESLint is **not** set up (no `eslint.config.*`); `npm run lint` fails. Rely on tests, typecheck and build.
- Before pushing: tests pass, typecheck clean, build passes.

### Environment variables (names only; values live in Vercel / `.env.local`)

`.env.example` lists every variable with notes. To get the real values, be added to the Vercel project
and run `vercel link && vercel env pull .env.local`. Values never go in the repo or in chat.

Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Direct DB for auto-migrations: `POSTGRES_URL_NON_POOLING` / `POSTGRES_URL` / `DATABASE_URL`.
WhatsApp/Meta: `WHATSAPP_*`, `META_APP_SECRET`, `META_SYSTEM_USER_TOKEN`, `NEXT_PUBLIC_META_*`.
Twilio: `TWILIO_*`. AI: `OPENAI_API_KEY` (optional: without it the global key is the one the Super Admin saves on
WAMA CRM's own workspace in Super Admin → Advanced, read by `platformAiKey` in `lib/ai-access.ts`), `AI_PRICE_MARKUP`, `AI_USD_INR_RATE`.
Billing: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, optional `RAZORPAY_PLAN_<STARTER|GROWTH|PRO_1|PRO_2|PRO_3>`, `META_PRICE_<UTILITY|…>_INR`.
Email: `HOSTINGER_SMTP_*`, `SENDGRID_*`. Other: `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `SUPERADMIN_EMAILS`.

## Map of the code

- `app/dashboard/*`: the signed-in app. `layout.tsx` is the shell: sidebar, phone bottom bar, More
  drawer, page access checks (role, feature switched off, billing locked).
- `app/api/*`: API routes. `app/api/v1/*` is the **public API** (API keys). `app/api/pipeline/*`,
  `app/api/salon/*`, `app/api/commerce/*` serve the connector screens.
- `components/phone-field.tsx`: phone number with a country code picker (use it for every new phone input).
- `components/pipeline/*`: Sales Pipeline screens. `components/salon/*`: Front Desk screens (and shared
  UI bits in `components/salon/ui.tsx`: `api()`, `card`, `Modal`, `primaryButton`, `StatTile`, `Toast`…).
  `components/commerce/*`: E-commerce.
- `lib/rbac.ts`: roles and permissions. `lib/api-auth-helper.ts`: `verifyOrgAccess(request, orgId, {permission})`
  and `getSupabaseAdminClient()`.
- `lib/connectors.ts`: the connector list and `isConnectorOn(org, key)`.
- `lib/connector-nav.ts`: connector tabs in the phone bottom bar. `lib/front-desk-nav.ts` wraps it for Front Desk.
- `lib/pipeline/*`: Sales Pipeline rules (`rules.ts`, pure), storage (`store.ts`), access (`server.ts`), schema (`schema.ts`).
- `lib/salon/*`: Front Desk logic (invoices/GST, availability, reminders, feedback, templates, IST date helpers in `spoken.ts`).
- `lib/public-api/*`: API keys (sha256-hashed, `wama_live_…`), auth, scopes, endpoint helpers, and `spec.ts`
  (the /developers docs and `/api/v1/openapi.json` are generated from it; update it with every endpoint change).
- `lib/schema-setup.ts`: auto-migrations (see below). `supabase/migrations/*.sql`: the same SQL, for the record.
- `tests/*.test.cjs`: unit tests.

## Key ideas to know

- **Roles** (`lib/rbac.ts`): super_admin, org_admin, org_manager, sales_employee, viewer (plus legacy names).
  Permissions: `settings.manage` (admins), `automation.manage` (managers), `records.assign` (managers),
  `records.write` (not read-only), `records.view_all`. Sales employees see only records assigned to them
  unless given "see all".
- **Auto-migrations**: the app adds its own tables/columns the first time they are needed.
  `createAutoSetup` + `runMigrationSql` (advisory lock per feature) with a `withXSchema(step)` wrapper
  that retries after a missing-column error. Locks used: salon 724519002, api_keys 724519010,
  pipeline 724519011, sign-up codes 724519012. When adding columns, follow this pattern and also add a `supabase/migrations/` file.
- **Connectors**: E-commerce (`organizations.enable_commerce`) and Sales Pipeline (`organizations.enable_pipeline`)
  are on unless switched off; Front Desk is in the `organizations.enabled_connectors` array. Admins switch
  them in `/dashboard/connectors`.
- **Consular Helpdesk** (a special tenant: by name, or WhatsApp via Twilio) keeps its original setup:
  no Flow Builder, Commerce, Team, Billing, Connectors, Front Desk (`lib/workspace-modules.ts`). It keeps
  the Sales Pipeline.
- **Connector bottom bar (phones)**: inside a connector, the bottom bar shows that connector's tabs
  (Pipeline: Board, List, Follow-ups, Reports; E-commerce: Orders, Products, Go live, Store; Front Desk:
  Counter, Invoices, Reviews, Team) plus More. Pages keep their tab in the address (`?tab=…`) and talk
  to the layout through window events in `lib/connector-nav.ts`. A new connector needs an entry in
  `CONNECTOR_APPS` and its items in `layout.tsx`.
- **Dates**: the business runs on India time. Use the IST helpers in `lib/salon/spoken.ts`
  (`istDate`, `addDays`, `istDayRange`, `formatIstDay`…). Date-range filters use `lib/salon/ranges.ts`
  and `components/salon/date-range.tsx`.
- **Money**: one currency per business (Settings → Currency; `organizations.business_currency`, empty = INR; see the
  newest history entry). `lib/money.ts` (`moneyText`, `businessCurrency(org)`, `currencySymbol`). Rupees use Indian
  grouping and lakh/crore in short form (`formatMoney` in `lib/pipeline/rules.ts`). **Never trust `organizations.currency`**
  (its old default was USD). WAMA's own plan prices stay in rupees.
- **WhatsApp templates**: Front Desk sends nothing from a template until the business sets one up
  (Front Desk → Setup → Templates); an AI writer helps draft them. There are no built-in default templates.
- **Public API**: `apiAuth(request, scope)` checks the key, scope, a 120/min rate limit and the plan.
  Errors are `{ "error": { "code", "message", "field"? } }`. Scopes: contacts, messages, templates,
  front_desk read/write, leads read/write.

## What has been built (recent history, newest first)

- **One currency for the whole business; the old USD default fixed** (owner, 28 Nov 2026: "e-commerce and frontdesk and
  sales currency configuration add in the settings"; chose one for the whole business and a short list).
  - `lib/money.ts` (pure, browser-safe): `CURRENCIES` INR, USD, AED, SAR, QAR, GBP, EUR, SGD, AUD, CAD; `moneyText`
    ("₹1,50,000", "AED 1,250.50"), `moneyFixed` (invoices), `currencySymbol`, `currencyWords`, `businessCurrency(org)` =
    `organizations.business_currency` or INR. **The older `organizations.currency` column defaulted to 'USD'** (10 of 13
    workspaces had USD without choosing it): the shop dashboard, store orders, Razorpay / Stripe booking payments and the
    app's Telugu / Hindi check all read it. Now nothing trusts it on its own; saving the currency writes both columns.
  - Saving: `lib/business-currency.ts` (lock **724519043**, migration `20261216_business_currency.sql`,
    `saveBusinessCurrency` adds the column on first save), `GET/PUT /api/settings/currency` (everyone reads, admins
    change). Web Settings → General → **Currency**; app More → **Currency** (`more/currency_screen.dart`).
  - Screens: the dashboard sets a "screen currency" when the workspace loads (`setScreenCurrency`, remembered in
    localStorage `wama-currency`, pages redrawn on change through `CURRENCY_EVENT`); `formatRupees`, the pipeline and
    commerce `formatMoney` use it when no currency is given (INR on the server: server code passes it). Shop screens show
    every order / product in the business currency (an order's own `currency` is ignored). Labels say "Price ($)" etc.
  - Server: bills keep the currency in `invoice.business.currency` (Front Desk) and the shop invoice snapshot; WhatsApp
    bill / card messages, the booking flow, services form, WhatsApp assistant, shopping assistant, store and booking pages,
    website (`view.currency`), website chat facts + amount check (`amountsIn` knows $, £, €, AED, SAR, dirhams…), offers'
    titles (`parseDiscount(raw, currency)`), loyalty line, policy page samples, membership card page, monthly AI review,
    and new store orders (`currency` = business currency) follow it. `/api/mobile/me` `organization.currency` too.
  - App: `format.dart` `businessCurrencySource` (set by `AppState` from the profile), `formatRupees` / `shortRupees` /
    store `formatMoney` in it, `formatInr` for WAMA's plans and wallet (billing, plan cards). Demo answers the PUT.
  - Tests `tests/business-currency.test.cjs`, `mobile/test/release_currency_test.dart`. Next free lock: **724519044**.
  - Owner to check: nothing converts amounts; switching only changes the sign (say so before a business switches).

- **New plans and prices; the website and dashboard green again** (owner, 28 Nov 2026, from the pricing sheet:
  "Update the pricing page and app with these prices and change colour to previous green"; kept ₹300 and Pro).
  - `lib/plans.ts`: Starter ₹300 (no own WhatsApp; keeps its website), **Business ₹999** (`business`: own WhatsApp,
    inbox, AI, campaigns, flows, tickets, team, attendance, expenses, GST bills; 3 people; **no website, no
    Instagram**), **Growth ₹1,499** (`growth`, the default and "Most popular": + the website we build, own domain, AI
    chat on the website, online payments, Instagram; 5 people), **Growth + Content ₹2,499** (`content`: + 3 reels and 2
    posters a month by our team; `limits.videos` 3, `posters` 2), Pro 1 / 2 / 3 unchanged. Ads alone = `ADS_OFFER`
    ("Contact sales" on WhatsApp, not a plan). New limits `website`, `instagram`, `posters` (Super Admin can override
    them); new features `instagram` (needs the inbox too) and `website`; `planFor(feature)` names the smallest plan in
    refusals ("Upgrade to Growth or a bigger plan…"). **No monthly AI credit on Business / Growth / Content** (the ₹300
    free credit, then top-ups) and Growth no longer promises ads help: owner to confirm.
  - Server (`lib/plan-gate.ts`): `/api/instagram*` → `instagram`; `/api/salon/website`, `/api/commerce/storefront*`
    (settings, own domain, online payments) → `website`. Public pages of a site switched on before a downgrade are not
    switched off. Dashboard: Instagram gets the lock + "Not on your plan" card on Business.
  - Web: `/pricing` rebuilt (Business · Growth · Growth + Content · Ads cards, then "More plans": Starter, Pro 1–3;
    mobile + web app chips; new FAQ), home page plans = the three main ones + "See all plans", billing picker 4 across
    on very wide screens; "Everything in X, plus:" lines show as headings (web and app `plan_cards.dart`).
  - App: onboarding "With my own WhatsApp" = Business ₹999 (`finishOnboarding` → `business`), demo plans, "Your own
    WhatsApp comes with the Business plan". Nobody was paying when this changed (all 13 workspaces on trial).
    `RAZORPAY_PLAN_GROWTH` in Vercel, if set, would still point at ₹2,500: remove or update it.
  - **Colours**: our blue accent shades → the app's green across `app/` and `components/` (118 files: the blue hex
    family, plus the `dark:` blue classes on the same lines), see "Design" above.

- **"Takes time" switch on each Front Desk service: off = billing only** (owner, 28 Nov 2026: "Prati service ki time
  vundadu just billing vuntadi time enable disable option evu").
  - `salon_services.takes_time` (default true; lock **724519042**, migration `20261215_front_desk_service_time.sql`,
    `lib/salon/service-time.ts`: `takesTime`, `saveWithServiceTime` adds the column on the first save and, if it cannot,
    saves "on" without it). `parseService` saves it only when sent (older apps change nothing); a billing-only service needs
    no minutes (a blank keeps 30 / what it had). History logs "time on / time off".
  - Off: never booked: left out of `loadChatSetup` (WhatsApp assistant, booking flow, booking page, website and its chat),
    refused by `create_appointment` and `/api/v1` availability / appointments (`toApiService` gives `bookable`, in
    `spec.ts`); counter New booking pickers leave it out (web `ServicePicker` without `forBill`, app `bookServices`). Still
    billed; adds 0 minutes to a walk-in visit.
  - Screens: web Setup → Services (form: "Takes time" under the minutes, minutes hidden when off; list: "Billing only" tag
    and a third switch "Time"; subtitle counts them); app Setup → Services (editor switch, minutes hidden, "Billing only"
    pill). Bill pickers show no minutes for these, and **no minutes at all when the shop takes no appointments**
    (`showTime`). Demo mode: fixed editing a service (`Map<String, dynamic>.from`). Tests `tests/service-time.test.cjs`,
    `mobile/test/service_time_test.dart`. (724519043 is now the business currency.)

- **A count for each service on a new bill; New bill's Save button lined up; GST-inclusive bills add up exactly**
  (owner, 28 Nov 2026, app New bill screenshot: "Alignment sariga ledu and count vundali ga prati product ki").
  - Server: `walk_in_bill` takes `quantities` (same order as `service_ids`; `serviceQuantities` in `lib/salon/actions.ts`,
    1–`MAX_QUANTITY` 99, wrong / missing = 1, older apps send none). One line per service with `quantity` (the invoice maths,
    bill page, public API and expense reports already read it); the visit's length is minutes × count. Membership cards
    (`applyCard`): as many free as the card has sessions left, the rest charged (a line can split into "(membership)" + paid;
    sessions used and given back by the count). Team page (`computePerformance`): 3 × Threading = 3 services.
  - **Prices with GST in them**: a line's total is now the price itself (after its discount share) and GST is what is left over
    the taxable amount (`computeInvoice`); before, ₹600 at 18% billed as ₹599.99. Discounts unchanged (₹100 off ₹1,180 = ₹1,062).
  - App: `ServicePicker` `counts` / `onCount` → a picked service shows "How many?" / "₹80 each" with a − / + `QtyStepper`
    (40 px buttons) under the name, its price × count on the right; `lineCount` / `lineAmount` in `logic.dart` used by
    `estimateLines`, `discountRoom`, the GST-inclusive estimate (same rounding as the server) and `applyMemberCard` (same
    split); `BillSummary` and Who did it say "3 × Threading"; who did it rides on each line. **`BillBar`**: the button fills
    the right half, against the right edge (≤260 wide; `Align(heightFactor: 1)`, else the bar takes the whole screen); it was
    `Flexible` and left a gap on its right. Demo backend bills counts. Tests `test/bill_quantity_test.dart`.
  - Web Quick bill: same − / + on picked services (`QtyStepper` in `counter-sheets.tsx`), receipt and Who did it show the
    count, sends `quantities`. Booking checkout (bill after a visit) has no counts yet.
  - Tests `tests/bill-quantity.test.cjs`. `mobile/test/attendance_test.dart` "Save 1 day" fails when tomorrow is the demo
    shop's closed Sunday (not caused by this; it passes on weekdays).

- **Fixes after the owner's own test of the websites; new customer bookings stand out; Google reviews** (owner, 26 Nov
  2026: "login ... something error page ... back kodithe login ayyi chupinchesindi", "front desk website nunchi booking
  chesthe ikkada raaledu", "UI improvements", "5 star review ... Google ki connect cheyagalama").
  - **The "missing" website booking** was saved (Magnetora AI Solutions, booked for Sat 28 Nov 10:30, `source online`):
    it was for another day, and Front Desk had since been switched off for that workspace (one connector at a time), so
    neither the counter nor the website showed it. Now `GET /api/salon/appointments?date=` also returns `fresh`: bookings
    customers made themselves (`SELF_BOOKED_SOURCES` online / chat / api) in the last 72 h, booked, still to come
    (`lib/salon/new-bookings.ts`); web counter card **New bookings from customers** (`components/salon/new-bookings.tsx`,
    tap → that day, "Got it" hides them per device in localStorage `wama-seen-bookings:<org>`); app Front Desk card the
    same (`_NewBookings` in `front_desk_screen.dart`, `FrontDesk.freshBookings`, seen ids in the phone store
    `seen_bookings`; demo shows one).
  - **Sign-in error page**: not reproducible from here (no login). Hardened: `/login` (password and code) and
    `/auth/callback` go to the dashboard with a full page load (`window.location.replace`), not an in-page move; the
    Google return page and the store's shopper sign-in (`app/s/[slug]/signin`) carry on when the code was already used
    but a session exists (`getSession()` fallback; the shopper page runs once via a ref) instead of showing "did not
    finish"; error pages `app/global-error.tsx`, `app/dashboard/error.tsx`, `app/{s,v,b}/[slug]/error.tsx` with Try
    again (`components/errors/error-screen.tsx`), reloading once by itself when a new version went live
    (`lib/new-version.ts` `isNewVersionError`, remembered a minute).
  - Front Desk website (`business-site.tsx`): no stray coloured strip on the hero, quick facts only for what exists (no
    empty boxes), no grey map without an address, team buttons say Book (fit at 320 px), service chips wrap on wide
    screens; booking form (`booking-wizard.tsx`) gets a search box and type chips when there are more than 8 services.
    Online store: `Picture` checks after load for photos that failed before the page came alive (placeholder, not alt
    text); `dropOwnBrand` (storefront.ts) hides a brand that is just the business / store name (Meta catalog syncs put it
    on every product); banner text kept off the drawn picture on phones; promise strip has no half-empty row; no empty
    Contact us; product grid's empty cells white.
  - **Google reviews**: Google has no way for an app to post a review for a customer (only the customer, from their own
    Google account), and its rules forbid asking only happy customers ("review gating"). So the feedback form's thank-you
    now has **Post it on Google too** (copies the customer's words, opens the business's review link; they paste and tap
    Post) for 4–5 stars, and a quiet "review us on Google" for lower ratings; `/api/salon/feedback/submit` and the
    WhatsApp `thanksText` give the link after every rating. Reading Google reviews into WAMA / replying from WAMA needs
    the Google Business Profile API (an access request to Google + the business connecting its profile): not built.
  - Holidays app part done too (Attendance → Holidays, `attendance_logic.dart`, `test/holidays_test.dart`).
  - This environment's network now allows `wamacrm.magnetora.in` (to look at the live websites).

- **Front Desk: shop holidays in Attendance, one-off or repeating** (owner, 26 Nov 2026: "store holidays in attendance
  recurring holidays").
  - Rules `lib/salon/holidays.ts` (pure, browser-safe): a holiday is `{ id, name ≤40, start, days, repeat }` with repeat
    `none` (1–31 days) / `yearly` (29 Feb → 28 Feb; spans can cross the new year) / `monthly` (31st → month end) /
    `monthly_weekday` (the nth weekday of the start date; a 5th = the last) / `monthly_last_weekday` (monthly ≤7 days);
    `holidayOn`, `holidaySpans`, `holidayDays`, `upcomingHolidays`, `nextTime`, `cleanHoliday` (plain-English refusals,
    ≤2 years ahead, a one-off cannot be in the past), `readHolidays` (forgiving, ≤60), `withHoliday` / `withoutHoliday`,
    `dropOldHolidays` (one-offs over a year old), `repeatLabel` / `repeatChoices` ("Every month on the 2nd Tuesday"),
    `spanLabel`, `SUGGESTED_HOLIDAYS` (Republic Day, Independence Day, Gandhi Jayanti, Christmas, New Year's Day),
    `holidaysSentence` (for the AI). Weekly closed days stay in Setup → WhatsApp → Closed on.
  - Stored in `salon_settings.holidays` (JSONB list; lock **724519041**, migration `20261214_front_desk_holidays.sql`,
    `lib/salon/holidays-store.ts` `withHolidaysSchema`, `loadHolidays`, `saveHolidays`, `bookingsOnHoliday`). Settings are
    read with `select('*')`, so nothing needs the column until the first save. API `GET/POST/PUT/DELETE
    /api/salon/holidays` (everyone looks, managers change: `automation.manage`; logged in the change history; POST answers
    how many bookings are already on that day: they stay, the team calls those customers).
  - **A holiday is a closed day everywhere**: `isClosedOn` in `availability.ts` checks `hours.holidays`, so free times
    (WhatsApp assistant, booking flow, booking page `bookableDays`, booking payments, `/api/v1` availability, which now
    reads `salon_settings` with `select('*')`) are empty that day; the assistant's prompt lists the next two months'
    holidays and its "no time" note says why; the website (`openStatus`: "Closed today · Diwali · opens Friday 10 am",
    next open day skips holidays; `comingHolidays` → "Holidays (closed)" under the opening hours) and the website chat
    (`deskFacts` `holidays`) follow them; the counter's New booking says "This day is a shop holiday (Diwali)" but can
    still book. Bills are never blocked.
  - Attendance: holidays are not working days (`leaveRange`, `monthSummary`, `leaveSpans` take `holidays`); the attendance
    API returns `holiday` (day) / `holidays` map (month) and `holidayRules`. Web Front Desk → Team → Attendance →
    **Day | Month | Holidays** (`components/salon/salon-holidays.tsx`: explanation, one-tap national holidays, Coming up,
    All holidays with Change / Remove, Add holiday sheet with quick names, day stepper, repeat choices and a "Next: …"
    line); a holiday banner on the day view (no Mark all present), holiday days marked on the month views, Add leave
    leaves holidays out. Tests `tests/holidays.test.cjs`. **Not tried against the real database yet.**

- **Front Desk: appointments can be switched off (walk-in shops); website buttons on/off; staff attendance with leave**
  (owner, 26 Nov 2026: "in some shops they don't need appointment booking, they can hide it", "staff attendance
  maintenance (staff leave marking)", "website lo call to action button enable or disable").
  - **"We take appointments"** (`salon_settings.takes_appointments`, default true; lock **724519040**, migration
    `20261213_front_desk_take_appointments.sql`; rules `lib/salon/appointments-switch.ts` / `appointments-setting.ts`;
    Setup → Appointments `components/salon/salon-appointments-switch.tsx`, owners/admins). Off = walk-in mode: the counter
    becomes `components/salon/walk-in-counter.tsx` (Quick bill, today's bills, "Booked earlier for today"), no
    Appointments tab / Calendar in the phone bottom bar (remembered on the device), Setup hides Booking flow, booking page
    links, auto-confirm, reminders, payment when booking, and the booking + reminder templates; `/b/<slug>` and `/book`
    say "No online booking" with Call / WhatsApp, booking + times APIs answer 403 `not_taking_bookings`; the counter and
    `POST /api/v1/appointments` refuse (409 `appointments_off`, in `spec.ts`); the website has no Book buttons or form and
    its AI chat does not offer booking; WhatsApp "Book" does not start the flow, old booking / time taps get a kind reply,
    the assistant never offers times, no reminders. Existing bookings stay. App: `/api/mobile/me` `frontDesk.appointments`;
    Front Desk shows today's bills without Bookings / Requests / Book; Setup / website / More hide booking items; demo
    `?walkin=1`; tests `tests/appointments-switch.test.cjs`, `mobile/test/release_walk_in_test.dart`,
    `walk_in_screens_test.dart`.
  - **Website buttons**: `salon_settings.website` buttons {call, whatsapp, book, shop, directions} (all on by default),
    Setup → Website → "Buttons on your website" (web and app); a switched-off button goes from every place (header, hero,
    quick facts, Visit us, closing band, footer, phone bar, team / service Book, chat hand-off); Book is unavailable while
    appointments are off; no phone bar when it would be empty; Directions off also removes the map.
  - **Staff attendance**: table `salon_staff_attendance` (one mark per person per day: present / absent / leave / half_day
    / week_off, leave kind casual / sick / other, note ≤200; lock **724519039**, migration `20261213_staff_attendance.sql`,
    `withAttendanceSchema`), rules `lib/salon/attendance.ts` (ranges skip closed days, half day = 0.5, ≤62 days ahead),
    store `attendance-store.ts`, `GET/POST/PUT/DELETE /api/salon/attendance` (`?day=` or `?month=&staffId=`; `{marks}`,
    `{all:{day}}` = mark the unmarked present, `{leave:{staff_id,from,to}}`; managers mark (`automation.manage`), notes
    hidden from others). Web Front Desk → Team → **Performance | Attendance** (`components/salon/salon-attendance.tsx`,
    `?tab=team&view=attendance`: day list with one-tap marks, Mark all present, Add leave, month grid, a person's calendar
    with Cancel leave). App More → Attendance / Team → Attendance (`front_desk/attendance_screen.dart`, offline through the
    outbox, `data/attendance_logic.dart`, demo `data/demo_attendance.dart`). **Bookings follow it**: absent / leave / week
    off = the whole IST day busy in availability, the WhatsApp assistant (told who is not in), the booking flow, booking
    page / website ("Anyone" goes to someone who is in) and `/api/v1` free times; half day stays bookable; existing
    bookings stay with an "on leave" chip on the counter and a warning in New booking; an attendance read error counts
    everyone as in. Team numbers show "N days in" once attendance is used. Tests `tests/staff-attendance*.test.cjs`,
    `mobile/test/attendance_test.dart`. (724519041 is now used by holidays: **next free lock 724519042**.)
  - **Not tried against the real database, WhatsApp or the AI yet** (both new columns / tables set themselves up on first use).

- **Invoices redesigned; editable WhatsApp templates sent for approval; real phone pop-ups; own expense kinds; UI pass on
  E-commerce / Billing / reports; no "Syncing…" flashes** (owner, 25 Nov 2026: "invoice design is not good", "message
  templates ... they can edit it and apply for approval", "its inapp notifications remove it", "ui related issues on
  ecommerse billing analytics", "expenditure lo category ... type search dropdown ... saved", "syncing syncing ani vastundi
  every time"; and "dont create apk run simulation": app commits stay `[skip ci]` until the owner asks for an APK).
  - **Invoices**: `/i/<token>` (Front Desk bill) and `/invoice/<token>` (shop GST invoice, credit notes) draw through
    `components/invoice/invoice-document.tsx` (plain data in; header with logo / GSTIN, title + Paid / Not paid /
    Cancelled stamp, facts strip, bill to / ship to / payment, table from `sm:` and stacked rows on phones, totals card
    with a navy Total bar, amount in words, GST summary, credit notes, footer) and `invoice-actions.tsx` (Rate your visit,
    Share = share sheet or copy link, Print / Save as PDF). A4 print fits one page. Unregistered bills: no Taxable column,
    no "Prices include GST". Data loading unchanged.
  - **WhatsApp templates for the automatic messages**: `lib/whatsapp-templates/auto-messages.ts` (suggested wording per
    purpose, blanks as `{Customer first name}`, names `bill_ready`, `bill_ready_2`… when a name is taken / being deleted)
    and `auto-submit.ts` (submits through the existing `createTemplate`, Utility). Front Desk (bill, booking, reminder,
    feedback) and shop (cart reminder, COD check, review ask, back in stock, refund updates, and new **order updates**
    `lib/commerce/order-update-template.ts`, sent only when the chat window is closed). Shared web card
    `components/templates/auto-message-templates.tsx` (status Not set up / In review / Approved / Rejected with Meta's reason
    in plain words / Paused; Send for approval, Edit (tap-to-add blanks, buttons, language, preview, Write with AI on
    Front Desk), Check status, Use one I already have, Stop using a template); app
    `mobile/lib/screens/templates/auto_messages_screen.dart` (+ `data/demo_auto_messages.dart`). Kept in the existing
    `salon_settings.message_templates` / `organizations.shop_messages` (no new columns). An approved one is used by itself;
    while a new wording is in review the old approved one still goes. Starter sees a note; the server refuses (402).
    Tests `tests/auto-message-templates.test.cjs`, `mobile/test/auto_messages_test.dart`. **Not tried against Meta yet**
    (the "name taken" subcodes 2388023–2388025 are from memory).
  - **App notifications**: no banner inside the app any more (`NoticeHost` only opens what a tapped notification is about).
    `Notifier.notify` shows the phone's own pop-up also while the app is open (channel by kind), except when the server's
    push already does it in the background; the open chat still gets none. Foreground pushes (`push.dart` `onMessage`)
    become pop-ups too.
  - **Own expense kinds**: `resolveCategory` / `cleanCategoryName` / `ownCategories` / `categoryChoices` in
    `lib/expenses/rules.ts` (same in `mobile/lib/data/expenses_logic.dart`): a typed kind (2–40 characters) is saved as
    typed, a built-in name typed out becomes its key, one used before keeps its first spelling. `ownCategoryList` (latest
    3,000 expenses) → overview `ownCategories`. Web `components/expenses/category-picker.tsx` (combobox: search, "Add …");
    app `CategoryField` + `CategorySearchSheet` in `expenses_screen.dart`, kinds also kept on the phone (`expense_kinds`).
  - **UI pass** (web + app) on E-commerce (header tabs on their own row, orders cards below a wide-enough width, products
    toolbar, reports chart with a ₹ scale and readable dates, palette colours), Billing (plans three across, prices never
    wrap, ₹145.50, white cards in the app) and shop reports; shared commerce buttons ≥ 44 px and 16 px inputs on phones;
    app `ButtonGrid` / `PairedFields` in `store_screen.dart`; `PhoneField` country box as tall as the number box.
  - **"Syncing…"**: the `SyncBanner` stays hidden online unless a change failed or has waited over a minute;
    `WaitingPill` shows only offline (or "Not saved").
  - **Simulation instead of an APK**: `flutter build web --dart-define=DEMO=true` (in `mobile/`), served locally and driven
    with Playwright at 390 × 844 through Flutter's semantics (click `flt-semantics-placeholder` first); CanvasKit and fonts
    are blocked from the cloud, so route `www.gstatic.com/flutter-canvaskit/*` to `build/web/canvaskit/` and font requests
    to local Roboto / Noto files. Scripts were scratch (not in the repo). The owner's Claude Desktop **iOS Simulator pane**
    works only in a local session on their Mac (`flutter run -d "iPhone 17 Pro" --dart-define=DEMO=true`).

- **Videos: a voice in English / Telugu / Hindi, a website video, a new screen after each video** (owner, 25 Nov 2026:
  "for the videos audio is not coming"; "ee screen baledu ... we are also giving a website for ecommerce and frontdesk ...
  all sides nunchi customer attraction ... product sale").
  - **Recorded voice with a natural Indian accent** (owner: "you can add voice to a video, do it yourself, natural Indian
    accent", then "try sarvam", then "Indians use some English words in the middle ... cut cut ga undi, translation oka
    flow ledu"): the voice says a **spoken script**, not the captions: `lib/screens/explainers/explainer_narration.dart`
    (one `Tx` per scene: natural Hyderabad Tenglish, Hinglish with everyday English words in English letters, simple
    Indian English; flows scene to scene; written with ChatGPT from the videos' content, checked here; no app name, no
    made-up numbers). **The videos are English on screen; the language buttons pick only the voice** (owner: "only English
    video with 3 different language voices ... remove the Telugu and Hindi videos"; the picker has a voice icon; the
    captions' te/hi texts are kept in the content but not shown). Clips in `mobile/assets/voice/` (105, 3.6 MB, AAC mono
    32 kbps) made with **Sarvam AI** (speaker `kavitha`, pace 1.15 = a little quicker, owner: "voice slow ga undi
    kuncham"; `ENGINE=sarvam`; OpenAI is the other engine) by `mobile/design/voice/make_voice.py` (lines from
    `test/voice_lines.dart`; steps in `design/voice/README.md`; keys from the environment / command line and the model
    from `VOICE_MODEL`, never in the repo). `assets/voice/durations.json`: each scene lasts as long as its clip + 250 ms
    (no gaps; the animation stretches to it). `RecordedNarrator` (just_audio) plays the clip named
    `<lang>_<FNV-1a of "lang|text">`; a line without a clip falls back to the phone's text-to-speech. A test fails when
    words change without new clips. `test/record_videos.dart` + `design/voice/mux_videos.py` make MP4s with the voice.
  - Voice: `mobile/lib/screens/explainers/narrator.dart` (`Narrator`; `PhoneNarrator` = the phone's text-to-speech via
    `flutter_tts` (en-IN → en-US/GB, te-IN, hi-IN; rate 0.45 = a little slower than normal; `speak` waits for the end);
    `SilentNarrator` for tests/desktop; `spokenWords` = title + line, "×" said as by / బై / बाय). The player
    (`explainer_player.dart`) reads each scene; a scene moves on when its picture has played **and** its words are read
    (`_voiceDone`, `_waitingForVoice`, turn counter so a stopped reading is ignored); pause / leaving the app / closing
    stop the voice, play reads the scene again, a new language reads it again. Sound button next to Close (saved in the
    phone store `videos.sound`, on by default); a phone without a voice for the language shows `VideoWords.noVoice`
    (how to add one in Settings → Text-to-speech) and the video plays silently. Screen readers still start paused.
    AndroidManifest `<queries>` has `android.intent.action.TTS_SERVICE` (needed on Android 11+). No sound files, no
    music. Test `test/explainer_voice_test.dart` (a pretend narrator; everything that saves a setting is in one widget
    test because a save started in one test can hold up the phone store in the next).
  - New video **Your own website** (`id: 'website'`, 2nd in the list): scene kinds `website` (a phone with the business's
    site: `picture: 'store'` products + Add + cart badge + "Order placed", or `'desk'` services + Book + times +
    "Booking confirmed"; "On your own domain" chip) and `sources` (Google, Instagram, WhatsApp, Ads → Your website, dotted
    roads with people moving, then Orders / Bookings). The E-commerce welcome slide's Watch button opens it.
  - Screen after a video (`_endView`): "Video done" + the last scene's words, an **Up next** card with a moving preview
    and Next video, Watch again | Done, the **Customers from every side** card (we also give you your own website:
    store or booking site; Google / Instagram / WhatsApp / Ads → Your website → More sales; Watch: Your own website),
    and All videos with ticks for watched ones. Previews `video_website`, `video_sources`, `video_end`.
  - New video **Instagram, just like WhatsApp** (`id: 'instagram'`, 3rd; owner: "we support Instagram too ... automatic
    comment reply and chat, automatic orders, booking"): scene kinds `igComments` (a post; each question gets the AI's
    reply under it, "DM sent") and `igChat` (an Instagram DM: the AI answers with an Order now / Book a time button, then
    the confirmation card); flat Instagram blue / pink, no gradients. Welcome slides: an Instagram line on Front Desk
    and E-commerce. Words: the AI sends the order / booking link in the chat (it does not place orders itself).
  - `mobile/test/record_videos.dart` (not in the test run) records the videos as frames from the player itself
    (`VIDEOS=grow:en,website:te FPS=12`), then `ffmpeg -framerate 12 -i <dir>/%05d.png -c:v libx264 -pix_fmt yuv420p`.
    Silent (the voice is the phone's).
  - New Telugu / Hindi words (website and Instagram videos, sound, end screen) were written here, not yet checked by a
    native speaker.

- **Expenses and profit, with a monthly AI review of sales** (owner, 25 Nov 2026: "expenditure ... salaries, expenditure and all
  types ... expenditure sale graphs ... monthly one time AI insight about the sales ... improvements and sales strategies").
  - `lib/expenses/rules.ts` (pure, browser-safe): `EXPENSE_CATEGORIES` (salaries, rent, bills, stock, marketing, transport,
    repairs, tax, loan, other), `PAY_METHODS`, `cleanExpense` (amount > 0 up to ₹10 crore, date up to 62 days ahead, IST
    today by default), India-time months (`readMonth` never a future month, `monthBounds`, `monthsUpTo`), `monthTotals`
    (sales, received, expenses, profit per month), `byCategory`, `salesByWeekday`, `topItems`, `repeatsDue` (monthly
    ones copied once, same day, 31st → month end), the AI review: `insightKindFor` ('so_far' while the month runs,
    'full' after), `insightFactsText` / `insightPrompt` (only real numbers), `parseInsight` {summary, good, improve, ideas,
    focus}, `insightBlocker`.
  - `lib/expenses/store.ts` (lock **724519038**, migration `20261212_expenses.sql`): `business_expenses` (repeat_key =
    the first one's id; unique (org, repeat_key, spent_on)) and `business_insights` (one per org + month + kind; a row
    with `insight` null holds the month while it is written, `claimInsight` / `dropClaim`, taken over after 3 min).
    Sales = Front Desk bills not void + shop orders not cancelled / waiting for payment (`salesBetween`, paged 1,000 at a
    time). `loadExpensesOverview`, `copyRepeats`, `insightFacts` (customers and how many bought in the year before).
  - APIs (admins only, `settings.manage`: salaries are private): `GET/POST/PUT/DELETE /api/expenses` (POST `action:
    'copy_repeats'`), `POST /api/expenses/insight` (AI wallet feature `sales_insight`; a saved review is returned as it is).
  - Web: menu **Expenses** (`/dashboard/expenses`, `components/expenses/expenses-page.tsx`; hidden for Consular Helpdesk;
    `canAccessPage` admins only): month switcher, tiles (Sales, Expenses, Profit / Loss in red, Money received), "N monthly
    expenses not added yet → Add them", AI review card, 6-month bars (sales blue, expenses slate, legend, tap/hover numbers,
    "See as a table"), Where the money went, list with kind filters, add / change / remove form. App: More → **Expenses and
    profit** (`screens/more/expenses_screen.dart`, owners/admins), same API, demo answers `data/demo_expenses.dart`, shared
    rules `data/expenses_logic.dart`, test `test/release_expenses_test.dart`. Tests `tests/expenses.test.cjs`.
  - **Not tried against the real database or AI yet** (needs a deploy). (724519039 and 724519040 are now used: next free 724519041.)

- **App: explainer videos on the welcome pages, in English, Telugu and Hindi; release check of the whole app**
  (owner, 25 Nov 2026: "video presentations ... how they will benefit ... multi language ... ads, chats, auto replies,
  automation ... on the onboarding itself").
  - `mobile/lib/screens/explainers/`: `explainer_content.dart` (5 videos × 4–5 scenes; every word a `Tx(en, te, hi)`,
    reviewed by native-language reviewers; no brand name, no made-up numbers), `explainer_scenes.dart` (animated scenes on
    a fixed 360 × 420 canvas from `t` 0→1: phone chat with typing dots, Telugu/Hinglish replies, inbox with assignees,
    lock-screen notifications, an ad tapped into a chat, a flow line that draws itself, growing bars, end card; flat
    WhatsApp colours; scene text ignores the phone's text size because the canvas is scaled as a whole),
    `explainer_player.dart` (story-style player: bars, tap left/right/middle, captions, English | తెలుగు | हिंदी,
    next video at the end, pauses when the app goes to the background, screen readers start paused; language and
    watched videos in the phone store `videos`; `ExplainerGallery`, `ExplainerLibraryScreen`, `openExplainer`).
    Built-in animations, not video files: tiny, sharp, offline, instant language switch. No voice-over (made to be
    watched without sound, like reels).
  - Welcome pages now start with the videos (page 0), each slide has a Watch button, More → How we help your business.
  - Release check of the whole app (7 areas, each file read in full, every problem confirmed by a second reader before
    fixing): 158 found, 141 confirmed, 137 fixed (data layer, Front Desk counter and setup, Store, Chats / AI /
    Instagram, Templates / Campaigns, More / Billing). Tests: `explainer_test.dart` and the older suites.
  - **Server items the check found, not done yet** (need a decision or a deploy): a scheduler for
    `GET /api/campaigns/scheduled` (scheduled campaigns only start while someone has Campaigns open; the app nudges it
    every 5 min for managers), and `/api/cron/shop` likewise; `client_ref` dedupe on `/api/messages/send`, tickets,
    campaigns, knowledge, contacts (the app already avoids most repeats); a campaign scheduled in the past should start
    at once; returns route `via` and `refundable()` left after a full refund; the web orders tab's "I have refunded it"
    (the app now refunds only through Returns and refunds); after an upgrade paid via webhook only, create the new
    auto-pay (`lib/billing-service.ts`); signed upload URLs for chat files; Instagram posting as a job.

- **App: sign-up and welcome pages redesigned with pictures; "Delete my account"; release check of the whole app**
  (owner, 25 Nov 2026: "redesign mobile signup and onboarding screens ... use some images ... attractive ... production
  ready", then "make it two steps and explain more about it" for the pick page).
  - Pictures: flat drawings in WhatsApp colours (no gradients, no brand name inside) drawn by code in
    `mobile/design/art/` (`gen.py` → SVG, `render.cjs` → PNG 1x/2x/3x with Playwright's Chromium, then `pngquant`; steps in
    its README). In `mobile/assets/images/` (+ `2.0x/`, `3.0x/`, ~430 KB): `welcome`, `desk`, `shop`, `nowa`, `team`,
    `signup`, `code`, `offline`, and Google's G (`google_g`) for "Continue with Google".
  - Auth screens moved to `mobile/lib/screens/auth/`: `login_screen.dart` (welcome page with the picture, "Create a free
    account" first, Google, "Already have an account? Sign in" → a separate Welcome back form with Forgot password (opens
    `/forgot-password` on the website), and the Name your business step after a first Google sign-in), `signup_screen.dart`
    (3 steps with a step bar: business → login → 6-box email code that sends itself when complete), `auth_parts.dart`
    (`AuthPicture`, `GoogleButton`, `BigButton`, `CodeBoxes`, `AuthError`, `friendlyAuthError` (server / Supabase words →
    plain sentences), `TermsLine` → `/terms`, `/privacy`, `StepBar`, `SoftPill`). Android back steps back inside each.
  - Welcome pages (`onboarding/onboarding_screen.dart`): a picture per slide, icon rows, "You gain", the ads-team card,
    then the pick in **two steps**: 1. Front Desk or E-commerce (picture, "Best for", what you get), 2. Without WhatsApp
    (₹300: what is in it, what is not, Meta's price per message from the wallet) or With my own WhatsApp (Growth ₹2,500:
    what it adds), "Not sure? start without", trial note. The Growth price is written in the app; keep it in step with
    `lib/plans.ts`.
  - **Delete my account** (Google Play rule for apps that make accounts): `lib/account-deletion.ts` (pure: emails, scope,
    recipients), `GET/POST /api/auth/delete-account` (under /api/auth so it works after a trial ends; emails the super
    admins, else support@magnetora.ai, and a copy to the person; 3 an hour per person; **only the owner** (role `owner`)
    asks for the whole workspace, other admins and staff only their own login (workspaces with no owner row: admins);
    nothing is deleted automatically: the team checks and deletes), public page `/delete-account` (for the Play Console
    "delete account URL"), app More → Delete my account (`more/delete_account_screen.dart`), also on the Plan ended
    screen. `AccountReadyException`: the account was made but signing in after it failed → back to sign in.
  - Tests: `test/release_signup_test.dart` (welcome → 3 steps, wrong code then right, onboarding follows),
    `test/release_signin_test.dart`, `release_onboarding_test.dart` follows the two pick steps; `tests/account-deletion.test.cjs`.
    `tapText` (release_helpers) now lays out before tapping (it used to tap where the text was before scrolling).
  - Screenshots of these screens: `mobile/test/screenshots.dart` (not in the test run; `SHOTS_DIR=… flutter test
    test/screenshots.dart`). Flutter tests draw text with no font family as boxes, so it wraps the app in a Roboto theme.

- **₹300 without WhatsApp; sign-up first; welcome pages in the app** (owner, 25 Nov 2026: "signup first ... take the
  country and mobile number ... remove glow salon ... after signup show two connectors ... ads ... social media ...
  without whatsapp ... confirmation message by wama crm ... invoices billing analysis ... monthly 300"). **Starter is now
  ₹300** (`amountPaise 30_000`) and covers **Front Desk or E-commerce** (`connectorKeys ['salon','ecommerce']`, one at a
  time; `connectorBlockReason` names the plan's connectors). Razorpay plans are matched by price, so a new ₹300 plan is
  made by itself — **unless `RAZORPAY_PLAN_STARTER` is set in Vercel (it would still point at ₹999: remove or update
  it)**. WAMA's number has a 5th fixed template `wama_order_confirmed` (`SharedPurpose = MessagePurpose | 'order'`), sent
  from the store order route when `usesSharedNumber` (submit it in Super Admin → WAMA's WhatsApp number). Sign-up (email
  and Google) takes `phone` (+country, `readPhone` in signup-otp.ts) → `organizations.contact_phone`; email sign-up no
  longer adds made-up contacts, deals and chats. `changePlan` (trial switch) and `applySubscription` now set
  `whatsapp_mode` from the plan (it stayed as it was before). App: start screen = Welcome, **Create a free account**
  first, Continue with Google, then "Already have an account? Sign in"; sign-up and the Google business step have
  `PhoneField` (country + mobile) and no "Glow Salon"; **the app's sign-up works when the server needs no email code**
  (`sendSignupCode` returns null on `codeNeeded: false` → account made at once; before, the app waited for a code that
  never came). After sign-up `store['onboarding'].pending` → `OnboardingScreen` (owners/admins): Front Desk and
  E-commerce slides (with own WhatsApp, what they gain, "our team runs your ads and social media"), the ₹300
  without-WhatsApp slide, then the pick (connector + with / without own WhatsApp) → `finishOnboarding`
  (`/api/billing/change-plan` growth|starter, `/api/connectors`). Previews `onboarding`, `_store`, `_nowa`, `_pick`;
  test `test/release_onboarding_test.dart`.
- **₹999 Starter = no own WhatsApp; Meta only on Growth / Pro, enforced on the server** (owner, 24 Nov 2026: "without
  meta just for billing and invoice generate and analytics we can 999 ... if they connected meta our plans will come ...
  be secure"). Before this only ~16 routes checked the plan; ~40 own-WhatsApp routes (conversations, messages, tickets,
  templates, campaigns, flows, Instagram, knowledge, AI, catalog) answered a Starter workspace. `lib/plan-gate.ts`
  (pure: `featureForPath`, `connectorForPath`, `planRefusal`, `connectsWhatsApp` / `SENDER_FIELDS`) runs for every
  call through `verifyOrgAccess` (`denyByPathPlan`), `verifyRecordAccess` and the exported `workspaceRules` (used by the
  sign-in-only routes: `/api/ai/*`, `/api/campaigns/senders`, `/api/flows/simulate`). Billing is read through
  `billingRowFor` (lib/billing-gate.ts, remembered 30 s, shared with the trial check). Connectors are refused only when
  the plan leaves them out entirely (Starter: Front Desk only). Exempt, no billing row and super admins: no limits.
  Typing WhatsApp / Twilio keys in Settings (`PATCH /api/organization`) needs Growth+ like Meta's sign-up (402). Web:
  Marketing Copilot and the tickets drawer hidden when the plan lacks them (`planHas`); Front Desk Setup hides Booking
  flow and Templates when `/api/salon/setup` says `ownWhatsApp: false`. App: on Starter the WhatsApp lock says "Your own
  WhatsApp comes with Growth" with See plans (Billing) and WhatsApp us; demo `?starter=1`. Plan words: Starter "Bills,
  GST invoices and reports, without connecting WhatsApp" + reports line; paid plans "Your own WhatsApp number (connect
  Meta)". Tests `tests/plan-gate.test.cjs`, app `test/release_starter_test.dart`.
- **14-day free trial, then pay: enforced on the server and in the app; release tests** (owner, 24 Nov 2026: "release the
  apk to production ... with whatsapp integration and without ... 14 days free trail after they need to do payment").
  Before this only the website's pages locked; the API kept answering, so the app worked after the trial. Now
  `verifyOrgAccess` refuses a paused workspace with 402 (`denyWhenPaused` → `lib/billing-gate.ts`: `workspacePaused`
  = `!billingState(...).hasAccess`, remembered 30 s per workspace, `forgetWorkspace` in `applySubscription` so paying opens
  it at once; never refuses on a billing read error, exempt, no billing row or super admins). Still open while paused
  (`openWhenEnded`): `/api/billing*`, `/api/auth*`, `/api/mobile/me|config|devices`, `GET /api/organization`,
  `/api/superadmin*`. Webhooks (incoming WhatsApp, AI replies) are not gated. `/api/mobile/me` returns `billing`
  {exempt, hasAccess, status, onTrial, trialDaysLeft, accessUntil, plan}. App: `AppState.paused` / `trialDaysLeft` /
  `trialEnded`; any 402 reloads the profile (`_onPaused`); the outbox keeps changes waiting on 402 (sent after paying);
  `refreshAll` stops after the profile while paused. `ui/plan_lock.dart`: `PlanEndedScreen` replaces the tabs (owner:
  Choose a plan → Billing, "I have paid, check again"; staff: ask the owner; WhatsApp us; Sign out) and `TrialBar`
  above the bottom bar for the last 3 days; More shows "Free trial · N days left". Demo: `?billing=trial|trial2|ended|paid`,
  `&staff=1`, `&nowa=1` (WhatsApp not connected); the demo backend refuses like the server. Tests
  `tests/billing-gate.test.cjs`, app `test/release_*_test.dart` (one workspace kind per file: the phone store opens
  once per file; `reach` scrolls lazily-built lists).
- **Home page = Magnetora AI as a digital marketing and AI solutions partner** (owner, 23 Nov 2026: "business ki
  strategies ... grow chestham, workflow automations, ads run chestam, video editing, images editing ... a digital
  marketing AI solutions partner"). `app/page.tsx` now leads with the company (`BRAND.company`): hero "We grow your
  business", the 4-step loop (found → messages → bookings → back), six services (growth strategy, ads, video editing and
  reels, photos and design, workflow automation, AI assistants), how we work (understand, plan, make and run, measure),
  industries (`UseCases`), the platform (`BRAND.name`) as the software behind it, platform plans + "Want us to run your
  marketing?" custom package, FAQ, and "Free growth plan" (`DemoForm`, new goals). Service prices and what each package
  includes are **not** on the page: the owner should confirm them before any are added.
- **New home page, side menu, Super Admin** (owner, 23 Nov 2026: "100% production ready ... side bar loading issue ...
  super admin not good ... web front page total redesign ... lot of use cases"). Home page `app/page.tsx` (server) +
  `components/landing/home-parts.tsx` (client: `UseCases` with 8 kinds of business, each with the problem, what changes,
  the connector and a sample chat in `PhoneChat`; `DemoForm` → `/api/public/demo-request` with the honeypot and ad source;
  `MobileMenu`, `DesktopNav`, `LightMode`): hero, numbers, use cases, connectors, 16 features, AI section, how it works,
  pricing from `PLANS`, FAQ (`<details>`), demo, navy footer. Brand name and contact in **`lib/brand.ts`** (`BRAND`,
  `whatsappUs`): rename there. Side menu (`app/dashboard/layout.tsx`): shows the last menu at once (`MENU_CACHE_KEY`
  'wama-menu' in localStorage, per user, cleared on log out), placeholder rows on the first load, waits for the
  workspace's settings (`menuReady`), and lists **only the connector in use** (`connectorHidden`); sidebar subtitle is the
  plan name. Super Admin: its sections are the side menu (`superAdminItems`, `?tab=` kept in the address,
  `lib/superadmin-nav.ts` `SUPERADMIN_TAB_EVENT` / `superAdminTab`; page tabs only on phones); the Advanced page is now
  "Workspace keys and AI" (workspace list only, plain words, simple colours). App: every server call checked against the
  routes (all exist, right methods, workspace id sent). **Most app "not working" reports come from production being on
  the 20 Nov server** (v4 `40e522f`): the app's newer screens need a deploy.
- **Simple colours on the whole dashboard; WhatsApp lock; sample lists** (owner, 22–23 Nov 2026: "do whatever changes
  you feel are needed"). Old emerald / teal / WhatsApp-green accents and every gradient on the dashboard pages, auth pages
  and shared components moved to navy / one blue / greys (44 files; the sidebar and phone bottom bar active item is now
  blue, which answers the old "navy or green?" question; the owner can still say otherwise). **Kept on purpose**: the
  inbox (`components/chat/*`, WhatsApp look), the landing page `app/page.tsx` (redone with the new brand), public store /
  booking / website pages (the business's own colour), WhatsApp previews, the Google logo, chart colours and the store
  colour choices. App: WhatsApp features locked until WhatsApp is connected (`ui/whatsapp_lock.dart`, `/api/mobile/me`
  `whatsapp.connected`), "Add sample services?" before a starter list, and **Remove samples** (`lib/salon/sample.ts`
  `sampleMatches` / `removeSamples`: unused samples deleted, used ones switched off; `salon_services.source = 'sample'`).
  Brand rename pending (owner does not want "WAMA CRM"; names shortlisted in chat, none chosen yet).
- **One connector at a time; Connectors in the app; More redesigned** (owner, 22 Nov 2026: "only one connector enable
  and disable no multiple connectors ... option to handle it from mobile ... enhance the mobile design"). `MAX_CONNECTORS = 1`
  in `lib/plans.ts` for every plan (Pro too, exempt and old ₹3,000 workspaces; Pro features say "Any one connector, switch
  any time"): `activeConnectors` keeps the first that is on (Front Desk, E-commerce, Sales Pipeline) until the owner picks;
  `connectorSwitch` always switches every other one off (never a refusal, except Starter = Front Desk only); `/api/connectors`
  reports only the one in use as enabled. Web Connectors page asks "Use X instead?" / "Switch X off?". The raw flags of older
  workspaces stay until the owner switches (gates such as the pipeline API still read `isConnectorOn`). App: More →
  **Connectors** (`screens/more/connectors_screen.dart`, admins switch, same API, reloads `/api/mobile/me` so the bottom bar
  follows); More screen: profile card with business / role / connector chips, icons in soft tiles, chevrons.
- **App: Instagram as its own section; chat redesign; shop reports fixed** (owner, 21 Nov 2026: "Instagram separate chat
  window ... whatsapp tho merge avakudadu ... analytics correct ga ... filters ... chat design baledu"). App keeps two chat
  lists (`AppState.chatLists`: `conversations` = `/api/conversations?channel=whatsapp`, `ig_conversations` = `channel=instagram`;
  `chatsOf(channel)` re-checks with `isInstagramChat` so an old mixed copy never mixes; `findChat`, `unreadIn`, `loadChats`;
  live updates and notices find the right list). `/api/mobile/me` returns `instagram {connected, username}`; bottom bar gets
  an **Instagram** tab (and Chats is labelled WhatsApp) when connected. `screens/instagram/instagram_screen.dart`: Chats
  (shared `ChatList` + sync `/api/instagram/messages?sync=1&list=0` on open and every 2 min, notes for messages off / slowed),
  Comments (reply, message them, hide, delete, post thumbnail), Posts (grid + `NewIgPostScreen`: photos via
  `/api/instagram/photos`, POST `/api/instagram/posts`), Auto replies (PUT `/api/instagram`). Chat window follows the chat's
  channel (Instagram: 7-day window, no templates, "Instagram" under the name). `chats_screen.dart`: `ChatList` / `ChatRow`
  (filters All, Unread, Waiting for reply, Mine, AI off; time aligned). Bubbles fit their text with the time inline.
  **Shop reports** (`lib/commerce/shop-reports.ts`): new = first order in the period, returning = ordered before (also by the
  contact's phone for WhatsApp orders), `repeatCustomers`, `received` (paid), `before` (the period just before), periods
  1/7/30/90, `channel` filter (`readChannel`; visits and carts only for website/all; the channel split always shows all).
  Web `reports-tab.tsx` and app `ShopReportsScreen` (shop_more.dart) have period + channel filters, received vs to collect,
  change vs before, labelled bars (tap a bar in the app). Brand rename under discussion (owner does not want "WAMA CRM").
  **Instagram reply window = 24 hours** (22 Nov 2026: Meta refused a reply with "(#10) To use 'Human Agent' ... must be
  reviewed"): the 7-day Human Agent window is used only with `NEXT_PUBLIC_INSTAGRAM_HUMAN_AGENT=on` (set it after Meta
  approves Human Agent in App Review). `humanAgentOn`, `igReplyHours`, `IG_WINDOW_CLOSED`, `replyWindow(…, humanAgent)` in
  `lib/instagram/rules.ts`; `igSendError` turns a Human Agent refusal into plain words; web inbox and app (`/api/mobile/me`
  `instagram.replyHours`) follow the same setting. Shop reports also take `from` / `to` (`readRange`, ≤366 days).
- **Version 1 freeze: security, bug pass, app parity** (owner, 21 Nov 2026: "freeze this version ... security ni baga
  take care ... every web feature in the app ... chatting WhatsApp native feel"). Report at the top of
  `docs/TESTING-REPORT.md`. **Security**: the public anon key could read core tables in production →
  `lib/security/lockdown.ts` (`LOCKDOWN_SQL`, lock 724519037, migration `20261211_lock_down_tables.sql` must stay equal:
  RLS on every public table, anon revoked, catch-all policies dropped, `wama_my_org()` + `wama_members_read` policies,
  safe organization columns only); Super Admin → Setup → Database security (`/api/superadmin/security`) shows open
  tables and locks them. **The owner must run it once on production.** Twilio signatures `lib/twilio-signature.ts`
  (logs only until `TWILIO_SIGNATURE_CHECK=enforce`). Auth try limits `lib/auth/attempts.ts`. Escaped HTML in the
  assistant drawer, sandboxed email preview, security headers in next.config, `/api/tickets/notify` removed.
  Contacts: phone checked and saved with `normalizePhone`, duplicates by `phoneKey`; import checks every existing number;
  campaign worker email lookup limited to the workspace. **App**: `chats/chat_parts.dart` (day chips, grouped bubbles,
  ticks, WhatsApp text marks, swipe to reply), new screens `front_desk/members_screen.dart`,
  `front_desk/website_settings_screen.dart`, `store/online_payments.dart`, `ai/ai_tools.dart` (unanswered questions,
  sources, reply style), demo answers `data/demo_launch.dart`, `Backend.uploadToStorage` (signed upload URL).
  Next free lock was 724519038 (now used by Expenses).
- **Website AI assistants answer from the business's own data; order / booking checks; new chat design** (owner, 21 Nov
  2026: "answer from the data it have, services products ... where is my order ... 100% accurate ... design
  improvements"). `lib/ai/site-assistant.ts` (pure): `storeFacts` (delivery charge / free-from / minimum, pick up, paying
  incl. gateway methods, returns days, loyalty, automatic offers, "never make up a code", the store's info pages, contact)
  and `deskFacts` (hours + each day + open now, every service with price and length by category, team and what each
  does, booking and paying rules, memberships, rating, about) given to the AI as true facts (`answerFromKnowledge`
  `facts`, `where`); `serviceHits` (services as `kind: 'service'` knowledge → cards with Book). **Amount check**
  (`strictAmounts`): `unknownAmounts` (every ₹ amount in the reply must be in the facts / knowledge, or a sum of two);
  a wrong one → asked once more (temperature 0) → still wrong → "the team will tell you" (hand-off). **No-AI answers**:
  `asksAboutOrder` / `asksAboutBooking` (English, Tenglish, Hinglish), `findOrderNumber` (ORD-YYMMDD-XXXX), `findPhone`,
  `findName`, `detailsGiven` (this and earlier messages), `orderReply`. Store chat (`/api/public/store/[slug]/chat`):
  signed-in shopper → own latest orders; order number + phone → `trackOrder`; else asks (form 'order'); 10 look-ups an
  hour per address; works before the AI check. Front Desk chat (`POST /api/public/booking/[slug]/chat`, new): upcoming
  bookings by phone + first name (both must match; form 'booking'); else the AI with `deskFacts` + `serviceHits`.
  Setting `salon_settings.website.chat` (default on; Setup → Website and booking → "AI chat on your website" with the
  `siteChatProblem` note); `loadSite` → `chat` only when the AI can answer. Shared window `components/site-chat/site-chat.tsx`
  (`SiteChat kind="store"|"desk"`: header with logo, quick-action tiles then a chip row, *bold* / • / links rendered
  safely, product cards (Add to cart), service cards (Book → `wama-book` event, the page's booking form), order card
  with a step bar, booking card, inline look-up forms, WhatsApp / Call on hand-off, typing dots, New chat; full screen on
  phones). `app/s/[slug]/store-chat.tsx` is now a thin wrapper (passes the shopper's token). Tests
  `tests/site-assistant.test.cjs` (incl. a made-up price never reaching the customer). Screenshots 320 / 390 / 1280.
  **Not tried against the real AI or real orders yet.**
- **Stripe, paying while booking, booking form and Instagram posts on the Front Desk website** (owner, 20 Nov 2026: "photo
  gallery or instgram posts, booking form also dynamic, pay also while booking or at store, support stripe gateway").
  **Stripe** on the business's OWN account (`lib/payments/stripe.ts`: plain REST, form-encoded `formBody`, Checkout Sessions
  `checkoutForm` / `createCheckout` (≥30 min, Stripe's minimum) / `getCheckout` / `readCheckout`, `refundStripe`,
  `verifyStripeWebhook` "t=,v1=" HMAC with 5-min tolerance, `minorUnits`). Keys `organizations.stripe_secret_key`,
  `stripe_webhook_secret`, and `pay_gateway` (which one when both are connected; `lib/payments/gateway.ts`
  `onlineGateway`). Lock 724519036, migration `20261210_stripe_and_booking_payments.sql` (`lib/payments/schema.ts`
  `withPaymentsSchema`). Settings: one shared card `components/payments/online-payments.tsx` (Razorpay + Stripe +
  "Customers pay with") used by Store → Website and Front Desk → Setup → Website and booking; API
  `GET/PUT/DELETE /api/commerce/storefront/payments` (PUT `{gateway:'stripe', secretKey, webhookSecret}` or `{use}`;
  DELETE `?gateway=`). Store checkout: order route opens Stripe Checkout (`shipping_address.payment.session_id`), the
  page goes to Stripe and back with `?paid=<order>&session=` (`returnBase` in `lib/payments/return-url.ts` only trusts
  WAMA's address or the store's own domain), `/pay` checks `sessionId`; refunds through Stripe (`returns-store.ts`).
  Webhooks: `POST /api/public/store/[slug]/stripe-webhook` (store orders and bookings, by `metadata.wama_kind`) and
  the Razorpay one now also marks bookings (`notes.wama_kind = 'booking'`).
  **Paying while booking** (`lib/salon/booking-pay.ts`, pure; kept in `salon_settings.website.bookingPay` {mode shop |
  choice | online, advance %}): `bookingPayOptions` (never no way to book), `amountOnline` (advance rounded up to
  rupees). An online booking is saved as status `awaiting_payment` with `payment_hold_until` (30 min); `holdsTime` in
  availability.ts keeps the time held only until then; the counter, ranges and `/api/v1/appointments` hide those rows.
  `lib/salon/booking-payments.ts`: `startBookingPayment` (Razorpay order / Stripe Checkout, ref in `payment_ref`),
  `markBookingPaid` (once, amount ≥ asked → booked or request; after an expired hold with the time taken → request with
  a note), `checkBookingPayment`, `payAtShopInstead`, `expireUnpaidBookings` (cancelled + expired after a day). Routes:
  `POST /api/public/booking/[slug]` takes `pay` + `returnPath`, `POST /api/public/booking/[slug]/pay` (check / Razorpay
  signature / `action: 'shop'`). The advance is taken off the bill (`issueInvoice` `advance` → `salon_invoices.advance_paid`;
  fully paid → method `online`); bill page shows "Paid online when booking". Counter, requests and the appointment sheet
  show `paymentNote`. **Website**: the booking form is inside the page (`#book`, `BookingWizard embedded colour`), Book
  buttons pick the service / person there (`components/salon-site/book-button.tsx`, window event `wama-book`), the
  wizard has a payment step (Razorpay window or Stripe page, "Payment not finished" with Try again / Pay at the shop /
  check again). Latest Instagram posts of the connected account (`site.instagramLive`, `loadSite` → `instagramPosts`
  via `latestPosts`, cached 30 min) under the photos. Tests `tests/payments.test.cjs`. Checked with local screenshots
  (320 / 390 / 1280, no sideways scroll). **Not tried with real Stripe or Razorpay keys yet; Stripe's API shapes are
  from memory (its docs were not opened from here). Mobile app not updated. Next free lock: 724519037.**
- **Front Desk website, on our address or the business's own domain** (owner, 20 Nov 2026: "same for the frontdesk
  connector ... website ... own domain else our domain"). `lib/salon/website.ts` (pure: `readSite` {enabled, tagline,
  about, cover, gallery ≤12 https, colour from `SITE_COLOURS`, show {prices, team, memberships, reviews}, instagram,
  domainShows website|store}, `domainOpens`, `openStatus` (IST "Open now · closes 9 pm"), `weekRows`, `niceTime`,
  `duration`, `fromPrice`); `lib/salon/website-store.ts` (lock 724519035, migration `20261209_front_desk_website.sql`:
  `salon_settings.website`; `loadSiteSettings`, `saveSiteSettings`, `loadSite` (booking page data + reviews + plans +
  review link + store link), `domainSite` (own domain → website or store)). Page `components/salon-site/business-site.tsx`
  (server-rendered: sticky header with section links + Book now, cover hero with Open now / rating / from-price, quick
  facts card, services menu `services-menu.tsx` with category tabs, search and Book `?s=`, memberships, team with Book
  `?p=`, gallery, reviews + Review us on Google, about, Visit us with Google map embed and week hours, closing Book band,
  navy footer with Shop online when the store is on, phone bar Call / WhatsApp / Book now). `/v/[slug]` uses it;
  `/s/[slug]` shows it first when an own domain opens the website; middleware maps `/book` on own domains to
  `/s/<host>/book` (booking wizard). Settings: Front Desk → Setup → **Website and booking**
  (`components/salon/salon-website.tsx`: on/off, link, cover, tagline, about, colour, photos, what to show, Instagram,
  the shared `StoreAddress` card from `storefront-settings.tsx` with `kind="website"`, and "You also have an online
  store" → what the domain opens); `GET/PUT /api/salon/website`. One domain per business (`organizations.store_domain`).
  Tests `tests/front-desk-website.test.cjs`. Checked with local screenshots (390 / 1280, 320 no sideways scroll).
  **Not merged to `v4` yet; not tried on a real own domain.**
- **Online store redesigned like a big marketplace, and an AI chat on it** (owner, 19 Nov 2026: "Flipkart feel ...
  professional, not a dummy website ... enable the chat bot in the site"). Not a copy of any marketplace's look: the
  shop's own colour (`--c`), no gradients. `app/s/[slug]/store-parts.tsx` (Picture contain, Stepper, `RatingChip`,
  `PriceLine` MRP struck + % off, `ProductCard` with heart / brand / stars, `Rail`, `TrustStrip`, `SearchBox` with
  suggestions, `FilterPanel`, `SortTabs`, `Sheet`, `OffersList`); `storefront.tsx` keeps every cart / checkout /
  Razorpay / account behaviour and lays out: colour header + wide search, category bar, banners, trust strip, rails
  (Deals for you, Recently viewed, Top rated, Best of <category>, Saved for later; localStorage `store-wish:` /
  `store-recent:`), list with side filters (lg) or Sort / Filter sheets (phones), product page (offers, options,
  delivery + PIN check, services, seller, details, reviews; Add to cart / Buy now under the photo, bottom bar on
  phones), cart "Price details" + "You save", navy footer, phone bottom menu (Home, Categories, Account, Cart);
  `?q=` search from a product page. `lib/commerce/store-browse.ts` (pure: `discountPercent`, `sortProducts`,
  `filterProducts`, `priceRanges`, `dealProducts`, `topRated`, `categoryRails`, `searchProducts` / `searchSuggestions`
  spelling-tolerant with `soundKey` / `editDistance`). Store products now carry `mrp` (`metadata.attributes.list_price`,
  product form **MRP** field → `parseProductAttributes` `mrp`; the products route lets a typed MRP win), `brand`,
  `addedAt` (`productExtras`) and `rating` / `ratingCount` (published reviews, `ratingsFor`). **AI chat**:
  `storefront.chat` (Website tab switch "AI chat on your website"); `loadStore` sets `chat` only when on, AI on and
  products or knowledge exist. `POST /api/public/store/[slug]/chat` (20 per 10 min per address, 600 a day per store,
  AI wallet feature `website_chat`): `answerFromKnowledge` with `channel: 'website'` and `products` (`chatProductHits`
  in `lib/commerce/store-chat.ts`, kind `product`), returns reply, product cards the answer used (`chatProductCards`,
  `AnswerResult.used`), follow-up buttons, FAQ attachments, and `handoff` → "Message the shop on WhatsApp"; an
  unanswered question goes to the knowledge gaps. Widget `app/s/[slug]/store-chat.tsx` ("Ask us", starters, product
  cards with Add to cart, sessionStorage). Tests `tests/store-browse.test.cjs`, `tests/store-chat.test.cjs`. Checked
  with local screenshots (360 / 390 / 1280, no sideways scroll at 320). **Not merged to `v4` yet.**
- **AI replies in each channel's own style, and smarter search** (owner, 19 Nov 2026: "improve the searching mechanism
  and sending messages style ... instagram and whatsapp"). `lib/ai/reply-format.ts` (pure): `ReplyStyle` {tone friendly |
  professional | short, emoji, buttons, typing} kept in `organizations.ai_handoff.style` (no new column; `GET/PUT
  /api/ai/handoff` take `style`; Settings card "How the AI replies, and when it hands a chat to your team" with a
  WhatsApp / Instagram preview). The model also returns `next` [{label ≤20 chars, question}]; `answerFromKnowledge`
  returns `plan` {text, buttons, link}: quick buttons (≤2 follow-ups + "Talk to a person" on answered replies) or, for a
  single used FAQ link, a link button. WhatsApp (`whatsappMessage`): *bold* / • lists, interactive reply buttons (body
  ≤1,024, ≤3, ids `aq:<full question>`) or `cta_url`, else text; the plain twin is sent when Meta refuses the
  interactive one; "typing…" + read via `whatsappTyping(messageSid)`. Tapped `aq:` buttons become the typed question
  (`askedByButton` in the webhook; `interactiveButtonId` cleared). Instagram (`instagramMessages`): no formatting marks
  (`forInstagram`), ≤1,000 bytes per message (`splitMessage`, ≤3), quick-reply chips on the last (`dmBodies`
  `quickReplies`, `sendDm`), `sendTyping` (sender_action typing_on); `readIgWebhook` reads `quick_reply.payload` "aq:".
  Meta's docs could not be opened from the cloud session (developers.facebook.com blocked): shapes are from memory —
  **check buttons, chips, cta_url and typing on a real number / account.** Search (`searchKnowledge`): meaning search in
  both the English search text and the customer's own words (one embeddings call; `mergeByMeaning`), 10-minute
  in-memory vector cache (`embedTexts`), `rankHits` (exact question first via `gapKey`, strong word overlap ×1.3, FAQs
  ×1.015 tiebreak), `withNeighbours` (a matching document part gets the parts before and after it, overlap removed by
  `joinPassage`). Playground shows the buttons and a tap asks the question behind it. Tests `tests/reply-style.test.cjs`.
- **Knowledge base: websites, PDFs, documents, text, and FAQ attachments** (owner, 19 Nov 2026: "PDFs, FAQs supports
  images videos, links and PDFs, chunking, web scraping"). Sources in `knowledge_sources` (kind website / pdf / document
  / text; status processing → ready / failed with a plain reason; lock 724519033, migration `20261207_knowledge_sources.sql`).
  Each source is read and split into parts (`chunkText` in `lib/ai/knowledge-text.ts`: ~1,100 characters, keeps its
  heading, 150 overlap; `chunkTitle` "Source — heading — page N") saved in `knowledge_base` as `kind = 'part'` with
  `source_id` (ON DELETE CASCADE), `chunk_index`, `source_url` (the page), and search vectors set in batches by the
  `set_knowledge_embeddings` RPC; the shared search finds FAQs and parts alike (`withDetails` adds kind, source name,
  attachments). Reading: `lib/ai/knowledge-sources.ts` — PDF with `unpdf` (page by page; scanned PDFs have no text →
  plain message), Word .docx with `mammoth` (headings kept), .txt/.md/.csv; websites with `readWebsite` (one page, or
  the whole site up to 25 pages through robots.txt sitemaps + links, robots.txt Disallow kept, 2-minute budget);
  `fetchPublic` refuses private / local addresses at every redirect (DNS checked), 3 MB per page. Both readers are
  `serverExternalPackages` in next.config. APIs: `POST /api/knowledge/upload-url` (signed upload straight to the
  `media-attachments` bucket under `knowledge/<org>/sources|attachments/`, so big files skip Vercel's body limit),
  `GET/POST/DELETE /api/knowledge/sources` (website / file / text / `action: refresh`; read in `after()`,
  `maxDuration` 300; `?id=&parts=1` lists parts). `/api/knowledge` GET lists FAQs only (no vectors) and POST/PATCH take
  `media`. FAQ attachments (`knowledge_base.media`, `cleanMedia`: photo / video / file / link, https, max 5): the model
  answers with `used: [n]`; `answerExtras` sends the used FAQs' photos, videos and files after the words (WhatsApp
  image / video / document by link; Instagram `sendDm` mediaUrl) and adds their links to the reply (`withLinks`); never
  on a hand-off. Screens: Settings → Knowledge Base → "Add knowledge from your website, PDFs and documents"
  (`components/ai/knowledge-sources.tsx`), FAQ form and edit → "Send with this answer" (`components/ai/media-editor.tsx`),
  Playground shows what was found and what would be sent. Tests `tests/knowledge-sources.test.cjs` (fixtures in
  `tests/fixtures/`). **Not tried against real websites, Supabase storage or WhatsApp yet; mobile app not updated.**
- **AI chatbot (RAG) and tickets rebuilt, like a business AI on WhatsApp** (owner, 19 Nov 2026: "rag having lot of issues
  and ticketing ... works like meta bot"). One answer for every place: `lib/ai/faq-answer.ts` `answerFromKnowledge`
  (WhatsApp webhook, Instagram DMs, Playground; Copilot and Twilio use the shared search only, Twilio keeps its own
  embedding and wallet charging). Steps: "talk to a person" (`wantsPerson`, English / Tenglish / Hinglish / Telugu /
  Hindi; the word "agent" alone no longer makes a ticket) goes straight to the team; else the message becomes an English
  search text (always, not only with history), `searchKnowledge` in `lib/ai/knowledge-store.ts` searches by meaning
  (`search_knowledge` RPC, exact, no approximate index so small businesses never miss answers; falls back to
  `match_faqs`) and by words (`search_knowledge_words`: any word, 'simple' + 'english' text search, pg_trgm close
  spellings; falls back to `fallbackKeywordSearch`), ranked together (`fuseResults`, reciprocal rank fusion, top 5).
  The model answers JSON {reply, status answered|chat|unknown|person|complaint, summary, urgent} from business details
  + knowledge only; `parseAnswer` never sends broken JSON. Pure rules in `lib/ai/knowledge-rules.ts`.
  Hand-off (`handOffToTeam`): one open ticket per chat with `reason`, `summary`, `priority` (urgent), `channel`,
  `ai_paused`; AI paused in that chat; pop-up + ticket email. Resolving (tickets PATCH, to-deal) turns the AI back on
  (`afterTicketResolved`); a team reply sets `first_reply_at` and `ai_paused` (`markTeamReplied` in messages/send).
  Settings `organizations.ai_handoff` {pauseAi, resumeOnResolve, keepAiWhenUnsure, message} via `GET/PUT /api/ai/handoff`
  (Settings → General → "When the AI hands a chat to your team", `components/ai/handoff-settings.tsx`). Unanswered
  questions: `knowledge_gaps` (counted once per `gapKey`), `GET/POST /api/knowledge/gaps` (draft = AI writes the FAQ
  from the team's reply in that chat, blanks in [brackets]; answered / ignore), Settings → Knowledge Base
  "Questions the AI couldn't answer" (`components/ai/knowledge-gaps.tsx`). Tickets page: reason / Urgent / Waiting for
  your reply / AI paused chips, summary, filters. Fixed: no reply at all when the embedding failed, the current
  message sent twice to the model, redelivered webhooks answered twice, 300-token cut-off JSON reaching customers.
  Lock 724519032, migration `20261206_ai_knowledge_handoff.sql` (checked on a local Postgres 16 + pgvector). Tests
  `tests/ai-knowledge.test.cjs`. **Not tried against real WhatsApp / OpenAI yet; mobile app not updated.**
- **Instagram** (owner, 19 Nov 2026: DMs in the inbox, comments, live feed on the store, posting). Built on Meta's
  **Instagram API with Unified Login** (Meta says new apps can't set up "Instagram Login"; new features ship on Unified
  Login): Facebook Login for Business with its own configuration `NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID` (never add these
  permissions to the WhatsApp signup configuration), code exchanged with `META_APP_SECRET` at
  `graph.facebook.com/v27.0/oauth/access_token` → Business Integration System User token → `/me/assigned_instagram_accounts`;
  all calls on `graph.facebook.com/v27.0/<ig-user-id>/…` (`IG_GRAPH` in `lib/instagram/rules.ts`). Permissions
  `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_content_publish` + Human Agent
  need **Advanced Access (App Review)** before other businesses can connect.
  - `lib/instagram/rules.ts` (pure: `readIgWebhook` messaging[] + changes[] comments with `id`/`comment_id`, `dmBody`,
    `replyWindow` 24 h / 7 days with HUMAN_AGENT for people only, `feedItem`, `checkCaption`, `productCaption`,
    `igContactKey` "ig:<igsid>"), `store.ts` (lock 724519031, migration `20261204_instagram.sql`: `instagram_accounts`
    one per workspace, `instagram_comments`, `contacts.instagram_id/username`, `conversations.channel`; `connectInstagram`,
    `subscribeWebhooks`, `saveIncomingDm`, `sendDm`, `saveComment`, `actOnComment`, `latestPosts` (cached 30 min on the
    account), `publishPost` single / carousel with status polling), `ai.ts` (`instagramAiReply`: knowledge base, handOff →
    AI off + pop-up).
  - Routes: `GET/POST(connect, resubscribe)/DELETE /api/instagram`, `/api/instagram/comments`, `/api/instagram/posts`,
    `GET/POST /api/webhooks/instagram` (verify token `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, signed with `META_APP_SECRET`).
    `/api/messages/send` sends Instagram chats through `sendDm`. Inbox marks Instagram chats from the contact's
    "ig:" phone (no new column needed in the UI queries); `normalizePhoneDigits` refuses "ig:" so campaigns skip them.
  - **Pulling without webhooks** (19 Nov 2026): Meta sends comment webhooks only to a Live app with Advanced Access, and
    the Meta app had no `instagram` webhook object yet. `syncComments` (latest 20 posts' comments; own replies mark them
    answered), `syncDms` (`/conversations?platform=instagram` threads → inbox; error #200 "disabled access to Instagram
    Direct Messaging" = owner must turn on Instagram app → Message controls → Connected tools → Allow access to messages),
    `listIgChats`, `instagramChecks` (app `/subscriptions` with the app token; DMs allowed). `GET /api/instagram/messages?sync=1`,
    comments `?sync=1`, `/api/instagram?checks=1`.
  - **Meta's call allowance is small** (the first full sync hit "(#4) Application request limit reached"). Syncing keeps
    `instagram_accounts.sync_state` (migration `20261205_instagram_automation.sql`): at most once a minute per kind, only
    threads whose `updated_time` / posts whose `comments_count` changed, ≤5 per check, nothing older than 7 days; a rate
    limit (`isRateLimit`: 4, 17, 32, 613, 80002, 80006) pauses 15 min (`waitUntil`, `slowDownMinutes`) instead of `last_error`.
  - **Auto replies** (`instagram_accounts.automation`, `readIgAutomation` / `parseIgAutomation` / `commentPlan` in rules.ts,
    `lib/instagram/automation.ts`): `dmAi` (AI answers DMs), `commentAi` (`instagramCommentAi`, short public reply or
    nothing), keyword rules (public reply and/or one DM, `{name}`), every other comment, hide words. `answerComment` once per
    comment under a day old (marks `instagram_comments.auto_replied`); `answerDm` for DMs under 2 hours. Run by the webhook
    and after each page check. `PUT /api/instagram` saves them (automation.manage).
  - **Two inboxes** (owner, 18 Nov 2026: "don't combine"): the inbox lives in `components/chat/inbox.tsx` (`Inbox
    channel="whatsapp" | "instagram"`). `/dashboard` = WhatsApp only, `/dashboard/instagram` = Instagram only, same
    screen (`/api/conversations?channel=`; no channel = every chat, for the mobile app; falls back when the `channel`
    column is missing). Instagram inbox: 7-day reply window (`getServiceWindow(..., windowMs)`), no templates, checks
    Instagram on open and every minute (`/api/instagram/messages?sync=1&list=0`), note when DMs are not shared / slowed.
    Sidebar badges are split (`unreadInstagramCount`). Thread `participants` fill "Instagram user" names
    (`fillUsernames`; "__deleted__…" → "Deleted account").
  - **Files** (checked live 18 Nov 2026): send `sendKind` (PNG/JPEG photos, MP4/MOV/WebM/OGG/AVI video, M4A/AAC/WAV
    audio, PDF; WebP/GIF/HEIC… → JPEG copy with `sharp`; others refused in plain words), `dmBodies` (file then words =
    two Instagram messages, saved as two rows with their own `IG_<mid>`, `fileMessage` returned to the inbox). Instagram
    goes by the served Content-Type: `/api/media/upload` types files by their ending when the browser sends none, and
    `typedFile` re-uploads an octet-stream file before sending. Received photos / GIFs / videos / voice notes / files are
    copied to `media-attachments/instagram/<org>/` (`keepIgMedia`; Instagram links expire) with body `[Media Attachment]`;
    shares keep label + link. The conversations API has no `sticker` field (asking fails the call) and marks some
    messages `is_unsupported` (e.g. voice notes): shown as `UNSUPPORTED_TEXT`; webhooks deliver those.
  - Screens: menu → **Instagram** = a tab bar (`app/dashboard/instagram/layout.tsx` → `InstagramShell`: connected check
    → else card to Settings; counts; hides on phones while a chat is open) over **Chats** (`/dashboard/instagram`, the
    inbox), **Comments** (`/comments`: posts list + Instagram-style thread, reply in place / as DM), **Posts** (`/posts`,
    grid + New post), **Auto replies** (`/auto-replies`, same settings as Settings). **Settings → Instagram** (`InstagramSettings` in
    `components/instagram/instagram-parts.tsx`: connect / disconnect, "Still to do", tiles, Auto replies; `?tab=instagram`); product form → Post on Instagram; Website → Instagram → "Show my latest posts by themselves"
    (`storefront.instagram.live`, `loadStore` → `instagramFeed`).
- **App: shop features synced** (18 Nov 2026): `mobile/lib/screens/store/shop_more.dart` (`OrderInvoiceBox`,
  `OrderReturnsBox`, `ShopReportsScreen`, `ShopReviewsScreen`, `ShopOffersScreen` + loyalty, settings screens for returns /
  invoices / WhatsApp messages, `DeliveryPartnersScreen`, `shopMoreTiles` on the Store tab); product form GST / HSN /
  weight / Write with AI; website screen layout + Instagram; `codCheckLabel`, `gstRates`, `storeLayouts`,
  `instagramPost` in `store_logic.dart`; demo answers in `lib/data/demo_shop_extras.dart`. 19 Nov: `shop_catchup.dart`
  (`ProductOptionsScreen`, `CourierBox`, `uploadProductsSheet` via `readSheet`, `InstagramScreen` in More), product form
  photos / video / sizes button, website Info pages (`storeInfoPages`), Instagram badge in Chats (`isInstagramContact`).
  Build with Flutter 3.50 (`~/Documents/flutter_versions/flutter3.50.0`); 3.44.6 is too old for the app's Dart 3.13.7.
- **Shop: spreadsheet upload and Write with AI** (4.3): `lib/commerce/product-import.ts` (browser-safe: `IMPORT_COLUMNS`
  headings by name, `checkImport` → products + row errors, SKUs made from names, `given` = filled columns, `sampleCsv`;
  max 500), `POST /api/commerce/products/import` (checks again; inserts new in 100s, updates existing SKUs with only the
  given columns). `components/commerce/product-import-dialog.tsx` (reads .xlsx / .csv with the `xlsx` package, loaded on
  demand). `lib/commerce/product-describe.ts` (prompt + answer check, `DESCRIBE_LANGUAGES`), `POST
  /api/commerce/products/describe` (photo → title / description / category through `aiFetch`, feature
  `product_description`, wallet-charged). Product form → Write with AI.
- **Shop: codes for one customer and loyalty points** (4.2): `commerce_discounts.for_phone` (last 10 digits; `applyDiscount`
  needs `ctx.phoneKey`, which `phoneContext` returns; never in `publicOffers`). `lib/commerce/loyalty.ts` (pure:
  `readLoyaltySettings` {on, percent, minUse, maxPercent} in `organizations.shop_loyalty`, `pointsEarned`, `pointsUsable`,
  `loyaltyLine`), `loyalty-store.ts` (lock 724519029, migration `20261202_shop_loyalty.sql`: ledger `commerce_points`
  unique per order + reason; `earnPointsFor`, `usePoints`, `returnPointsFor`, `pointsBalance`). `lib/commerce/order-delivered.ts`
  `afterDelivered` = review ask + invoice + points, used by orders PATCH, courier webhook, shop cron and the courier panel.
  Store order route: `usePoints` only for a signed-in shopper whose saved phone is the order phone; points join the
  order's discount (`discount_code` "CODE + 120 points"). Account API returns `points`. Offers tab → `LoyaltyCard`.
  Front Desk members (`shop_loyalty.members`): `memberDiscount` (best `plan.discount_percent` of `cardsForCustomer`), same
  signed-in + own-phone rule; replaces the offer only when it saves more; account API returns `member`.
- **Shop: store layouts and Instagram** (4.1): `lib/commerce/store-look.ts` (browser-safe: `STORE_LAYOUTS` grid / big / list /
  compact with `STORE_LAYOUT_INFO`, `cleanInstagramHandle`, `instagramPost` → "p/<code>" or "reel/<code>", max 9). Kept in
  `storefront.layout` and `storefront.instagram` {handle, posts} (`readStorefront`, `storeView`). Store page: `gridClass`
  and `listCard` in `app/s/[slug]/storefront.tsx`; Instagram section uses `https://www.instagram.com/<post>/embed` iframes
  (no API, no token). Website tab → Look (layout picker) and `InstagramCard`.
- **Shop: returns and refunds** (3.5): `lib/commerce/returns.ts` (pure: `readReturnSettings` {on, days} in
  `organizations.shop_returns`, `returnChance`, `cleanReturnRequest` with `RETURN_REASONS`, `refundable`, `parseRefund`;
  the ask lives in `shipping_address.return` asked → accepted / declined → refunded), `returns-store.ts` (lock 724519028,
  migration `20261201_shop_returns.sql`: `commerce_refunds`; `refundOrder` → `refundStorePayment` in store-payments.ts
  when paid through the shop's Razorpay (`shipping_address.payment.payment_id`), else method manual; full refund sets
  `payment_status` refunded; `decideReturn`; WhatsApp purpose `refund_update`). APIs: `GET/POST/PUT /api/commerce/returns`,
  `POST /api/public/store/[slug]/return`. Screens: order details → Returns and refunds (`order-returns.tsx`, also
  `ReturnsSettingsCard`), My orders → Return this order (`ReturnBox` in `app/s/[slug]/account.tsx`; store view `returns`).
- **Shop: reports** (3.4): `lib/commerce/shop-reports.ts` (pure: `buildShopReport` from orders, items, checkouts and visits;
  cancelled and waiting-for-payment orders are not counted; IST days; `readPeriod` 7/30/90), `shop-reports-store.ts` (lock
  724519027, migration `20261130_shop_reports.sql`: `commerce_store_visits` per org per day; `countVisit` exact with the
  direct DB pool, read-then-write without; `loadShopReport`). `POST /api/public/store/[slug]/visit` (one per tab session,
  product pages counted apart), `GET /api/commerce/reports`. Dashboard **Reports** tab (`reports-tab.tsx`); on phones from the
  Store tab (managers) or the bottom bar (others).
- **Shop: GST invoices** (3.2): `lib/commerce/invoice.ts` (pure, browser-safe: `GST_RATES` 0/0.25/3/5/18/40, `readInvoiceSettings`
  / `parseInvoiceSettings` {gstin, legalName, address, prefix ≤5, defaultRate} in `organizations.shop_invoice`, `stateCodeOf`
  names / short forms → GST state code, `financialYear` April–March IST, `shopInvoiceNumber` "WEB/26-27/0001",
  `computeShopInvoice`: prices include GST, offer shared by amount, delivery line at the highest goods rate, IGST when
  the delivery state differs from the GSTIN's state, no GSTIN → plain bill). `invoice-store.ts` (lock 724519026, migration
  `20261129_shop_invoices.sql`: `commerce_invoices` one per order, unique (org, fy, seq), snapshot of shop / customer /
  lines; `commerce_products.gst_rate`; `issueInvoice` retries on a taken number, puts `invoice_token` in the order's
  `shipping_address`; `cancelInvoiceFor`). Issued on Shipped / Delivered (orders PATCH, courier webhook, shop cron) or
  `POST /api/commerce/invoices`; `GET/PUT` there for settings. Public page `/invoice/<token>` (A4 print). Screens: Store
  settings → **GST invoices** (`invoice-settings-card.tsx`), order details → Invoice (`order-invoice.tsx`), product form
  GST rate, My orders → Invoice link. **Credit notes**: `creditNoteLines` / `creditNoteNumber` (CN/26-27/0001, own series)
  in invoice.ts; `issueCreditNote` (lock 724519030, migration `20261203_shop_credit_notes.sql`: `commerce_credit_notes`, one
  per refund) called from `refundOrder`; `/invoice/<token>` shows credit notes too; order Invoice box lists them.
- **Shop: reviews with photos + "How was it?"** (3.3, 2.3): `lib/commerce/reviews.ts` (pure: `cleanReview` 1–5 stars,
  ≤1000 chars, ≤4 https photos; `publicName` "Asha R."; `ratingSummary`), `review-store.ts` (lock 724519025, migration
  `20261128_shop_reviews.sql`: `commerce_reviews` unique per order + product; `reviewToken` kept in
  `shipping_address.review_token`; `askForReview` once per order (`review_asked_at`, purpose review_ask);
  `askForReviewOf` used by orders PATCH → delivered and by courier tracking (`applyTracking` `deps.onDelivered`);
  `saveReviews`, `productReviews`). Customer page `/s/[slug]/review/[token]` (`review-form.tsx`; own domains `/review/<t>`),
  `GET/POST /api/public/store/[slug]/review`, `POST .../review-photo` (token-checked, images ≤4 MB, storage bucket
  `media-attachments` under `reviews/`). Product page `Reviews` + schema.org aggregateRating. Dashboard **Reviews** tab
  (`reviews-tab.tsx`, `GET/PATCH /api/commerce/reviews` hide / show).

- **Shop: selling on WhatsApp** (2.1–2.6): `lib/commerce/shop-messages.ts` (pure: purposes cart_reminder, cod_confirm,
  review_ask, back_in_stock; `readShopMessages` {on, template, language} in `organizations.shop_messages`;
  `templatePayload` with quick-reply payloads; `codok:`/`codno:` button ids; `codCheckLabel`), `shop-messages-send.ts`
  (`sendShopMessage`: off → nothing; inside 24 h free text / buttons; outside only the business's template; logs in the
  chat via `logInChat`, now exported from `lib/salon/whatsapp.ts`). `shop-sales-store.ts` (lock 724519024, migration
  `20261127_shop_whatsapp_selling.sql`: `shop_messages`, `commerce_checkouts`, `commerce_stock_alerts`).
  Cart reminder `cart-reminders.ts` (store checkout saves the cart with the phone → `POST/GET
  /api/public/store/[slug]/checkout`; `sendDueReminders` from `/api/cron/shop`, once, 1–48 h; `?cart=<token>` restores;
  an order marks it recovered). COD check `cod-check.ts` (sent after a COD delivery store order; webhook hands
  `codok/codno` taps to `handleCodButton`; Cancel cancels before shipping and returns option stock; order screen shows
  the answer). Back in stock `stock-alerts.ts` (`POST /api/public/store/[slug]/stock-alert`, product page `BackInStock`;
  `notifyBackInStock` after product / options saves). Reorder: My orders → "Same as last time? Order again" (order
  lines carry `key`). Store settings → **WhatsApp messages** card (`shop-messages-card.tsx`, `/api/commerce/shop-messages`).

- **Shop: info / policy pages and Google** (1.5, 1.6): `lib/commerce/store-pages.ts` (About, Shipping, Returns, Terms,
  Privacy, Contact; `cleanPages`, `starterPage` samples from the shop's own fees / contact, `pageText` falls back to About
  text and contact details), kept in `storefront.pages`; Website tab `PagesEditor`; page `/s/[slug]/info/[page]`; footer
  links (`store.pages`). `lib/commerce/store-seo.ts` (`storeBase` own domain or /s/slug, `sitemapXml`, `robotsTxt`);
  routes `/s/[slug]/sitemap.xml`, `/s/[slug]/robots.txt`; middleware sends `/info/<page>`, `/sitemap.xml`, `/robots.txt`
  on own domains to them. Home / product metadata: canonical, Open Graph (site name, url), Twitter large image.

- **Shop: more photos and a video per product** (1.2): `lib/commerce/product-media.ts` (browser-safe; database side in `product-media-store.ts`; `cleanImages` ≤8 https, `readVideo`
  YouTube watch / youtu.be / shorts / embed or .mp4/.webm/.mov, lock 724519023, migration `20261126_shop_product_media.sql`:
  `commerce_products.images`, `video_url`), saved apart in the products route (`productMediaValues`), product form
  `ProductMedia` (upload several, remove, video link check), store `Gallery` (thumbnails, YouTube nocookie embed or
  `<video>`), schema.org images. PIN check now also says the delivery charge.

- **Shop: offers and discount codes** (1.3 in `docs/PLAN-shop-next-level.md`): `lib/commerce/discounts.ts` (pure: percent,
  flat, free_delivery, buy_get — cheapest items free; min order, first order only, once per phone, dates, total uses;
  `applyDiscount`, `bestAutomatic`, `parseDiscount`), `discount-store.ts` (lock 724519022, migration
  `20261125_shop_discounts.sql`: `commerce_discounts`, `commerce_discount_uses`, orders `discount_code` /
  `discount_amount`; `decideDiscount` typed code else best automatic, `recordDiscountUse` compare-and-set).
  `ManualOrderInput.discount` (total = subtotal − discount + delivery; free delivery waives it). Store order route
  decides on the server and refuses a bad code (field `code`); `POST /api/public/store/[slug]/discount` previews it.
  Checkout "Have a code?" + offer line; cart shows open offers. Dashboard **Offers** tab (`components/commerce/offers.tsx`,
  `GET/POST/DELETE /api/commerce/discounts`); on phones from the Store tab. Order details show the offer.

- **Shop: product options** (size, colour…; Part 2 of `docs/PLAN-shop-next-level.md`): `lib/commerce/variants.ts`
  (pure, browser-safe: `cleanOptions` ≤3 options × ≤20 choices, ≤100 combinations; `buildVariants` keeps id / price /
  stock / SKU of combinations that stay; `findVariant`, `valueAvailable`, `priceRange`), `variant-store.ts` (SQL lock
  724519021, migration `20261124_shop_product_options.sql`: `commerce_products.options`, table
  `commerce_product_variants`, `commerce_order_items.variant_id / variant_name`; `saveProductOptions`, `variantsFor`,
  `changeVariantStock` compare-and-set, never below 0, untracked stays untracked). `GET/PUT /api/commerce/products/options`.
  Store: `loadStore` adds `options`, `variants`, `priceFrom` (`select('*')` on products now); cards say "from" and
  **Choose**; product page option buttons; cart keys are `productId` or `productId:variantId` (also in `cleanCart`);
  `parseStoreOrder` needs a choice and takes its price; stock down in the store order route, back on cancel (orders PATCH).
  Dashboard: product form → **Options (size, colour…)** (`components/commerce/product-options.tsx`, own Save).

- **Shop delivery partners: Shiprocket and Delhivery** (owner: "e-commerce next level ... top 2 delivery integrations
  ... check their official documentations"; plan in `docs/PLAN-shop-next-level.md`, read it first). Each business
  connects its **own** account (like its Razorpay). Built from the official docs (Shiprocket Postman collection at
  apidocs.shiprocket.in; Delhivery delhivery-express-api-doc.readme.io), field notes in the plan and the file headers.
  - `lib/commerce/shipping-rules.ts` (pure: our statuses `booked…delivered/returned/lost`, Shiprocket status ids,
    Delhivery StatusType, `shouldMoveTo` never backwards, `orderStatusFor`, `noticeFor`/`noticeText` WhatsApp words,
    `parcelFor`, `sortRates`, `shipBlocker`, `trackingLink`), `shiprocket.ts` (API user login, JWT 10 days → re-login
    after 9 or on 401, rates, adhoc order → AWB → pickup → label, cancel; a refused AWB cancels the Shiprocket order),
    `delhivery.ts` (`Authorization: Token`, test/live hosts, PIN check, approximate charges S/E, `format=json&data=`
    shipment with the exact warehouse name, pickup request, cancel, tracking), `shipping.ts` (SQL + lock 724519020,
    `withShippingSchema`, settings `organizations.shipping_settings` + secret columns `shiprocket_api_password`,
    `shiprocket_api_token`, `shiprocket_token_at`, `delhivery_api_token`, `shipping_webhook_token`; table
    `commerce_shipments`; products `weight_grams`, `hsn_code`; `ratesForOrder`, `bookShipment`, `cancelShipment`,
    `applyTracking` (moves the order to Shipped / Delivered, COD paid on delivery, one WhatsApp notice per step via
    `shipping-notify.ts` → `notifyOrderStatus`), `refreshShipment`, `dueShipments`, `deliveryCheck`).
  - APIs: `GET/PUT/DELETE /api/commerce/shipping` (admins change), `GET/POST /api/commerce/shipping/ship`
    (rates / book / cancel / refresh / label; records.write), `POST /api/webhooks/parcel-updates` (both partners,
    key in `x-api-key`; no "sr"/"kr" in the path, Shiprocket refuses those), `GET /api/cron/shop` (CRON_SECRET; checks
    open parcels every 30 min: needs a scheduler), `GET /api/public/store/[slug]/delivery-check?pin=` (30/h per IP).
  - Screens: Store settings → **Delivery partners** (`components/commerce/delivery-partners.tsx`), order details →
    **Send with courier** (`courier-panel.tsx`), product form weight + HSN, store product page "Check delivery to your
    PIN code" (`PinCheck`, shown when `store.pinCheck`). Migration `20261123_shop_delivery_partners.sql`.
  - **Not tried with real Shiprocket / Delhivery accounts yet**; Delhivery's tracking answer is not in its public docs
    (read carefully, check with a real token). Mobile app not updated yet.

- **Shop server is live on the owner's Linux server (nginx)** (16 Nov 2026): `https://stores.magnetora.in` is
  served by nginx 1.24 on Ubuntu → Next.js (checked from outside: latest code, Supabase settings in place).
  80/443 belong to the existing nginx, so business domains are added one at a time:
  `deploy/nginx/add-store-domain.sh <domain> <email> [port]` (checks the domain is connected in WAMA and points
  here, adds only `/etc/nginx/sites-available/wama-store-<domain>.conf`, `nginx -t`, reload, certbot) and
  `remove-store-domain.sh`; steps in `deploy/nginx/README.md`. `domainStatus` now says **Connected** only when
  `https://<domain>/api/public/store-domain-check` answers 200 (else "points to us, https being turned on").
  Vercel still needs `STORE_GATEWAY_HOST` / `STORE_GATEWAY_IP` for the Website tab to accept domains.
  **Automatic since 17 Nov 2026**: `deploy/nginx/install-auto-domains.sh <email> [port]` (once) makes
  `STORE_GATEWAY_KEY` in the shop's `.env.local` (openssl, never shown) and a systemd timer
  (`wama-store-domains`, every 2 min) running `sync-store-domains.sh`: reads `GET /api/public/store-domains`
  (header `X-Gateway-Key`, `lib/commerce/server-key.ts`; domains only) from the local shop, adds new domains
  (5-min retry while DNS is not ready, exit 3 from `add-store-domain.sh`; 30 min after a failed certificate), removes ones taken off (only `wama-store-*`, never more than half at once, nothing on a failed list).
  **The shop must run with `next start -H localhost`**, not `-H 127.0.0.1`: with 127.0.0.1, Next treats the
  own-domain rewrite as external and fetches `https://localhost:<port>` → 500 on every business domain
  (reproduced with Next 16.2.6; see `deploy/nginx/README.md`). codeswipes.com was the first domain connected (17 Nov 2026).
  **www**: a main domain's records include `CNAME www → <domain>`; when `www.<domain>` points here,
  `add-store-domain.sh` adds a second server block that 301s to `https://<domain>` and expands the certificate
  (`--cert-name <domain> --expand`); if certbot fails, the old site file is put back. The sync job looks at www
  for already-connected domains every 30 minutes (`<domain>.www-next`).

- **Product page, memberships, appointments, business page** (owner: "product details page is missing", "front
  desk appointment module strong and landing page", "membership cards and membership utilisation"):
  - Store product page `/s/[slug]/p/[productId]` (and `/p/<id>` on own domains: middleware rewrites it and sets
    `x-store-via-domain`; `basePath` prop), schema.org Product data, Buy now, Share, Ask on WhatsApp, related.
    The old product pop-up is gone; cards link to the page.
  - Memberships: `lib/salon/memberships.ts` (SQL, lock 724519019, migration `20261122_front_desk_memberships.sql`:
    `salon_membership_plans`, `salon_memberships`, `salon_membership_usage`, invoices `membership_id` /
    `membership_paid`), pure rules in `membership-rules.ts` (no imports; browser-safe: `readPlan`, `applyCard`
    sessions → discount, `creditToUse`, `cardState`, `membershipReport`…), DB in `membership-store.ts`
    (`cardsForCustomer` by contact or last 10 phone digits, `insertCard` MB-0001…, `recordCardUse`,
    `undoCardsForInvoice`, `adjustCard`, compare-and-set on `updated_at`). Counter actions: `sell_membership`;
    `membership_id` on `complete_and_bill` / `walk_in_bill` (`issueInvoice` takes `membership` credit; payment
    method `membership` when the card covers it); `void_invoice` gives use back / cancels a sold card.
    `GET/POST /api/salon/memberships`; card page `/m/[token]`; WhatsApp `cardMessage`. UI: Front Desk →
    **Members** tab (`salon-members.tsx`: Cards, Plans, Usage, Sell), bill sheet `MembershipBox`
    (`membership-box.tsx`).
  - Appointments: `lib/salon/calendar.ts` (`dayWindow`, `layoutDay` lanes, `weekOf`, `findClash`,
    `periodSummary`), `GET /api/salon/appointments?from&to` and `?history=1`, counter action `reschedule`
    (keeps length, new person takes every service, clash warning, WhatsApp). UI: Front Desk → **Appointments**
    tab (`salon-appointments.tsx`: Day grid by person / phone list, Week, List, filters, numbers, sheet with
    Move, Bill, No-show, Cancel, past visits). Phone bottom bar: Desk · Calendar · Members · Bills (+More);
    managers reach Reviews / Team from a chip row on phones.
  - Business page `/v/[slug]` (services with Book `?s=`, team with `?p=`, memberships, good reviews with first
    names, hours, map); linked in Setup → Booking page. **Mobile app not updated for these yet.**

- **Shop customer accounts** (owner: "for the shop add the oauth for users also they can see their products
  purchased, cart and history tracking"): shoppers sign in with Google on the store page (setting
  `storefront.accounts`, default on; web + app switch). `lib/commerce/store-accounts.ts`: table `store_shoppers`
  (per store: name, phone, address, saved cart; RLS on, server only) + `commerce_orders.shopper_id` (migration
  `20261121_store_accounts.sql`, lock 724519018); `shopperFrom` (Bearer Supabase token → `db.auth.getUser`),
  `cleanCart` / `mergeCarts`, `shopperStatus` / `orderTimeline` / `shopperOrderView` (plain words, no workspace
  ids), `trackOrder` (order number + phone, last 10 digits). APIs: `GET/PUT /api/public/store/[slug]/account`
  (signed in), `POST /api/public/store/[slug]/track` (guests, 20/h), and the order route links the order and
  saves details. Browser: `lib/commerce/shopper-client.ts` (own Supabase client, `storageKey: 'wama-shopper'`,
  PKCE, apart from the dashboard login; `safeReturn`, `packSession`), sign-in page `/s/[slug]/signin` (always on
  WAMA's address; hands the session to a store's own domain in `#shopper=`), `app/s/[slug]/account.tsx`
  (`useShopper`, `AccountPanel`: Sign in, My orders, order timeline, Track an order). Supabase needs
  `https://wamacrm.magnetora.in/s/**` in Redirect URLs. **Not tried against real Google yet.**

- **Own domains only through our Hostinger server** (owner: "Domain Connect is not vercel ... hostinger linux
  server ... I will deploy"): all Vercel domain code removed from `lib/commerce/store-domain.ts` (no
  `VERCEL_TOKEN` etc.). The only way is the store server in `deploy/gateway/` (Hostinger VPS, Ubuntu 24.04,
  Caddy): `domainsAvailable()` = `STORE_GATEWAY_HOST` + `STORE_GATEWAY_IP` set; records are CNAME →
  `stores.magnetora.in` or A → the VPS IP; status comes from DNS; `PUT` refuses (503) until it is set up.
  The owner installs the server himself (README Part 2: `git clone`, `setup.sh`; the script stops if Apache /
  Nginx / LiteSpeed hold ports 80/443). The GitHub workflow stays as an optional extra.

- **Store domain gateway, store fixes and a testing report** (owner: "do all the changes ... fix all the bugs ...
  test cases ... testing report"): `deploy/gateway/` (Caddyfile with on-demand certificates that ask
  `GET /api/public/store-domain-check`, `setup.sh` for Ubuntu, README with the steps) and
  `.github/workflows/deploy-gateway.yml` (**manual only**, SSH key and `STORE_GATEWAY_KEY` as Actions secrets).
  When Vercel has `STORE_GATEWAY_HOST` + `STORE_GATEWAY_IP`, `store-domain.ts` uses the gateway (records point at
  it, connected = DNS points there, no Vercel calls); the middleware trusts `X-Store-Domain` only with
  `X-Gateway-Key` = `STORE_GATEWAY_KEY` (16+ chars). Fixes: the store Razorpay webhook now finds the order
  (`findStoreOrder`: Razorpay ORDER notes, then payment notes, then `shipping_address->payment->>order_id`);
  an unfinished payment is kept in localStorage (`store-unpaid:<slug>`) and checked on reload; no paying for a
  cancelled order (410); 15 s limit on Razorpay calls; `app/s/[slug]/not-found.tsx`; design polish (solid
  header, pay choices stack under 360 px, `showPhone` in `lib/phone-display.ts`). Report: `docs/TESTING-REPORT.md`
  (590 web + 326 app tests, bugs fixed, test cases, what still needs a real try). **Gateway not set up yet;
  Caddyfile not validated by Caddy itself here.**

- **Store on the business's own domain** (owner: "custom domain like Shopify ... two options, ours or custom
  domain"): Website tab → **Store address** (web `StoreAddress` in `storefront-settings.tsx`, app
  `store/store_address.dart`): "Our address (free)" or "My own domain". `lib/commerce/store-domain.ts`:
  `cleanDomain`, `isRootDomain` (A `76.76.21.21` for a root domain, CNAME `cname.vercel-dns.com` otherwise;
  Vercel's recommended values used when given; TXT when Vercel asks for proof), `addDomain` / `removeDomain` /
  `domainStatus` through Vercel's API (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`; without them the
  option says it is not set up). New column `organizations.store_domain` (unique; migration
  `20261120_store_domain.sql`, lock 724519017). `GET/PUT/DELETE /api/commerce/storefront/domain` (PUT/DELETE
  admins). (Vercel's domain API was used here at first; replaced by our Hostinger store server, see above.)
  `middleware.ts` rewrites every non-API page on a host that is not WAMA's (`lib/commerce/store-host.ts`
  `isOwnHost`: *.magnetora.in, *.vercel.app, NEXT_PUBLIC_APP_URL, `STORE_APP_HOSTS`, IPs) to `/s/<host>`, and
  `loadStore` finds the store by `store_domain`. Later, for many domains: a small Ubuntu gateway (Caddy with
  on-demand certificates) in front, same settings screen. **Not tried against Vercel yet.**

- **Store website filled from the business's details, with made pictures** (owner: "Prefill the data ... full
  store configuration, generate images"): `suggestStorefront` in `lib/commerce/storefront.ts` builds a full page
  from the workspace (name, `contact_phone`, `contact_address`, `whatsapp_default_phone`, shipping fee / free-from),
  Front Desk details (`salon_settings` name, phone, address, logo) and products (categories by count, first https
  photo). `GET /api/commerce/storefront` returns `suggested` always, and uses it as `settings` with
  `prefilled: true` while the store was never saved (nothing is saved until Save; never switched on by itself).
  `fillStorefront` / the web and app "Fill blanks" button fill only empty parts. Pictures with no photo are drawn
  by `lib/commerce/store-art.ts` (flat SVG banners in 4 designs, initials logo, category tiles; no gradients) at
  `GET /api/public/store-art?kind=banner|logo|tile&c=&name=&n=`; they follow the store colour when it changes
  (`c=` is rewritten). The app cannot draw SVG, so it shows a made picture as a coloured box (`madePicture`).

- **Razorpay on the online store website** (owner: "Online store website (/s/shop). Integrate the razorpay"):
  each business connects **its own** Razorpay (money goes to the business, not WAMA): new columns
  `organizations.store_razorpay_key_id / _key_secret / _webhook_secret` (in the storefront migration; hidden
  from `/api/organization` by `isSecretColumn`). `lib/commerce/store-payments.ts`: `checkStoreKeys` (reads one
  order), `createStorePayment` (Razorpay order in paise, notes = our order), `verifyStoreSignature`,
  `verifyStoreWebhook`, `paidPayment` (asks Razorpay), `markStoreOrderPaid` (amount must match; once, by
  `payment_status <> 'paid'`; transaction row; "Paid online" pop-up). Settings `storefront.payment` =
  later | online | both, `payOptions` (online only when keys are saved; never no way to pay). Order route:
  `pay: 'online'` → order `payment_pending` + `payment_method razorpay`, Razorpay order id kept in
  `shipping_address.payment.order_id`, page opens checkout.js; `POST /api/public/store/[slug]/pay`
  (signature → paid; `action: 'check'`; `action: 'later'` → pay on delivery when allowed);
  `POST /api/public/store/[slug]/razorpay-webhook` (business's webhook secret). Keys: `GET/PUT/DELETE
  /api/commerce/storefront/payments` (PUT checks the keys with Razorpay first; admins). Web Website tab →
  Online payment (Razorpay) + two switches, Cash on delivery and Pay now (owner: only these two options, as
  switched on); app Website screen the same. Page: Pay now / Cash on delivery
  choice, "Payment not finished" with Try again / Pay later instead. **Not tried with real Razorpay keys yet.**

- **Online store website for each business** (owner: "e-commerce store front page website, carousel,
  categories, fully dynamic, responsive, ordering products from the page"): public page **`/s/<org slug>`**
  (`app/s/[slug]/page.tsx` + `storefront.tsx`): top strip, header with search and cart, banner carousel
  (slides by itself, swipe, arrows, dots; a tap opens a category or a link), round category pictures, product
  grid (2/3/4 columns), product sheet, cart kept in localStorage, checkout (name, phone, pick up or delivery
  with address, note; pay on delivery / pick up), "Send this cart on WhatsApp", footer with address, call and
  WhatsApp. `lib/commerce/storefront.ts`: settings in new column `organizations.storefront` (JSON;
  migration `20261119_storefront.sql`, lock 724519016), `readStorefront` cleans everything (https pictures
  only, 8 banners, colour presets), `loadStore` (off unless enabled and the store is on), `storeView` (no
  workspace id), `parseStoreOrder` (prices from the product list, stock, minimum order, pick-up/delivery
  rules), `deliveryCharge`. `POST /api/public/store/[slug]/order` (rate limited per address and phone) saves
  it with `createManualOrder` as channel `website` and pops up "New website order". Settings: `GET/PUT
  /api/commerce/storefront`; web E-commerce → **Website** tab (`components/commerce/storefront-settings.tsx`:
  on/off, link + QR, name, line, strip, logo, colour, banners with upload/order/what a tap opens, category
  order and pictures, pick up / delivery, charges, note, minimum, contact, about); on phones it opens from the
  Store tab. App: Store tab → Online store website (`store/website_screen.dart`). `PhoneField`'s country box
  now keeps its width when the screen's input class says `w-full`.

- **Shop and phone-call orders; Chat and tickets settings for every business** (owner: "in-store purchases
  ... people contact via phone call", "chat and tickets option not showing in settings"):
  `lib/commerce/manual-order.ts` (`parseManualOrder`, `startStatus`, `createManualOrder`): `POST
  /api/commerce/orders {action:'create', channel:'in_store'|'phone', customer, items (product or typed),
  handover:'now'|'pickup'|'delivery', paid, paymentMethod cash/upi/card, shippingFee, address, note}`;
  saved as a normal order with `checkout_type` = channel and `shipping_address.handover` (no new column).
  Taken now = delivered + paid; otherwise paid → To ship, or pay later → `cod_confirmed`. Paid / COD
  orders may now go straight to Delivered (`ORDER_TRANSITIONS`). Web: Orders → **New order**
  (`components/commerce/new-order.tsx`), "In the shop" / "Phone call" labels, "Picked up". App: same
  (`store/new_order_screen.dart`). Settings: the ticket alert emails and chatbot instructions were shown only
  to WAMA CRM's own workspace (`isMasterOrg`); now a **Chat and tickets** card for every admin with its own
  save (`handleSaveChatTickets`), and in the app More → Chat and tickets (`more/chat_tickets_screen.dart`,
  `can.settings` in `/api/mobile/me`). Ticket emails: `lib/ticket-alerts.ts` (`emailTicketAlert`), sent
  from the business's own SendGrid/SMTP or else the platform mailbox, called from `notifyTicketRaised`
  (awaited; the webhooks no longer call `/api/tickets/notify` fire-and-forget).

- **App: E-commerce, and pop-ups for tickets and connectors** (owner: "build E-commerce in the app exact
  whatever in web", "notifications not triggering ... ticket raised ... connectors"): `mobile/lib/screens/store/`
  (`store_screen.dart` shell + Orders and the order page, `products_tab.dart` list / filters / sync / add to
  catalog / add-edit-remove / send product, collection or catalog, `flow_tab.dart` go-live checks + flow preview
  + recent orders' trail, `store_settings.dart` every web store setting; rules mirrored in `store_logic.dart`).
  Same `/api/commerce/*` and `/api/organization` as the web; "Connect catalog with Meta" (Facebook login) opens
  the web. Shown in More → E-commerce, and as a bottom-bar **Store** tab when Front Desk is off.
  `/api/mobile/me` now returns `connectors.ecommerce/pipeline` from the plan (`activeConnectors`). Pop-ups:
  `lib/push-events.ts` (`notifyTicketRaised` from both webhooks, flows and the AI agent; `notifyOrderReady` on
  paid / COD; `notifyDealAssigned` from `createLead` / `updateLead`; `notifyLowReview` for 3★ or less), kinds
  `deal` and `review` with their channels; the webhook's ticket pop-up is awaited (the old fire-and-forget
  `/api/tickets/notify` call could be dropped by Vercel). App: pushes that arrive while it is open show as the
  top banner (`FirebaseMessaging.onMessage`); More → **Test notifications** (`POST /api/mobile/push-test`)
  says exactly why a phone gets nothing. Demo data in `data/demo_commerce.dart`; checks in
  `test/store_screens_test.dart`.

- **Sign-in email code (OTP) re-enabled, with a super-admin bypass** (owner: emails not sending; wanted OTP
  on login + a bypass): `lib/auth/login-otp.ts` (`login_codes` table, migration `20261115_login_codes.sql`,
  lock 724519015; hashed 6-digit codes, 10 min, 5 tries, resend 60 s / 5 per hour; `issueLoginCode`,
  `checkLoginCode`, `clearLoginCode`, `loginCodeEmail`). `POST /api/auth/login` verifies the password,
  emails a code and returns `otpRequired`. **If the code email cannot be sent, login signs the person in on
  the password alone** (`signInNow`) rather than lock anyone out — a mail outage never blocks login. `POST
  /api/auth/verify-otp` rewritten to use `checkLoginCode` (re-checks the password too). Bypass: `isBypassCode`
  honours `LOGIN_OTP_BYPASS` only for `SUPERADMIN_EMAILS` (never hardcoded; set it in Vercel) and lets a super
  admin skip the code step with that code when email is working. **Switched off by default since 18 Nov 2026 (owner: "remove the login otp verification"): the password signs in; `OTP_LOGIN=on` brings the code step back. The sign-up code is off the same way (`signupCodeOn`, `SIGNUP_CODE=on` brings it back; `send-code` then answers `codeNeeded: false` and the page creates the account at once).** Email itself is sent via `lib/email.ts` (platform mailbox from Super Admin → Platform Email,
  or `PLATFORM_SMTP_*` / `HOSTINGER_SMTP_*`; SendGrid fallback); the "email not sending" cause is almost
  always those not being set — Super Admin → Platform Email → Send test shows the real SMTP error.

- **Connectors under the plans** (owner: "check the connectors too"): `GET /api/connectors` also returns
  `active` per connector and `plan` ({connectors, only}); `POST` takes `swap: true` (`connectorSwitch` in
  `lib/plans.ts` switches the others off to make room on a one-connector plan; Starter stays Front Desk only).
  The Connectors page says how many the plan includes, marks extra ones "Not in your plan" and offers
  "Use X instead?". A workspace still on `pro_monthly` (before the plans set-up ran) keeps all connectors
  (`billingLimits`).

- **Sign in / sign up with Google** (website and app; owner chose plain Google sign-in through Supabase
  after trying Firebase as a middleman, Nov 2026: Firebase is for notifications only):
  `components/auth/oauth-buttons.tsx` ("Continue with Google" on /login and /signup via Supabase
  `signInWithOAuth`, `NEXT_PUBLIC_OAUTH_PROVIDERS`, default `google`; `apple` ready for later; remembers
  `?plan=`), `app/auth/callback` (session from the code or the URL hash, then "Name your business" the first
  time), `GET/POST /api/auth/oauth-complete` with `lib/auth/oauth-workspace.ts` (`createWorkspaceFor`:
  business, owner, deal stages, trial on the chosen plan; once). Same email as an existing account = that
  account (Supabase links them). App: `HttpBackend.signInWithGoogle` (browser, back to
  `com.magnetora.wamacrm://login-callback`, intent filter in AndroidManifest), sign-in screen button +
  business step (`AppState.signInWithGoogle` / `finishGoogleSignUp`). Needs Google switched on in Supabase
  (Web OAuth client from Google Cloud) with both return addresses allowed. **Not tried against Supabase yet.**

- **Super Admin console redesigned** (owner: "really not good"): `components/superadmin/console-parts.tsx`
  holds `ConsoleOverview` (tiles that open the filtered list, Needs attention with reasons, Plans with
  paying / trial / monthly amount, Trials ending next, Newest), `WorkspaceList` (filter chips with counts,
  plan filter, sort, search, CSV download; table on wide screens, cards on phones; last chat, wallet, AI) and
  `ConsoleSetup` (new **Setup** tab: billing, Razorpay keys and webhook, WAMA's WhatsApp number, Firebase,
  "Send a test to my phone" → `POST /api/superadmin/push-test`). Server: `attentionFor` (payment failed,
  ended, trial ending, WhatsApp not connected, message wallet low, AI used up), `planBreakdown`, `last_active_at`
  (latest conversation) in `lib/superadmin-workspaces.ts`; `billing-setup` GET also returns `push`.
  Navy / blue / grey, red only for what needs attention.

- **Pop-up notifications (Firebase)**: `lib/push.ts` (FCM HTTP v1 with a service-account JWT, no SDK;
  `sendPush(db, {organizationId, userIds?, exceptUserId?}, notice)` never throws; forgets unregistered
  phones), table `device_tokens` (migration `20261113_push_devices.sql`, lock 724519014),
  `POST/DELETE /api/mobile/devices`, `/api/mobile/config` returns `firebase` (public values). Sent on: a
  customer's message (the chat's assignee, else everyone; one per chat by tag), a WhatsApp cart order, a
  booking or request (WhatsApp and the booking page), a ticket assigned. App: `data/push.dart`
  (`firebase_core` + `firebase_messaging`, started from Dart with the server's values, so there is no
  `google-services.json` and no Google Gradle plugin; registers the phone after sign-in, removes it on
  sign-out; taps open the chat / bookings / tickets through `Notifier.tapped`), `Notifier.pushOn` stops
  the second (local) notification in the background, channels `messages`/`bookings`/`orders`/`tickets`.
  Env: `FIREBASE_PROJECT_ID`, `FIREBASE_ANDROID_APP_ID`, `FIREBASE_API_KEY`, `FIREBASE_SENDER_ID`,
  `FIREBASE_SERVICE_ACCOUNT` (secret). **Not tried on a real phone yet.**

- **Starter on WAMA's number + booking page** (owner: Front Desk only without WhatsApp; all other plans
  need WhatsApp): `lib/shared-whatsapp.ts` (four fixed utility templates `wama_booking_confirmed`,
  `wama_booking_reminder`, `wama_bill_ready`, `wama_feedback_request`; charged to the message wallet before
  sending, refunded on refusal/failure; `shared_messages` table), `sendToCustomer` routes Starter
  (`whatsapp_mode = shared`) there, webhook `/api/webhooks/wama-shared` (failed → refund; a customer reply
  gets the business's phone once a day), Super Admin "WAMA's WhatsApp number" panel (submit templates).
  Uses WAMA CRM's own number from the existing `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_BUSINESS_ACCOUNT_ID` /
  `WHATSAPP_API_TOKEN` (owner: "take from the env"); its events arrive at the platform workspace's normal
  webhook, which hands statuses and Starter customers' replies to `handleSharedStatus` / `handleSharedIncoming`
  (those replies skip the platform chatbot). Those settings are not in Vercel, so `findSharedNumber(db)` falls
  back to the number connected in WAMA CRM's own workspaces (ids in `PLATFORM_WORKSPACES`, Meta only; or
  `WAMA_SHARED_WORKSPACE_ID`); the Super Admin panel says which one is used, or why none is.
  Optional separate number: `WAMA_SHARED_*` + `/api/webhooks/wama-shared`. Growth/Pro: inbox, campaigns, templates,
  flows, tickets show "Connect your WhatsApp first" until a number is connected; Starter lands on Front Desk.
  Public booking page `/b/<org slug>` (`lib/salon/booking-page.ts`, `app/b/[slug]`, APIs
  `/api/public/booking/[slug]` and `/times`; `?p=` person, `?s=` service; rate-limited; booked or request
  per "accept on their own"; confirmation through the normal sender), Setup → Booking page with links and
  QR codes (`qrcode` package).

- **Plans (phase 1 of `docs/PLAN-plans-signin-stores.md`)**: `lib/plans.ts` (Starter ₹999 on WAMA's
  number + Front Desk only, Growth ₹2,500, Pro 1/2/3 ₹6,000/9,000/12,000; limits, Super Admin
  overrides, upgrade difference), migration `20261111_plans_and_message_wallet.sql` (lock 724519013,
  also run with the billing migration), Razorpay plan per tier found/created by itself (optional env
  `RAZORPAY_PLAN_<ID>`), `POST /api/billing/change-plan` (trial switch; upgrade pays the difference
  then new auto-pay from the bill date; downgrade from the bill date; `pending_subscription_id`),
  monthly AI credit per plan payment, message wallet (`lib/message-wallet.ts`, Meta's price, no markup,
  charge/refund once), plan checks (`verifyOrgAccess(..., { feature })` → 402; team size; connectors via
  `activeConnectors`), web `/pricing`, Billing plan picker + message wallet, sign-up `?plan=`, Super Admin
  plan/limits/wallet, app Billing (plans list, change plan, wallet; `--dart-define=STORE=true` hides buy
  buttons). The old ₹3,000 plan reads as Growth; old workspaces keep all connectors (override).

- **App: Tickets, Templates and Billing like the web** (owner: "without missing a single feature"):
  - **Tickets** (`chats/tickets_screen.dart`, a "Tickets" chip in Chats): counts, Open/Resolved, search,
    dates, Load more, assign (managers), open chat, move to Sales Pipeline, resolve / reopen. Server:
    `GET /api/tickets?view=list` (status, q, from, to, offset, counts; `meta=1` adds team, stages, can)
    and `POST /api/tickets/to-deal` (createLead + link conversation + resolve).
  - **Templates** (`templates/`): list with filters, quality, rejected reason, status updates, 20 s
    re-check while in review; create with AI (`/ai-draft`) or by hand (all 12 types); editor with every web
    section (`template_editor.dart`), preview (`template_preview.dart`), library, insights, edit, add
    language, duplicate, delete. The draft is the web's JSON (`template_model.dart` mirrors the
    constants); the server reads Meta's templates into drafts (`GET ?drafts=1`) and checks a draft
    (`POST {check: true}`), so the rules stay in one place (`validateDraft`). Upload reads the file
    type from its name when the phone sends none. Design (owner, Nov 2026): number tiles that filter
    (All / Active / In review / Rejected), one card per template with its languages as status chips,
    category / type icons (`CategoryIcon`), a template page with Insights / Edit / Add language /
    Duplicate / Delete buttons and details; the editor has Edit and Preview tabs, a live "Ready / N to
    fix" check against the server (debounced `{check: true}`), and section icons. Section errors show
    after the first Submit, like the web.
  - **Billing** (`more/billing_screen.dart`, More → Billing): the web's plan states, subscribe / cancel,
    AI credit with top-ups, payments, plan features and use cases (`GET /api/billing?extras=1`), FAQ.
    Payments use `razorpay_flutter` (native Checkout; the same confirm endpoints as the web; ProGuard
    rules in `android/app/proguard-rules.pro`). `can.billing` added to `/api/mobile/me`.

- **App: chat files you can open and save, and "Grow your business"** (owner, Nov 2026): files customers
  send arrive as `data:` links (the webhook stores them in `messages.media_url`); `chats/media.dart`
  (`ChatMedia`) reads their type, shows photos inline (`Image.memory`), labels PDF / Voice note / Video
  / Word / Spreadsheet, and a tap opens the photo full screen (zoom, Share, Save) or a sheet with
  "Open with an app" (`share_plus`) and "Save to phone" (`FilePicker.saveFile`). More → **Grow your
  business with marketing** (`more/grow_screen.dart`): Magnetora's marketing services (no Google
  reviews, owner's call; Google and Meta ads, video editing, photos, Instagram/Facebook promotion) with WhatsApp us
  (+91 83676 29608, `url_launcher` to wa.me). New packages: `share_plus`, `url_launcher`.
  Bill page (`bill_screen.dart`) redesigned as a receipt: business and total on green, status chip,
  customer with Call, items with who did them, Subtotal / Discount / CGST / SGST / Total, then Mark paid,
  Send on WhatsApp, Copy link and Share, Cancel at the bottom.

- **Booking flow: questions in the middle of a booking** (owner, web server + app): a customer who
  writes something during a booking (session moved in the last 60 minutes, `activeBookingSession`)
  gets the usual assistants (Front Desk assistant, shopping assistant, FAQ chatbot), then the step
  they were on again with "To carry on with your booking:" (`resumeBooking`, run from POST through
  `options.afterReply` / `carryOnBooking`; not when the Front Desk assistant moved to offering times).
  "cancel" stops the booking at any step (`cancelBooking`). A typed-answer step no longer saves a
  question as the answer (`looksLikeQuestion`, English + Tenglish/Hinglish words; mirrored in Dart).
  Try it: typed questions get a real answer (`POST /api/salon/booking-flow/try-question` runs the
  Front Desk assistant with `collect`, nothing sent; falls back to `/api/ai/playground-chat`), then
  the step again.

- **Booking flow: pick services with tick boxes in one WhatsApp form** (owner's choice, web and app):
  `booking_flow.services_style` = `'form'` (default) or `'list'`, chosen on the Pick services step.
  `lib/salon/services-form.ts`: one Meta Flow per WhatsApp account (`servicesFormJson`: 10
  CheckboxGroups shown/hidden by data, 20 services each), published once on save
  (`ensureServicesForm`, Meta id in new column `salon_settings.services_form`, migration
  `20261118_front_desk_services_form.sql`; a refusal is remembered and retried after an hour). The
  services ride in the message (`flow_action_payload.data`), so service changes need no republish.
  Token `bk:<session id>`; the webhook passes the `nfm_reply` to `handleServicesForm`, which saves the
  ticks (max 5) and runs the next step with "You picked: …". Session `waiting = 'form'`; the customer
  can reply LIST for the list. Falls back to the list when: style is list, "More than one service"
  is off, not Meta Cloud API, publishing failed, or more than 10 groups. App: `ServicesFormCard`,
  Try it (`tickBoxes`). **Needs a deploy, and has not been tried against Meta yet.**

- **Front Desk: services from the catalog, "Use in bills", change history** (web and app): Setup →
  Services → **From catalog** lists `commerce_products` with tick boxes (search, category chips, tick
  all; minutes, GST, category and "Use in bills" for the ticked ones), `GET/POST /api/salon/catalog`
  (`lib/salon/catalog.ts`; `action: 'refresh'` copies new catalog names and prices). New columns on
  `salon_services`: `billable`, `source`, `catalog_product_id`, `image_url` (migration
  `20261117_front_desk_catalog_and_history.sql`, also in `lib/salon/schema.ts`). A service with
  `billable = false` can be booked but never billed (`loadServices(..., forBill)` refuses it; bill and
  checkout pickers hide it). **Change history**: `salon_change_log` table, `logChange` in
  `lib/salon/change-log.ts` (best effort, never fails a save) called from services, categories, staff,
  settings, templates and catalog routes; `GET /api/salon/history`; web Setup → History, app Setup →
  Change history (`catalog_history.dart`).

- **App layout (owner, Nov 2026)**: bottom bar = Front Desk · Bills · Chats · More (WhatsApp's four);
  Contacts, Campaigns, Reviews and Team live in More. Front Desk has two WhatsApp-style tabs, **Bookings**
  (today first; calendar icon / date header picks another day) and **Requests** (WhatsApp booking requests
  with a count, Accept all, auto-accept switch); `BillsScreen` is its own tab. Animated splash
  (`lib/ui/splash.dart`, logo pops in on #008069) after the Android start screen in the same green
  (`launch_background.xml`, `values-v31`). Text weights capped at w700 (no extra-bold). Sign-in has no
  "Create an account" (sign-up stays on the web).

- **App: WhatsApp colours** (owner's choice, Nov 2026; overrides "no green" for the **mobile app only**,
  the website keeps navy/blue): `Brand` in `mobile/lib/ui/theme.dart` now holds WhatsApp's palette
  (`blue` = action green #008069, `green` = unread badges #25D366, `bubble` = picked / own message
  #D9FDD3, `navy` = dark text #111B21, WhatsApp greys). Front Desk home redesigned like WhatsApp's
  home: green "Front Desk" title, days as status-style bubbles (`_DayStrip`), one numbers strip, visits
  grouped In now / Coming up / Done as chat-like rows with the next step. Logo (owner's pick, "option 5", window C):
  a shop front with a striped awning and a receipt in the window, white on WhatsApp dark green
  #008069; no currency sign (the product is for any country). Used as the launcher icon (adaptive icon in
  `mipmap-anydpi-v26`, background colour in `values/colors.xml`), `assets/app_icon.png` on sign-in and
  the web favicon. Front Desk tab icon = `Icons.storefront` (outline, filled when picked).
- **App: WhatsApp-like look** (owner's choice): white lists with round avatars
  (`Avatar` picks one of three quiet tones by name), pill search (`SearchField`), soft filter chips
  (`FilterChips`; picked = light blue with a blue edge, theme `chipTheme` / `segmentedButtonTheme`),
  flat rows (`FlatRow`), rounded-square FABs, sentence-case section titles, More as a settings list,
  Front Desk tabs as chips with Book / New bill as corner buttons. Do not bring back navy-filled chips.

- **Booking flow: every step editable + new styles + Try it** (web and app): services / staff /
  datetime take the business's own words (`text`, with {service}); new step types `image` (photo +
  caption, WhatsApp image), `link` (words + button, WhatsApp `cta_url`) and `location` (name, address,
  Google Maps link; a map pin when the link has coordinates — `mapsCoordinates` — else the address
  with an "Open map" button). {name} and {business} work in every step's words. `stepProblem` (one
  rule, mirrored in the app) says what a step still needs; `parseSteps` flags blanks like
  "[insert …]". The AI drafter knows the new types and gets the business address. App: step sheets for
  each type (photo upload), shared bubbles, and **Try it as a customer** (`booking_try_screen.dart`,
  tap through the flow with real services, team and hours; nothing sent). Chip text colour fixed for
  phones (theme `labelStyle` uses a `WidgetStateColor`; `test/chip_colors_test.dart`).
  **The new step types need the server deployed**: an older server drops them when saving.

- **App: Campaigns like the web, simpler** (`mobile/lib/screens/campaigns/`): list with totals
  (`summary`), search, status filters and Load more; campaign page (`campaign_screen.dart`: numbers,
  message, Replies → opens the chat, Everyone with status filters; Send now / Cancel a scheduled one,
  Stop, send again to those who missed it or to everyone); new campaign on one page
  (`new_campaign_screen.dart`: template, My contacts with Choose people (tags any/all/none, past
  campaigns got / did not get, ticks) or Upload a list (.xlsx/.csv, `excel` package), blanks from a
  contact field or a column or the same text, send-from number, now / quick times / any date and time).
  Same APIs as the web (`/api/campaigns`, `/run`, `/stop`, `/rerun`, `/scheduled`, `/participants`,
  `/senders`); number rules mirror `lib/campaigns/audience.ts` in `campaigns/audience.dart`. WhatsApp
  only (SMS/email stay on the web). Front Desk Visits: one-tap next step (Arrived → Start → Bill) and
  booking requests in one card. Layout checks: `test/screen_check.dart` (320px, 412px, large text).
  App changes are pushed with `[skip ci]` until the owner has seen the pictures (a push builds the APK).

- **App: every web Front Desk feature** (`mobile/lib/screens/front_desk/`): Visits / Bills / Reviews / Team
  tabs; any day on Visits (`DayBar`), date ranges on Bills, Reviews and Team (`range_bar.dart`,
  `FrontDesk.billsKey`); Setup (`setup_screen.dart`: services + categories, team with commission and
  services, business details + logo + GSTIN, WhatsApp assistant / hours / reminders / feedback / review
  link; `setup_templates.dart`: a template per message, or send the suggested one to Meta); checkout
  (`checkout_screen.dart`: extras, who did each, discount); walk-in bills with who did each, discount and
  "Same as last time" (customer lookup with visits); cancel a bill, copy bill link; Reviews (call back) and
  Team (sales, commission). The app calls `/api/salon/tick` every 2 minutes, like the web counter. Setup
  edits are online-only (`app.ask`); counter actions stay offline-capable. Demo answers in
  `data/demo_front_desk.dart`.

- **App: live chat and notifications**: Supabase realtime on `messages`/`conversations` (filter by
  `organization_id`, `HttpBackend.live`); banner in the app, phone notification in the background
  (`mobile/lib/data/notifier.dart`, `ui/notice_host.dart`); booking requests checked every 30 s and
  after a customer writes. Notifications when the app is fully closed need Firebase push (not set up).
  Front Desk: "Accept WhatsApp bookings on their own" + Accept all. Skeletons (`ui/skeleton.dart`)
  and form checks (`ui/validate.dart`). Android compiles against SDK 37 with desugaring (notifications).
- **Custom booking flow steps** (web Setup → Booking flow, and the app): the business arranges its own
  steps (`booking_flow.steps`: services, staff, choice = question with buttons, text = typed answer,
  message, datetime last; checked by `parseSteps`), and "Write with AI" drafts them
  (`POST /api/salon/booking-flow/draft`). Runs with a booking in progress per customer
  (`salon_booking_sessions`, `bs:` button ids with session + step); typed answers are caught in the
  webhook before the AI; answers go on the booking's notes via `salon_chat_offers.notes`.
  Lists already sent with `bf:` ids still work (`startStatelessFlow`, `handleBookingFlowButton`).
- **Sign-up with an email code** (web and mobile): `POST /api/auth/signup/send-code` emails a 6-digit
  code (10 min, 5 tries, resend once a minute, 5 an hour; only a hash is stored in `signup_otps`,
  `lib/auth/signup-otp.ts`, lock 724519012); `POST /api/auth/signup` needs `code`.
- **WhatsApp booking flow** (Front Desk → Setup → Booking flow; `salon_settings.booking_flow`,
  `lib/salon/booking-flow.ts`, settings in `booking-flow-settings.ts`): a customer sends "Book" (trigger
  words are set by the business) and picks services (category first if more than 10; "Add another" after each, up to 5, setting `multi_select`, ids packed to 22 chars each), who (optional),
  day, then a time from the same list as the assistant (`sb:` ids, `handleSlotPick`). Choices ride in
  `bf:` button ids, so there is no state table. Hooked in the Facebook webhook before the AI assistant.
- `PATCH /api/conversations` (AI replies on/off, mark read) for the mobile app.
- Mobile app: full chat features (AI on/off, AI suggestions, Rephrase, files, reply-to, tickets),
  Knowledge base, Try the AI chatbot, Booking flow settings, Sign up with code.
- **Android download link**: GitHub Actions (`.github/workflows/mobile-android.yml`) builds the app and publishes
  `releases/download/mobile-latest/wama-crm.apk`. The app reads the public Supabase URL and key from
  `GET /api/mobile/config`, so no keys are built in. Signing key: optional repo secrets (see the workflow).
- (mobile) **Flutter app in `mobile/`** (see `mobile/README.md`): Front Desk, Chats, Contacts,
  Templates, Campaigns, **offline first** (Hive copy + outbox synced in order). Server additions:
  `GET /api/mobile/me`, and `client_ref` on `/api/salon/act` so a replayed action is done once
  (`salon_action_log`, `lib/salon/action-log.ts`). Demo mode: `--dart-define=DEMO=true`.
  Flutter SDK is not in the cloud image; it was downloaded to `/opt/flutter-sdk` for the build.
- Store settings: **Turn off cart** (switches the WhatsApp cart button off on Meta).
  Front Desk: **service categories** you can add, rename, reorder and remove (Setup → Services →
  Categories; new column `salon_settings.service_categories`, `/api/salon/categories`); the "Counter"
  tab is now **Front Desk** with its own icon (`components/salon/front-desk-icon.tsx`); phone numbers
  take a **country code** (`components/phone-field.tsx`, `parsePhoneNumber` in `lib/salon/spoken.ts`);
  bills, reminders and feedback check the **24-hour WhatsApp window before sending** (Meta accepts a
  free text and fails it later), so a closed window sends the set-up template or nothing.
- `4ce54f0`: Phone bottom bar follows the connector you are in (Pipeline, E-commerce, Front Desk).
- `923b915`: **Sales Pipeline** as a connector, fully rebuilt: Board (drag or Move menu), List (search,
  filters, CSV), Follow-ups (overdue/today/tomorrow/later, Done + next follow-up, Snooze), Reports
  (pipeline, won, win rate, average deal, days to close, by stage/source/person, lost reasons), Stages
  editor (managers), deal sheet (WhatsApp/call, stage steps, follow-up presets, notes/calls, won/lost
  with reason, AI summary, history), new deal with contact lookup. New column `leads.next_follow_up_at`.
  Public API: `/v1/leads`, `/v1/leads/{id}`, `/v1/leads/{id}/activities`, `/v1/pipeline-stages`.
- `cb47287`: Front Desk templates must be set up by the business; simpler colours.
- `afa4073`: Front Desk tabs in the phone bottom bar.
- `c56f6eb`: Salon renamed to **Front Desk** for any business; a template per message type with AI
  writer; contacts sync in customer lookup; **public API v1 + API keys + /developers docs**.
- `49f62f2`, `b98237a`: simpler counter (voice and typed commands removed), responsive everywhere,
  date range filter, Reviews tab.
- Earlier Front Desk work: GST invoices on WhatsApp, logo, staff on each service, WhatsApp booking
  assistant with approval, reminders, feedback form, team performance and commission, template pack.
- Before that: billing (₹3,000 plan, Razorpay, trial), AI wallet, team roles, admin console, login
  redesign, WhatsApp commerce (catalog sync, cart, payments, AI shopping assistant), templates manager,
  flow builder, campaigns, landing page.

**Deployed**: production was updated on 25 Nov 2026 (owner: "deploy it to production") by moving `v4` from `40e522f`
to the handoff branch `ccr-7a545d5a-4kbhlw` (fast-forward, 49 commits: ₹300 Starter and plan checks on the server, trial
lock, account deletion, the security lock-down screen, sign-up with mobile number, Expenses and the monthly AI review,
and everything else above since 20 Nov). Vercel project `marketing-crm` is Git-connected to this repo; production
deploys are made from `v4`. Still for the owner after this deploy: in Vercel remove or update `RAZORPAY_PLAN_STARTER`
(it may still point at the old ₹999 plan), run Super Admin → Setup → Database security once, submit
`wama_order_confirmed` in Super Admin → WAMA's WhatsApp number, set `FIREBASE_SERVICE_ACCOUNT` for pop-ups.
Before that: 14 Nov 2026 (plans and billing, WAMA's number for Starter, the booking page), and `cf4c324` (10 Nov 2026).

## Open items and ideas

- **The big plan in progress**: `docs/PLAN-plans-signin-stores.md` (plans ₹999–₹12,000, WAMA's own
  number, Google/Apple sign-in, Firebase notifications, E-commerce in the app, Play Store and App Store).
  Read it first and update its Progress table.

- The inbox keeps WhatsApp's green look and the landing page still has green and gradients (to be redone with the
  new brand name).
- Ideas not yet done: WhatsApp message to a deal straight from the pipeline with a template; a deal
  created automatically from a new WhatsApp chat; the AI summary uses its older endpoint
  (`/api/ai/summarize`) and could be moved into the pipeline API.

## Testing the UI locally without the real database

The previous sessions used a small local mock of the Supabase REST API plus Playwright screenshots
at widths 320–1440. Those helper scripts were scratch files and are **not** in the repo. To try the UI,
point `.env.local` at a Supabase project (a test one, never production data) and run `npm run dev`.
For logic, prefer unit tests with `tests/salon-fake-db.cjs`.

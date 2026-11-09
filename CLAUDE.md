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
- **Design: simple colours.** Navy `#0E1B3D`, one blue `#1D5BEA` (hover `#174bc4`), greys
  (`#f4f6fa #eef1f6 #e3e8f2 #d5ddeb #4a5672 #6B7894 #8a94a8`), and red `#b91c1c` / `#fdf0f0` **only** for
  things needing attention. **No gradients, no rainbow colours.** (Older pages still have emerald/green
  bits; don't spread them into new work.)
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
- Tests: `npm test` → `node --test tests/*.test.cjs` (about 450 tests; they import `.ts` files through
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
Twilio: `TWILIO_*`. AI: `OPENAI_API_KEY`, `AI_PRICE_MARKUP`, `AI_USD_INR_RATE`.
Billing: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_ID`, `RAZORPAY_WEBHOOK_SECRET`.
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
- **Money**: rupees with Indian grouping; short form lakh/crore (`formatMoney` in `lib/pipeline/rules.ts`).
- **WhatsApp templates**: Front Desk sends nothing from a template until the business sets one up
  (Front Desk → Setup → Templates); an AI writer helps draft them. There are no built-in default templates.
- **Public API**: `apiAuth(request, scope)` checks the key, scope, a 120/min rate limit and the plan.
  Errors are `{ "error": { "code", "message", "field"? } }`. Scopes: contacts, messages, templates,
  front_desk read/write, leads read/write.

## What has been built (recent history, newest first)

- **App: WhatsApp-like look** (owner's choice): brand colours kept; white lists with round avatars
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

**Deployed**: production is on `4ce54f0` (deployed 9 Nov 2026, Vercel project `marketing-crm`,
Git-connected to this repo; production deploys are made from branch `v4`).

## Open items and ideas

- **Waiting on the owner**: should the active item in the phone bottom bar be navy instead of the
  current green? (The whole bottom bar and sidebar still use emerald for "active".)
- Older pages (inbox, commerce, settings) still use emerald/teal accents and some gradients; the owner
  prefers the simple palette above. Change them only when asked or when touching that page.
- Ideas not yet done: WhatsApp message to a deal straight from the pipeline with a template; a deal
  created automatically from a new WhatsApp chat; the AI summary uses its older endpoint
  (`/api/ai/summarize`) and could be moved into the pipeline API.

## Testing the UI locally without the real database

The previous sessions used a small local mock of the Supabase REST API plus Playwright screenshots
at widths 320–1440. Those helper scripts were scratch files and are **not** in the repo. To try the UI,
point `.env.local` at a Supabase project (a test one, never production data) and run `npm run dev`.
For logic, prefer unit tests with `tests/salon-fake-db.cjs`.

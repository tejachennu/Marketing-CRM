# Plan: plans, WAMA's own number, Google/Apple sign-in, notifications, app store release

Status: **agreed with the owner, not started.** Build in the order of the phases below. Each phase
ends with tests, typecheck and build passing, and a push. Nothing goes to production until the owner
says "Deploy it". Update the "Progress" table at the bottom as phases finish.

## 1. Decisions (owner, Nov 2026)

| Topic | Decision |
|---|---|
| Ways to join | **WAMA's number** (no WhatsApp onboarding; send-only, no inbox) or **own WhatsApp number** (full product) |
| Plans (monthly, + 18% GST) | Starter ₹999 · Growth ₹2,500 · Pro 1 ₹6,000 · Pro 2 ₹9,000 · Pro 3 ₹12,000 |
| Free trial | 14 days on every plan |
| Message charges (Starter) | Prepaid **message wallet** at **Meta's exact price, no markup**. Failed messages are not charged. Razorpay's top-up fee is absorbed by Magnetora |
| Ads support / video campaigns | A **service by Magnetora's team**, not an app feature. The plan says what is included; the app has a "Request" button |
| Existing ₹3,000 customers | Move to **Growth (₹2,500)** from their next bill |
| Sign-in | **Google** (web + Android + iPhone) and **Sign in with Apple** (iPhone; Apple requires it when Google is offered). Email + code stays |
| Notifications | Firebase Cloud Messaging (Android + iPhone) |
| Play Console | Personal account → 12 testers for 14 days before going public |
| Payments for **plans and top-ups** | On the **website only** (store rules). The store apps show the plan, never a buy button or an outside-payment link |
| Payments for the **business's own customers** | Razorpay is fine in the app (bills, orders, booking advances are real-world goods and services) |

## 2. Plans and what each one switches on

One source of truth: `lib/plans.ts` (new). Every limit is a number that Super Admin can change for one
workspace (override) without a deploy.

| | Starter | Growth | Pro 1 | Pro 2 | Pro 3 |
|---|---|---|---|---|---|
| Price / month | ₹999 | ₹2,500 | ₹6,000 | ₹9,000 | ₹12,000 |
| WhatsApp | WAMA's number | Own | Own | Own | Own |
| Inbox, AI replies, tickets | – | ✓ | ✓ | ✓ | ✓ |
| Campaigns, templates, flows | – | ✓ | ✓ | ✓ | ✓ |
| Connectors | Front Desk only | 1 of Front Desk / E-commerce / Sales Pipeline | all | all | all |
| Booking page + QR | ✓ | ✓ | ✓ | ✓ | ✓ |
| Team members | 3 | 5 | 10 | 20 | unlimited |
| AI credit each month | – | ₹300 | ₹500 | ₹1,000 | ₹1,500 |
| Ads support (Magnetora team) | – | ✓ (setup + monthly check) | ✓ | ✓ | ✓ |
| Video campaigns a month (Magnetora team) | – | – | 2 | 4 | 8 |

Team, AI credit and video numbers above are **starting guesses**; the owner can change them in
`lib/plans.ts` or per workspace in Super Admin.

Plan ids: `starter`, `growth`, `pro_1`, `pro_2`, `pro_3`. The old `pro_monthly` reads as `growth`.

## 3. Phases

### Phase 1: Plans and billing (web + server)

Server
- `lib/plans.ts`: `PLANS` (id, name, price paise, features list for the page, limits, `whatsapp: 'shared' | 'own'`),
  `planOf(row)`, `limitsOf(org)` (plan limits + Super Admin overrides), `can(org, feature)`.
- Database (auto-migration + `supabase/migrations/` file, new lock id): `organization_billing.plan`
  holds the plan id; new columns `plan_overrides jsonb`, `pending_plan text` (downgrade at the end of the
  period), `message_balance numeric`, `whatsapp_mode text` (`shared` | `own`).
  New table `message_charges` (org, message id, kind, price paise, status `charged` | `refunded`, created_at).
- Razorpay: one Razorpay plan per WAMA plan. Env names (values in Vercel only):
  `RAZORPAY_PLAN_STARTER`, `RAZORPAY_PLAN_GROWTH`, `RAZORPAY_PLAN_PRO_1`, `RAZORPAY_PLAN_PRO_2`,
  `RAZORPAY_PLAN_PRO_3`. `RAZORPAY_PLAN_ID` keeps working as Growth.
- `POST /api/billing/subscribe` takes `plan`. **Upgrade** = new subscription now (Razorpay charges the
  new price; the unused part of the old month is not refunded, said clearly on the page). **Downgrade** =
  `pending_plan`, switched when the current period ends (webhook `subscription.charged`).
- Migration of existing customers: `pro_monthly` → `growth`; their Razorpay subscription is moved to the
  Growth plan at the next renewal (Razorpay "update subscription" with `schedule_change_at: cycle_end`).
- **Message wallet** (Starter, and anyone on WAMA's number): top-ups through the same Razorpay order flow
  as the AI wallet (`/api/billing/topup` with `wallet: 'messages'`). Price per message = Meta's rate for
  the category and country (`lib/message-prices.ts`, a table with the date it was checked; Super Admin can
  edit). Charge when Meta accepts the message; refund on a `failed` status webhook. Below ₹100: email +
  in-app notice. At zero: messages stop, bookings carry on, the counter says "Top up to send WhatsApp messages".
- Access: `layout.tsx` and the API helpers use `can(org, feature)` instead of "has a plan". Pages a plan
  does not include show an "Upgrade to Growth" card instead of the page.

Web
- `/pricing` (public) and Settings → Billing: plan cards, monthly price + GST, "messages at Meta's price",
  compare table, FAQ, upgrade / downgrade / cancel, message wallet with top-ups and a usage list.
- Super Admin: change a workspace's plan, overrides, wallet credit.

Tests: plan limits, upgrade/downgrade dates, wallet charge/refund exactly once, old plan id mapping,
access per plan.

### Phase 2: Google and Apple sign-in

- Supabase Auth providers: Google, Apple (owner sets them up in Supabase; keys never in the repo).
- Web: "Continue with Google" on `/login` and `/signup` (`signInWithOAuth`, redirect `/auth/callback`, new route).
- App: `google_sign_in` + `sign_in_with_apple` packages → `signInWithIdToken` (no browser hop). The
  client ids come from `GET /api/mobile/config` (env: `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`).
- First sign-in with no workspace → **Get started** (web and app): business name, type of business
  (salon, clinic, dental, pet clinic, fitness, tutor, consultant, shop, other), phone, and
  "Use WAMA's number (start in 2 minutes)" or "Connect my own WhatsApp". Type of business fills in
  hours, example services and words (Doctor / Tutor / Trainer). Picks a plan; trial starts.
- Account linking: a Google sign-in with the same email as an existing account joins it (Supabase
  "link identities"), never a second account.

### Phase 3: WAMA's number (send-only) and the public booking page

- **WAMA's WhatsApp account** set up by the owner in Meta (company email; not written in the repo). Env:
  `WAMA_SHARED_PHONE_NUMBER_ID`, `WAMA_SHARED_WABA_ID`, `WAMA_SHARED_ACCESS_TOKEN`.
- Utility templates on WAMA's account (submitted once from Super Admin, "Shared number" page):
  booking confirmed, booking reminder, booking changed, booking cancelled, bill ready (with link),
  feedback request. Every one names the business and ends with
  "This number does not take replies. To talk to {business}, call {phone}."
- Sending: `lib/salon/whatsapp.ts` `sendToCustomer` is the one place Front Desk messages go out. When
  `whatsapp_mode = 'shared'` it sends the matching shared template from WAMA's number, charges the
  message wallet, and logs it on the booking/bill (no conversation, no inbox). Same for reminders and
  feedback in `lib/salon/jobs.ts`.
- Replies to WAMA's number: the webhook for WAMA's account finds the business from the customer's last
  message (phone → latest `message_charges` row) and auto-replies once a day: "This number only sends
  booking messages for {business}. Please call {phone}." Unknown sender → a general WAMA reply.
- **Public booking page** `wamacrm.magnetora.in/b/<slug>` (available on every plan):
  services → person (or Any) → day → time → name + phone → booked (or "Request sent" when approval is on).
  Uses the existing services, staff, opening hours and `availability.ts`. Links + QR codes for the
  business, each person and each service (Front Desk → Setup → Booking page; download QR as PNG,
  printable poster). Rate limited, with a phone check by code sent from WAMA's number when the slot is
  booked online (stops fake bookings).
- Manage link in every confirmation: `/b/<slug>/m/<token>` to change or cancel (until the cut-off
  hours set by the business).
- Per-person hours and leave (`salon_staff.hours jsonb`, new table `salon_staff_leave`) used by the
  booking page, the WhatsApp flow and the counter.
- Switching to own number later: Settings → WhatsApp → connect (existing onboarding); `whatsapp_mode`
  becomes `own`; plan moves to Growth or higher.

### Phase 4: The app for three kinds of account

`GET /api/mobile/me` adds `plan`, `whatsapp_mode`, `connectors` (on/off for front_desk, commerce,
pipeline) and `can.*` per feature. The app picks its layout:

| Account | Bottom bar | More |
|---|---|---|
| Front Desk (own number) | Front Desk · Bills · Chats · More | Contacts, Campaigns, Templates, Reviews, Team, Setup, Billing, Grow |
| Front Desk on WAMA's number (Starter) | Front Desk · Bills · Booking page · More | Reviews, Team, Setup, Message wallet, Plan |
| Chatbot only (no connector) | Chats · Campaigns · Tickets · More | Contacts, Templates, AI, Knowledge base, Billing, Grow |
| E-commerce | Orders · Products · Chats · More | Store, Go live, Payments, Contacts, Campaigns, Templates, Billing |

More than one connector → a switcher at the top of More ("Front Desk / Shop / Pipeline"), remembered
per phone. Pages a plan does not include show an "Upgrade on the website" card (no price, no buy
button in store builds: `--dart-define=STORE=true`).

### Phase 5: E-commerce in the app

Same APIs as the web (`/api/commerce/orders`, `/products`, `/catalog`, `/order-flow`, `/send`,
`/go-live-checks`, `/meta-detect`): orders list with status filters, order page (items, customer, call /
WhatsApp, payment, change status, send update), products (list, add/edit with photo, price, stock,
on/off, sync with Meta catalog), store settings (cart on/off, payment methods UPI / card / COD,
delivery charges), go-live checklist. Demo data like the Front Desk. Layout checks at 320 / 412 px.

### Phase 6: Firebase notifications

- App: `firebase_core`, `firebase_messaging`, `flutter_local_notifications` (already there). Options
  from `/api/mobile/config` (env: `FIREBASE_PROJECT_ID`, `FIREBASE_ANDROID_APP_ID`, `FIREBASE_IOS_APP_ID`,
  `FIREBASE_API_KEY`, `FIREBASE_SENDER_ID`). No `google-services.json` in the repo.
- Server: table `device_tokens` (user, org, token, platform, last_seen); `POST/DELETE /api/mobile/devices`;
  `lib/push.ts` sends through FCM HTTP v1 with `FIREBASE_SERVICE_ACCOUNT` (Vercel only).
- Sends on: new customer message (assigned person, else managers), booking request, new order,
  ticket assigned, campaign finished, wallet low. Tap opens the right screen. Settings → Notifications
  to switch each kind off.
- iPhone: APNs key uploaded to Firebase by the owner.

### Phase 7: Legal pages, account deletion, store builds

Web pages (plain English, linked from the site footer, the app's More → About, and both store listings):
`/terms`, `/privacy` (rewrite: WhatsApp data, customer records the business keeps, AI processing,
payments, Firebase, data kept and deleted, contact), `/refunds` (subscriptions: cancel any time, no
refund for a started month; wallet credit: refunded only on account closure, minus used; failed
payments; how to ask), `/shipping` ("digital service, starts on payment"; Razorpay needs it),
`/contact`, `/delete-account` (how to delete; what is kept for tax law, e.g. bills, for 8 years).
**To be checked by a lawyer/CA before launch.**

App
- More → Account → **Delete my account** (owner of the workspace: deletes the workspace after typing
  its name; staff: removes only themselves). Server `DELETE /api/mobile/account`.
- About page with the legal links and the app version.
- Store build flavour: `STORE=true` hides every buy button and outside-payment link for plans/top-ups.

Android (Google Play)
- Permanent upload key (owner makes it; four GitHub secrets already supported by the workflow).
- Workflow builds an **AAB** for Play next to the APK. Version code from the run number.
- Play listing: short and full description, 8 phone screenshots (from `test/screen_check.dart` demo
  screens), feature graphic, icon, Data safety form, content rating, target audience (18+, business),
  privacy policy URL, delete-account URL, a reviewer login (demo workspace).
- Closed testing: 12 testers for 14 days, then production.

iPhone (App Store)
- Apple Developer account (owner, $99/year). Bundle id `com.magnetora.wamacrm`.
- `mobile/ios/` exists (default Flutter project): set the bundle id, Sign in with Apple and push
  capabilities, camera/photos usage texts, app icon.
- GitHub Actions on a macOS runner builds and uploads to TestFlight (secrets: App Store Connect API key,
  certificate, profile; owner adds them).
- App Store listing: screenshots (6.7" and 5.5"), privacy labels, reviewer demo login, review notes
  explaining that subscriptions are bought on the website (guideline 3.1.3(b) "multiplatform").

### Phase 8: Test on real phones and submit

Owner's phone checks (Android + iPhone): sign in with Google/Apple, Get started, each account type's
bottom bar, booking page booking → WAMA-number confirmation, notification when the app is closed,
delete account. Then closed testing (Play) and TestFlight, then submission.

## 4. What the owner does (cannot be done from code)

1. Razorpay: create the five plans (amounts above, monthly) and add their ids to Vercel.
2. Meta: WAMA's own WhatsApp account and number (company email), add its ids/token to Vercel.
3. Google Cloud: OAuth clients (Web, Android with package `com.magnetora.wamacrm` + SHA-1 of the
   permanent key, iOS). Supabase → Authentication → Providers → Google.
4. Apple: Developer account, Sign in with Apple key, APNs key; Supabase → Providers → Apple.
5. Firebase: Android + iOS apps, the five settings and the service account in Vercel.
6. Permanent Android signing key + the four GitHub secrets.
7. Play Console account, 12 testers' Gmail ids.
8. Lawyer/CA check of the legal pages.

All keys go only into Vercel, Supabase, Firebase or GitHub secrets. Never in the repo, never in chat.

## 5. Risks and notes

- **Meta and a shared number**: messages for many businesses from one number must be clearly utility
  (booking/bill), name the business, and never be marketing. Marketing campaigns need the business's
  own number. Quality rating of WAMA's number must be watched (Super Admin page shows it).
- **Meta prices change**: `lib/message-prices.ts` keeps the date checked; Super Admin can update.
- **Store review**: no in-app purchase of plans in store builds; reviewer demo account must work
  without a real WhatsApp number (demo workspace).
- **Apple** requires Sign in with Apple, account deletion, and a working demo login.
- The iPhone project in `mobile/ios/` has never been built or signed; Phase 7 sets it up.

## Progress

| Phase | Status |
|---|---|
| 1 Plans and billing | not started |
| 2 Google / Apple sign-in | not started |
| 3 WAMA's number + booking page | not started |
| 4 App for three account kinds | not started |
| 5 E-commerce in the app | not started |
| 6 Firebase notifications | not started |
| 7 Legal, delete account, store builds | not started |
| 8 Real-phone tests and submission | not started |

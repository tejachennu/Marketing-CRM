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
Twilio: `TWILIO_*`. AI: `OPENAI_API_KEY`, `AI_PRICE_MARKUP`, `AI_USD_INR_RATE`.
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
- **Money**: rupees with Indian grouping; short form lakh/crore (`formatMoney` in `lib/pipeline/rules.ts`).
- **WhatsApp templates**: Front Desk sends nothing from a template until the business sets one up
  (Front Desk → Setup → Templates); an AI writer helps draft them. There are no built-in default templates.
- **Public API**: `apiAuth(request, scope)` checks the key, scope, a 120/min rate limit and the plan.
  Errors are `{ "error": { "code", "message", "field"? } }`. Scopes: contacts, messages, templates,
  front_desk read/write, leads read/write.

## What has been built (recent history, newest first)

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
  - Screens: menu → **Instagram** (`app/dashboard/instagram/page.tsx`: connect via `loadMetaSdk` + `FB.login` config_id,
    Comments, Posts); product form → Post on Instagram; Website → Instagram → "Show my latest posts by themselves"
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
  admin skip the code step with that code when email is working. `OTP_LOGIN=off` skips the whole step. Email itself is sent via `lib/email.ts` (platform mailbox from Super Admin → Platform Email,
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

**Deployed**: production was updated on 14 Nov 2026 from branch `v4` (Vercel project `marketing-crm`,
Git-connected to this repo; production deploys are made from `v4`), with everything above: plans and
billing, WAMA's number for Starter, the booking page, "Connect your WhatsApp first", and the server side
of pop-up notifications. Previous production commit: `cf4c324` (10 Nov 2026).

## Open items and ideas

- **The big plan in progress**: `docs/PLAN-plans-signin-stores.md` (plans ₹999–₹12,000, WAMA's own
  number, Google/Apple sign-in, Firebase notifications, E-commerce in the app, Play Store and App Store).
  Read it first and update its Progress table.

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

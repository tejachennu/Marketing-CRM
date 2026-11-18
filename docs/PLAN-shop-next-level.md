# Shop: next level (Shopify-like, WhatsApp soul)

Owner (17 Nov 2026): "e-commerce next level ki vellali ... features like Shopify also but our soul don't need
to miss ... integrate the top 2 delivery integrations ... check their official documentations ... create a plan first".

**Our soul (never lose it):** the shop runs on WhatsApp. Every step a customer takes (cart, payment, shipping,
delivery) is also a WhatsApp message they can reply to. The shopkeeper runs it from a phone, in plain words.
Shopify bolts WhatsApp on with paid apps; we start from it.

## What we build in this round (in this order)

| # | Part | Why first |
|---|------|-----------|
| 1 | **Delivery partners: Shiprocket and Delhivery** | Every shop that ships asks for it; it also gives the PIN code check |
| 2 | **Product options** (size, colour, weight…) with a price and stock for each | Clothes, shoes, food: cannot sell without it |
| 3 | **Discount codes** (percent, flat ₹, free delivery; minimum order, uses, dates) | First thing shopkeepers ask after options |
| 4 | **Cart reminder on WhatsApp** (left without ordering → reminder with a link back) | Our soul: Shopify does this by email |
| 5 | App screens for 1–4, tests, testing report, handoff notes | Web first, then the app, like before |

Each part is pushed on its own, with tests, typecheck and build passing.

## 1. Delivery partners

**Whose account:** each business connects **its own** Shiprocket or Delhivery account, like its own Razorpay.
The courier bills the business's wallet / contract; WAMA never holds courier money. (A WAMA-run master account
can come later if the owner wants to resell shipping.)

### What the official docs say (read 17 Nov 2026)

**Shiprocket** (`https://apiv2.shiprocket.in`, official Postman docs at apidocs.shiprocket.in):
- Login `POST /v1/external/auth/login` `{email, password}` of an **API user** (Settings → API → Configure →
  Create API user; a different email from the main login) → JWT `token`, **valid 10 days**, sent as
  `Authorization: Bearer <token>`. Rate limit header seen: 180 requests.
- Rates `GET /v1/external/courier/serviceability/?pickup_postcode&delivery_postcode&weight(kg)&cod(1/0)&declared_value`
  → `data.available_courier_companies[]` (`courier_company_id`, `courier_name`, `rate`/`freight_charge`,
  `cod_charges`, `estimated_delivery_days`, `etd`, `rating`, `cod`) and `data.recommended_courier_company_id`.
- Order `POST /v1/external/orders/create/adhoc` (required: `order_id` ≤50 chars and never reused, `order_date`
  "yyyy-mm-dd hh:mm", `pickup_location` = an existing pickup location name, `billing_customer_name`,
  `billing_address`, `billing_city`, `billing_pincode`, `billing_state`, `billing_country`, `billing_email`,
  `billing_phone`, `shipping_is_billing`, `order_items[]` {`name`,`sku`,`units`,`selling_price` incl. GST,
  `discount`,`tax`,`hsn`}, `payment_method` "COD"/"Prepaid", `sub_total` (not computed for us), `length`,
  `breadth`, `height` cm > 0.5, `weight` kg > 0) → `order_id`, `shipment_id`, `status`.
- AWB `POST /v1/external/courier/assign/awb` `{shipment_id, courier_id}` → `response.data.awb_code`, `courier_name`.
- Pickup `POST /v1/external/courier/generate/pickup` `{shipment_id: [id]}` (AWB first; Sundays/holidays move to
  the next day) → `response.pickup_scheduled_date`.
- Label `POST /v1/external/courier/generate/label` `{shipment_id: [id]}` → `label_url` (PDF).
- Cancel `POST /v1/external/orders/cancel` `{ids: [shiprocket order id]}`.
- Pickup locations `GET /v1/external/settings/company/pickup` → `data.shipping_address[].pickup_location`, `pin_code`.
- Tracking `GET /v1/external/courier/track/awb/{awb}` → `tracking_data.shipment_status` (number),
  `shipment_track[].current_status`, `edd`, `shipment_track_activities[]`.
- Webhook: Settings → API → Webhooks, POST JSON, optional token sent as **`x-api-key`**, must answer 200,
  URL **must not contain** "shiprocket", "kartrocket", "sr" or "kr". Body: `awb`, `current_status`,
  `current_status_id`, `shipment_status`, `shipment_status_id`, `order_id`, `etd`, `scans[]`.
- Status codes: 6 Shipped, 7 Delivered, 8 Cancelled, 9 RTO Initiated, 10 RTO Delivered, 17 Out For Delivery,
  18 In Transit, 19 Out For Pickup, 21 Undelivered, 42 Picked Up (full list in the docs).

**Delhivery** (Express / B2C, official docs at delhivery-express-api-doc.readme.io; staging
`https://staging-express.delhivery.com`, production `https://track.delhivery.com`):
- Auth: header `Authorization: Token <API token>`; the token is **given by Delhivery's onboarding team**,
  different for test and production.
- PIN check `GET /c/api/pin-codes/json/?filter_codes=<pin>` → `delivery_codes[].postal_code` with `pre_paid`,
  `cash`/`cod`, `pickup` ("Y"/"N"), `is_oda`; empty `delivery_codes` = not served.
- Charges `GET /api/kinko/v1/invoice/charges/.json?md=E|S&cgm=<grams>&o_pin&d_pin&ss=Delivered` → `total_amount`
  (approximate; 40 requests / minute).
- Shipment `POST /api/cmu/create.json`, body **`format=json&data=<JSON>`** with `shipments[]` (`name`, `add`, `pin`,
  `city`, `state`, `country`, `phone`, `order` unique, `payment_mode` "Prepaid"/"COD", `cod_amount`,
  `total_amount`, `products_desc`, `quantity`, `weight` grams, `shipment_length/width/height`, `shipping_mode`
  "Surface"/"Express", `seller_name`, `seller_add`, `seller_inv`, `seller_gst_tin`, `hsn_code`) and
  `pickup_location: {name}` = the **registered warehouse name, exactly (case sensitive)**. No `& # % ; \` in
  values. Waybill left blank = Delhivery assigns one (`packages[].waybill`; `success`, `rmk` on error).
- Label data `GET /api/p/packing_slip?wbns=<waybill>` (JSON to draw the slip; or the panel's label).
- Pickup `POST /fm/request/new/` `{pickup_time "hh:mm:ss", pickup_date "YYYY-MM-DD", pickup_location,
  expected_package_count}` → `pickup_id`. One open pickup per warehouse at a time.
- Cancel `POST /api/p/edit` `{waybill, cancellation: "true"}` (Manifested / In Transit / Pending / Scheduled).
- Tracking pull `GET /api/v1/packages/json/?waybill=<wb>` (750 requests / 5 min per IP) → `ShipmentData[].Shipment.Status`
  {`Status`, `StatusType`, `StatusDateTime`, `StatusLocation`, `Instructions`}. StatusType: UD undelivered (moving),
  DL delivered, RT returned, CN cancelled.
- Push webhook: set up **by Delhivery's team** (we give the URL and header; 5–6 working days). Body `{Shipment:
  {Status:{Status, StatusType, StatusDateTime, StatusLocation, Instructions}, AWB, ReferenceNo, …}}`.
- Not public: the newer Delhivery One docs are behind a login; the public pages do not show a full tracking
  response, so parsing is defensive and must be checked with a real token.

### How it works in WAMA
- **Settings** (E-commerce → Store → **Delivery partners**, admins): connect Shiprocket (API user email +
  password, kept server-side like Razorpay secrets; we log in, keep the token, log in again before 10 days or
  on 401; pick the pickup location from their list) and/or Delhivery (API token, warehouse name exactly as
  registered, test/live). Default package size and weight; each product can have its own weight.
  "Copy webhook address and key" for Shiprocket; the Delhivery push address to send to their team.
- **Order screen** (To ship orders): **Ship with courier** → rates from every connected partner side by side
  (price, days, COD, rating; cheapest and fastest marked) → **Book** → AWB, label PDF, pickup asked for →
  the order moves to **Shipped** with courier, AWB and a tracking link. Cancel the shipment from the order;
  cancelling the order cancels the shipment.
- **Tracking**: Shiprocket webhook and Delhivery push at `/api/webhooks/parcel-updates/<provider>` (no "sr"/"kr"
  in the path; checked with each business's own key), plus a check every 30 minutes for open shipments
  (`/api/cron/shop`, CRON_SECRET, same as Front Desk). In transit, Out for delivery, Delivered, Returned
  update the order; **Delivered** closes it.
- **WhatsApp (our soul)**: "Your order is on the way: <tracking link>", "Out for delivery today", "Delivered.
  How was it?". Sent free inside the 24-hour window, else with the business's own order-update template
  (set up once, AI writer helps, like Front Desk), else nothing.
- **Store page**: "Check delivery to your PIN code" on the product page and in checkout: served or not, COD
  or not, and "arrives in N days", from the connected partner (rate limited).
- **Saved**: new table `commerce_shipments` (order, provider, their order / shipment id, AWB, courier, label,
  status, expected date, scans, last checked); new `organizations` columns for the partner settings
  (secrets match `isSecretColumn`); products get `weight_grams` and `hsn_code`. Auto-migration + a
  `supabase/migrations/` file, lock 724519020.

## 2. Product options
- A product can have up to 3 options (e.g. Colour, Size) and up to 100 combinations, each with its own price,
  stock, SKU and photo. New table `commerce_product_variants`; order lines keep `variant_id` and its name.
- Products tab: "Add options" → type the values → a table to set price / stock per combination.
- Store page: option buttons on the product page (sold-out ones crossed out), price and photo follow the pick,
  the cart line shows "Red / L". Stock goes down when an order is placed, back when cancelled.
- WhatsApp catalog: options sync as items of one group (Meta `item_group_id`) in a later step.

## 3. Discount codes
- Table `commerce_discounts`: code, percent / flat ₹ / free delivery, minimum order, total uses, one use per
  phone, start and end dates, on/off; orders keep `discount_code` and `discount_amount`.
- Store checkout: "Have a code?" box, checked on the server (never trusted from the browser).
  New order (shop / phone) can use a code too. A simple "Offers" list in E-commerce with uses so far.

## 4. Cart reminder on WhatsApp
- When a shopper types a phone at checkout (or is signed in) the cart is saved (`commerce_checkouts`). If no
  order comes within 1 hour: one WhatsApp reminder with a link that brings the same cart back
  (`/s/<shop>?cart=<token>`). Never more than one; stops at once when they order. Business switch, default
  off until a template is set up (Meta needs a template outside the 24-hour window).
- E-commerce shows "Carts left" and "Came back after the reminder".

## What the owner / each business needs to do
- **Shiprocket**: create an API user (Settings → API → Configure → Create API user, another email), type its email
  and password in WAMA; add the webhook address and key WAMA shows (Settings → API → Webhooks).
- **Delhivery**: get the API token from Delhivery's onboarding team; register the pickup warehouse; type the
  token and warehouse name in WAMA; ask Delhivery to switch on push tracking to the address WAMA shows.
- WAMA: `CRON_SECRET` set, and a scheduler calling `/api/cron/shop` every 30 minutes (the shop server's timer
  or Vercel Cron).

## Not tried for real yet (will be marked in the report)
Real Shiprocket and Delhivery accounts (no keys here: everything is built from the docs and tested with fakes),
Delhivery's real tracking response, and the WhatsApp templates for order updates and cart reminders.

## Progress

| Part | Status |
|------|--------|
| Plan | Done (this file) |
| 1. Delivery partners | **Done** (17 Nov 2026): server, settings, ship from order, tracking webhook + 30-min check, WhatsApp updates, PIN check on the product page, product weight / HSN. Not tried with real accounts; screens not looked at in a browser yet. Still to do: template fallback for WhatsApp updates outside 24 h, PIN check in checkout |
| 2. Product options | **Done on the web** (17 Nov 2026): options editor in the product form, store page option buttons (sold-out crossed out), price / photo follow the pick, cart lines per choice, order lines keep `variant_id` / `variant_name`, stock down on order and back on cancel. Still to do: WhatsApp catalog groups, New order (shop / phone) picking an option, the app |
| 3. Discount codes | Done (see 1.3 below) |
| 4. Cart reminder | Done (see 2.1 below) |
| 5. App, tests, report | Not started |

## Full list (owner, 17 Nov 2026: "Please work on all the things")

Order of work: Phase 1 gaps first, then Phase 2 (WhatsApp selling), Phase 3, Phase 4. Each item is pushed on its own.
WhatsApp messages outside the 24-hour window go out only with a template the business sets up once
(E-commerce → Store settings → WhatsApp messages), like Front Desk; inside the window they are free text.

| # | Item | Status |
|---|------|--------|
| 1.1 | Product options with price and stock each | Done (web) |
| 1.2 | More photos per product, plus a short video | Done: up to 8 more photos (upload), a YouTube / .mp4 link, gallery on the product page |
| 1.3 | Discount codes and offers (code, free delivery above, buy X get Y, first order) | Done: Offers tab, checkout code box, decided on the server, use counts, once per phone |
| 1.4 | Delivery check by PIN code (served, charge, days) | Done (product page: served, days, charge, COD) |
| 1.5 | Policy and info pages (About, Returns, Shipping, Contact, Terms) | Done: + Privacy; Website tab editor with samples; footer links; /info/<page> |
| 1.6 | Google findability (site map, titles, share previews) | Done: sitemap.xml, robots.txt (own domains too), canonical, Open Graph + Twitter cards |
| 2.1 | Cart reminder on WhatsApp | Done: cart kept with the phone at checkout, one reminder after an hour (scheduled shop job), link brings the cart back |
| 2.2 | COD confirmation on WhatsApp ("Yes, send it") | Done: buttons after a COD store order; Yes kept on the order, Cancel cancels before shipping |
| 2.3 | Order updates on WhatsApp + "How was it?" review ask | Done: courier updates (on the way, out for delivery, delivered) + review link when Delivered |
| 2.4 | "Ask on WhatsApp" with the product attached, answered by the AI | Done: the message carries the product, option, price and link; the shopping assistant answers |
| 2.5 | Back-in-stock alerts on WhatsApp | Done: "Tell me when it's back" (product or size / colour); one message when stock returns |
| 2.6 | Reorder in one tap ("Same as last time?") | Done: Order again in My orders (same products and options) |
| 3.1 | Shiprocket / Delhivery from the order screen | Done |
| 3.2 | GST invoice for every online order | Done (18 Nov 2026): made when the order is shipped or delivered (or "Make invoice now" on the order), numbered per financial year (WEB/26-27/0001), prices include GST, CGST + SGST or IGST by the delivery state, plain bill without a GSTIN, Cancelled when the order is cancelled; Store settings → GST invoices; GST rate per product; Invoice link in My orders. Not looked at in a browser yet; no credit notes, no customer GSTIN (B2B) yet |
| 3.3 | Customer reviews with photos on product pages | Done: review page from WhatsApp (stars, words, up to 4 photos), product page reviews + Google stars, Reviews tab (hide / show) |
| 3.4 | Shop reports (visitors, orders, what sells, carts left, best customers) | Done (18 Nov 2026): Reports tab, 7 / 30 / 90 days: store visits (counted from now on), orders, sales, average, sales each day, what sells, where orders came from, carts left / reminded / came back, best customers, new vs returning |
| 3.5 | Returns and refunds (Razorpay refund) | Done (18 Nov 2026): Store settings → Returns (on, days after delivery); "Return this order" in My orders (reason + note, signed in or by order number + phone); order page → Accept / Decline and Refund (all or part; through the shop's Razorpay when paid online, else recorded as paid back by hand; can put sizes / colours back in stock); WhatsApp updates (new "Return and refund updates" message). Not tried with a real Razorpay refund; no credit note on the GST invoice yet |
| 4.1 | Store layouts (3–4) and an Instagram feed | Done (18 Nov 2026): Website → Look → How products are shown (Tiles, Big photos, List, Small tiles); Instagram card (handle + up to 9 post / reel links, shown with Instagram's own embeds and a Follow link). A live feed that updates by itself needs the shop's Instagram business account connected through Meta (not done) |
| 4.2 | Coupons per customer and loyalty points | Done (18 Nov 2026): Offers → "Only for one customer" (code works only with that phone); Offers → Loyalty points (on, % back, use from, at most % of order, look up a customer's points); points earned when delivered, used at checkout by signed-in shoppers with their own saved phone, given back on cancel / full refund; My orders shows the balance. Front Desk memberships do not carry over yet |
| 4.3 | Product list from a spreadsheet; AI description from a photo | To do |

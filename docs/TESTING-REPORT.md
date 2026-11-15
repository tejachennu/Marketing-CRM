# WAMA CRM — Testing report

**Date:** 15 Nov 2026  **Branch:** `ccr-7a545d5a-4kbhlw`  **Last commit tested:** `0e85e9a`
**Scope:** the whole web app and mobile app, with extra focus on this round's work: the online store
website (filled from business details, made pictures, Razorpay, own domain through our Hostinger store server).

**Update (same day):** domain connection now goes only through WAMA's own Hostinger Ubuntu server (no Vercel).

## 1. Summary

| Check | Result |
|---|---|
| Web unit tests (`npm test`, 51 files) | **618 / 618 passed** |
| Web type check (`tsc --noEmit`) | **No errors** |
| Web production build (`next build`) | **Passed** |
| App code check (`flutter analyze`) | **No issues** |
| App tests (`flutter test`, 6 files) | **326 / 326 passed** |
| App screens at 320 px, 360 px, 412 px and large text | **No overflow** (part of the 326) |
| Store page pictures at 320 px, 390 px and 1366 px | **No sideways scroll, no page errors** |
| Bugs found this round | **6, all fixed** (section 4) |

Nothing failed. Section 6 lists what could **not** be tested here and needs a real try before customers
use it.

## 2. How it was tested

- **Unit tests (web):** Node's test runner over `tests/*.test.cjs`. They load the real `.ts` code. The
  database is a small in-memory stand-in, so no real data is touched.
- **App tests:** Flutter widget tests in demo mode. Every screen is drawn at small and normal phone sizes
  and with large text, and taps are followed through flows (open an order, add a product, and so on).
- **Real browser:** the built web app ran against a fake database (`next start` + a mock Supabase). Pages
  were opened in Chromium with Playwright at phone and desktop sizes, and the pictures were checked by eye.
- **Domain routing:** the built app was called with different `Host` headers. A business's domain opened
  its store, API calls passed through untouched, and `wamacrm.magnetora.in` worked as before.

## 3. Test results by area

### 3.1 Web (618 tests)

| Area | Test files | Tests |
|---|---|---|
| Online store website (settings, page, orders, prefill, made pictures) | storefront, store-prefill | 10 |
| Store online payment (Razorpay) | store-payments | 8 |
| Store on own domain + gateway | store-domain | 10 |
| Shop customer accounts (sign in, orders, tracking, saved cart) | store-accounts | 12 |
| Front Desk memberships (plans, cards, use at billing, history, report) | memberships | 10 |
| Front Desk appointments calendar and moving appointments | appointments-calendar | 6 |
| Shop and phone-call orders | manual-order | 5 |
| WhatsApp shop (catalog, cart, go-live, shopping assistant) | whatsapp-commerce, meta-catalog, commerce-go-live, chat-commerce, shopping-assistant, catalog-access-route | 107 |
| Front Desk (bookings, bills, GST, reviews, jobs, catalog, categories) | salon, salon-jobs, salon-reviews, salon-chat, front-desk, front-desk-catalog, front-desk-categories | 95 |
| Booking flow and booking page | booking-flow, booking-steps, booking-page, services-form | 37 |
| WhatsApp flows, templates, messages | whatsapp-flows, whatsapp-flows-native, whatsapp-templates, whatsapp-template-sending, chat-message-format, chat-dates, chat-language | 97 |
| Meta connection and webhooks | meta-webhook, meta-webhook-route, meta-detect-route, embedded-signup-route | 25 |
| Plans, billing, message wallet | billing | 60 |
| WAMA's shared number (Starter) | shared-whatsapp | 9 |
| Sign-in, sign-up, codes, Google | login-otp, signup-otp, forgot-password-route, oauth-workspace, platform-email | 33 |
| Roles and access | rbac, workspace-modules, connector-nav | 33 |
| Sales Pipeline | pipeline | 16 |
| Campaigns | campaign-audience | 16 |
| Pop-up notifications | push | 10 |
| Public API | public-api | 14 |
| Other (demo requests) | demo-requests | 5 |

### 3.2 App (326 tests)

| Test file | What it covers | Tests |
|---|---|---|
| screens_test | Every Front Desk, chat, contact, template, booking-flow, billing and More screen, at 3 sizes and large text, plus tap-through flows | 206 |
| store_screens_test | E-commerce: orders, products, go live, store settings, new order, Website screen with Store address, plus store rules | 53 |
| campaign_screens_test | Campaigns list, campaign page, new campaign, choosing people | 32 |
| app_test | Offline copy and outbox, sign-in state, sync order | 30 |
| booking_try_test | "Try it as a customer" for the booking flow | 4 |
| chip_colors_test | Filter chip text stays readable on phones | 1 |

## 4. Bugs found and fixed this round

| # | Where | What was wrong | Fix | Test |
|---|---|---|---|---|
| 1 | Store Razorpay webhook | Looked for our order in the **payment's** notes. Razorpay keeps them on the **order**, so the webhook could never mark an order paid. | Looks in the order's notes, then the payment's, then the Razorpay order id we keep. Checkout also passes our order number. | store-payments: "the order is found from…" |
| 2 | Store checkout | If a customer's online payment did not finish and they reloaded, the cart was already empty and the order was stuck as "waiting for payment". | The unfinished payment is kept on the phone. When the page opens again it asks Razorpay whether it was paid, then shows "Paid" or "Try again / Cash on delivery". | store-payments: "unfinished payments…" |
| 3 | Store payment | A customer could still pay for an order the shop had cancelled. | Refused with "The shop cancelled this order", and the page forgets it. | same |
| 4 | Store payment | Calls to Razorpay had no time limit, so a slow Razorpay kept the customer waiting until the server gave up. | 15-second limit with a clear message. | same |
| 5 | Store page | A store that is off showed a bare 404 (seen with csat37). | Friendly "This store is not open right now" page. | same + picture |
| 6 | Store page design | Product photos showed through the header while scrolling. "Cash on delivery" squeezed onto two lines on 320 px phones. The phone number showed as +919876543210. The "Change" domain button showed even with nothing to change. | Solid header, pay choices stack on small phones, number shown as +91 98765 43210, button only after an edit. | store-payments: "phone numbers…", pictures |

## 5. Test cases for this round's features

Result: **Pass** = automated test passed. **Seen** = checked in the browser or app picture.

### 5.1 Store website filled from business details

| ID | Case | Expected | Result |
|---|---|---|---|
| SF-01 | New store, never saved | Website tab opens filled: name, logo, phone, WhatsApp, address, delivery charges, categories, banners. Store stays **off** until Save. | Pass |
| SF-02 | Front Desk has a logo and details, workspace has none | Front Desk name, logo, phone and address are used. | Pass |
| SF-03 | Free-delivery amount set | Top strip "Free delivery on orders above ₹999", plus a Free delivery banner. | Pass |
| SF-04 | "Fill blanks" on a saved store | Only empty parts filled. Typed text kept. | Pass |
| SF-05 | Category with a product photo | Photo used. Without one, a made picture. | Pass |
| SF-06 | Made pictures | Plain shapes in the store colour, no gradients, safe text (no script). 4 banner designs. | Pass |
| SF-07 | Change the store colour | Made pictures change colour too. Own photos unchanged. | Pass (web + app) |

### 5.2 Store page and ordering

| ID | Case | Expected | Result |
|---|---|---|---|
| SP-01 | Page on 320 px, 390 px, desktop | No sideways scroll, banners slide, categories, product grid | Seen |
| SP-02 | Add to cart, reload | Cart still there | Pass (earlier round) |
| SP-03 | Order pick up / delivery | Prices from our product list, never from the page. Delivery charge and minimum order applied. | Pass |
| SP-04 | Out-of-stock product | Shown greyed with "Not available now" when the setting is on, and cannot be ordered | Pass + Seen |
| SP-05 | Too many orders from one phone or address | Polite "please call the shop" | Pass |
| SP-06 | Store switched off | "This store is not open right now" | Pass + Seen |

### 5.3 Online payment (Razorpay)

| ID | Case | Expected | Result |
|---|---|---|---|
| PY-01 | Pay now, payment succeeds | Signature checked, amount read from Razorpay, order marked paid once, team gets "Paid online" | Pass |
| PY-02 | Wrong amount paid | Not marked paid | Pass |
| PY-03 | Webhook arrives (page closed) | Order found and marked paid | Pass (bug 1 fixed) |
| PY-04 | Webhook with wrong signature | Refused (401) | Pass |
| PY-05 | Payment window closed | "Payment not finished" with Try again / Cash on delivery instead | Pass |
| PY-06 | Reload during an unfinished payment | Asks Razorpay, then shows paid, or the choice again | Pass (bug 2 fixed) |
| PY-07 | Shop cancelled the order | No payment taken for it | Pass (bug 3 fixed) |
| PY-08 | Only Cash on delivery switched on | No Pay now button | Pass |
| PY-09 | Keys saved | Checked with Razorpay first. Secret never sent to any page. | Pass |

### 5.4 Store on own domain and gateway

| ID | Case | Expected | Result |
|---|---|---|---|
| DM-01 | Typed domain "https://Shop.MyName.com/" | Cleaned to shop.myname.com | Pass |
| DM-02 | Bad or WAMA domain | Plain error | Pass |
| DM-03 | shop.name.com / name.com / name.co.in | CNAME to stores.magnetora.in for sub-domains. A record to the server IP for root domains, including .co.in | Pass |
| DM-04 | Store server not set up | "Custom domains are not set up on WAMA yet", nothing saved | Pass |
| DM-05 | Domain used by another WAMA store | Clear message, nothing saved | Pass (code) |
| DM-06 | Domain status | Waiting, then "points somewhere else", then Connected once DNS points at the server. No Vercel used. | Pass |
| DM-07 | Visit on a business's domain | Store page. /dashboard is not reachable there. API calls work. | Pass + real request |
| DM-08 | Visit on wamacrm.magnetora.in | App as before | Real request |
| DM-09 | Gateway header without the right key | Ignored | Pass |
| DM-10 | Certificate check for a domain no store has | Refused (404), so no certificate is made | Pass (code) |
| DM-11 | Gateway files | Caddy on-demand certificates with the check, manual-only deploy, no secrets in files | Pass |
| DM-12 | App: Store address card | Both choices, records with Copy, Check again, Remove asks first, fits 320 px | Pass + Seen |

### 5.5 Shop customer accounts (added 15 Nov 2026)

| ID | Case | Expected | Result |
|---|---|---|---|
| AC-01 | Store page header | "Sign in" button (or "My orders" when signed in) beside the cart | Seen |
| AC-02 | Continue with Google | Sign-in runs on WAMA's address, then returns to the store (also to its own domain) | Pass (code); **needs a real Google try** |
| AC-03 | Return address after sign-in | Only WAMA or the store's own https domain, never anywhere else | Pass |
| AC-04 | My orders | The shopper's orders in this store only, newest first, with status, items and total | Pass + Seen |
| AC-05 | One order | Placed → Confirmed → On the way / Ready to pick up → Delivered / Picked up, with times, tracking number, items, totals, payment | Pass + Seen |
| AC-06 | Cancelled order | Placed, then Cancelled | Pass |
| AC-07 | Order view | No workspace ids or team notes | Pass |
| AC-08 | Order while signed in | Linked to the shopper; name, phone and address saved for next time; saved cart emptied | Pass (code) |
| AC-09 | Checkout when signed in | Name, phone and address filled in (only empty boxes) | Seen |
| AC-10 | Cart on another phone | The phone's cart and the saved cart are joined (bigger amount wins) and kept | Pass |
| AC-11 | Account without a valid sign-in | Refused (401) | Pass + real request |
| AC-12 | Track an order as a guest | Order number + the phone it was placed with; wrong phone, other store or odd numbers find nothing; 20 tries an hour | Pass + real request |
| AC-13 | Store switches sign-in off | No Sign in button; account API refuses | Pass |
| AC-14 | 320 px phone | All account screens fit, no sideways scroll | Seen |

### 5.6 Store product page (added 16 Nov 2026)

| ID | Case | Expected | Result |
|---|---|---|---|
| PP-01 | Tap a product on the store | Opens its own page `/s/<store>/p/<product>` (or `/p/<product>` on the store's own domain) | Seen + real request |
| PP-02 | Product page | Photo, category, name, price, In stock, quantity, Add to cart, Buy now, Ask on WhatsApp, Share, delivery / pick up / payment, description, More in this category | Seen (320 px, 390 px, desktop) |
| PP-03 | Product not sold any more / wrong id | Store not-open page (404) | Real request |
| PP-04 | Search engines and sharing | Title with price, description, picture, and product details (price, stock) for Google | Real request |

### 5.7 Front Desk memberships (added 16 Nov 2026)

| ID | Case | Expected | Result |
|---|---|---|---|
| MB-01 | New plan | Needs a name, a length, and credit / free sessions / discount (any mix) | Pass |
| MB-02 | Sell a card | GST bill for the price; card MB-0001 with link and QR; sent on WhatsApp | Pass + Seen |
| MB-03 | Bill a card holder | Card found by phone or contact; free sessions first, then discount, then credit pays; "covered by the card" | Pass + Seen |
| MB-04 | Credit runs out | The rest is paid by cash / UPI / card or later | Pass |
| MB-05 | Cancel a bill that used a card | Sessions and credit go back, once | Pass |
| MB-06 | Cancel the bill a card was sold on | Card cancelled | Pass |
| MB-07 | Someone else's card | Refused | Pass |
| MB-08 | Extend, add or take off credit or sessions, cancel | Changes the card; each change in its history | Pass |
| MB-09 | Card states | Active, Ending soon (14 days, red), Expired, Cancelled, Starts later | Pass + Seen |
| MB-10 | Usage report | Cards sold and money in, credit / sessions used, discount given, credit and sessions still owed, by plan | Pass + Seen |
| MB-11 | Customer's card page | Card with number and QR, what is left, history, terms; no ids | Pass + Seen |

### 5.8 Front Desk appointments and landing page (added 16 Nov 2026)

| ID | Case | Expected | Result |
|---|---|---|---|
| AP-01 | Day view (wide screens) | One column per team member plus Anyone, times down the side, colours by state (no-show red), a red now-line; empty slot books | Pass + Seen |
| AP-02 | Day view (phones) | A list by time with state | Seen |
| AP-03 | Week and List views | Seven days at a glance; any dates as a list | Seen |
| AP-04 | Filters and numbers | Person, state, search; appointments, coming, in the shop, done, no-show, booked value | Pass + Seen |
| AP-05 | Move an appointment | New time and/or person, keeps its length, warns about a clash, tells the customer on WhatsApp; finished visits cannot move | Pass |
| AP-06 | One appointment | Call, WhatsApp, services and value, Arrived / Start / Bill, Did not come, Cancel, Book again, past visits | Seen |
| AP-07 | Business landing page `/v/<business>` | Services and prices with Book, team with Book with, memberships, good reviews (first names), hours, map, Call / WhatsApp | Pass + Seen |

## 6. Not tested here (needs a real try)

These need real accounts or servers that this test environment does not have. Please try them once
before telling customers.

| What | Why not tested | How to try |
|---|---|---|
| Real Razorpay payment on the store page | No real keys here | Connect test keys (rzp_test_…) in Website → Online payment, place an order, pay with Razorpay's test card, and check that the order shows "Paid online". Then set the webhook and repeat with the page closed. |
| Own domain on the Hostinger store server | No server yet. Downloading Caddy to validate the config was blocked here, so `Caddyfile` has only been checked by its tests, not by Caddy itself. | Follow `deploy/gateway/README.md` (Hostinger steps). Setup runs `caddy validate` before starting. Then connect a spare sub-domain and press Check again. |
| Pop-up notifications on a real phone | Needs a phone and Firebase | App → More → Test notifications |
| Google sign-in (dashboard and shop customers) | Needs Google switched on in Supabase | Sign in with Google on /login, and on a store page. In Supabase → Authentication → URL Configuration, add `https://wamacrm.magnetora.in/s/**` to Redirect URLs, or shoppers land on the business sign-up page. |
| WhatsApp tick-box booking form | Needs Meta | Send "Book" to the business number |
| Memberships and appointments in the mobile app | Built on the web only this round | Next step |
| Real database speed and the "Loading…" Website tab | No production database here | Run the storefront SQL in Supabase first (see the earlier note), then open the Website tab |

## 7. How to run the checks again

```
npm install
npm test                                   # web unit tests
npx tsc --noEmit -p .                      # type check
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54329 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon \
  SUPABASE_SERVICE_ROLE_KEY=service npx next build      # production build
cd mobile && flutter analyze && flutter test            # app
```

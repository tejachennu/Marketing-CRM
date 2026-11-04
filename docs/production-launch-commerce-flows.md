# Production launch: WhatsApp Commerce and the Flow Builder

What changed on `LASTESTV4` for the launch, what to do before and after deploying, and what is
left for later. Each item names the file or setting to look at.

## 1. Before deploying

### Database migrations

Apply every `supabase/migrations/20261104_*.sql` file in filename order (Supabase SQL editor, or
`psql -f`). Each file is safe to run more than once. The app keeps working before a file is
applied: the feature that needs it stays off or falls back, and the server log says which file is
missing.

| File | Needs | What it enables |
| --- | --- | --- |
| `20261104_commerce_payment_requests.sql` | commerce tables | Every payment request of an order is kept, so a payment is checked against the amount asked for under its reference |
| `20261104_commerce_products_search.sql` | `pg_trgm` extension | Fast word search for the shopping assistant on large catalogs |
| `20261104_commerce_reminders.sql` | commerce tables | Checkout reminders and their store switch. Marks open orders older than 7 days as already reminded, so launch day does not message old carts |
| `20261104_commerce_status_template.sql` | | The order-update template setting (status messages after 24 hours) |
| `20261104_commerce_stock.sql` | commerce tables | Stock taken once per order and given back on cancel |
| `20261104_commerce_transactions_unique.sql` | commerce tables | One ledger row per payment. **Fails if duplicate rows exist**: keep the earliest row per `(organization_id, transaction_id)` and run it again |
| `20261104_enable_flows.sql` | | Per-workspace Flow Builder switch for super admins |
| `20261104_flow_sessions_form_token.sql` | flow tables (`scripts/db-migration-v31-flows.js`) | Late form answers filed under their flow; faster in-progress counts |
| `20261104_flow_sessions_idle_index.sql` | flow tables | Cheap idle-session expiry |
| `20261104_handoff_queue.sql`, then `20261104_handoff_state.sql` | | Explicit hand-off state (`conversations.handed_off_at`); carries over open hand-offs |
| `20261104_messages_provider_sid_unique.sql` | | Each inbound message stored once. **Deletes duplicate message rows** (keeps the earliest of each pair); take a backup first |
| `20261104_scheduler_pg_cron.sql` | | Nothing when applied as is: a commented template for running the scheduler from Supabase |
| `20261104_whatsapp_app_secret.sql` | | Webhook signature checks for workspaces on their own Meta app |
| `20261104_workflows_pause_reason.sql` | flow tables | Shows why a live flow was paused automatically |

### Environment variables (Vercel → Settings → Environment Variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `CRON_SECRET` | Yes | Protects `/api/cron/tick` and the campaign worker hand-off. Without it the scheduler answers 503 and nothing runs |
| `META_APP_SECRET` | Yes | Verifies Meta webhooks for workspaces on the platform's Meta app |
| `TWILIO_AUTH_TOKEN` | If Twilio is used without per-workspace tokens | Verifies Twilio webhooks |
| `PG_CRON_SECRET` | Only with the pg_cron path | A separate secret for the Supabase scheduler |
| `CAMPAIGN_WORKER_MAX_SECONDS` | If the plan allows under 300 s per function | The campaign worker pauses cleanly before the limit |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | If Deployment Protection is on | Lets the tick start campaign workers |
| `NEXT_PUBLIC_DISABLED_MODULES` | No | Emergency kill switch, `commerce` and/or `flows`, applied at build time |
| `META_WEBHOOK_ALLOW_UNSIGNED`, `TWILIO_WEBHOOK_ALLOW_UNSIGNED` | No, never in production | Turn signature checks off for local tunnels |

### Scheduler

`vercel.json` runs `/api/cron/tick` once a day (`30 3 * * *`), the most a Vercel Hobby project
allows. On Pro, change it to `*/10 * * * *`. On Hobby, use the pg_cron template for a 10-minute
cadence. The tick sends checkout reminders, expires idle chatbot sessions and starts scheduled
campaigns. See the README section "Scheduled jobs".

## 2. Behavior changes tenants will notice

- **Workspaces on their own Meta app** get 403 on every webhook until they save the app secret in
  Settings → WhatsApp. Tell them before deploying.
- **Twilio webhooks** are refused unless Twilio signed them with the workspace's auth token (or
  `TWILIO_AUTH_TOKEN`). The shared address without a workspace id now files a message only under
  the workspace that owns the Twilio number; point Twilio at `/api/webhooks/twilio/<workspace id>`.
- **In-chat payments are INR only.** Stores in another currency get Cash on Delivery or an
  acknowledgement, and the chat says why. `organizations.currency` defaults to `USD` in the
  database, so an Indian store must save INR in Settings → General → Regional Preferences once.
- **Order updates after 24 hours** need an approved utility template chosen in Store settings
  (body variables: order number, status, tracking). Without one the attempt is logged as failed in
  the chat and the dashboard says so.
- **Flows**: activating a flow whose keyword is already used by another live flow is refused. New
  flows start on keywords derived from their name. Live flows with unknown placeholders or broken
  connections are paused automatically, with the reason shown in the builder.
- **Inbox**: "Needs an agent" lists only chats a flow handed to the team. A manager's reply no
  longer puts a chat in that queue or shows it to every agent.
- Commerce and the Flow Builder are on for every workspace. Super admins can switch either off per
  workspace.

## 3. After deploying: smoke test

1. Send a cart from WhatsApp to a test store: address form, payment choice, payment card.
2. Pay a small amount online; check the receipt, the order status and the stock count.
3. Place a COD order; press **Cash collected** on it; ship it with a tracking link.
4. Switch the store off in Store settings with an unpaid card open: the card is withdrawn.
5. Run a flow with a form, a hand-off to the team queue, and a knowledge-assistant step.
6. Take the handed-off chat with **Assign to me** as an agent who sees only their own chats.
7. Call the tick by hand and check the JSON summary:
   `curl -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/tick`

## 4. Competitor features adopted for launch

Research covered Interakt, WATI, Zoko, Bik, LimeChat, Gallabox, AiSensy, DoubleTick, Gupshup,
GoKwik, respond.io, Manychat, Landbot, Yellow.ai and Twilio Studio. Adopted now:

- Checkout-abandonment reminders (up to 2, held while a person is talking to the customer).
- Stock that never sells what is not there, with the Meta catalog updated at zero.
- Shipping updates with carrier, tracking number and tracking link; the AI assistant answers
  "where is my order" with them.
- Order updates outside the 24-hour window through an approved template.
- Storefront link (`wa.me/c/<number>`) with a copy button.
- Hand-off to a specific agent, round-robin or the team queue, with an explicit queue in the inbox.
- Keyword collision checks, placeholder validation and form retirement in the Flow Builder.

## 5. Roadmap (not in this release)

- Flow Builder: ask-a-question node with validation, HTTP request node, jump/go-to-flow and A/B
  split, delays with a scheduler, per-node analytics, versions, event triggers (Click-to-WhatsApp
  ads, webhooks).
- Commerce: COD confirmation reminder and COD-to-prepaid nudge, coupons, Shopify connector,
  revenue analytics, post-purchase prompts, storefront QR code, a store time zone setting
  (dates use Asia/Kolkata today).
- Platform: row-level security for browser access (most tables are reachable with the anon key
  today; see the private security audit), DNS pinning for media downloads, shared rate-limit
  counters across server instances.

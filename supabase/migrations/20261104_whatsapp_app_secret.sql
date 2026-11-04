-- A workspace connected to WhatsApp through its own Meta app (not the platform's) receives webhooks
-- that Meta signs with that app's secret. The secret is saved per workspace (Settings → WhatsApp) so
-- the webhook route can verify those payloads instead of taking them unsigned.
-- The column name contains "secret", so /api/organization never returns it to the browser.
alter table public.organizations add column if not exists whatsapp_app_secret text;

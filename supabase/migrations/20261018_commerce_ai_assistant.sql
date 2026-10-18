-- The AI shopping assistant: answers product and order questions in WhatsApp with the store's own
-- products and the customer's own orders. On by default; the store can switch it off in Store settings.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS commerce_ai_assistant BOOLEAN NOT NULL DEFAULT TRUE;

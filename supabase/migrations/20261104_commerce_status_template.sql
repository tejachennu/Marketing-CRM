-- The approved WhatsApp template that carries order status updates (shipped, delivered, ...) once a
-- plain message is no longer allowed: Meta refuses one more than 24 hours after the customer's last
-- message (error 131047), the usual case for a Cash on Delivery order shipped the next day.
-- Chosen in Store settings and stored as { "name": "<template name>", "language": "<code>" }; its
-- body takes three variables: the order number, the status and the tracking details. Null means
-- plain messages only. Safe to apply more than once. Until it is applied the setting cannot be
-- saved (the API says the migration is missing) and the Order flow tab's check says so.
alter table public.organizations add column if not exists commerce_status_template jsonb;

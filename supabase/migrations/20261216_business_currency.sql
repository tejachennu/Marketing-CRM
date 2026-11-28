-- The business's currency, chosen in Settings (INR, USD, AED, SAR, QAR, GBP, EUR, SGD, AUD, CAD). Empty means it was
-- never chosen, which counts as INR. Front Desk, E-commerce and the Sales Pipeline show money in it. The older
-- organizations.currency column defaulted to 'USD', so it is not used on its own. Safe to run more than once.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_currency TEXT;

NOTIFY pgrst, 'reload schema';

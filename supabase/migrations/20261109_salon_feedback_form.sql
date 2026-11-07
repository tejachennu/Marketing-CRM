-- Spa & Salon: the feedback form. A rating for each person who served, what stood out, and
-- where the feedback came from (the form, or a rating tapped in the chat).
-- Safe to run more than once. The app runs it on its own when feedback is first saved.
ALTER TABLE salon_feedback ADD COLUMN IF NOT EXISTS staff_ratings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE salon_feedback ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE salon_feedback ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'chat';

NOTIFY pgrst, 'reload schema';

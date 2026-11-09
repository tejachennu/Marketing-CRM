-- Sign-up email codes: a new account is made only after the code sent to the email is entered.
-- Only a hash of the code is kept. Safe to run more than once. The app runs it on its own.
CREATE TABLE IF NOT EXISTS signup_otps (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sends INTEGER NOT NULL DEFAULT 1,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE signup_otps ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

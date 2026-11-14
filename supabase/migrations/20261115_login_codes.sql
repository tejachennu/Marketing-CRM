-- Sign-in email codes: after the password, a 6-digit code sent to the email must be entered.
-- Only a hash of the code is kept. Safe to run more than once. The app runs it on its own.
CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sends INTEGER NOT NULL DEFAULT 1,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE login_codes ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

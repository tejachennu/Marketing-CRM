-- Where the platform's own emails (login codes, teammate invites) are sent from, as set in the
-- superadmin panel. Without a row, the server's environment variables are used.
-- A single row. Row level security is on with no policies, so only the server (service role) can
-- read or change it: the mailbox password never reaches a browser.
CREATE TABLE IF NOT EXISTS platform_email_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  smtp_host TEXT NOT NULL,
  smtp_port INT NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_secure BOOLEAN NOT NULL DEFAULT true,
  smtp_user TEXT NOT NULL,
  smtp_password TEXT NOT NULL,
  from_name TEXT,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_email_settings ENABLE ROW LEVEL SECURITY;

-- Instagram (DMs in the inbox, comments, feed, posting). Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS instagram_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  ig_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  name TEXT,
  picture_url TEXT,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  client_business_id TEXT,
  subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  feed JSONB NOT NULL DEFAULT '[]'::jsonb,
  feed_at TIMESTAMPTZ,
  last_error TEXT,
  connected_by UUID,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS instagram_username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_instagram ON contacts(organization_id, instagram_id) WHERE instagram_id IS NOT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';
CREATE TABLE IF NOT EXISTS instagram_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL UNIQUE,
  parent_id TEXT,
  media_id TEXT,
  media_type TEXT,
  from_id TEXT,
  from_username TEXT,
  text TEXT,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  reply_text TEXT,
  replied_at TIMESTAMPTZ,
  private_reply_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_instagram_comments_org ON instagram_comments(organization_id, created_at DESC);
ALTER TABLE instagram_comments ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';

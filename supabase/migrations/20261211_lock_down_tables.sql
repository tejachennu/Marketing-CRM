-- Row level security on every table in the public schema: the anon key reads nothing; a signed-in person reads only
-- their own business's rows of the tables the dashboard and the app read directly, and only safe columns of their
-- own business. The server uses the service key and is not affected. Safe to run more than once.

-- The signed-in person's business (security definer, so the users policy below does not call itself)
CREATE OR REPLACE FUNCTION public.wama_my_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.wama_my_org() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wama_my_org() TO authenticated;

DO $$
DECLARE
  t text;
  member_tables text[] := ARRAY['contacts','conversations','messages','leads','tickets','pipeline_stages'];
  safe_org_columns text[] := ARRAY['id','name','slug','enable_ai','enable_email','enable_messages','enable_phone_calls','enable_sms','enable_commerce','enable_pipeline','enabled_connectors','service_synonyms'];
  c text;
BEGIN
  -- 1. Every table: row level security on, and nothing at all for the anon key
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;

  -- 1b. Catch-all rules ("true" for everyone) would still open every business's rows: removed
  FOR t, c IN SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND policyname NOT LIKE 'wama_%'
      AND (qual IS NULL OR btrim(qual) IN ('true', '(true)')) AND (with_check IS NULL OR btrim(with_check) IN ('true', '(true)'))
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', c, t);
  END LOOP;

  -- 2. Business rows the dashboard and the app read directly: members of the same business only (reading)
  FOREACH t IN ARRAY member_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS wama_members_read ON public.%I', t);
      EXECUTE format('CREATE POLICY wama_members_read ON public.%I FOR SELECT TO authenticated USING (organization_id = public.wama_my_org())', t);
    END IF;
  END LOOP;

  -- 3. People: your own profile and your team
  IF to_regclass('public.users') IS NOT NULL THEN
    DROP POLICY IF EXISTS wama_members_read ON public.users;
    CREATE POLICY wama_members_read ON public.users FOR SELECT TO authenticated USING (id = auth.uid() OR organization_id = public.wama_my_org());
  END IF;

  -- 4. Your own business, and only its harmless columns (never tokens, keys or passwords)
  IF to_regclass('public.organizations') IS NOT NULL THEN
    DROP POLICY IF EXISTS wama_members_read ON public.organizations;
    CREATE POLICY wama_members_read ON public.organizations FOR SELECT TO authenticated USING (id = public.wama_my_org());
    REVOKE SELECT ON public.organizations FROM authenticated;
    FOREACH c IN ARRAY safe_org_columns LOOP
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = c) THEN
        EXECUTE format('GRANT SELECT (%I) ON public.organizations TO authenticated', c);
      END IF;
    END LOOP;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

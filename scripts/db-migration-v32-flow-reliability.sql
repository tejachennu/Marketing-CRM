BEGIN;
ALTER TABLE public.flow_submissions ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES public.whatsapp_workflows(id) ON DELETE SET NULL;
ALTER TABLE public.flow_submissions ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.flow_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.flow_submissions ADD COLUMN IF NOT EXISTS flow_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS flow_submissions_token_unique ON public.flow_submissions(organization_id, flow_token);

-- Serialize messages from the same customer across server instances.
CREATE TABLE IF NOT EXISTS public.flow_runtime_locks (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL,
  owner UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id, contact_phone)
);
ALTER TABLE public.flow_runtime_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flow_runtime_locks FROM anon, authenticated;
GRANT ALL ON public.flow_runtime_locks TO service_role;
CREATE OR REPLACE FUNCTION public.acquire_flow_lock(p_org UUID, p_phone TEXT, p_owner UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE acquired BOOLEAN;
BEGIN
  INSERT INTO flow_runtime_locks(organization_id, contact_phone, owner, expires_at)
  VALUES (p_org, p_phone, p_owner, NOW() + INTERVAL '3 minutes')
  ON CONFLICT (organization_id, contact_phone) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
  WHERE flow_runtime_locks.expires_at < NOW()
  RETURNING TRUE INTO acquired;
  RETURN COALESCE(acquired, FALSE);
END;
$$;
CREATE OR REPLACE FUNCTION public.increment_flow_execution(p_workflow UUID, p_org UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE whatsapp_workflows SET execution_count = COALESCE(execution_count, 0) + 1 WHERE id = p_workflow AND organization_id = p_org;
$$;
REVOKE ALL ON FUNCTION public.acquire_flow_lock(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_flow_execution(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_flow_lock(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_flow_execution(UUID, UUID) TO service_role;
COMMIT;

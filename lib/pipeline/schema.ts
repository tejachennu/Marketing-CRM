/** The Sales Pipeline's columns, set up by the app itself the first time they are needed. */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261111_sales_pipeline.sql word for word. */
export const PIPELINE_SQL = `-- Sales Pipeline as a connector: a workspace can switch it off (it is on unless switched off),
-- and each deal can carry its next follow-up, so the team sees what is due and overdue.
-- Safe to run more than once. The app runs it on its own when these are first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS enable_pipeline BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_leads_follow_up ON leads(organization_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
`

const PIPELINE_LOCK = 724519011

export const pipelineSchemaSetup = createAutoSetup('Sales Pipeline', (connectionString) => runMigrationSql(connectionString, PIPELINE_SQL, PIPELINE_LOCK))

export function isMissingPipelineSchema(error: any): boolean {
  return isMissingSchemaError(error, /enable_pipeline|next_follow_up_at/)
}

/** Run a database step; if the pipeline columns are missing, set them up and try again. */
export async function withPipelineSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = pipelineSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingPipelineSchema(first.error)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingPipelineSchema(result.error); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

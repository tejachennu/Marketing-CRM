/**
 * Sending a connector message's template to Meta for approval (rules in auto-messages.ts), through the same
 * Graph API calls as the Templates page (meta-templates.ts). Server only.
 */

import type { MetaCredentials } from '@/lib/flows/meta-client'
import { autoDraft, autoTemplateName, isNameTakenError, type AutoInput, type AutoMessageDef } from './auto-messages'
import { createTemplate, type MetaTemplate } from './meta-templates'

/** Meta's refusal in its own words for people, or a plain line when Meta could not be reached. */
export function metaErrorText(error: any): string {
  const detail = error?.details?.[0]
  if (detail?.error_user_msg || detail?.error_user_title) return String(detail.error_user_msg || detail.error_user_title)
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(String(error?.message || ''))) return 'Meta could not be reached. Check your connection and try again.'
  return String(error?.message || 'Meta did not accept it.')
}

export type AutoSubmitResult =
  | { ok: true; name: string; language: string; fields: string[]; status: string; category: string }
  | { ok: false; error: string; problems?: string[]; status: number }

/** What still needs fixing before the editor's work can go to Meta (nothing is sent). */
export function autoProblems(def: AutoMessageDef, input: AutoInput, origin: string): string[] {
  return autoDraft(def, input, { name: def.baseName, origin }).problems
}

/**
 * Submit the editor's work as a new Utility template under a name not used on the account (the next one is tried
 * when Meta says a name is taken or still being deleted).
 */
export async function submitAutoTemplate(credentials: MetaCredentials, def: AutoMessageDef, input: AutoInput, options: { origin: string; account: MetaTemplate[]; fetcher?: typeof fetch }): Promise<AutoSubmitResult> {
  const taken = new Set(options.account.map((t) => t.name))
  for (let attempt = 0; attempt < 4; attempt++) {
    const name = autoTemplateName(def.baseName, taken)
    const { draft, fields, problems } = autoDraft(def, input, { name, origin: options.origin })
    if (problems.length) return { ok: false, error: problems[0], problems, status: 400 }
    try {
      const result = await createTemplate(credentials, draft, options.fetcher)
      return { ok: true, name, language: draft.language, fields, status: String(result?.status || 'PENDING').toUpperCase(), category: String(result?.category || 'UTILITY').toUpperCase() }
    } catch (error) {
      if (!isNameTakenError(error)) return { ok: false, error: metaErrorText(error), status: 422 }
      taken.add(name)
    }
  }
  return { ok: false, error: 'Meta did not take the name. Please try again in a minute.', status: 422 }
}

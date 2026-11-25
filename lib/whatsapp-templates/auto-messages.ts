/**
 * Templates for the WhatsApp messages a connector sends by itself (Front Desk: bill, booking, reminder, feedback;
 * E-commerce: cart reminder, Cash on Delivery check, review ask, back in stock, refunds, order updates).
 *
 * WhatsApp delivers a free message only within 24 hours of the customer's last message; after that only an
 * approved template reaches them. Each message comes with a suggested wording. The business can change it and
 * send it to Meta for approval on its own WhatsApp account; once Meta approves it, that message uses it. Nothing
 * is used before the business sends it and Meta approves it.
 *
 * The editor shows blanks as words in braces ("Hi {Customer first name}"), so nobody has to type {{1}}. They are
 * turned into Meta's numbered blanks ({{1}}, {{2}}…) and the list of what fills each one when it is sent.
 * Pure and browser-safe: the web screens, the API routes and the tests share it.
 */

import { emptyDraft, languageLabel, TEMPLATE_LANGUAGES, validateDraft, type TemplateDraft } from './template-model'

/** Something the message can put in a blank. */
export interface AutoField {
  key: string
  label: string
  /** An example value, shown in the preview and sent to Meta as the blank's example. */
  sample: string
}

export interface AutoButtonDef {
  type: 'URL' | 'QUICK_REPLY'
  /** Suggested button words (the business can change them). */
  text: string
  /** URL: the app page the button opens; the link code goes at the end. */
  path?: string
  /** What the button does, in plain words. */
  note: string
}

export interface AutoMessageDef {
  purpose: string
  title: string
  when: string
  /** Where a new template's name on WhatsApp starts (lowercase and underscores). */
  baseName: string
  /** What can go in the text's blanks. */
  fields: AutoField[]
  /** The suggested text in Meta's form, and what fills each blank in order. */
  suggestion: { body: string; fields: string[] }
  buttons: AutoButtonDef[]
  /** The field that goes at the end of a link button. */
  urlField?: string | null
}

/** A template set up for a message: its name and language on WhatsApp, and what fills each blank. */
export interface AutoChoice {
  name: string
  language: string
  fields: string[]
  /** The earlier approved template, used while a newer one waits for Meta (dropped once it is approved). */
  previous?: { name: string; language: string; fields: string[] } | null
}

/** A template as Meta lists it (the parts used here). */
export interface AccountTemplate {
  id?: string
  name: string
  language: string
  status: string
  category?: string
  components?: any[]
  rejected_reason?: string | null
}

export type AutoState = 'review' | 'approved' | 'rejected' | 'paused' | 'missing' | 'unknown'

// ── Words in braces ⇄ Meta's numbered blanks ─────────────────────────────────

const NUMBERED = /\{\{\s*(\d+)\s*\}\}/g
const TOKEN = /\{([^{}\n]{1,60})\}/g
const tidy = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()

/** Meta's text ("Hi {{1}}") as the editor shows it ("Hi {Customer first name}"). A blank nothing fills reads "{?}". */
export function toEditorText(body: string, fieldKeys: string[], fields: AutoField[]): string {
  return String(body || '').replace(NUMBERED, (_, n) => {
    const field = fields.find((f) => f.key === fieldKeys[Number(n) - 1])
    return `{${field ? field.label : '?'}}`
  })
}

/** Which field a word in braces means: its label (any letter case and spacing) or its key. */
export function fieldForToken(token: string, fields: AutoField[]): AutoField | null {
  const wanted = tidy(token)
  return fields.find((f) => tidy(f.label) === wanted || f.key === wanted.replace(/ /g, '_')) || null
}

/**
 * The editor's text in Meta's form: each different blank gets the next number in the order it first appears, and
 * the same blank used twice keeps its number. Words in braces that are not a blank this message fills are listed.
 */
export function readEditorText(text: string, fields: AutoField[]): { body: string; fields: string[]; unknown: string[] } {
  const used: string[] = []
  const unknown: string[] = []
  const body = String(text || '').replace(/\r\n?/g, '\n').replace(TOKEN, (whole, token: string) => {
    const field = fieldForToken(token, fields)
    if (!field) {
      // "{{1}}" typed by hand is reported on its own (see autoDraft)
      if (!/^\s*\d+\s*$/.test(token) && !unknown.includes(token.trim())) unknown.push(token.trim())
      return whole
    }
    if (!used.includes(field.key)) used.push(field.key)
    return `{{${used.indexOf(field.key) + 1}}}`
  })
  return { body: body.trim(), fields: used, unknown }
}

/** The editor's text with every blank filled with its example, for the preview. */
export function previewText(text: string, fields: AutoField[]): string {
  return String(text || '').replace(TOKEN, (whole, token: string) => fieldForToken(token, fields)?.sample || whole)
}

// ── Building the template for Meta ──────────────────────────────────────────

export interface AutoInput {
  text: string
  language: string
  /** Button words, one for each of the message's buttons, in order. */
  buttons?: string[]
}

/** Meta's rule messages, in the words this screen uses ("blank", not "variable"). */
function plainProblem(message: string): string {
  return message
    .replace(/^Body: /, '')
    .replace(/variables must be numbers like \{\{1\}\}, \{\{2\}\}\./, 'use the blank buttons to add blanks.')
    .replace(/variables must be in order without gaps: \{\{1\}\}, \{\{2\}\}, \{\{3\}\}…/, 'use the blank buttons to add blanks.')
    .replace(/a variable can't be at the very start or end\. Add some words around it\./, 'the message can\'t start or end with a blank. Add some words before or after it.')
    .replace(/two variables can't be next to each other\./, 'two blanks can\'t be side by side. Put a word between them.')
    .replace(/Too many variables for the length of the message\. Add more words, or use fewer variables\./, 'Too many blanks for so few words. Add more words, or use fewer blanks.')
    .replace(/^Enter the message body\./, 'Write the message.')
    .replace(/^Buttons, button (\d+): /, 'Button $1: ')
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * The editor's work as a template for Meta (Utility, the purpose's buttons with the business's words, examples
 * from the purpose's samples), what fills each blank, and what still needs fixing, in plain words.
 */
export function autoDraft(def: AutoMessageDef, input: AutoInput, options: { name: string; origin: string }): { draft: TemplateDraft; fields: string[]; problems: string[] } {
  const { body, fields, unknown } = readEditorText(input.text, def.fields)
  const base = String(options.origin || '').replace(/\/+$/, '')
  const words = (input.buttons || []).map((b) => String(b ?? '').replace(/\s+/g, ' ').trim())
  const draft: TemplateDraft = {
    ...emptyDraft('UTILITY', 'custom'),
    name: options.name,
    language: TEMPLATE_LANGUAGES.some((l) => l.code === input.language) ? input.language : 'en',
    body,
    samples: Object.fromEntries(fields.map((key, i) => [String(i + 1), def.fields.find((f) => f.key === key)?.sample || 'Example'])),
    buttons: def.buttons.map((b, i) => {
      const text = words[i] ?? b.text
      return b.type === 'URL'
        ? { type: 'URL' as const, text, url: `${base}${b.path || '/'}{{1}}`, example: `${base}${b.path || '/'}AbCdEf123456` }
        : { type: 'QUICK_REPLY' as const, text }
    }),
    // Meta files it under the right kind instead of refusing it (the screen says when it did)
    allowCategoryChange: true,
  }
  const problems: string[] = []
  if (unknown.length) problems.push(`${unknown.map((u) => `{${u}}`).join(', ')} ${unknown.length === 1 ? 'is not a blank' : 'are not blanks'} this message can fill. Use the blank buttons to add one.`)
  // Numbered blanks typed by hand have nothing to fill them: blanks are added with the buttons
  if (/\{\{|\}\}/.test(String(input.text || ''))) problems.push('Use single braces for blanks, like {Customer first name}, or the blank buttons.')
  if (body.length > 0 && body.replace(NUMBERED, '').trim().length < 10) problems.push('Write a few more words.')
  for (const p of validateDraft(draft)) {
    // Examples are filled here, and the name is made here
    if (p.field === 'samples' || p.field === 'name') continue
    problems.push(plainProblem(p.message))
  }
  return { draft, fields, problems: [...new Set(problems)] }
}

// ── Names on WhatsApp ───────────────────────────────────────────────────────

/** A name Meta accepts: lowercase letters, numbers and underscores. */
export function cleanTemplateName(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 480) || 'message'
}

/**
 * A name not used on the account: the base name, else base_2, base_3… Meta keeps names apart per account, and a
 * deleted or rejected one cannot be taken again straight away, so a new version always gets a new name.
 */
export function autoTemplateName(baseName: string, taken: Iterable<string>): string {
  const base = cleanTemplateName(baseName)
  const used = new Set([...taken].map((n) => String(n).toLowerCase()))
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`
  return `${base}_${Date.now().toString(36)}`
}

/** Meta refused the name because it is in use or still being deleted (then the next name is tried). */
export function isNameTakenError(error: any): boolean {
  const detail = error?.details?.[0] || error?.error || {}
  const subcode = Number(detail?.error_subcode ?? error?.subcode)
  if ([2388023, 2388024, 2388025].includes(subcode)) return true
  const text = `${detail?.error_user_title || ''} ${detail?.error_user_msg || ''} ${detail?.message || ''} ${error?.message || ''}`
  return /already exists|being deleted|name (is|was) (already )?(taken|in use|used)|can.?t be (re)?used|delet\w* .*(name|language)/i.test(text)
}

// ── Where a template stands ────────────────────────────────────────────────

/** Why Meta rejected it, in words a shopkeeper can act on. */
export function rejectedReason(reason: string | null | undefined): string {
  switch (String(reason || '').toUpperCase()) {
    case 'PROMOTIONAL':
    case 'INCORRECT_CATEGORY':
      return 'Meta read it as an advert. Keep to the facts about the visit or order, without offers, prices off or words like "sale" and "discount".'
    case 'INVALID_FORMAT':
      return 'Meta found a problem with the layout. Keep words before and after each blank, and check the button words.'
    case 'ABUSIVE_CONTENT':
    case 'SCAM':
      return 'Meta flagged some of the words. Write it more plainly, as a short update to the customer.'
    case 'TAG_CONTENT_MISMATCH':
      return 'The language picked does not match the words. Pick the language the message is written in.'
    default:
      return 'Meta did not say why. Change the words a little and send it again.'
  }
}

export function templateFor(account: AccountTemplate[], name: string, language: string): AccountTemplate | null {
  return account.find((t) => t.name === name && t.language === language) || null
}

/** Where a set-up template stands on WhatsApp, from Meta's list. */
export function autoStatus(template: AccountTemplate | null, checked = true): { state: AutoState; label: string; reason: string | null } {
  if (!checked) return { state: 'unknown', label: 'Not checked', reason: null }
  if (!template || ['DELETED', 'PENDING_DELETION', 'ARCHIVED'].includes(String(template.status).toUpperCase())) return { state: 'missing', label: 'Not found', reason: null }
  switch (String(template.status).toUpperCase()) {
    case 'APPROVED': return { state: 'approved', label: 'Approved', reason: null }
    case 'REJECTED': return { state: 'rejected', label: 'Rejected', reason: rejectedReason(template.rejected_reason) }
    case 'DISABLED': return { state: 'rejected', label: 'Turned off by Meta', reason: 'Meta turned it off after customers reported it. Send a new wording.' }
    case 'PAUSED': return { state: 'paused', label: 'Paused', reason: 'Meta paused it for a while after customers reported it. It starts again by itself, or send a new wording.' }
    default: return { state: 'review', label: 'In review', reason: null }
  }
}

const componentOf = (t: AccountTemplate | null, type: string) => (t?.components || []).find((c: any) => String(c?.type).toUpperCase() === type)

/** A template's text and its button words. */
export function templateParts(template: AccountTemplate | null): { body: string; buttons: { type: string; text: string; url?: string }[] } {
  const buttons = (componentOf(template, 'BUTTONS')?.buttons || []).map((b: any) => ({ type: String(b?.type || '').toUpperCase(), text: String(b?.text || ''), url: b?.url }))
  return { body: String(componentOf(template, 'BODY')?.text || ''), buttons }
}

/** How many numbered blanks a text has (the highest number). */
export function blankCount(body: string): number {
  const numbers = [...String(body || '').matchAll(NUMBERED)].map((m) => Number(m[1]))
  return numbers.length ? Math.max(...numbers) : 0
}

// ── What the screens show ──────────────────────────────────────────────────

export interface AutoMessageView {
  purpose: string
  title: string
  when: string
  fields: AutoField[]
  buttons: { type: 'URL' | 'QUICK_REPLY'; text: string; note: string }[]
  /** The suggested text as the editor shows it, its button words, and what fills its blanks in order. */
  suggestion: { text: string; buttons: string[]; fieldKeys: string[] }
  /** E-commerce: whether the message is sent at all, and whether the business can switch it. */
  on?: boolean
  switchable?: boolean
  current: null | {
    name: string
    language: string
    languageLabel: string
    state: AutoState
    label: string
    reason: string | null
    /** Meta filed it under another kind than Utility (it still works). */
    category: string | null
    /** The template's text and button words as the editor shows them (null when it is not on WhatsApp). */
    text: string | null
    buttons: string[] | null
    previous: { name: string; state: AutoState } | null
  }
}

/** One message as the screens show it: the suggestion, and the set-up template with where it stands. */
export function autoView(def: AutoMessageDef, choice: AutoChoice | null | undefined, account: AccountTemplate[], options: { checked: boolean; business?: string | null }): AutoMessageView {
  const fields = def.fields.map((f) => (f.key === 'business' || f.key === 'shop') && options.business ? { ...f, sample: options.business } : f)
  const view: AutoMessageView = {
    purpose: def.purpose,
    title: def.title,
    when: def.when,
    fields,
    buttons: def.buttons.map(({ type, text, note }) => ({ type, text, note })),
    suggestion: { text: toEditorText(def.suggestion.body, def.suggestion.fields, fields), buttons: def.buttons.map((b) => b.text), fieldKeys: [...def.suggestion.fields] },
    current: null,
  }
  if (!choice?.name) return view
  const template = templateFor(account, choice.name, choice.language)
  const status = autoStatus(template, options.checked)
  const parts = templateParts(template)
  const previous = choice.previous?.name ? templateFor(account, choice.previous.name, choice.previous.language) : null
  view.current = {
    name: choice.name,
    language: choice.language,
    languageLabel: languageLabel(choice.language),
    ...status,
    category: template?.category && String(template.category).toUpperCase() !== 'UTILITY' ? String(template.category).toUpperCase() : null,
    text: template ? toEditorText(parts.body, choice.fields, fields) : null,
    buttons: template ? parts.buttons.filter((b) => b.type === 'URL' || b.type === 'QUICK_REPLY').map((b) => b.text) : null,
    previous: choice.previous?.name ? { name: choice.previous.name, state: autoStatus(previous, options.checked).state } : null,
  }
  return view
}

/**
 * The choice to keep after a new template went to Meta: it becomes the one set up, and the one it replaces stays
 * as the fallback only while it is approved (or the fallback it had, when the replaced one was never approved).
 */
export function nextChoice(old: AutoChoice | null | undefined, made: { name: string; language: string; fields: string[] }, account: AccountTemplate[]): AutoChoice {
  const oldApproved = old?.name ? autoStatus(templateFor(account, old.name, old.language)).state === 'approved' : false
  const keep = oldApproved && old ? { name: old.name, language: old.language, fields: [...old.fields] } : old?.previous || null
  return { ...made, previous: keep && keep.name !== made.name ? keep : null }
}

/** Once the set-up template is approved, its fallback is no longer needed. */
export function settledChoice(choice: AutoChoice, account: AccountTemplate[]): AutoChoice {
  if (!choice.previous) return choice
  return autoStatus(templateFor(account, choice.name, choice.language)).state === 'approved' ? { ...choice, previous: null } : choice
}

/** The account's approved templates a message could use instead ("one I already have"), with their blanks. */
export function pickableTemplates(account: AccountTemplate[], def: AutoMessageDef) {
  const hasLink = def.buttons.some((b) => b.type === 'URL')
  return account
    .filter((t) => String(t.status).toUpperCase() === 'APPROVED')
    .map((t) => {
      const parts = templateParts(t)
      return {
        name: t.name,
        language: t.language,
        body: parts.body,
        blanks: blankCount(parts.body),
        urlButton: parts.buttons.some((b) => b.type === 'URL' && /\{\{\s*1\s*\}\}/.test(String(b.url || ''))),
        quickReplies: parts.buttons.filter((b) => b.type === 'QUICK_REPLY').length,
      }
    })
    // A link to fill needs a message with a link to open
    .filter((t) => hasLink || !t.urlButton)
    .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language))
}

/** Languages offered for a template (code and name). */
export const AUTO_LANGUAGES = TEMPLATE_LANGUAGES.map(({ code, label }) => ({ code, label }))

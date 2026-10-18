/**
 * WhatsApp message templates as WhatsApp Manager builds them: the editor's draft, Meta's rules,
 * the Graph API payload, and reading a template back from Meta. Pure and client-safe; the
 * Templates page, the API routes and the tests share it.
 *
 * Reference: Graph API /{WABA_ID}/message_templates (create, list, delete) and /{TEMPLATE_ID} (edit).
 */

export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'

/** The kinds of template WhatsApp Manager offers under each category. */
export type TemplateType =
  | 'custom' | 'carousel' | 'catalog' | 'lto' | 'coupon' | 'flow' | 'otp'
  | 'mpm' | 'spm' | 'product_carousel' | 'order_details' | 'call_permission'

export type HeaderFormat = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION'
export type ParameterFormat = 'POSITIONAL' | 'NAMED'
export type OtpType = 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP'

export type ButtonDraft =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example?: string }
  | { type: 'PHONE_NUMBER'; text: string; phone_number: string }
  | { type: 'COPY_CODE'; example: string }
  | { type: 'FLOW'; text: string; flow_id: string; navigate_screen?: string }
  /** WhatsApp Business Calling: starts a voice call to the business. */
  | { type: 'VOICE_CALL'; text: string }

export interface CardDraft {
  headerFormat: 'IMAGE' | 'VIDEO'
  /** Upload handle ("4::…") from the media upload, and a local preview URL. */
  headerHandle: string
  headerPreview?: string
  body: string
  samples: Record<string, string>
  buttons: ButtonDraft[]
}

export interface TemplateDraft {
  name: string
  language: string
  category: TemplateCategory
  type: TemplateType
  parameterFormat: ParameterFormat
  headerFormat: HeaderFormat
  headerText: string
  headerHandle: string
  headerPreview?: string
  body: string
  footer: string
  buttons: ButtonDraft[]
  /** Example values for every variable, by variable name ("1", "first_name", "header:1"). */
  samples: Record<string, string>
  cards: CardDraft[]
  lto: { text: string; hasExpiration: boolean }
  otp: {
    type: OtpType
    buttonText: string
    autofillText: string
    /** Android apps the code can be sent to (one-tap and zero-tap), up to 5. */
    apps: Array<{ packageName: string; signatureHash: string }>
    /** Zero-tap needs the business to accept WhatsApp's terms for it. */
    zeroTapTermsAccepted: boolean
    addSecurityRecommendation: boolean
    codeExpirationMinutes: number | null
  }
  /** Product card carousel: how many product cards (2 to 10); the products are chosen when sending. */
  productCards: number
  /** Message validity period: how long WhatsApp keeps trying to deliver. null = Meta's default. */
  ttlSeconds: number | null
  /** Let Meta move the template to the right category instead of rejecting it. */
  allowCategoryChange: boolean
}

// ── Choices ─────────────────────────────────────────────────────────────────

export const TEMPLATE_TYPES: Record<TemplateCategory, Array<{ type: TemplateType; title: string; description: string }>> = {
  MARKETING: [
    { type: 'custom', title: 'Default', description: 'Send messages with media and customised buttons to engage your customers.' },
    { type: 'carousel', title: 'Media card carousel', description: 'Send up to 10 scrollable cards, each with an image or video and buttons.' },
    { type: 'catalog', title: 'Catalogue', description: 'Send messages that drive sales by connecting your product catalogue.' },
    { type: 'mpm', title: 'Multi-product message', description: 'Send up to 30 products from your catalogue, in sections, in one message.' },
    { type: 'spm', title: 'Single-product message', description: 'Feature one product from your catalogue, with its image, name and price.' },
    { type: 'product_carousel', title: 'Product card carousel', description: 'Send 2 to 10 scrollable product cards from your catalogue.' },
    { type: 'lto', title: 'Limited-time offer', description: 'Send an offer with an expiry countdown and a copy-code button.' },
    { type: 'coupon', title: 'Coupon code', description: 'Send messages with a promo code customers can copy with one tap.' },
    { type: 'flow', title: 'Flows', description: 'Send a form to capture interests, appointment requests or run surveys.' },
    { type: 'call_permission', title: 'Call permissions request', description: 'Ask customers for permission to call them on WhatsApp.' },
  ],
  UTILITY: [
    { type: 'custom', title: 'Default', description: 'Send messages about an existing order or account.' },
    { type: 'flow', title: 'Flows', description: 'Send a form to collect feedback, send reminders or manage orders.' },
    { type: 'order_details', title: 'Order details', description: 'Send an order summary with a Review and pay button (payments in India).' },
    { type: 'call_permission', title: 'Call permissions request', description: 'Ask customers for permission to call them on WhatsApp.' },
  ],
  AUTHENTICATION: [
    { type: 'otp', title: 'One-time passcode', description: 'Send codes to verify a transaction or login.' },
  ],
}

export const CATEGORY_LABELS: Record<TemplateCategory, { title: string; description: string }> = {
  MARKETING: { title: 'Marketing', description: 'Promotions or information about your business, products or services. Or any message that isn\'t utility or authentication.' },
  UTILITY: { title: 'Utility', description: 'Messages about a specific transaction, account, order or customer request.' },
  AUTHENTICATION: { title: 'Authentication', description: 'One-time passcodes used to verify a transaction or login.' },
}

export const TEMPLATE_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' }, { code: 'en_US', label: 'English (US)' }, { code: 'en_GB', label: 'English (UK)' },
  { code: 'hi', label: 'Hindi' }, { code: 'te', label: 'Telugu' }, { code: 'ta', label: 'Tamil' }, { code: 'kn', label: 'Kannada' },
  { code: 'ml', label: 'Malayalam' }, { code: 'mr', label: 'Marathi' }, { code: 'bn', label: 'Bengali' }, { code: 'gu', label: 'Gujarati' },
  { code: 'pa', label: 'Punjabi' }, { code: 'ur', label: 'Urdu' }, { code: 'ar', label: 'Arabic' }, { code: 'es', label: 'Spanish' },
  { code: 'pt_BR', label: 'Portuguese (BR)' }, { code: 'fr', label: 'French' }, { code: 'de', label: 'German' }, { code: 'id', label: 'Indonesian' },
  { code: 'ms', label: 'Malay' }, { code: 'it', label: 'Italian' }, { code: 'ru', label: 'Russian' }, { code: 'tr', label: 'Turkish' },
  { code: 'zh_CN', label: 'Chinese (CHN)' }, { code: 'ja', label: 'Japanese' },
]

export function languageLabel(code: string): string {
  return TEMPLATE_LANGUAGES.find((language) => language.code === code)?.label || code
}

/** What each Meta status means, as WhatsApp Manager shows it. */
export const STATUS_INFO: Record<string, { label: string; tone: 'green' | 'yellow' | 'red' | 'gray' | 'blue'; help: string }> = {
  APPROVED: { label: 'Active', tone: 'green', help: 'Approved by Meta. You can send it.' },
  PENDING: { label: 'In review', tone: 'yellow', help: 'Meta is reviewing it, usually within minutes and at most 24 hours.' },
  IN_APPEAL: { label: 'In appeal', tone: 'yellow', help: 'You appealed the rejection; Meta is reviewing it again.' },
  REJECTED: { label: 'Rejected', tone: 'red', help: 'Meta did not approve it. Fix the reason and edit it, or create a new one.' },
  PAUSED: { label: 'Paused', tone: 'gray', help: 'Paused by Meta after negative feedback. It is resumed automatically after the pause.' },
  DISABLED: { label: 'Disabled', tone: 'red', help: 'Disabled by Meta after repeated negative feedback. Create a new template.' },
  PENDING_DELETION: { label: 'Being deleted', tone: 'gray', help: 'Deleted; its name can be reused after 30 days.' },
  DELETED: { label: 'Deleted', tone: 'gray', help: 'Deleted.' },
  LIMIT_EXCEEDED: { label: 'Limit exceeded', tone: 'red', help: 'Your account has reached its template limit.' },
  ARCHIVED: { label: 'Archived', tone: 'gray', help: 'Archived.' },
}

export const REJECTION_REASONS: Record<string, string> = {
  ABUSIVE_CONTENT: 'The content was flagged as abusive.',
  INCORRECT_CATEGORY: 'The category does not match the content. Pick the category the message really is.',
  INVALID_FORMAT: 'The format is invalid: check variables, samples and buttons.',
  SCAM: 'The content was flagged as a possible scam.',
  TAG_CONTENT_MISMATCH: 'The content does not match the template type or language.',
  PROMOTIONAL: 'Promotional content in a Utility template. Use the Marketing category.',
  NONE: 'Meta gave no reason.',
}

// ── Limits (WhatsApp Manager) ───────────────────────────────────────────────

export const LIMITS = {
  name: 512,
  headerText: 60,
  body: 1024,
  carouselBody: 160,
  footer: 60,
  buttonText: 25,
  url: 2000,
  phone: 20,
  buttons: 10,
  urlButtons: 2,
  phoneButtons: 1,
  copyCodeButtons: 1,
  couponCode: 15,
  cards: 10,
  minCards: 2,
  ltoText: 16,
  otpApps: 5,
}

/** Message validity period Meta allows per category, in seconds (min, max, default). */
export const TTL_LIMITS: Record<TemplateCategory, { min: number; max: number; default: number }> = {
  AUTHENTICATION: { min: 30, max: 900, default: 600 },
  UTILITY: { min: 30, max: 43200, default: 2592000 },
  MARKETING: { min: 43200, max: 2592000, default: 2592000 },
}

/** "10 minutes", "12 hours", "30 days". */
export function describeDuration(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`
  return `${seconds} seconds`
}

/** Types sent with products from the linked catalogue. */
export const PRODUCT_TYPES: TemplateType[] = ['catalog', 'mpm', 'spm', 'product_carousel']

// ── Variables ───────────────────────────────────────────────────────────────

const VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g

/** The variables in a text, in order of first use: "{{1}}" → "1", "{{first_name}}" → "first_name". */
export function extractVariables(text: string): string[] {
  const names: string[] = []
  for (const match of String(text || '').matchAll(VARIABLE)) {
    if (!names.includes(match[1])) names.push(match[1])
  }
  return names
}

/** The next variable to insert: "{{3}}" for positional, a fresh name for named. */
export function nextVariable(text: string, format: ParameterFormat, existing: string[] = []): string {
  const used = [...extractVariables(text), ...existing]
  if (format === 'NAMED') {
    let index = 1
    while (used.includes(`variable_${index}`)) index++
    return `{{variable_${index}}}`
  }
  const numbers = used.map((name) => parseInt(name, 10)).filter((value) => Number.isFinite(value))
  return `{{${(numbers.length ? Math.max(...numbers) : 0) + 1}}}`
}

/** Text with each variable replaced by its sample, for the preview. */
export function fillSamples(text: string, samples: Record<string, string>, prefix = ''): string {
  return String(text || '').replace(VARIABLE, (whole, name) => samples[`${prefix}${name}`] || whole)
}

/** Problems with a text's variables, in Meta's words. */
function variableProblems(text: string, format: ParameterFormat, where: string): string[] {
  const problems: string[] = []
  const names = extractVariables(text)
  if (names.length === 0) return problems
  if (format === 'POSITIONAL') {
    if (names.some((name) => !/^\d+$/.test(name))) problems.push(`${where}: variables must be numbers like {{1}}, {{2}}.`)
    const numbers = names.map(Number).sort((a, b) => a - b)
    if (numbers.some((value, index) => value !== index + 1)) problems.push(`${where}: variables must be in order without gaps: {{1}}, {{2}}, {{3}}…`)
  } else if (names.some((name) => !/^[a-z][a-z0-9_]*$/.test(name))) {
    problems.push(`${where}: variable names use lowercase letters, numbers and underscores, starting with a letter.`)
  }
  const trimmed = text.trim()
  if (/^\{\{[^{}]*\}\}/.test(trimmed) || /\{\{[^{}]*\}\}[.!?]?$/.test(trimmed)) {
    problems.push(`${where}: a variable can't be at the very start or end. Add some words around it.`)
  }
  if (/\}\}\s*\{\{/.test(text)) problems.push(`${where}: two variables can't be next to each other.`)
  return problems
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface DraftProblem {
  field: string
  message: string
}

export function validateDraft(draft: TemplateDraft): DraftProblem[] {
  const problems: DraftProblem[] = []
  const add = (field: string, message: string) => problems.push({ field, message })

  if (!draft.name) add('name', 'Enter a template name.')
  else if (!/^[a-z0-9_]+$/.test(draft.name)) add('name', 'Use only lowercase letters, numbers and underscores.')
  else if (draft.name.length > LIMITS.name) add('name', `The name can be at most ${LIMITS.name} characters.`)
  if (!draft.language) add('language', 'Choose a language.')

  if (draft.ttlSeconds !== null) {
    const ttl = TTL_LIMITS[draft.category]
    if (!Number.isFinite(draft.ttlSeconds) || draft.ttlSeconds < ttl.min || draft.ttlSeconds > ttl.max) {
      add('ttl', `The validity period for ${draft.category.toLowerCase()} templates is ${describeDuration(ttl.min)} to ${describeDuration(ttl.max)}.`)
    }
  }
  if (draft.type === 'order_details' && draft.category !== 'UTILITY') add('type', 'Order details templates are Utility templates.')

  if (draft.type === 'otp') {
    if (draft.otp.type !== 'COPY_CODE') {
      if (draft.otp.apps.length === 0) add('otp', 'Add the Android app the code is sent to.')
      if (draft.otp.apps.length > LIMITS.otpApps) add('otp', `Add at most ${LIMITS.otpApps} apps.`)
      draft.otp.apps.forEach((app, index) => {
        const which = draft.otp.apps.length > 1 ? `App ${index + 1}: ` : ''
        if (!/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(app.packageName)) add('otp', `${which}enter the Android package name, like com.example.app.`)
        if (!/^[A-Za-z0-9+/]{11}$/.test(app.signatureHash)) add('otp', `${which}enter the app's 11-character signature hash.`)
      })
      if (draft.otp.type === 'ZERO_TAP' && !draft.otp.zeroTapTermsAccepted) add('otp', 'Accept the zero-tap terms to use zero-tap autofill.')
    }
    if (draft.otp.codeExpirationMinutes !== null && (draft.otp.codeExpirationMinutes < 1 || draft.otp.codeExpirationMinutes > 90)) add('otp', 'Code expiry must be between 1 and 90 minutes.')
    if (draft.otp.buttonText.length > LIMITS.buttonText) add('otp', `Button text can be at most ${LIMITS.buttonText} characters.`)
    return problems
  }

  // Header
  if (draft.type === 'mpm' && draft.headerFormat !== 'TEXT') add('header', 'A multi-product message needs a text header.')
  if (draft.headerFormat === 'TEXT' && draft.type !== 'spm' && draft.type !== 'product_carousel') {
    if (!draft.headerText.trim()) add('header', 'Enter the header text or choose no header.')
    if (draft.headerText.length > LIMITS.headerText) add('header', `The header can be at most ${LIMITS.headerText} characters.`)
    const headerVariables = extractVariables(draft.headerText)
    if (headerVariables.length > 1) add('header', 'The header can have only one variable.')
    if (/[\n*_~]/.test(draft.headerText) || /\p{Extended_Pictographic}/u.test(draft.headerText)) add('header', 'The header can\'t have new lines, formatting or emoji.')
    headerVariables.forEach((name) => { if (!draft.samples[`header:${name}`]?.trim()) add('samples', `Add a sample for the header variable {{${name}}}.`) })
  }
  if (!['spm', 'mpm', 'product_carousel'].includes(draft.type) && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(draft.headerFormat) && !draft.headerHandle) add('header', `Upload a sample ${draft.headerFormat.toLowerCase()} for the header.`)

  // Body
  const bodyLimit = LIMITS.body
  if (!draft.body.trim()) add('body', 'Enter the message body.')
  if (draft.body.length > bodyLimit) add('body', `The body can be at most ${bodyLimit} characters.`)
  variableProblems(draft.body, draft.parameterFormat, 'Body').forEach((message) => add('body', message))
  extractVariables(draft.body).forEach((name) => { if (!draft.samples[name]?.trim()) add('samples', `Add a sample for {{${name}}}.`) })
  const bodyVariables = extractVariables(draft.body).length
  const words = draft.body.replace(VARIABLE, ' ').split(/\s+/).filter(Boolean).length
  if (bodyVariables > 0 && words < bodyVariables * 2 + 1) add('body', 'Too many variables for the length of the message. Add more words, or use fewer variables.')

  // Footer
  if (draft.type !== 'lto' && draft.footer) {
    if (draft.footer.length > LIMITS.footer) add('footer', `The footer can be at most ${LIMITS.footer} characters.`)
    if (extractVariables(draft.footer).length) add('footer', 'The footer can\'t have variables.')
  }

  // Buttons
  checkButtons(draft.buttons, 'buttons', add)
  if (draft.type === 'coupon' && !draft.buttons.some((button) => button.type === 'COPY_CODE')) add('buttons', 'A coupon template needs a Copy offer code button.')
  if (draft.type === 'lto') {
    if (!draft.lto.text.trim()) add('lto', 'Enter the offer heading, like "Expiring offer!".')
    if (draft.lto.text.length > LIMITS.ltoText) add('lto', `The offer heading can be at most ${LIMITS.ltoText} characters.`)
    if (!draft.buttons.some((button) => button.type === 'COPY_CODE')) add('buttons', 'A limited-time offer needs a Copy offer code button.')
    if (!draft.buttons.some((button) => button.type === 'URL')) add('buttons', 'A limited-time offer needs a Visit website button.')
  }
  if (draft.type === 'flow' && !draft.buttons.some((button) => button.type === 'FLOW')) add('buttons', 'A Flows template needs a Complete flow button.')
  if (draft.type === 'product_carousel' && (draft.productCards < LIMITS.minCards || draft.productCards > LIMITS.cards)) add('cards', `A product carousel has ${LIMITS.minCards} to ${LIMITS.cards} cards.`)

  // Carousel
  if (draft.type === 'carousel') {
    if (draft.cards.length < LIMITS.minCards || draft.cards.length > LIMITS.cards) add('cards', `A carousel has ${LIMITS.minCards} to ${LIMITS.cards} cards.`)
    const shape = (card: CardDraft) => card.buttons.map((button) => button.type).join(',')
    draft.cards.forEach((card, index) => {
      const where = `Card ${index + 1}`
      if (!card.headerHandle) add('cards', `${where}: upload an ${card.headerFormat.toLowerCase()}.`)
      if (card.headerFormat !== draft.cards[0].headerFormat) add('cards', 'Every card must have the same kind of media (all images or all videos).')
      if (!card.body.trim()) add('cards', `${where}: enter the card text.`)
      if (card.body.length > LIMITS.carouselBody) add('cards', `${where}: card text can be at most ${LIMITS.carouselBody} characters.`)
      extractVariables(card.body).forEach((name) => { if (!card.samples[name]?.trim()) add('cards', `${where}: add a sample for {{${name}}}.`) })
      if (card.buttons.length < 1 || card.buttons.length > 2) add('cards', `${where}: add one or two buttons.`)
      if (shape(card) !== shape(draft.cards[0])) add('cards', 'Every card must have the same buttons, in the same order.')
      checkButtons(card.buttons, 'cards', add, where)
    })
  }
  return dedupe(problems)
}

function checkButtons(buttons: ButtonDraft[], field: string, add: (field: string, message: string) => void, where = 'Buttons') {
  if (buttons.length > LIMITS.buttons) add(field, `${where}: at most ${LIMITS.buttons} buttons.`)
  const count = (type: ButtonDraft['type']) => buttons.filter((button) => button.type === type).length
  if (count('URL') > LIMITS.urlButtons) add(field, `${where}: at most ${LIMITS.urlButtons} Visit website buttons.`)
  if (count('PHONE_NUMBER') > LIMITS.phoneButtons) add(field, `${where}: at most one Call phone number button.`)
  if (count('COPY_CODE') > LIMITS.copyCodeButtons) add(field, `${where}: at most one Copy offer code button.`)
  if (count('FLOW') > 1) add(field, `${where}: at most one Complete flow button.`)
  if (count('VOICE_CALL') > 1) add(field, `${where}: at most one Call on WhatsApp button.`)
  if (count('VOICE_CALL') && count('PHONE_NUMBER')) add(field, `${where}: use either Call phone number or Call on WhatsApp, not both.`)
  const texts = new Set<string>()
  buttons.forEach((button, index) => {
    const label = `${where}, button ${index + 1}`
    if (button.type === 'COPY_CODE') {
      if (!button.example.trim()) add(field, `${label}: enter the offer code.`)
      else if (button.example.length > LIMITS.couponCode || !/^[A-Za-z0-9]+$/.test(button.example)) add(field, `${label}: the code is up to ${LIMITS.couponCode} letters and numbers.`)
      return
    }
    if (!button.text.trim()) add(field, `${label}: enter the button text.`)
    if (button.text.length > LIMITS.buttonText) add(field, `${label}: button text can be at most ${LIMITS.buttonText} characters.`)
    if (texts.has(button.text.trim().toLowerCase())) add(field, `${label}: two buttons can't have the same text.`)
    texts.add(button.text.trim().toLowerCase())
    if (button.type === 'URL') {
      if (!/^https?:\/\/[^\s]+$/.test(button.url)) add(field, `${label}: enter a full web address starting with https://.`)
      if (button.url.length > LIMITS.url) add(field, `${label}: the address is too long.`)
      const urlVariables = extractVariables(button.url)
      if (urlVariables.length > 1 || (urlVariables.length === 1 && !/\{\{\s*1\s*\}\}$/.test(button.url))) add(field, `${label}: a dynamic address can have one variable, {{1}}, at the end.`)
      if (urlVariables.length === 1 && !button.example?.trim()) add(field, `${label}: add a sample address for the variable.`)
    }
    if (button.type === 'PHONE_NUMBER' && !/^\+?[1-9]\d{6,18}$/.test(button.phone_number.replace(/[\s-]/g, ''))) add(field, `${label}: enter the phone number with its country code, like +919876543210.`)
    if (button.type === 'FLOW' && !button.flow_id.trim()) add(field, `${label}: choose the flow to open.`)
  })
  // Quick replies must sit together, before or after the other buttons
  const kinds = buttons.map((button) => (button.type === 'QUICK_REPLY' ? 'Q' : 'C')).join('')
  if (/Q+C+Q+|C+Q+C+/.test(kinds)) add(field, `${where}: keep quick reply buttons together, before or after the other buttons.`)
}

function dedupe(problems: DraftProblem[]): DraftProblem[] {
  const seen = new Set<string>()
  return problems.filter((problem) => (seen.has(problem.message) ? false : (seen.add(problem.message), true)))
}

// ── Draft → Graph API ───────────────────────────────────────────────────────

function textExample(text: string, samples: Record<string, string>, format: ParameterFormat, prefix = '', kind: 'body' | 'header' = 'body') {
  const names = extractVariables(text)
  if (names.length === 0) return undefined
  if (format === 'NAMED') {
    const key = kind === 'body' ? 'body_text_named_params' : 'header_text_named_params'
    return { [key]: names.map((name) => ({ param_name: name, example: samples[`${prefix}${name}`] || '' })) }
  }
  const values = names.map((name) => samples[`${prefix}${name}`] || '')
  return kind === 'body' ? { body_text: [values] } : { header_text: values }
}

function buttonsComponent(buttons: ButtonDraft[]) {
  if (buttons.length === 0) return null
  return {
    type: 'BUTTONS',
    buttons: buttons.map((button) => {
      switch (button.type) {
        case 'QUICK_REPLY': return { type: 'QUICK_REPLY', text: button.text.trim() }
        case 'URL': return { type: 'URL', text: button.text.trim(), url: button.url.trim(), ...(extractVariables(button.url).length ? { example: [button.example?.trim() || ''] } : {}) }
        case 'PHONE_NUMBER': return { type: 'PHONE_NUMBER', text: button.text.trim(), phone_number: button.phone_number.replace(/[\s-]/g, '') }
        case 'COPY_CODE': return { type: 'COPY_CODE', example: button.example.trim() }
        case 'FLOW': return { type: 'FLOW', text: button.text.trim(), flow_id: button.flow_id, flow_action: 'navigate', ...(button.navigate_screen ? { navigate_screen: button.navigate_screen } : {}) }
        case 'VOICE_CALL': return { type: 'VOICE_CALL', text: button.text.trim() }
      }
    }),
  }
}

/** The components Meta expects for a draft (used for create and edit). */
export function buildComponents(draft: TemplateDraft): any[] {
  const components: any[] = []

  if (draft.type === 'otp') {
    components.push({ type: 'BODY', add_security_recommendation: draft.otp.addSecurityRecommendation })
    if (draft.otp.codeExpirationMinutes) components.push({ type: 'FOOTER', code_expiration_minutes: draft.otp.codeExpirationMinutes })
    const otp: any = { type: 'OTP', otp_type: draft.otp.type }
    if (draft.otp.buttonText.trim()) otp.text = draft.otp.buttonText.trim()
    if (draft.otp.type !== 'COPY_CODE') {
      otp.supported_apps = draft.otp.apps.map((app) => ({ package_name: app.packageName.trim(), signature_hash: app.signatureHash.trim() }))
      // Zero-tap falls back to one-tap, so both carry the autofill button text
      if (draft.otp.autofillText.trim()) otp.autofill_text = draft.otp.autofillText.trim()
      if (draft.otp.type === 'ZERO_TAP') otp.zero_tap_terms_accepted = draft.otp.zeroTapTermsAccepted
    }
    components.push({ type: 'BUTTONS', buttons: [otp] })
    return components
  }

  // Header
  if (draft.type === 'spm') {
    components.push({ type: 'HEADER', format: 'PRODUCT' })
  } else if (draft.type !== 'carousel' && draft.type !== 'product_carousel') {
    if (draft.headerFormat === 'TEXT') {
      const example = textExample(draft.headerText, draft.samples, draft.parameterFormat, 'header:', 'header')
      components.push({ type: 'HEADER', format: 'TEXT', text: draft.headerText.trim(), ...(example ? { example } : {}) })
    } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(draft.headerFormat)) {
      components.push({ type: 'HEADER', format: draft.headerFormat, example: { header_handle: [draft.headerHandle] } })
    } else if (draft.headerFormat === 'LOCATION') {
      components.push({ type: 'HEADER', format: 'LOCATION' })
    }
  }

  if (draft.type === 'lto') {
    components.push({ type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: draft.lto.text.trim(), has_expiration: draft.lto.hasExpiration } })
  }

  const bodyExample = textExample(draft.body, draft.samples, draft.parameterFormat)
  components.push({ type: 'BODY', text: draft.body.trim(), ...(bodyExample ? { example: bodyExample } : {}) })

  if (draft.footer.trim() && !['lto', 'carousel', 'product_carousel'].includes(draft.type)) components.push({ type: 'FOOTER', text: draft.footer.trim() })

  if (draft.type === 'call_permission') components.push({ type: 'CALL_PERMISSION_REQUEST' })

  if (draft.type === 'product_carousel') {
    components.push({
      type: 'CAROUSEL',
      cards: Array.from({ length: draft.productCards }, () => ({
        components: [{ type: 'HEADER', format: 'PRODUCT' }, { type: 'BUTTONS', buttons: [{ type: 'SPM', text: 'View' }] }],
      })),
    })
    return components
  }

  if (draft.type === 'carousel') {
    components.push({
      type: 'CAROUSEL',
      cards: draft.cards.map((card) => {
        const cardExample = textExample(card.body, card.samples, draft.parameterFormat)
        return {
          components: [
            { type: 'HEADER', format: card.headerFormat, example: { header_handle: [card.headerHandle] } },
            { type: 'BODY', text: card.body.trim(), ...(cardExample ? { example: cardExample } : {}) },
            buttonsComponent(card.buttons),
          ].filter(Boolean),
        }
      }),
    })
    return components
  }

  const fixed: Partial<Record<TemplateType, any[]>> = {
    catalog: [{ type: 'CATALOG', text: 'View catalog' }],
    mpm: [{ type: 'MPM', text: 'View items' }],
    spm: [{ type: 'SPM', text: 'View' }],
    order_details: [{ type: 'ORDER_DETAILS', text: 'Review and pay' }],
  }
  const buttons = fixed[draft.type] || null
  const component = buttons ? { type: 'BUTTONS', buttons } : buttonsComponent(draft.buttons)
  if (component) components.push(component)
  return components
}

/** The body of POST /{WABA_ID}/message_templates for a new template. */
export function buildCreatePayload(draft: TemplateDraft) {
  return {
    name: draft.name,
    language: draft.language,
    category: draft.category,
    ...(draft.type !== 'otp' && draft.parameterFormat === 'NAMED' ? { parameter_format: 'NAMED' } : {}),
    ...(draft.allowCategoryChange && draft.category !== 'AUTHENTICATION' ? { allow_category_change: true } : {}),
    ...(draft.ttlSeconds !== null ? { message_send_ttl_seconds: draft.ttlSeconds } : {}),
    components: buildComponents(draft),
  }
}

// ── Graph API → draft (edit, duplicate) ─────────────────────────────────────

export function emptyDraft(category: TemplateCategory = 'MARKETING', type: TemplateType = 'custom'): TemplateDraft {
  return {
    name: '',
    language: 'en',
    category,
    type,
    parameterFormat: 'POSITIONAL',
    headerFormat: type === 'mpm' ? 'TEXT' : 'NONE',
    headerText: '',
    headerHandle: '',
    body: '',
    footer: '',
    buttons: type === 'coupon' ? [{ type: 'COPY_CODE', example: '' }] : type === 'lto' ? [{ type: 'COPY_CODE', example: '' }, { type: 'URL', text: 'Book now', url: 'https://' }] : type === 'flow' ? [{ type: 'FLOW', text: 'Open form', flow_id: '' }] : [],
    samples: {},
    cards: type === 'carousel' ? [emptyCard(), emptyCard()] : [],
    lto: { text: 'Expiring offer!', hasExpiration: true },
    otp: { type: 'COPY_CODE', buttonText: 'Copy code', autofillText: 'Autofill', apps: [{ packageName: '', signatureHash: '' }], zeroTapTermsAccepted: false, addSecurityRecommendation: true, codeExpirationMinutes: 10 },
    productCards: 3,
    ttlSeconds: null,
    allowCategoryChange: true,
  }
}

export function emptyCard(): CardDraft {
  return { headerFormat: 'IMAGE', headerHandle: '', body: '', samples: {}, buttons: [{ type: 'QUICK_REPLY', text: 'Interested' }] }
}

function samplesFrom(component: any, prefix = ''): Record<string, string> {
  const samples: Record<string, string> = {}
  const example = component?.example || {}
  for (const param of [...(example.body_text_named_params || []), ...(example.header_text_named_params || [])]) {
    if (param?.param_name) samples[`${prefix}${param.param_name}`] = String(param.example || '')
  }
  const positional: string[] = example.body_text?.[0] || example.header_text || []
  extractVariables(component?.text || '').forEach((name, index) => {
    if (positional[index] !== undefined && samples[`${prefix}${name}`] === undefined) samples[`${prefix}${name}`] = String(positional[index])
  })
  return samples
}

function buttonsFrom(component: any): ButtonDraft[] {
  return (component?.buttons || []).flatMap((button: any): ButtonDraft[] => {
    switch (String(button.type).toUpperCase()) {
      case 'QUICK_REPLY': return [{ type: 'QUICK_REPLY', text: button.text || '' }]
      case 'URL': return [{ type: 'URL', text: button.text || '', url: button.url || '', example: button.example?.[0] || '' }]
      case 'PHONE_NUMBER': return [{ type: 'PHONE_NUMBER', text: button.text || '', phone_number: button.phone_number || '' }]
      case 'COPY_CODE': return [{ type: 'COPY_CODE', example: Array.isArray(button.example) ? button.example[0] || '' : button.example || '' }]
      case 'FLOW': return [{ type: 'FLOW', text: button.text || '', flow_id: String(button.flow_id || ''), navigate_screen: button.navigate_screen }]
      case 'VOICE_CALL': return [{ type: 'VOICE_CALL', text: button.text || '' }]
      default: return []
    }
  })
}

/** An editor draft from a template as Meta lists it. */
export function draftFromMeta(template: any): TemplateDraft {
  const components: any[] = template?.components || []
  const find = (type: string) => components.find((component) => String(component.type).toUpperCase() === type)
  const header = find('HEADER')
  const body = find('BODY')
  const footer = find('FOOTER')
  const buttons = find('BUTTONS')
  const carousel = find('CAROUSEL')
  const lto = find('LIMITED_TIME_OFFER')
  const category = (String(template?.category || 'MARKETING').toUpperCase() as TemplateCategory)
  const buttonTypes = (buttons?.buttons || []).map((button: any) => String(button.type).toUpperCase())

  const cardHeaderFormat = String(carousel?.cards?.[0]?.components?.find((c: any) => String(c.type).toUpperCase() === 'HEADER')?.format || '').toUpperCase()
  const type: TemplateType = category === 'AUTHENTICATION' ? 'otp'
    : carousel ? (cardHeaderFormat === 'PRODUCT' ? 'product_carousel' : 'carousel')
      : lto ? 'lto'
        : String(header?.format || '').toUpperCase() === 'PRODUCT' || buttonTypes.includes('SPM') ? 'spm'
          : buttonTypes.includes('MPM') ? 'mpm'
            : buttonTypes.includes('CATALOG') ? 'catalog'
              : buttonTypes.includes('ORDER_DETAILS') ? 'order_details'
                : find('CALL_PERMISSION_REQUEST') ? 'call_permission'
                  : buttonTypes.includes('FLOW') ? 'flow'
                    : buttonTypes.includes('COPY_CODE') ? 'coupon'
                      : 'custom'

  const draft = emptyDraft(category, type)
  draft.name = template?.name || ''
  draft.language = template?.language || 'en'
  draft.parameterFormat = String(template?.parameter_format || '').toUpperCase() === 'NAMED' ? 'NAMED' : 'POSITIONAL'
  draft.headerFormat = header && String(header.format).toUpperCase() !== 'PRODUCT' ? (String(header.format || 'TEXT').toUpperCase() as HeaderFormat) : 'NONE'
  if (typeof template?.message_send_ttl_seconds === 'number') draft.ttlSeconds = template.message_send_ttl_seconds
  draft.headerText = header?.text || ''
  draft.headerHandle = header?.example?.header_handle?.[0] || ''
  draft.headerPreview = draft.headerHandle.startsWith('http') ? draft.headerHandle : undefined
  draft.body = body?.text || ''
  draft.footer = footer?.text || ''
  draft.buttons = buttonsFrom(buttons)
  draft.samples = { ...samplesFrom(body), ...samplesFrom(header, 'header:') }
  if (lto) draft.lto = { text: lto.limited_time_offer?.text || '', hasExpiration: lto.limited_time_offer?.has_expiration !== false }
  if (carousel && type === 'product_carousel') draft.productCards = (carousel.cards || []).length || 2
  if (carousel && type === 'carousel') {
    draft.cards = (carousel.cards || []).map((card: any): CardDraft => {
      const cardHeader = (card.components || []).find((c: any) => String(c.type).toUpperCase() === 'HEADER')
      const cardBody = (card.components || []).find((c: any) => String(c.type).toUpperCase() === 'BODY')
      const cardButtons = (card.components || []).find((c: any) => String(c.type).toUpperCase() === 'BUTTONS')
      const handle = cardHeader?.example?.header_handle?.[0] || ''
      return { headerFormat: String(cardHeader?.format).toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE', headerHandle: handle, headerPreview: handle.startsWith('http') ? handle : undefined, body: cardBody?.text || '', samples: samplesFrom(cardBody), buttons: buttonsFrom(cardButtons) }
    })
  }
  if (type === 'otp') {
    const otp = (buttons?.buttons || [])[0] || {}
    draft.otp = {
      type: (String(otp.otp_type || 'COPY_CODE').toUpperCase() as OtpType),
      buttonText: otp.text || 'Copy code',
      autofillText: otp.autofill_text || 'Autofill',
      apps: (otp.supported_apps?.length ? otp.supported_apps : otp.package_name ? [{ package_name: otp.package_name, signature_hash: otp.signature_hash }] : [{}])
        .map((app: any) => ({ packageName: app.package_name || '', signatureHash: app.signature_hash || '' })),
      zeroTapTermsAccepted: otp.zero_tap_terms_accepted === true,
      addSecurityRecommendation: body?.add_security_recommendation !== false,
      codeExpirationMinutes: footer?.code_expiration_minutes ?? null,
    }
  }
  return draft
}

/** The text WhatsApp shows for an authentication template (Meta writes it, not the business). */
export function otpPreviewText(draft: TemplateDraft): { body: string; footer: string } {
  return {
    body: `*123456* is your verification code.${draft.otp.addSecurityRecommendation ? ' For your security, do not share this code.' : ''}`,
    footer: draft.otp.codeExpirationMinutes ? `This code expires in ${draft.otp.codeExpirationMinutes} minutes.` : '',
  }
}

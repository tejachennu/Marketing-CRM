import { MetaFlowJSON, MetaFlowScreen, MetaFormField } from './flow-types'

// Meta accepts screen IDs of capital letters and underscores only, and reserves SUCCESS
const SCREEN_ID = /^[A-Z][A-Z_]*$/
const TEXT_TYPES = ['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption']
const TEXT_INPUT_TYPES = ['text', 'number', 'email', 'password', 'passcode', 'phone']

/** A letters-only ID for a screen saved without one: SCREEN_A, SCREEN_B, … */
function fallbackScreenId(index: number, used: Set<string>): string {
  let suffix = String.fromCharCode(65 + (index % 26))
  while (used.has(`SCREEN_${suffix}`)) suffix += 'X'
  return `SCREEN_${suffix}`
}

/** Compile designer fields into Meta components, navigation and submission bindings. */
export function compileMetaFlowJSON(screens: MetaFlowScreen[]): MetaFlowJSON {
  if (!Array.isArray(screens) || !screens.length) throw new Error('At least one screen is required')
  if (screens.length > 10) throw new Error('Use at most 10 screens per form')
  const explicitIds = new Set(screens.map(screen => screen.id).filter(Boolean))
  const screenIds = screens.map((screen, index) => screen.id || fallbackScreenId(index, explicitIds))
  const ids = new Set<string>()
  const names = new Set<string>()
  let carried: Record<string, any> = {}
  const compiled = screens.map((screen, index) => {
    const id = screenIds[index]
    const title = screen.title || `Step ${index + 1}`
    const where = `Screen ${index + 1} ("${title}")`
    if (id === 'SUCCESS') throw new Error(`${where}: the screen ID "SUCCESS" is reserved by WhatsApp. Choose another ID.`)
    if (!SCREEN_ID.test(id)) throw new Error(`${where}: the screen ID "${id}" is not allowed. Use capital letters and underscores only, e.g. CONTACT_DETAILS.`)
    if (ids.has(id)) throw new Error(`Screen IDs must be unique: ${id}`)
    ids.add(id)
    if (title.length > 30) throw new Error(`Screen title must be at most 30 characters: ${title}`)
    const data = { ...carried }
    const payload: Record<string, string> = Object.fromEntries(Object.keys(carried).map(key => [key, '${data.' + key + '}']))
    const children: Record<string, any>[] = []
    for (const field of screen.layout?.children || []) {
      if (field.type === 'Footer') continue // Navigation is generated from screen order.
      if (TEXT_TYPES.includes(field.type)) {
        if (!String(field.label ?? '').trim()) throw new Error(`${where}: a ${field.type} element has no text. Add text or remove it.`)
        children.push({ type: field.type, text: field.label })
        continue
      }
      const name = field.name
      if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || names.has(name) || ['flow_token', '__proto__', 'constructor', 'prototype'].includes(name)) {
        throw new Error(`Field names must be unique across screens: ${name || '(empty)'}`)
      }
      names.add(name)
      let type: string = field.type
      if (type === 'RadioGroup') type = 'RadioButtonsGroup'
      if (type === 'TimePicker') type = 'Dropdown' // Meta has no TimePicker component.
      if (!['TextInput', 'TextArea', 'Dropdown', 'RadioButtonsGroup', 'CheckboxGroup', 'DatePicker', 'OptIn'].includes(type)) throw new Error(`Unsupported field: ${type}`)
      const component: Record<string, any> = { type, name, required: Boolean(field.required) }
      if (['RadioButtonsGroup', 'CheckboxGroup'].includes(type)) {
        component.label = field.label || 'Choose an option'
      } else if (field.label?.length > 20 && type !== 'OptIn') {
        children.push({ type: 'TextCaption', text: field.label })
        component.label = 'Your response'
      } else {
        component.label = field.label || 'Your response'
      }
      if (type === 'TextInput') {
        const inputType = field.input_type || 'text'
        if (!TEXT_INPUT_TYPES.includes(inputType)) throw new Error(`${where}: "${field.label || name}" has input type "${inputType}". Use one of: ${TEXT_INPUT_TYPES.join(', ')}.`)
        component['input-type'] = inputType
      }
      if (['TextInput', 'TextArea'].includes(type) && (field.helperText || field.helper_text)) component['helper-text'] = field.helperText || field.helper_text
      if (type === 'DatePicker') {
        if (field.minDate) component['min-date'] = field.minDate
        if (field.maxDate) component['max-date'] = field.maxDate
      }
      if (['Dropdown', 'RadioButtonsGroup', 'CheckboxGroup'].includes(type)) {
        const options: Array<{ id: string; title: string; description?: string }> = field.options?.length ? field.options : field.type === 'TimePicker'
          ? ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'].map(time => ({ id: time, title: time })) : []
        if (!options.length || options.length > 20) throw new Error(`${name}: provide between 1 and 20 options`)
        if (new Set(options.map(option => option.id)).size !== options.length || options.some(option => !option.id || !option.title)) throw new Error(`${name}: options need unique IDs and titles`)
        const long = options.find(option => option.title.length > 30)
        if (long) throw new Error(`${where}: option "${long.title}" in "${field.label || name}" is ${long.title.length} characters. WhatsApp allows at most 30.`)
        component['data-source'] = options.map(({ id, title, description }) => ({ id, title, ...(description ? { description } : {}) }))
      }
      children.push(component)
      carried[name] = type === 'OptIn' ? { type: 'boolean', __example__: true }
        : type === 'CheckboxGroup' ? { type: 'array', items: { type: 'string' }, __example__: [] }
        : { type: 'string', __example__: '' }
      payload[name] = '${form.' + name + '}'
    }
    const terminal = index === screens.length - 1
    const footerLabel = screen.layout?.children.find(field => field.type === 'Footer')?.label || (terminal ? 'Submit' : 'Continue')
    if (footerLabel.length > 35) throw new Error(`${where}: the button label "${footerLabel}" is ${footerLabel.length} characters. WhatsApp allows at most 35.`)
    children.push({
      type: 'Footer',
      label: footerLabel,
      'on-click-action': terminal ? { name: 'complete', payload } : {
        name: 'navigate', next: { type: 'screen', name: screenIds[index + 1] }, payload,
      },
    })
    return { id, title, ...(terminal ? { terminal: true, success: true } : {}), data,
      layout: { type: 'SingleColumnLayout' as const, children: [{ type: 'Form', name: 'form', children }] } }
  })
  return { version: '7.3', screens: compiled }
}

/**
 * One answer from a form submission as spreadsheet text. `key` may be a nested path such as
 * "address.city"; choice IDs are shown as their option titles when `optionTitles` has them.
 */
export function formAnswerText(payload: Record<string, any> | null | undefined, key: string, optionTitles: Record<string, string> = {}): string {
  const value: any = payload && key in payload ? payload[key] : key.split('.').reduce((current: any, part) => current == null || typeof current !== 'object' ? undefined : current[part], payload)
  if (value === undefined || value === null) return ''
  const title = (item: any) => typeof item === 'string' && Object.prototype.hasOwnProperty.call(optionTitles, item) ? optionTitles[item] : item
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' && item !== null ? JSON.stringify(item) : String(title(item))).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(title(value))
}

/**
 * CSV for submissions: every cell quoted, and a cell that a spreadsheet would run as a formula
 * (starting with = + - @, tab or carriage return) prefixed with a single quote.
 */
export function formSubmissionsCsv(headers: unknown[], rows: unknown[][]): string {
  const cell = (value: unknown) => {
    const text = String(value ?? '')
    return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
  }
  return [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n')
}

/**
 * Starter templates for the native form designer
 */
export const NATIVE_FLOW_TEMPLATES: Record<
  string,
  { name: string; category: string; description: string; screens: MetaFlowScreen[] }
> = {
  LEAD_QUALIFICATION: {
    name: 'VIP Lead Qualification Flow',
    category: 'LEAD_GENERATION',
    description: 'Collect customer name, company, budget range, and timeline with zero external redirects.',
    screens: [
      {
        id: 'LEAD_DETAILS',
        title: 'Project Consultation Details',
        terminal: false,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              id: 'header_caption',
              type: 'TextCaption',
              label: 'Fill in your requirements below for priority team routing.',
              name: 'caption',
            },
            {
              id: 'full_name',
              type: 'TextInput',
              label: 'Full Name',
              name: 'full_name',
              required: true,
              placeholder: 'e.g. Alex Morgan',
            },
            {
              id: 'company_name',
              type: 'TextInput',
              label: 'Company or Brand Name',
              name: 'company_name',
              required: true,
              placeholder: 'e.g. TrendKart Retail',
            },
            {
              id: 'budget_range',
              type: 'Dropdown',
              label: 'Estimated Monthly Budget',
              name: 'budget',
              required: true,
              options: [
                { id: 'tier_1', title: 'Under ₹50,000 ($600)' },
                { id: 'tier_2', title: '₹50,000 - ₹2,00,000 ($2,400)' },
                { id: 'tier_3', title: '₹2,00,000 - ₹10,00,000 ($12k)' },
                { id: 'tier_enterprise', title: '₹10,00,000+ (Enterprise)' },
              ],
            },
            {
              id: 'marketing_consent',
              type: 'OptIn',
              label: 'I consent to receiving WhatsApp updates on this consultation.',
              name: 'opt_in',
              required: true,
            },
          ],
        },
      },
      {
        id: 'CONFIRMATION',
        title: 'Request Confirmed',
        terminal: true,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              id: 'success_msg',
              type: 'TextBody',
              label: 'Submit your details and our team will contact you about your request.',
              name: 'confirm_text',
            },
          ],
        },
      },
    ],
  },

  APPOINTMENT_BOOKING: {
    name: '1-on-1 Consultation & Demo Booking',
    category: 'APPOINTMENT_BOOKING',
    description: 'Interactive date and time picker for consultations, doctor visits, and product walkthroughs.',
    screens: [
      {
        id: 'SLOT_SELECTION',
        title: 'Consultation Date & Time',
        terminal: false,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              id: 'consultation_topic',
              type: 'Dropdown',
              label: 'Consultation Topic',
              name: 'topic',
              required: true,
              options: [
                { id: 'api_setup', title: 'WhatsApp Cloud API Setup' },
                { id: 'bulk_campaigns', title: 'Bulk Broadcasts Strategy' },
                { id: 'ai_chatbot', title: '24/7 AI Chatbot Training' },
                { id: 'enterprise_quote', title: 'Custom Enterprise Plan' },
              ],
            },
            {
              id: 'preferred_date',
              type: 'DatePicker',
              label: 'Preferred Date',
              name: 'booking_date',
              required: true,
            },
            {
              id: 'preferred_time',
              type: 'TimePicker',
              label: 'Preferred Time Slot',
              name: 'booking_time',
              required: true,
            },
            {
              id: 'attendee_notes',
              type: 'TextArea',
              label: 'Notes or Questions for our team',
              name: 'notes',
              placeholder: 'Any specific questions or goals...',
            },
          ],
        },
      },
      {
        id: 'BOOKING_SUCCESS',
        title: 'Appointment Request',
        terminal: true,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              id: 'reserved_notice',
              type: 'TextBody',
              label: 'Submit your preferred appointment time. Our team will contact you to confirm availability.',
              name: 'reserved_body',
            },
          ],
        },
      },
    ],
  },

  CUSTOMER_FEEDBACK: {
    name: 'NPS & Customer Satisfaction Survey',
    category: 'CUSTOMER_SUPPORT',
    description: 'Collect star ratings, NPS scores, and verified user testimonials in under 30 seconds.',
    screens: [
      {
        id: 'FEEDBACK_FORM',
        title: 'How was your experience?',
        terminal: true,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              id: 'rating_radio',
              type: 'RadioGroup',
              label: 'Overall Satisfaction',
              name: 'satisfaction',
              required: true,
              options: [
                { id: 'score_5', title: '⭐⭐⭐⭐⭐ Exceptional (5/5)' },
                { id: 'score_4', title: '⭐⭐⭐⭐ Great (4/5)' },
                { id: 'score_3', title: '⭐⭐⭐ Average (3/5)' },
                { id: 'score_2', title: '⭐⭐ Needs Improvement (2/5)' },
                { id: 'score_1', title: '⭐ Poor (1/5)' },
              ],
            },
            {
              id: 'feedback_comment',
              type: 'TextArea',
              label: 'Tell us what you liked or how we can improve',
              name: 'comment',
              placeholder: 'Write your thoughts here...',
            },
          ],
        },
      },
    ],
  },

  SHIPPING_ADDRESS: {
    name: 'E-commerce Delivery Address Flow',
    category: 'OTHER',
    description: 'Collect delivery address, postal code, and delivery speed directly inside WhatsApp with zero redirects.',
    screens: [
      {
        id: 'SHIPPING_DETAILS',
        title: 'Delivery Address',
        terminal: false,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              id: 'header_caption',
              type: 'TextCaption',
              label: 'Enter your shipping address for fast order delivery.',
              name: 'caption',
            },
            {
              id: 'full_name',
              type: 'TextInput',
              label: 'Recipient Name',
              name: 'full_name',
              required: true,
              placeholder: 'e.g. John Doe',
            },
            {
              id: 'phone_number',
              type: 'TextInput',
              label: 'Contact Phone',
              name: 'phone_number',
              required: true,
              placeholder: 'e.g. +91 9876543210',
            },
            {
              id: 'address_line_1',
              type: 'TextInput',
              label: 'House / Flat / Street',
              name: 'address_line_1',
              required: true,
              placeholder: 'e.g. Flat 402, Green Heights, MG Road',
            },
            {
              id: 'address_line_2',
              type: 'TextInput',
              label: 'Area / Landmark',
              name: 'address_line_2',
              required: false,
              placeholder: 'e.g. Near City Mall',
            },
            {
              id: 'city',
              type: 'TextInput',
              label: 'City',
              name: 'city',
              required: true,
              placeholder: 'e.g. Mumbai',
            },
            {
              id: 'state',
              type: 'TextInput',
              label: 'State / Province',
              name: 'state',
              required: true,
              placeholder: 'e.g. Maharashtra',
            },
            {
              id: 'pincode',
              type: 'TextInput',
              label: 'PIN / Postal Code',
              name: 'pincode',
              required: true,
              placeholder: 'e.g. 400001',
            },
            {
              id: 'delivery_speed',
              type: 'RadioGroup',
              label: 'Delivery Speed',
              name: 'delivery_speed',
              required: true,
              options: [
                // The store's express charge is written into this title when the form is published
                { id: 'standard', title: 'Standard delivery' },
                { id: 'express', title: 'Express delivery' },
              ],
            },
          ],
        },
      },
      {
        id: 'CONFIRM_ADDRESS',
        title: 'Review and Confirm',
        terminal: true,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              id: 'confirm_msg',
              type: 'TextBody',
              label: 'Tap Submit to save your address. We will then confirm how you would like to pay.',
              name: 'confirm_body',
            },
            {
              id: 'delivery_instructions',
              type: 'TextArea',
              label: 'Delivery Instructions (Optional)',
              name: 'instructions',
              placeholder: 'e.g. Ring bell twice, leave with security...',
            },
          ],
        },
      },
    ],
  },
}


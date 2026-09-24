import { MetaFlowJSON, MetaFlowScreen, MetaFormField } from './flow-types'

/** Compile designer fields into Meta components, navigation and submission bindings. */
export function compileMetaFlowJSON(screens: MetaFlowScreen[]): MetaFlowJSON {
  if (!Array.isArray(screens) || !screens.length) throw new Error('At least one screen is required')
  if (screens.length > 10) throw new Error('Use at most 10 screens per form')
  const ids = new Set<string>()
  const names = new Set<string>()
  let carried: Record<string, any> = {}
  const compiled = screens.map((screen, index) => {
    const id = screen.id || `SCREEN_${index + 1}`
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) || ids.has(id)) throw new Error(`Screen ID must be valid and unique: ${id}`)
    ids.add(id)
    const title = screen.title || `Step ${index + 1}`
    if (title.length > 30) throw new Error(`Screen title must be at most 30 characters: ${title}`)
    const data = { ...carried }
    const payload: Record<string, string> = Object.fromEntries(Object.keys(carried).map(key => [key, '${data.' + key + '}']))
    const children: Record<string, any>[] = []
    for (const field of screen.layout?.children || []) {
      if (field.type === 'Footer') continue // Navigation is generated from screen order.
      if (['TextCaption', 'TextSubheading', 'TextBody'].includes(field.type)) {
        children.push({ type: field.type, text: field.label || '' })
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
      if (type === 'TextInput') component['input-type'] = field.input_type || 'text'
      if (['TextInput', 'TextArea'].includes(type) && (field.helperText || field.helper_text)) component['helper-text'] = field.helperText || field.helper_text
      if (type === 'DatePicker') {
        if (field.minDate) component['min-date'] = field.minDate
        if (field.maxDate) component['max-date'] = field.maxDate
      }
      if (['Dropdown', 'RadioButtonsGroup', 'CheckboxGroup'].includes(type)) {
        const options: Array<{ id: string; title: string; description?: string }> = field.options?.length ? field.options : field.type === 'TimePicker'
          ? ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'].map(time => ({ id: time, title: time })) : []
        if (!options.length || options.length > 20) throw new Error(`${name}: provide between 1 and 20 options`)
        if (new Set(options.map(option => option.id)).size !== options.length || options.some(option => !option.id || !option.title || option.title.length > 30)) throw new Error(`${name}: options need unique IDs and titles of at most 30 characters`)
        component['data-source'] = options.map(({ id, title, description }) => ({ id, title, ...(description ? { description } : {}) }))
      }
      children.push(component)
      carried[name] = type === 'OptIn' ? { type: 'boolean', __example__: true }
        : type === 'CheckboxGroup' ? { type: 'array', items: { type: 'string' }, __example__: [] }
        : { type: 'string', __example__: '' }
      payload[name] = '${form.' + name + '}'
    }
    const terminal = index === screens.length - 1
    children.push({
      type: 'Footer',
      label: screen.layout?.children.find(field => field.type === 'Footer')?.label || (terminal ? 'Submit' : 'Continue'),
      'on-click-action': terminal ? { name: 'complete', payload } : {
        name: 'navigate', next: { type: 'screen', name: screens[index + 1].id || `SCREEN_${index + 2}` }, payload,
      },
    })
    return { id, title, ...(terminal ? { terminal: true, success: true } : {}), data,
      layout: { type: 'SingleColumnLayout' as const, children: [{ type: 'Form', name: 'form', children }] } }
  })
  return { version: '7.3', screens: compiled }
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
}

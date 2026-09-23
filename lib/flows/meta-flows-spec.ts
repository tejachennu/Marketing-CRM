import { MetaFlowJSON, MetaFlowScreen, MetaFormField } from './flow-types'

/**
 * Validates and compiles visual form screens into official Meta Flow Specification v3.1
 */
export function compileMetaFlowJSON(screens: MetaFlowScreen[]): MetaFlowJSON {
  if (!screens || screens.length === 0) {
    throw new Error('At least one screen is required for a WhatsApp Native Flow')
  }

  // Ensure terminal screen exists on the last screen if not defined
  const validatedScreens = screens.map((screen, idx) => {
    const isLast = idx === screens.length - 1
    return {
      id: screen.id || `SCREEN_${idx + 1}`,
      title: screen.title || `Step ${idx + 1}`,
      terminal: screen.terminal !== undefined ? screen.terminal : isLast,
      layout: {
        type: 'SingleColumnLayout' as const,
        children: (screen.layout?.children || []).map((field) => ({
          ...field,
          id: field.id || `field_${Math.random().toString(36).substring(2, 9)}`,
          name: field.name || field.label.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        })),
      },
    }
  })

  return {
    version: '3.1',
    screens: validatedScreens,
  }
}

/**
 * Pre-built battle-tested Meta Native Flow Templates
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
                { id: 'tier_enterprise', title: '₹10,00,000+ ($15k+ Enterprise)' },
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
              label: 'Thank you! A dedicated account specialist will review your details and message you within 15 minutes.',
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
        title: 'Select Appointment Date & Slot',
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
        title: 'Calendar Slot Reserved',
        terminal: true,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              id: 'reserved_notice',
              type: 'TextBody',
              label: 'Your priority slot has been reserved! We have sent a calendar invite to your registered email and WhatsApp.',
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

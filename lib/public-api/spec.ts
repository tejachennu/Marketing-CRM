/**
 * The public API, described once: the documentation page (/developers) and the OpenAPI file
 * (/api/v1/openapi.json) are both built from this, so they always match.
 */

import { API_SCOPES, RATE_LIMIT_PER_MINUTE, type ApiScope } from './scopes'

export interface ParamDoc { name: string; type: string; required?: boolean; description: string }
export interface EndpointDoc {
  id: string
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  scope: ApiScope | null
  title: string
  description: string
  pathParams?: ParamDoc[]
  query?: ParamDoc[]
  body?: ParamDoc[]
  requestExample?: Record<string, unknown>
  /** Shown in the curl example, like "?date=2026-11-08" */
  exampleQuery?: string
  status: number
  responseExample: Record<string, unknown>
  errors?: string[]
}
export interface GroupDoc { id: string; title: string; description: string; endpoints: EndpointDoc[] }

const contact = { id: '0b6d3c1e-5f0a-4c3e-9a8e-2d6f1b7c9a10', name: 'Priya Sharma', first_name: 'Priya', last_name: 'Sharma', phone: '+919876543210', whatsapp: '+919876543210', email: 'priya@example.com', company: null, tags: ['Website'], created_at: '2026-11-08T10:15:00.000Z', updated_at: '2026-11-08T10:15:00.000Z' }
const service = { id: '6f1e2d3c-4b5a-4968-8776-655443322110', name: 'Facial', category: 'Skin', price: 1200, duration_minutes: 60, tax_rate: 18, active: true }
const appointment = {
  id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', status: 'booked', starts_at: '2026-11-08T11:30:00.000Z', ends_at: '2026-11-08T12:30:00.000Z',
  customer: { name: 'Priya Sharma', phone: '+919876543210', contact_id: contact.id },
  services: [{ service_id: service.id, name: 'Facial', price: 1200, duration_minutes: 60, staff_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f', staff_name: 'Anitha' }],
  staff_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f', invoice_id: null, source: 'api', notes: null, created_at: '2026-11-08T09:00:00.000Z',
}
const invoice = {
  id: '4d5e6f70-8192-4a3b-9c4d-5e6f708192a3', number: 'GLOW-0042', status: 'paid', customer: { name: 'Priya Sharma', phone: '+919876543210', contact_id: contact.id }, appointment_id: appointment.id,
  items: [{ service_id: service.id, name: 'Facial', quantity: 1, price: 1200, tax_rate: 18, taxable: 1016.95, tax: 183.05, total: 1200, staff_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f', staff_name: 'Anitha' }],
  subtotal: 1200, discount: 0, taxable: 1016.95, cgst: 91.53, sgst: 91.52, igst: 0, total: 1200, payment_method: 'upi', issued_at: '2026-11-08T12:35:00.000Z', paid_at: '2026-11-08T12:35:00.000Z', url: 'https://wamacrm.magnetora.in/i/AbCdEf123456',
}
const page = (data: unknown[]) => ({ data, pagination: { limit: 50, offset: 0, has_more: false } })
const LIST: ParamDoc[] = [
  { name: 'limit', type: 'integer', description: 'How many to return, 1 to 100. Default 50.' },
  { name: 'offset', type: 'integer', description: 'How many to skip, for the next page. Default 0.' },
]
const WINDOW: ParamDoc[] = [
  { name: 'date', type: 'string (YYYY-MM-DD)', description: 'One day, India time. Default today.' },
  { name: 'from', type: 'string (YYYY-MM-DD)', description: 'First day of a range (with "to"), at most 31 days.' },
  { name: 'to', type: 'string (YYYY-MM-DD)', description: 'Last day of the range.' },
]
const ID: ParamDoc[] = [{ name: 'id', type: 'string (uuid)', required: true, description: 'The id.' }]

export const API_GROUPS: GroupDoc[] = [
  {
    id: 'workspace', title: 'Workspace', description: 'Check that a key works and what it may do.',
    endpoints: [{
      id: 'get-me', method: 'GET', path: '/me', scope: null, title: 'Who am I', description: 'The workspace this key belongs to, its permissions, and whether WhatsApp and Front Desk are on.',
      status: 200, responseExample: { data: { workspace: { id: 'c0ffee00-0000-4000-8000-000000000001', name: 'Glow Studio' }, key: { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Website', scopes: ['contacts:read', 'contacts:write'] }, whatsapp_connected: true, front_desk: true } },
    }],
  },
  {
    id: 'contacts', title: 'Contacts', description: 'The people in your workspace: the same list as the Contacts page and the WhatsApp inbox. A phone number belongs to one contact; creating a contact with a number that exists updates that contact.',
    endpoints: [
      { id: 'list-contacts', method: 'GET', path: '/contacts', scope: 'contacts:read', title: 'List contacts', description: 'Newest first. Search by name, phone or email, or find one number.', exampleQuery: '?search=priya&limit=20',
        query: [{ name: 'search', type: 'string', description: 'Part of a name, email, or at least 4 digits of a number.' }, { name: 'phone', type: 'string', description: 'A whole phone number: the contact with that number (saved or WhatsApp).' }, { name: 'tag', type: 'string', description: 'Only contacts with this tag.' }, ...LIST],
        status: 200, responseExample: page([contact]) },
      { id: 'create-contact', method: 'POST', path: '/contacts', scope: 'contacts:write', title: 'Create or update a contact', description: 'Creates the contact, or updates the one with the same phone number (tags are added, not replaced). Answers 201 when created, 200 when updated.',
        body: [{ name: 'phone', type: 'string', required: true, description: 'With country code, like +919876543210. A 10-digit Indian number gets +91.' }, { name: 'name', type: 'string', description: 'Full name; or send first_name and last_name.' }, { name: 'first_name', type: 'string', description: '' }, { name: 'last_name', type: 'string', description: '' }, { name: 'email', type: 'string', description: '' }, { name: 'company', type: 'string', description: '' }, { name: 'tags', type: 'string[]', description: 'Words to group contacts, like ["Website", "VIP"].' }],
        requestExample: { name: 'Priya Sharma', phone: '+91 98765 43210', email: 'priya@example.com', tags: ['Website'] },
        status: 201, responseExample: { data: contact, created: true }, errors: ['invalid_request'] },
      { id: 'get-contact', method: 'GET', path: '/contacts/{id}', scope: 'contacts:read', title: 'Get a contact', description: '', pathParams: ID, status: 200, responseExample: { data: contact }, errors: ['not_found'] },
      { id: 'update-contact', method: 'PATCH', path: '/contacts/{id}', scope: 'contacts:write', title: 'Update a contact', description: 'Changes only the fields sent. Here tags replace the list.', pathParams: ID,
        body: [{ name: 'name / first_name / last_name', type: 'string', description: '' }, { name: 'phone', type: 'string', description: 'Must not belong to another contact.' }, { name: 'email', type: 'string', description: '' }, { name: 'company', type: 'string', description: '' }, { name: 'tags', type: 'string[]', description: '' }],
        requestExample: { company: 'Sharma Traders', tags: ['VIP'] }, status: 200, responseExample: { data: { ...contact, company: 'Sharma Traders', tags: ['VIP'] } }, errors: ['not_found', 'phone_taken'] },
    ],
  },
  {
    id: 'messages', title: 'WhatsApp messages', description: 'Send from your WhatsApp Business number (Meta Cloud API). A text can only go within 24 hours of the customer\'s last message; after that, send an approved template. Every message also appears in the customer\'s chat in the inbox.',
    endpoints: [
      { id: 'send-message', method: 'POST', path: '/messages', scope: 'messages:send', title: 'Send a message', description: 'Send "text", or "template" with values for its blanks in order. URL button values fill the end of each link button.',
        body: [{ name: 'to', type: 'string', required: true, description: 'WhatsApp number with country code.' }, { name: 'text', type: 'string', description: 'Up to 4096 characters.' }, { name: 'template.name', type: 'string', description: 'The template\'s name on WhatsApp.' }, { name: 'template.language', type: 'string', description: 'Like en, en_US, hi, te. Default en.' }, { name: 'template.body_parameters', type: 'string[]', description: 'Values for {{1}}, {{2}}, … in order.' }, { name: 'template.header_parameters', type: 'string[]', description: 'For a header with a blank.' }, { name: 'template.button_parameters', type: 'string[]', description: 'The end of each link button\'s URL.' }],
        requestExample: { to: '+919876543210', template: { name: 'wama_bill', language: 'en', body_parameters: ['Priya', 'Glow Studio', 'GLOW-0042', '₹1,200'], button_parameters: ['AbCdEf123456'] } },
        status: 201, responseExample: { data: { id: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgSQzE', to: '+919876543210', status: 'sent', contact_id: contact.id, conversation_id: '7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918' } },
        errors: ['outside_24h_window', 'template_not_found', 'template_parameters', 'whatsapp_refused', 'whatsapp_not_connected'] },
    ],
  },
  {
    id: 'templates', title: 'Templates', description: 'Your WhatsApp templates, to know which ones you can send and how many values each needs.',
    endpoints: [
      { id: 'list-templates', method: 'GET', path: '/templates', scope: 'templates:read', title: 'List templates', description: 'Approved templates by default.',
        query: [{ name: 'status', type: 'string', description: 'APPROVED (default), PENDING, REJECTED, or ALL.' }],
        status: 200, responseExample: { data: [{ name: 'wama_bill', language: 'en', category: 'UTILITY', status: 'APPROVED', body: 'Hi {{1}}, thank you for visiting {{2}}! Your bill {{3}} for {{4}} is ready. Tap below to view or download it.', body_parameters: 4, has_url_button: true }] } },
    ],
  },
  {
    id: 'front-desk', title: 'Front Desk', description: 'Bookings and bills, for workspaces with Front Desk switched on. Use it to take bookings from your website or app, or to bill from your own till. Bookings and bills made here show on the counter at once, and the customer gets the same WhatsApp messages.',
    endpoints: [
      { id: 'list-services', method: 'GET', path: '/services', scope: 'front_desk:read', title: 'List services', description: 'Services on offer, with prices (in rupees) and how long each takes.', query: [{ name: 'include_inactive', type: 'boolean', description: 'Also those switched off.' }], status: 200, responseExample: { data: [service] } },
      { id: 'list-staff', method: 'GET', path: '/staff', scope: 'front_desk:read', title: 'List staff', description: 'The team. service_ids lists what each person does; empty means everything.', status: 200, responseExample: { data: [{ id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f', name: 'Anitha', active: true, service_ids: [service.id] }] } },
      { id: 'availability', method: 'GET', path: '/availability', scope: 'front_desk:read', exampleQuery: `?date=2026-11-08&service_ids=${service.id}`, title: 'Free times', description: 'Free start times on a day for the services asked for, using your opening hours, closed days and existing bookings. Times start at least 30 minutes from now.',
        query: [{ name: 'service_ids', type: 'string', required: true, description: 'Service ids, separated by commas.' }, { name: 'date', type: 'string (YYYY-MM-DD)', description: 'India time. Default today.' }, { name: 'staff_id', type: 'string', description: 'Only times this person is free.' }],
        status: 200, responseExample: { data: { date: '2026-11-08', duration_minutes: 60, times: ['17:00', '17:30'], slots: [{ time: '17:00', starts_at: '2026-11-08T11:30:00.000Z' }, { time: '17:30', starts_at: '2026-11-08T12:00:00.000Z' }] } } },
      { id: 'list-appointments', method: 'GET', path: '/appointments', scope: 'front_desk:read', title: 'List appointments', description: 'Earliest first.', exampleQuery: '?date=2026-11-08', query: [...WINDOW, { name: 'status', type: 'string', description: 'requested, booked, arrived, in_service, completed, cancelled or no_show.' }, ...LIST], status: 200, responseExample: page([appointment]) },
      { id: 'create-appointment', method: 'POST', path: '/appointments', scope: 'front_desk:write', title: 'Book an appointment', description: 'Books it (status booked) and sends the customer a WhatsApp confirmation. The time is checked against free times first; a time that is taken answers 409.',
        body: [{ name: 'customer.name', type: 'string', description: 'Name, or a phone number, is needed.' }, { name: 'customer.phone', type: 'string', description: 'Indian mobile number; the customer is saved to Contacts.' }, { name: 'service_ids', type: 'string[]', required: true, description: 'One or more service ids.' }, { name: 'starts_at', type: 'string (ISO 8601)', required: true, description: 'Like 2026-11-08T17:00:00+05:30, or a slot\'s starts_at.' }, { name: 'staff_id', type: 'string', description: 'Who does it; or staff_ids, one per service.' }, { name: 'notes', type: 'string', description: '' }, { name: 'send_whatsapp', type: 'boolean', description: 'Default true.' }, { name: 'check_availability', type: 'boolean', description: 'Default true. False books even if the time is taken.' }],
        requestExample: { customer: { name: 'Priya Sharma', phone: '+919876543210' }, service_ids: [service.id], staff_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f', starts_at: '2026-11-08T17:00:00+05:30' },
        status: 201, responseExample: { data: appointment, whatsapp: { sent: true }, warning: null }, errors: ['slot_taken', 'invalid_request'] },
      { id: 'get-appointment', method: 'GET', path: '/appointments/{id}', scope: 'front_desk:read', title: 'Get an appointment', description: '', pathParams: ID, status: 200, responseExample: { data: appointment }, errors: ['not_found'] },
      { id: 'update-appointment', method: 'PATCH', path: '/appointments/{id}', scope: 'front_desk:write', title: 'Change an appointment\'s status', description: 'Mark arrived, in service, cancelled or no-show, or book a cancelled one again. To complete a visit, create its bill.', pathParams: ID,
        body: [{ name: 'status', type: 'string', required: true, description: 'arrived, in_service, cancelled, no_show or booked.' }], requestExample: { status: 'arrived' }, status: 200, responseExample: { data: { ...appointment, status: 'arrived' } }, errors: ['not_found', 'invalid_change'] },
      { id: 'list-invoices', method: 'GET', path: '/invoices', scope: 'front_desk:read', title: 'List invoices', description: 'Newest first. url opens the bill for the customer.', exampleQuery: '?from=2026-11-01&to=2026-11-08&status=paid', query: [...WINDOW, { name: 'status', type: 'string', description: 'paid, unpaid or void.' }, ...LIST], status: 200, responseExample: page([invoice]) },
      { id: 'create-invoice', method: 'POST', path: '/invoices', scope: 'front_desk:write', title: 'Create a bill', description: 'Bill an appointment (send appointment_id) or a walk-in (send customer and service_ids). GST is worked out from your Front Desk settings. The bill goes to the customer on WhatsApp.',
        body: [{ name: 'appointment_id', type: 'string', description: 'Bill this appointment and complete it.' }, { name: 'extra_service_ids', type: 'string[]', description: 'With appointment_id: services added at the visit.' }, { name: 'customer', type: 'object', description: 'For a walk-in: { name, phone }.' }, { name: 'service_ids', type: 'string[]', description: 'For a walk-in.' }, { name: 'staff_ids', type: 'string[]', description: 'Who did each service, in order.' }, { name: 'discount', type: 'object', description: '{ "type": "percent" | "amount", "value": 10 }' }, { name: 'payment_method', type: 'string', description: 'cash, upi or card. Leave out for not paid yet.' }, { name: 'send_whatsapp', type: 'boolean', description: 'Default true.' }],
        requestExample: { appointment_id: appointment.id, payment_method: 'upi' }, status: 201, responseExample: { data: invoice, whatsapp: { sent: true } }, errors: ['invalid_request'] },
      { id: 'get-invoice', method: 'GET', path: '/invoices/{id}', scope: 'front_desk:read', title: 'Get an invoice', description: '', pathParams: ID, status: 200, responseExample: { data: invoice }, errors: ['not_found'] },
      { id: 'update-invoice', method: 'PATCH', path: '/invoices/{id}', scope: 'front_desk:write', title: 'Mark paid, or cancel', description: 'Record a payment, or cancel the bill (it stays on record, marked void).', pathParams: ID,
        body: [{ name: 'status', type: 'string', required: true, description: '"paid" or "void".' }, { name: 'payment_method', type: 'string', description: 'With paid: cash, upi or card.' }], requestExample: { status: 'paid', payment_method: 'cash' }, status: 200, responseExample: { data: { ...invoice, payment_method: 'cash' } }, errors: ['not_found', 'invalid_change'] },
    ],
  },
]

export const ERROR_CODES: { code: string; status: number; meaning: string }[] = [
  { code: 'missing_api_key', status: 401, meaning: 'No key in the request.' },
  { code: 'invalid_api_key', status: 401, meaning: 'The key is wrong or was revoked.' },
  { code: 'workspace_locked', status: 402, meaning: 'The workspace\'s plan has ended.' },
  { code: 'insufficient_scope', status: 403, meaning: 'The key does not have the permission this needs.' },
  { code: 'front_desk_off', status: 403, meaning: 'Front Desk is switched off for the workspace.' },
  { code: 'not_found', status: 404, meaning: 'No such record in this workspace.' },
  { code: 'invalid_json', status: 400, meaning: 'The body is not a JSON object.' },
  { code: 'invalid_request', status: 400, meaning: 'A value is missing or wrong; "field" says which.' },
  { code: 'phone_taken', status: 409, meaning: 'Another contact has that phone number.' },
  { code: 'slot_taken', status: 409, meaning: 'That time is not free.' },
  { code: 'invalid_change', status: 409, meaning: 'That change is not possible now (for example, paying a void bill).' },
  { code: 'outside_24h_window', status: 422, meaning: 'The customer has not messaged in 24 hours: send a template.' },
  { code: 'template_not_found', status: 422, meaning: 'No approved template with that name and language.' },
  { code: 'template_parameters', status: 422, meaning: 'The values do not match the template\'s blanks.' },
  { code: 'whatsapp_refused', status: 422, meaning: 'WhatsApp refused the message; the message says why.' },
  { code: 'whatsapp_not_connected', status: 400, meaning: 'WhatsApp (Meta Cloud API) is not connected in Settings.' },
  { code: 'rate_limited', status: 429, meaning: 'Too many requests; wait for the Retry-After seconds.' },
  { code: 'server_error', status: 500, meaning: 'Something went wrong on our side; try again.' },
]

export const SCOPE_DOCS = Object.entries(API_SCOPES).map(([scope, meaning]) => ({ scope, meaning }))
export { RATE_LIMIT_PER_MINUTE }

/** The API as an OpenAPI 3.1 document, for Postman, Insomnia or code generators. */
export function openApiSpec(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const group of API_GROUPS) {
    for (const endpoint of group.endpoints) {
      const params = [
        ...(endpoint.pathParams || []).map((p) => ({ name: p.name, in: 'path', required: true, description: p.description, schema: { type: 'string' } })),
        ...(endpoint.query || []).map((p) => ({ name: p.name, in: 'query', required: Boolean(p.required), description: p.description, schema: { type: p.type.startsWith('integer') ? 'integer' : p.type.startsWith('boolean') ? 'boolean' : 'string' } })),
      ]
      const operation: Record<string, unknown> = {
        operationId: endpoint.id,
        summary: endpoint.title,
        description: [endpoint.description, endpoint.scope ? `Needs the \`${endpoint.scope}\` permission.` : 'Any valid key.'].filter(Boolean).join('\n\n'),
        tags: [group.title],
        parameters: params,
        responses: {
          [String(endpoint.status)]: { description: 'Success', content: { 'application/json': { example: endpoint.responseExample } } },
          default: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      }
      if (endpoint.requestExample) operation.requestBody = { required: true, content: { 'application/json': { example: endpoint.requestExample } } }
      paths[endpoint.path] = { ...(paths[endpoint.path] || {}), [endpoint.method.toLowerCase()]: operation }
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: 'WAMA CRM API', version: '1.0.0', description: `Connect your website, app or till to WAMA CRM: contacts, WhatsApp messages and Front Desk. Create a key in Settings → API. ${RATE_LIMIT_PER_MINUTE} requests a minute per key.` },
    servers: [{ url: `${baseUrl.replace(/\/+$/, '')}/api/v1` }],
    security: [{ bearerAuth: [] }],
    tags: API_GROUPS.map((g) => ({ name: g.title, description: g.description })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Your API key: Authorization: Bearer wama_live_…' } },
      schemas: { Error: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string', enum: ERROR_CODES.map((e) => e.code) }, message: { type: 'string' }, field: { type: 'string' } } } } } },
    },
  }
}

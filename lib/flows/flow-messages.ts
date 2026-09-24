import type { FlowReply } from './flow-runner'

/** Cloud API message envelope, shared by the runtime and contract tests. */
export function buildWhatsAppFlowMessage(phone: string, reply: FlowReply) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone.replace(/\D/g, '') }
  if (!reply.body || reply.body.length > (reply.type === 'text' ? 4096 : 1024)) throw new Error('Flow message body is empty or exceeds the WhatsApp limit')
  if (reply.type === 'text') return { ...base, type: 'text', text: { body: reply.body } }
  let interactive: Record<string, any>
  if (reply.type === 'native_flow') {
    const parameters = reply.flowPayload
    if (!parameters?.flow_id || !/^\d+$/.test(parameters.flow_id) || !parameters.flow_token || !parameters.flow_action_payload?.screen) throw new Error('Native form needs a Meta Flow ID, session token and starting screen')
    interactive = { type: 'flow', body: { text: reply.body }, action: { name: 'flow', parameters: { flow_message_version: '3', mode: 'published', ...parameters } } }
  } else if (reply.type === 'interactive_buttons') {
    if (!reply.buttons?.length || reply.buttons.length > 3 || reply.buttons.some(button => !button.id || !button.title || button.title.length > 20)) throw new Error('WhatsApp supports 1–3 buttons with titles of at most 20 characters')
    interactive = { type: 'button', body: { text: reply.body }, action: { buttons: reply.buttons.map(button => ({ type: 'reply', reply: button })) } }
  } else {
    const rows = reply.sections?.flatMap(section => section.rows || []) || []
    if (!rows.length || rows.length > 10 || rows.some(row => !row.id || !row.title || row.title.length > 24)) throw new Error('WhatsApp lists require 1–10 rows with titles of at most 24 characters')
    interactive = { type: 'list', body: { text: reply.body }, action: { button: reply.buttonText || 'Choose', sections: reply.sections?.map(section => ({ title: section.title, rows: section.rows.map((row: any) => ({ id: row.id, title: row.title, ...(row.description ? { description: row.description } : {}) })) })) } }
  }
  return { ...base, type: 'interactive', interactive }
}

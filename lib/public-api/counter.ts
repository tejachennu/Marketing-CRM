/** Front Desk actions from the public API go through the same checks as the counter. */

import { executeCounterAction, type CounterAction } from '../salon/actions'
import { loadSalonSettings } from '../salon/server'
import { billTemplate, bookingMessage, bookingTemplate, invoiceLink, invoiceMessage, sendCustomerText } from '../salon/whatsapp'
import type { ApiContext } from './auth'

export async function runCounterAction(ctx: ApiContext, action: CounterAction, origin: string) {
  const { db, organizationId, organization } = ctx
  const settings = await loadSalonSettings(db, organizationId)
  return executeCounterAction({ db, organizationId, organization, user: null, settings }, action, {
    invoice: (invoice) => sendCustomerText(db, organizationId, invoice.customer_phone, invoiceMessage(invoice, invoiceLink(origin, invoice.public_token)), billTemplate(invoice)),
    booking: (appointment, staffName) => sendCustomerText(db, organizationId, appointment.customer_phone, bookingMessage(appointment, settings.business_name, staffName), bookingTemplate(appointment, settings.business_name, staffName)),
    text: (phone, body) => sendCustomerText(db, organizationId, phone, body),
  })
}

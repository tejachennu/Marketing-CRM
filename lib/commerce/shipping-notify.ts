/**
 * Tell the customer on WhatsApp as their parcel moves (shared by the order screen, the courier webhook and
 * the scheduled check). Uses the same sender as the order status messages: WhatsApp's order card when the
 * order has one, else a message in the chat (WhatsApp only allows that within 24 hours of the customer's
 * last message; outside it nothing is sent and the next step tries again).
 */

import { notifyOrderStatus } from './commerce-webhook-handler'

export async function notifyParcel(db: any, args: { org: any; order: any; status: 'shipped' | 'delivered'; text: string }): Promise<boolean> {
  const result = await notifyOrderStatus({ organization: args.org, order: args.order, status: args.status, text: args.text, database: db })
  return result.notified
}

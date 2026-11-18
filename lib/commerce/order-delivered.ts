/**
 * What happens once a shop order is delivered, whichever way it got there (marked by hand, the courier's
 * webhook, or the scheduled courier check): "How was it?" on WhatsApp, the GST invoice, and loyalty points.
 * Each step is best effort and never stops the others. Server only.
 */

import { issueInvoiceQuietly } from './invoice-store'
import { earnPointsFor } from './loyalty-store'
import { askForReviewOf } from './review-store'

export async function afterDelivered(db: any, organizationId: string, orderId: string, appUrl: string) {
  await askForReviewOf(db, organizationId, orderId, appUrl).catch(() => null)
  await issueInvoiceQuietly(db, organizationId, orderId)
  await earnPointsFor(db, organizationId, orderId).catch((error: any) => console.error('[Shop points]', error?.message))
}

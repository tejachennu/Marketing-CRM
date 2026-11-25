'use client'

import { AutoMessageTemplates } from '@/components/templates/auto-message-templates'
import type { ShowToast } from './ui'

/**
 * Store settings → WhatsApp messages the shop sends by itself: each on / off, with a suggested template wording the
 * business sends to Meta for approval as it is or after editing it, and where each one stands.
 */
export function ShopMessagesCard({ orgId, showToast }: { orgId: string; showToast: ShowToast }) {
  return (
    <AutoMessageTemplates orgId={orgId} kind="shop" flash={showToast}
      heading="WhatsApp messages the shop sends"
      intro="Sent as a normal message when the customer wrote to you in the last 24 hours. After that WhatsApp needs an approved template: send the suggested wording for approval, or change it first." />
  )
}

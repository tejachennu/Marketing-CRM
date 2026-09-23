import { Pool } from 'pg'

let pool: Pool | null = null

function getPool(): Pool | null {
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL

  if (!connectionString) return null

  if (!pool) {
    const cleanUrl = connectionString
      .replace(/[?&]sslmode=[^&]*/g, '')
      .replace(/[?&]supa=[^&]*/g, '')

    pool = new Pool({
      connectionString: cleanUrl,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    })
  }

  return pool
}

export interface CampaignReplyStats {
  active_chats_count: number
  unread_chats_count: number
}

export interface CampaignRecipientChat {
  log_id: string
  phone_number: string | null
  email_address: string | null
  dispatch_status: string
  error_message: string | null
  variables_mapped: Record<string, any> | null
  dispatched_at: string
  contact_id: string | null
  first_name: string | null
  last_name: string | null
  contact_phone: string | null
  contact_email: string | null
  contact_company: string | null
  conversation_id: string | null
  unread_count: number
  last_message_at: string | null
  is_active: boolean
  has_replied: boolean
  needs_reply: boolean
  last_message: {
    id: string
    body: string
    media_url?: string | null
    sender_type: 'user' | 'contact'
    created_at: string
  } | null
}

/**
 * Fetch batch stats for campaigns: how many recipients have replied and how many need reply.
 */
export async function getCampaignsReplyStats(
  campaignIds: string[]
): Promise<Record<string, CampaignReplyStats>> {
  const statsMap: Record<string, CampaignReplyStats> = {}
  if (!campaignIds || campaignIds.length === 0) return statsMap

  const p = getPool()
  if (!p) return statsMap

  try {
    const query = `
      SELECT 
        cl.campaign_id,
        COUNT(DISTINCT CASE WHEN m.sender_type = 'contact' THEN conv.id END) as active_chats_count,
        COUNT(DISTINCT CASE WHEN conv.unread_count > 0 THEN conv.id END) as unread_chats_count
      FROM campaign_logs cl
      JOIN campaigns cmp ON cmp.id = cl.campaign_id
      JOIN contacts c ON (
        c.organization_id = cmp.organization_id AND (
          c.phone_number = cl.phone_number 
          OR c.phone_number = '+' || cl.phone_number
          OR '+' || c.phone_number = cl.phone_number
          OR (cl.email_address IS NOT NULL AND c.email = cl.email_address)
        )
      )
      JOIN conversations conv ON conv.contact_id = c.id
      LEFT JOIN messages m ON m.conversation_id = conv.id AND m.sender_type = 'contact' AND m.created_at >= cl.created_at
      WHERE cl.campaign_id = ANY($1::uuid[])
      GROUP BY cl.campaign_id
    `
    const res = await p.query(query, [campaignIds])
    for (const row of res.rows) {
      statsMap[row.campaign_id] = {
        active_chats_count: parseInt(row.active_chats_count || '0', 10),
        unread_chats_count: parseInt(row.unread_chats_count || '0', 10),
      }
    }
  } catch (err) {
    console.error('[CampaignStats] getCampaignsReplyStats error:', err)
  }

  return statsMap
}

/**
 * Fetch detailed recipient list for a single campaign including contact info, conversation info,
 * latest message snippet, and whether they replied to the campaign.
 */
export async function getCampaignDetailedRecipients(
  campaignId: string
): Promise<CampaignRecipientChat[]> {
  const p = getPool()
  if (!p) return []

  try {
    const query = `
      SELECT 
        cl.id as log_id,
        cl.phone_number,
        cl.email_address,
        cl.status as dispatch_status,
        cl.error_message,
        cl.variables_mapped,
        cl.created_at as dispatched_at,
        c.id as contact_id,
        c.first_name,
        c.last_name,
        c.phone_number as contact_phone,
        c.email as contact_email,
        c.company as contact_company,
        conv.id as conversation_id,
        COALESCE(conv.unread_count, 0) as unread_count,
        conv.last_message_at,
        COALESCE(conv.is_active, true) as is_active,
        EXISTS(
          SELECT 1 FROM messages m 
          WHERE m.conversation_id = conv.id 
            AND m.sender_type = 'contact' 
            AND m.created_at >= cl.created_at
        ) as has_replied,
        (
          SELECT json_build_object(
            'id', lm.id,
            'body', lm.body,
            'media_url', lm.media_url,
            'sender_type', lm.sender_type,
            'created_at', lm.created_at
          )
          FROM messages lm
          WHERE lm.conversation_id = conv.id
          ORDER BY lm.created_at DESC
          LIMIT 1
        ) as last_message
      FROM campaign_logs cl
      JOIN campaigns cmp ON cmp.id = cl.campaign_id
      LEFT JOIN contacts c ON (
        c.organization_id = cmp.organization_id AND (
          c.phone_number = cl.phone_number 
          OR c.phone_number = '+' || cl.phone_number
          OR '+' || c.phone_number = cl.phone_number
          OR (cl.email_address IS NOT NULL AND c.email = cl.email_address)
        )
      )
      LEFT JOIN conversations conv ON conv.contact_id = c.id
      WHERE cl.campaign_id = $1::uuid
      ORDER BY 
        (EXISTS(
          SELECT 1 FROM messages m 
          WHERE m.conversation_id = conv.id 
            AND m.sender_type = 'contact' 
            AND m.created_at >= cl.created_at
        )) DESC,
        conv.last_message_at DESC NULLS LAST,
        cl.created_at DESC
    `

    const res = await p.query(query, [campaignId])
    return res.rows.map((r: any) => {
      const hasReplied = Boolean(r.has_replied)
      const unreadCount = parseInt(r.unread_count || '0', 10)
      const lastMsgSender = r.last_message?.sender_type
      const needsReply = unreadCount > 0 || lastMsgSender === 'contact'

      return {
        log_id: r.log_id,
        phone_number: r.phone_number,
        email_address: r.email_address,
        dispatch_status: r.dispatch_status,
        error_message: r.error_message,
        variables_mapped: r.variables_mapped,
        dispatched_at: r.dispatched_at,
        contact_id: r.contact_id,
        first_name: r.first_name,
        last_name: r.last_name,
        contact_phone: r.contact_phone,
        contact_email: r.contact_email,
        contact_company: r.contact_company,
        conversation_id: r.conversation_id,
        unread_count: unreadCount,
        last_message_at: r.last_message_at,
        is_active: r.is_active,
        has_replied: hasReplied,
        needs_reply: needsReply,
        last_message: r.last_message,
      }
    })
  } catch (err) {
    console.error('[CampaignStats] getCampaignDetailedRecipients error:', err)
    return []
  }
}

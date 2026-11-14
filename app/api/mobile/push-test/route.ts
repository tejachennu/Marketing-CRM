import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { firebaseAppConfig, sendPush, serviceAccount, withPushSchema } from '@/lib/push'

export const runtime = 'nodejs'

/**
 * POST: send a test pop-up to the phones the signed-in person has the app on, and say in plain words
 * what happened: sent, no phone registered, or what Firebase refused. For anyone, from the app.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user?.organization_id) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  if (!firebaseAppConfig() || !serviceAccount()) return NextResponse.json({ sent: 0, message: 'Pop-up notifications are not set up on the server yet. Ask WAMA CRM support.' })
  const db = getSupabaseAdminClient()
  const { data, error } = await withPushSchema(() => db.from('device_tokens').select('token').eq('user_id', user.id).eq('organization_id', user.organization_id))
  if (error) return NextResponse.json({ sent: 0, message: 'The list of phones could not be read. Try again in a minute.' })
  if (!data?.length) return NextResponse.json({ sent: 0, phones: 0, message: 'This phone is not registered yet. Allow notifications for WAMA CRM in the phone settings, close and open the app, then try again.' })
  const problems: string[] = []
  const sent = await sendPush(db, { organizationId: user.organization_id, userIds: [user.id] }, { kind: 'message', title: 'WAMA CRM', body: 'Notifications are working on this phone.', open: '', tag: 'test' }, fetch, problems)
  return NextResponse.json({
    sent, phones: data.length,
    message: sent ? 'Sent. It should pop up in a few seconds (even with the app closed).' : `Firebase did not accept it: ${problems[0] || 'unknown reason'}`,
  })
}

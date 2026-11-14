import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import { firebaseAppConfig, sendPush, serviceAccount, withPushSchema } from '@/lib/push'

export const runtime = 'nodejs'

/**
 * POST: send a test pop-up notification to the phones the signed-in super admin has the app on, and say
 * in plain words what happened: sent, no phone registered, or what Firebase refused.
 */
export async function POST(request: NextRequest) {
  const actor = await checkSuperAdmin(request)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!firebaseAppConfig()) return NextResponse.json({ sent: 0, message: 'The app\'s Firebase settings are missing in Vercel (FIREBASE_PROJECT_ID, FIREBASE_ANDROID_APP_ID, FIREBASE_API_KEY, FIREBASE_SENDER_ID).' })
  if (!serviceAccount()) return NextResponse.json({ sent: 0, message: 'FIREBASE_SERVICE_ACCOUNT is missing in Vercel, or is not the whole JSON file.' })
  const db = getSupabaseAdminClient()
  const { data, error } = await withPushSchema(() => db.from('device_tokens').select('token, organization_id').eq('user_id', actor.id))
  if (error) return NextResponse.json({ sent: 0, message: `The list of phones could not be read: ${error.message}` })
  const phones = data || []
  if (!phones.length) return NextResponse.json({ sent: 0, phones: 0, message: 'No phone is registered for your account yet. Install the latest app, sign in with this account, allow notifications, then try again.' })
  const problems: string[] = []
  let sent = 0
  for (const organizationId of [...new Set(phones.map((phone: any) => phone.organization_id))] as string[]) {
    sent += await sendPush(db, { organizationId, userIds: [actor.id] }, { kind: 'message', title: 'WAMA CRM test', body: 'Notifications are working on this phone.', open: '', tag: 'test' }, fetch, problems)
  }
  return NextResponse.json({
    sent, phones: phones.length,
    message: sent ? `Sent to ${sent} phone${sent === 1 ? '' : 's'}. It should pop up in a few seconds.` : `Firebase did not accept it: ${problems[0] || 'unknown reason'}`,
  })
}

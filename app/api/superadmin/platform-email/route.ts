import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import {
  PLATFORM_EMAIL_MIGRATION,
  PLATFORM_EMAIL_TABLE,
  forgetCachedPlatformEmailSettings,
  loadSavedSettings,
  settingsFromEnvironment,
  validatePlatformEmailInput,
  type PlatformEmailSettings,
} from '@/lib/platform-email'

/** What the panel may see of a mailbox: everything but the password. */
function view(settings: PlatformEmailSettings | null) {
  if (!settings) return null
  return { host: settings.host, port: settings.port, secure: settings.secure, user: settings.user, fromName: settings.fromName, hasPassword: Boolean(settings.password) }
}

async function describeCurrent(db: ReturnType<typeof getSupabaseAdminClient>) {
  const saved = await loadSavedSettings(db)
  const environment = settingsFromEnvironment()
  return {
    // Which mailbox platform emails go out from now
    source: saved.settings ? 'admin_panel' : environment ? 'environment' : 'none',
    tableReady: saved.tableReady,
    migration: saved.tableReady ? undefined : PLATFORM_EMAIL_MIGRATION,
    saved: view(saved.settings),
    environment: view(environment),
  }
}

export async function GET(request: NextRequest) {
  if (!(await checkSuperAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await describeCurrent(getSupabaseAdminClient()))
  } catch (error: any) {
    console.error('[Platform Email] Could not load the settings:', error)
    return NextResponse.json({ error: error?.message || 'Could not load the email settings' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const admin = await checkSuperAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const db = getSupabaseAdminClient()
    const saved = await loadSavedSettings(db)
    if (!saved.tableReady) {
      return NextResponse.json(
        { error: `Saving needs the platform email table. Run ${PLATFORM_EMAIL_MIGRATION} in the Supabase SQL editor first.` },
        { status: 409 }
      )
    }

    const body = await request.json().catch(() => ({}))
    // A blank password keeps the saved one, but only for the same mailbox
    const samePassword = saved.settings && String(body?.user ?? '').trim().toLowerCase() === saved.settings.user.toLowerCase() ? saved.settings.password : undefined
    const { settings, error } = validatePlatformEmailInput(body, samePassword)
    if (!settings) {
      return NextResponse.json({ error }, { status: 400 })
    }

    const { error: saveError } = await db.from(PLATFORM_EMAIL_TABLE).upsert({
      id: 1,
      smtp_host: settings.host,
      smtp_port: settings.port,
      smtp_secure: settings.secure,
      smtp_user: settings.user,
      smtp_password: settings.password,
      from_name: settings.fromName,
      updated_by: admin.id,
      updated_at: new Date().toISOString(),
    })
    if (saveError) {
      console.error('[Platform Email] Could not save the settings:', saveError)
      return NextResponse.json({ error: `Could not save: ${saveError.message}` }, { status: 500 })
    }

    forgetCachedPlatformEmailSettings()
    return NextResponse.json(await describeCurrent(db))
  } catch (error: any) {
    console.error('[Platform Email] Could not save the settings:', error)
    return NextResponse.json({ error: error?.message || 'Could not save the email settings' }, { status: 500 })
  }
}

/** Forgets the mailbox saved in the panel, so platform emails go back to the environment's. */
export async function DELETE(request: NextRequest) {
  if (!(await checkSuperAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const db = getSupabaseAdminClient()
    const saved = await loadSavedSettings(db)
    if (saved.tableReady) {
      const { error } = await db.from(PLATFORM_EMAIL_TABLE).delete().eq('id', 1)
      if (error) return NextResponse.json({ error: `Could not remove: ${error.message}` }, { status: 500 })
    }
    forgetCachedPlatformEmailSettings()
    return NextResponse.json(await describeCurrent(db))
  } catch (error: any) {
    console.error('[Platform Email] Could not remove the settings:', error)
    return NextResponse.json({ error: error?.message || 'Could not remove the email settings' }, { status: 500 })
  }
}

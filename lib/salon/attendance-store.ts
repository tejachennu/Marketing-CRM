/**
 * Staff attendance in the database (rules in attendance.ts). Server only, through the service client: row level
 * security is on and there are no policies, so the browser's own key reads nothing.
 * Bookings read who is away with awayStaffOn, which never fails a booking (no table yet = nobody marked).
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { withSalonSchema } from './schema'
import { awayIds, monthBounds, type AttendanceMark, type AttendanceStatus, type LeaveKind } from './attendance'
import { awayBusy, type Busy } from './availability'

/** supabase/migrations/20261213_staff_attendance.sql word for word. */
export const ATTENDANCE_SQL = `-- Front Desk: staff attendance. One mark per person per day: present, absent, leave, half_day or week_off,
-- with the kind of leave (casual, sick, other) and a short note. People marked absent, on leave or week off are not
-- offered for bookings that day. Safe to run more than once. The app runs it on its own when first needed.
CREATE TABLE IF NOT EXISTS salon_staff_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES salon_staff(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'leave', 'half_day', 'week_off')),
  leave_kind TEXT CHECK (leave_kind IS NULL OR leave_kind IN ('casual', 'sick', 'other')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  marked_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, staff_id, day)
);
CREATE INDEX IF NOT EXISTS idx_salon_staff_attendance_day ON salon_staff_attendance(organization_id, day);

ALTER TABLE salon_staff_attendance ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
`
export const ATTENDANCE_LOCK = 724519039
export const attendanceSchemaSetup = createAutoSetup('Staff attendance', (connectionString) => runMigrationSql(connectionString, ATTENDANCE_SQL, ATTENDANCE_LOCK))

export async function withAttendanceSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = attendanceSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /salon_staff_attendance/)) return first
  if (!(await setup.ensure())) return first
  return step()
}

export const ATTENDANCE_COLUMNS = 'staff_id, day, status, leave_kind, note, marked_by, updated_at'

export interface AttendanceRow extends AttendanceMark { marked_by?: string | null; updated_at?: string | null }

const plain = (row: any): AttendanceRow => ({
  staff_id: String(row.staff_id),
  day: String(row.day).slice(0, 10),
  status: row.status as AttendanceStatus,
  leave_kind: (row.leave_kind || null) as LeaveKind | null,
  note: row.note || null,
  marked_by: row.marked_by || null,
  updated_at: row.updated_at || null,
})

/** The team (active people first, in name order), for the attendance screens. */
export async function loadTeam(db: any, organizationId: string): Promise<{ id: string; name: string; active: boolean }[]> {
  const { data, error } = await withSalonSchema(() => db.from('salon_staff').select('id, name, active').eq('organization_id', organizationId).order('name'))
  if (error) throw new Error(error.message || 'The team could not be loaded.')
  return (data || []).map((m: any) => ({ id: String(m.id), name: String(m.name || ''), active: m.active !== false }))
}

/** Marks from one day to another (both included), oldest first. */
export async function marksBetween(db: any, organizationId: string, from: string, to: string, staffId?: string | null): Promise<AttendanceRow[]> {
  const { data, error } = await withAttendanceSchema(() => {
    let query = db.from('salon_staff_attendance').select(ATTENDANCE_COLUMNS).eq('organization_id', organizationId).gte('day', from).lte('day', to)
    if (staffId) query = query.eq('staff_id', staffId)
    return query.order('day').order('staff_id').limit(5000)
  })
  if (error) {
    // Never set up yet (no direct database connection to make the table): nobody is marked
    if (isMissingSchemaError(error, /salon_staff_attendance/)) return []
    throw new Error(error.message || 'Attendance could not be loaded.')
  }
  return (data || []).map(plain)
}

export const marksOn = (db: any, organizationId: string, day: string) => marksBetween(db, organizationId, day, day)

export function marksInMonth(db: any, organizationId: string, month: string, staffId?: string | null) {
  const { first, last } = monthBounds(month)
  return marksBetween(db, organizationId, first, last, staffId)
}

/**
 * Save marks (one per person per day: a new mark replaces the old one). Every person must be on this business's
 * team. Returns the saved marks.
 */
export async function saveMarks(db: any, organizationId: string, marks: AttendanceMark[], userId?: string | null): Promise<{ saved: AttendanceRow[] } | { error: string; field?: string }> {
  if (!marks.length) return { saved: [] }
  const team = new Set((await loadTeam(db, organizationId)).map((m) => m.id))
  const stranger = marks.find((m) => !team.has(m.staff_id))
  if (stranger) return { error: 'That person is not on your team. Add them in Setup → Team first.', field: 'staff_id' }
  const now = new Date().toISOString()
  const rows = marks.map((m) => ({
    organization_id: organizationId, staff_id: m.staff_id, day: m.day, status: m.status, leave_kind: m.leave_kind, note: m.note,
    marked_by: userId || null, updated_at: now,
  }))
  const saved: AttendanceRow[] = []
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await withAttendanceSchema(() => db.from('salon_staff_attendance').upsert(rows.slice(i, i + 200), { onConflict: 'organization_id,staff_id,day' }).select(ATTENDANCE_COLUMNS))
    if (error) throw new Error(error.message || 'Attendance could not be saved.')
    saved.push(...(data || []).map(plain))
  }
  return { saved }
}

/** Take marks off (one day, or every day from `from` to `to`) for one person. Returns how many went. */
export async function clearMarks(db: any, organizationId: string, staffId: string, from: string, to = from): Promise<number> {
  const { data, error } = await withAttendanceSchema(() => db.from('salon_staff_attendance').delete()
    .eq('organization_id', organizationId).eq('staff_id', staffId).gte('day', from).lte('day', to).select('day'))
  if (error) {
    if (isMissingSchemaError(error, /salon_staff_attendance/)) return 0
    throw new Error(error.message || 'The mark could not be taken off.')
  }
  return (data || []).length
}

export interface DayNotice { staff_id: string; status: AttendanceStatus; leave_kind: LeaveKind | null }

/**
 * Everyone not simply present on a day (absent, on leave, half day, week off), for bookings and the counter. Never
 * throws and never sets the table up: when attendance cannot be read, everyone counts as in, so a booking is never
 * refused because of it.
 */
export async function dayNotices(db: any, organizationId: string, day: string): Promise<DayNotice[]> {
  try {
    const { data, error } = await db.from('salon_staff_attendance').select('staff_id, status, leave_kind').eq('organization_id', organizationId).eq('day', day)
    if (error || !Array.isArray(data)) return []
    return data.filter((m: any) => m.status && m.status !== 'present').map((m: any) => ({ staff_id: String(m.staff_id), status: m.status, leave_kind: m.leave_kind || null }))
  } catch {
    return []
  }
}

/** Who is not in on a day (absent, on leave, week off): not offered for bookings. */
export async function awayStaffOn(db: any, organizationId: string, day: string): Promise<string[]> {
  return awayIds((await dayNotices(db, organizationId, day)).map((m) => ({ ...m, day })), day)
}

/** The same, as whole-day busy time for availability.ts. */
export async function awayBusyOn(db: any, organizationId: string, day: string): Promise<Busy[]> {
  return awayBusy(day, await awayStaffOn(db, organizationId, day))
}

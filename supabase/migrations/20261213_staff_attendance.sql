-- Front Desk: staff attendance. One mark per person per day: present, absent, leave, half_day or week_off,
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

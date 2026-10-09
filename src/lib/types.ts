export type GuestStatus = 'not_contacted' | 'invited' | 'no_answer'
export type ContactOutcome = Exclude<GuestStatus, 'not_contacted'> | 'note'

export type Guest = {
  id: string
  family_id: string
  first_name: string
  last_name: string
  phone: string
  family_count: number
  invited_by: string
  status: GuestStatus
  created_at: string
  updated_at: string
  latest_note?: string
}

export type GuestActivity = {
  id: string
  family_id: string
  guest_id: string
  outcome: ContactOutcome | 'added'
  note: string
  actor_name: string
  created_at: string
}

export type Family = {
  id: string
  name: string
  realtime_topic: string
  access_code?: string
}

export const FAMILY_CONTACTS = ['شهاب', 'هاشم', 'صلاح', 'إسماعيل', 'محمد'] as const
export type FamilyContact = typeof FAMILY_CONTACTS[number]

export const STATUS_META: Record<GuestStatus, { label: string; tone: string }> = {
  not_contacted: { label: 'بانتظار العزيمة', tone: 'neutral' },
  invited: { label: 'تمت العزيمة', tone: 'invited' },
  no_answer: { label: 'لم يرد', tone: 'muted' },
}

export const OUTCOME_META: Record<ContactOutcome, { label: string }> = {
  invited: { label: 'تمت العزيمة' },
  no_answer: { label: 'لم يرد' },
  note: { label: 'ملاحظة فقط' },
}

import type { Guest, GuestActivity } from './types'

const arabicDigits = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'
const latinDigits = '01234567890123456789'

export function normalizePhone(value: string): string {
  let digits = [...value].map((character) => {
    const index = arabicDigits.indexOf(character)
    return index === -1 ? character : latinDigits[index]
  }).join('').replace(/\D/g, '')
  if (digits.startsWith('00218')) digits = digits.slice(5)
  else if (digits.startsWith('218') && digits.length === 12) digits = digits.slice(3)
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

export function normalizeName(value: string): string {
  return value.toLocaleLowerCase('ar-LY')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function fullName(guest: Pick<Guest, 'first_name' | 'last_name'>): string {
  return [guest.first_name, guest.last_name].filter(Boolean).join(' ').trim()
}

export function findDuplicate(guests: Guest[], firstName: string, lastName: string, phone: string, editingId?: string): Guest | undefined {
  const candidateName = normalizeName(`${firstName} ${lastName}`)
  const candidatePhone = normalizePhone(phone)
  return guests.find((guest) => guest.id !== editingId && (
    normalizeName(fullName(guest)) === candidateName ||
    (candidatePhone.length >= 6 && normalizePhone(guest.phone) === candidatePhone)
  ))
}

const GUESTS_KEY = 'daftar-alazima-demo-guests-v2'
const ACTIVITY_KEY = 'daftar-alazima-demo-activity-v2'
export const ACCESS_CODE_KEY = 'daftar-alazima-access-code-v1'

const initialGuests: Guest[] = [
  { id: 'demo-1', family_id: 'demo-family', first_name: 'محمد', last_name: 'الشريف', phone: '0912345678', family_count: 4, invited_by: 'شهاب', status: 'invited', created_at: '2026-10-03T18:20:00.000Z', updated_at: '2026-10-08T17:10:00.000Z', latest_note: 'تمت العزيمة، وأكد حضور أربعة من العائلة.' },
  { id: 'demo-2', family_id: 'demo-family', first_name: 'خديجة', last_name: 'المصراتي', phone: '0923456789', family_count: 2, invited_by: 'هاشم', status: 'no_answer', created_at: '2026-10-04T10:15:00.000Z', updated_at: '2026-10-08T14:12:00.000Z', latest_note: 'لم ترد، نعيد الاتصال بعد العصر.' },
  { id: 'demo-3', family_id: 'demo-family', first_name: 'يوسف', last_name: 'الترهوني', phone: '0918765432', family_count: 1, invited_by: 'صلاح', status: 'not_contacted', created_at: '2026-10-05T11:00:00.000Z', updated_at: '2026-10-05T11:00:00.000Z' },
  { id: 'demo-4', family_id: 'demo-family', first_name: 'أسماء', last_name: 'الفيتوري', phone: '', family_count: 3, invited_by: 'إسماعيل', status: 'invited', created_at: '2026-10-06T13:25:00.000Z', updated_at: '2026-10-06T15:05:00.000Z', latest_note: 'العزيمة عن طريق خالها.' },
  { id: 'demo-5', family_id: 'demo-family', first_name: 'عبدالله', last_name: 'الورفلي', phone: '0921122334', family_count: 5, invited_by: 'محمد', status: 'not_contacted', created_at: '2026-10-07T09:20:00.000Z', updated_at: '2026-10-07T09:20:00.000Z' },
]

const initialActivity: GuestActivity[] = [
  { id: 'act-1', family_id: 'demo-family', guest_id: 'demo-1', outcome: 'invited', note: 'تمت العزيمة، وأكد حضور أربعة من العائلة.', actor_name: 'العائلة', created_at: '2026-10-08T17:10:00.000Z' },
  { id: 'act-2', family_id: 'demo-family', guest_id: 'demo-2', outcome: 'no_answer', note: 'لم ترد، نعيد الاتصال بعد العصر.', actor_name: 'العائلة', created_at: '2026-10-08T14:12:00.000Z' },
  { id: 'act-3', family_id: 'demo-family', guest_id: 'demo-4', outcome: 'invited', note: 'العزيمة عن طريق خالها.', actor_name: 'العائلة', created_at: '2026-10-06T15:05:00.000Z' },
]

function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch { return fallback }
}

export function loadDemoGuests(): Guest[] { return readLocal(GUESTS_KEY, initialGuests) }
export function loadDemoActivity(): GuestActivity[] { return readLocal(ACTIVITY_KEY, initialActivity) }
export function saveDemoData(guests: Guest[], activity: GuestActivity[]): void {
  localStorage.setItem(GUESTS_KEY, JSON.stringify(guests))
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity))
}
export function resetDemoData(): void { localStorage.removeItem(GUESTS_KEY); localStorage.removeItem(ACTIVITY_KEY) }

export function downloadCsv(guests: Guest[]): void {
  const rows = [
    ['الاسم', 'اللقب', 'رقم الهاتف', 'من طرف', 'عدد أفراد المجموعة', 'حالة العزيمة', 'آخر ملاحظة'],
    ...guests.map((guest) => [guest.first_name, guest.last_name, guest.phone, guest.invited_by, String(guest.family_count), guest.status === 'invited' ? 'تمت العزيمة' : guest.status === 'no_answer' ? 'لم يرد' : 'بانتظار العزيمة', guest.latest_note ?? '']),
  ]
  const csv = '\uFEFF' + rows.map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `daftar-alazima-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

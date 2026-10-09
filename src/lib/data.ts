import type { Guest } from './types'

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

export function matchesGuestQuery(guest: Guest, query: string): boolean {
  if (!query.trim()) return true
  const digits = query.replace(/[٠-٩۰-۹]/g, (char) => latinDigits[arabicDigits.indexOf(char)])
  if (/^[\d+()\s-]+$/.test(digits)) {
    return normalizePhone(guest.phone).includes(normalizePhone(digits))
  }
  const haystack = normalizeName([fullName(guest), guest.invited_by, guest.phone, normalizePhone(guest.phone)].join(' '))
  return digits.trim().split(/\s+/).every((token) => haystack.includes(normalizeName(token)))
}

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

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, ArrowDownToLine, ArrowDownUp, Check, CheckCheck, ChevronDown,
  CircleHelp, Clock3, HeartHandshake, ListFilter,
  MessageCircle, MoreHorizontal, Phone, PhoneMissed, Plus, RefreshCw, Search,
  Share2, ShieldCheck, Users, X,
} from 'lucide-react'
import { downloadCsv, findDuplicate, fullName, matchesGuestQuery, normalizePhone } from './lib/data'
import { FAMILY_ACCESS_CODE, supabase } from './lib/supabase'
import { FAMILY_CONTACTS, OUTCOME_META, STATUS_META, type ContactOutcome, type Family, type FamilyContact, type Guest, type GuestActivity, type GuestStatus } from './lib/types'

type GuestDraft = Pick<Guest, 'first_name' | 'last_name' | 'phone' | 'family_count' | 'invited_by'>
type Filter = GuestStatus | 'all'
type SortBy = 'updated' | 'name' | 'group' | 'inviter' | 'status'
const APP_NAME = 'أفراح عائلة التركي'
const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'not_contacted', label: 'بانتظار العزيمة' },
  { value: 'invited', label: 'تمت العزيمة' },
  { value: 'no_answer', label: 'لم يرد' },
]
const partySize = (items: Guest[]) => items.reduce((sum, guest) => sum + guest.family_count, 0)

function explainError(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
  const text = message.toLowerCase()
  if (text.includes('invalid_access_code')) return 'تعذر فتح دفتر العائلة. أعد المحاولة.'
  if (text.includes('guest_duplicate')) return 'هذا الاسم أو الرقم مسجل من قبل. افتح الاسم الموجود لتعديل بياناته.'
  if (text.includes('invalid_phone')) return 'تأكد من رقم الهاتف أو اتركه فارغاً.'
  if (text.includes('invalid_guest_name')) return 'اكتب اسم المعزوم.'
  if (text.includes('invalid_family_count')) return 'عدد أفراد المجموعة يجب أن يكون من 1 إلى 500.'
  if (text.includes('could not find the function') || text.includes('schema cache')) return 'لم يكتمل تجهيز قاعدة البيانات بعد. أعد المحاولة بعد تفعيل الدفتر.'
  if (text.includes('failed to fetch') || text.includes('network')) return 'تعذر الاتصال بالدفتر. تحقق من الإنترنت وأعد المحاولة.'
  if (text.includes('jwt') || text.includes('api key')) return 'تعذر الاتصال بقاعدة البيانات. يلزم مراجعة إعداد الربط.'
  return message || 'تعذر حفظ التغيير. أعد المحاولة.'
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words[0]?.[0] ?? '؟') + (words[1]?.[0] ?? '')
}
function shortDate(value: string): string {
  return new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short' }).format(new Date(value))
}
function formatStamp(value?: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function App() {
  const [family, setFamily] = useState<Family | null>(null)
  const [guests, setGuests] = useState<Guest[]>([])
  const [activity, setActivity] = useState<GuestActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [realtime, setRealtime] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [inviterFilter, setInviterFilter] = useState<FamilyContact | 'all' | ''>('all')
  const [sortBy, setSortBy] = useState<SortBy>('updated')
  const [descending, setDescending] = useState(true)
  const [search, setSearch] = useState('')
  const [visibleLimit, setVisibleLimit] = useState(50)
  const [dialog, setDialog] = useState<'add' | 'edit' | 'details' | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const pendingRef = useRef(new Set<string>())
  const refreshSequence = useRef(0)
  const selected = guests.find((guest) => guest.id === selectedId) ?? null
  const selectedEvents = useMemo(() => activity.filter((entry) => entry.guest_id === selectedId).sort((a, b) => b.created_at.localeCompare(a.created_at)), [activity, selectedId])

  const refreshCloudData = useCallback(async () => {
    if (!supabase) throw new Error('تعذر الاتصال بقاعدة البيانات.')
    const sequence = ++refreshSequence.current
    const { data, error: snapshotError } = await supabase.rpc('get_turki_snapshot', { p_access_code: FAMILY_ACCESS_CODE })
    if (snapshotError) throw snapshotError
    if (sequence === refreshSequence.current) {
      setGuests((data?.guests ?? []) as Guest[])
      setActivity((data?.activities ?? []) as GuestActivity[])
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void (async () => {
      try {
        if (!supabase) throw new Error('تعذر الاتصال بقاعدة البيانات.')
        const { data, error: bookError } = await supabase.rpc('open_turki_book')
        if (bookError) throw bookError
        if (!active) return
        const row = Array.isArray(data) ? data[0] : data
        if (!row) throw new Error('تعذر فتح دفتر العائلة.')
        setFamily(row as Family)
        await refreshCloudData()
      } catch (loadError) { if (active) setError(explainError(loadError)) }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [refreshCloudData, reloadKey])

  useEffect(() => {
    if (!family?.realtime_topic || !supabase) return
    const client = supabase
    const recover = () => {
      if (document.visibilityState === 'visible') void refreshCloudData().catch((loadError: unknown) => setError(explainError(loadError)))
    }
    const channel = client.channel(family.realtime_topic)
      .on('broadcast', { event: 'family-change' }, recover)
      .subscribe((status) => setRealtime(status === 'SUBSCRIBED'))
    const recovery = window.setInterval(recover, 20000)
    window.addEventListener('online', recover)
    document.addEventListener('visibilitychange', recover)
    return () => { window.clearInterval(recovery); window.removeEventListener('online', recover); document.removeEventListener('visibilitychange', recover); setRealtime(false); void client.removeChannel(channel) }
  }, [family?.realtime_topic, refreshCloudData])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => { setVisibleLimit(50) }, [filter, inviterFilter, search, sortBy, descending])

  const filtered = useMemo(() => guests.filter((guest) =>
    (filter === 'all' || guest.status === filter) &&
    (inviterFilter === 'all' || guest.invited_by === inviterFilter) && matchesGuestQuery(guest, search),
  ).sort((a, b) => {
    let comparison = 0
    if (sortBy === 'name') comparison = fullName(a).localeCompare(fullName(b), 'ar')
    else if (sortBy === 'group') comparison = a.family_count - b.family_count
    else if (sortBy === 'inviter') comparison = (FAMILY_CONTACTS as readonly string[]).indexOf(a.invited_by) - (FAMILY_CONTACTS as readonly string[]).indexOf(b.invited_by)
    else if (sortBy === 'status') comparison = ['not_contacted', 'no_answer', 'invited'].indexOf(a.status) - ['not_contacted', 'no_answer', 'invited'].indexOf(b.status)
    else comparison = a.updated_at.localeCompare(b.updated_at)
    return (descending ? -comparison : comparison) || fullName(a).localeCompare(fullName(b), 'ar')
  }), [descending, filter, guests, inviterFilter, search, sortBy])
  const visibleGuests = filtered.slice(0, visibleLimit)
  const count = (status: GuestStatus) => guests.filter((guest) => guest.status === status).length
  const hasFilters = Boolean(search || filter !== 'all' || inviterFilter !== 'all')
  const clearFilters = () => { setFilter('all'); setInviterFilter('all'); setSearch('') }
  const openAdd = () => { if (family) { setSelectedId(null); setError(''); setDialog('add') } }
  const openDetails = (guest: Guest) => { setSelectedId(guest.id); setDialog('details'); setError('') }

  const saveGuest = async (draft: GuestDraft, guestId?: string): Promise<boolean> => {
    const duplicate = findDuplicate(guests, draft.first_name, draft.last_name, draft.phone, guestId)
    if (duplicate) { setError(`المعزوم «${fullName(duplicate)}» موجود بالفعل بنفس الاسم أو الهاتف.`); return false }
    if (draft.phone && normalizePhone(draft.phone).length < 6) { setError('رقم الهاتف غير مكتمل. اتركه فارغاً أو أكمل الرقم.'); return false }
    setError('')
    try {
      if (!supabase || !family) throw new Error('تعذر الاتصال بالدفتر.')
      const { data, error: saveError } = await supabase.rpc('save_guest', {
        p_access_code: FAMILY_ACCESS_CODE, p_guest_id: guestId ?? null,
        p_first_name: draft.first_name, p_last_name: draft.last_name, p_phone: draft.phone,
        p_family_count: draft.family_count, p_invited_by: draft.invited_by,
      })
      if (saveError) throw saveError
      const result = Array.isArray(data) ? data[0] : data
      if (result?.was_duplicate) { setError(`المعزوم مسجل من قبل بنفس ${result.duplicate_by === 'phone' ? 'رقم الهاتف' : 'الاسم'}.`); return false }
      setDialog(null); setToast(guestId ? 'تم حفظ التعديل' : 'تمت إضافة المعزوم')
      await refreshCloudData().catch(() => setError('تم الحفظ. تعذر تحديث القائمة؛ اضغط تحديث.'))
      return true
    } catch (saveError) { setError(explainError(saveError)); return false }
  }

  const recordContact = async (guest: Guest, outcome: ContactOutcome, note: string): Promise<boolean> => {
    if (pendingRef.current.has(guest.id)) return false
    pendingRef.current.add(guest.id); setPendingIds(new Set(pendingRef.current)); setError('')
    try {
      if (!supabase || !family) throw new Error('تعذر الاتصال بالدفتر.')
      const { error: saveError } = await supabase.rpc('record_guest_activity', {
        p_access_code: FAMILY_ACCESS_CODE, p_guest_id: guest.id, p_outcome: outcome, p_note: note,
      })
      if (saveError) throw saveError
      setToast(outcome === 'note' ? 'تم حفظ الملاحظة' : 'تم تحديث حالة العزيمة')
      await refreshCloudData().catch(() => setError('تم الحفظ. تعذر تحديث القائمة؛ اضغط تحديث.'))
      return true
    } catch (saveError) { setError(explainError(saveError)); return false }
    finally { pendingRef.current.delete(guest.id); setPendingIds(new Set(pendingRef.current)) }
  }

  const shareFamily = async () => {
    const url = new URL(window.location.href); url.hash = ''
    try {
      if (navigator.share) await navigator.share({ title: APP_NAME, url: url.toString() })
      else { await navigator.clipboard.writeText(url.toString()); setToast('تم نسخ رابط العائلة') }
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name === 'AbortError') return
      setError('تعذرت المشاركة. انسخ رابط الصفحة وأرسله للعائلة.')
    }
  }

  return <div className="turki-app" dir="rtl">
    <header className="turki-header"><div className="brand-lockup"><span className="brand-mark"><HeartHandshake size={23} /></span><strong className="brand-name">{APP_NAME}</strong></div><div className="header-actions"><span className={`sync-indicator ${realtime ? 'online' : 'offline'}`} role="status"><span className="sync-dot" />{realtime ? 'متصل' : loading ? 'جارٍ الفتح' : 'جارٍ الاتصال'}</span><button className="icon-button" aria-label="مشاركة رابط العائلة" onClick={shareFamily}><Share2 size={19} /></button></div></header>
    <main className="turki-main" aria-busy={loading}>
      <section className="turki-heading"><h1>المعازيم<span>{guests.length.toLocaleString('en-US')} اسم</span></h1><div className="heading-actions"><button className="secondary-button export-button" disabled={!filtered.length} onClick={() => downloadCsv(filtered)}><ArrowDownToLine size={17} />تنزيل</button><button className="primary-button" onClick={openAdd} disabled={!family || loading}><Plus size={19} />إضافة معزوم</button></div></section>
      {error && !dialog && <div className="inline-alert" role="alert"><CircleHelp size={18} /><span>{error}</span><button aria-label="إعادة الاتصال" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={18} /></button></div>}
      <section className="stats-grid" aria-label="أعداد المعازيم"><StatCard icon={<Users size={18} />} label="إجمالي الأشخاص" value={partySize(guests)} detail={`${guests.length} اسم وعائلة`} tone="ink" /><StatCard icon={<CheckCheck size={18} />} label="تمت عزيمتهم" value={partySize(guests.filter((guest) => guest.status === 'invited'))} detail={`${count('invited')} اسم`} tone="green" /><StatCard icon={<Clock3 size={18} />} label="بانتظار العزيمة" value={partySize(guests.filter((guest) => guest.status === 'not_contacted'))} detail={`${count('not_contacted')} اسم`} tone="amber" /><StatCard icon={<PhoneMissed size={18} />} label="لم يردوا" value={partySize(guests.filter((guest) => guest.status === 'no_answer'))} detail={`${count('no_answer')} اسم`} tone="rose" /></section>
      <section className="list-section turki-list" id="guest-list" aria-label="قائمة المعازيم">
        <div className="list-toolbar"><div className="search-box"><Search size={21} /><input type="search" aria-label="ابحث عن معزوم" placeholder="ابحث بالاسم أو الهاتف أو من طرف…" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button aria-label="مسح البحث" onClick={() => setSearch('')}><X size={17} /></button>}</div><div className="toolbar-selects"><label className="compact-select"><select aria-label="تصفية حسب الشخص" value={inviterFilter} onChange={(event) => setInviterFilter(event.target.value as FamilyContact | 'all' | '')}><option value="all">كل الأشخاص</option>{FAMILY_CONTACTS.map((person) => <option key={person} value={person}>من طرف {person}</option>)}<option value="">غير محدد</option></select><ChevronDown size={15} /></label><label className="compact-select"><select aria-label="ترتيب القائمة" value={sortBy} onChange={(event) => { const next = event.target.value as SortBy; setSortBy(next); setDescending(next === 'updated' || next === 'group') }}><option value="updated">آخر تحديث</option><option value="name">الاسم</option><option value="group">عدد الأشخاص</option><option value="inviter">من طرف</option><option value="status">حالة العزيمة</option></select><ChevronDown size={15} /></label><button className="sort-direction" aria-label={descending ? 'ترتيب تنازلي؛ اضغط للتصاعدي' : 'ترتيب تصاعدي؛ اضغط للتنازلي'} title={descending ? 'تنازلي' : 'تصاعدي'} aria-pressed={descending} onClick={() => setDescending((value) => !value)}><ArrowDownUp size={18} /><span>{descending ? 'تنازلي' : 'تصاعدي'}</span></button></div></div>
        <div className="filter-row" role="group" aria-label="تصفية حسب الحالة">{filters.map((option) => <button key={option.value} className={`filter-chip ${filter === option.value ? 'selected' : ''}`} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label}<span>{option.value === 'all' ? guests.length : count(option.value)}</span></button>)}</div>
        <div className="results-summary"><span><ListFilter size={15} /><strong>{filtered.length}</strong> اسم <i /> <strong>{partySize(filtered)}</strong> شخص</span><div>{hasFilters && <button onClick={clearFilters}>مسح التصفية <X size={13} /></button>}<button onClick={() => setReloadKey((value) => value + 1)} disabled={loading} aria-label="تحديث القائمة"><RefreshCw size={15} className={loading ? 'spinning' : ''} /></button></div></div>
        {loading ? <div className="list-loading" role="status"><span className="loader" />جارٍ فتح القائمة…</div> : !family ? <div className="empty-state"><CircleHelp size={28} /><h3>تعذر فتح قائمة العائلة</h3><button className="secondary-button" onClick={() => setReloadKey((value) => value + 1)}>إعادة المحاولة <RefreshCw size={16} /></button></div> : filtered.length ? <><div className="guest-table-wrap"><table className="guest-table"><thead><tr><th scope="col">المعزوم</th><th scope="col">من طرف</th><th scope="col">الأشخاص</th><th scope="col">حالة العزيمة</th><th scope="col"><span className="sr-only">التفاصيل</span></th></tr></thead><tbody>{visibleGuests.map((guest) => <tr key={guest.id}><td><button className="guest-name-button" onClick={() => openDetails(guest)}><span className="guest-avatar">{initials(fullName(guest))}</span><span className="guest-main-copy"><strong>{fullName(guest)}</strong><small dir="ltr">{guest.phone || 'بدون رقم هاتف'}</small></span></button></td><td>{guest.invited_by || 'غير محدد'}</td><td><span className="party-count">{guest.family_count}</span></td><td><StatusBadge status={guest.status} /></td><td><button className="row-open" aria-label={`تفاصيل ${fullName(guest)}`} onClick={() => openDetails(guest)}><MoreHorizontal size={20} /></button></td></tr>)}</tbody></table></div><div className="guest-cards">{visibleGuests.map((guest) => <GuestCard key={guest.id} guest={guest} pending={pendingIds.has(guest.id)} onOpen={() => openDetails(guest)} onStatus={(outcome) => { void recordContact(guest, outcome, '') }} />)}</div>{visibleLimit < filtered.length && <button className="load-more" onClick={() => setVisibleLimit((value) => value + 50)}>عرض 50 اسماً إضافياً <ChevronDown size={17} /></button>}<div className="table-footer">عرض {visibleGuests.length} من {filtered.length} اسم</div></> : <div className="empty-state"><span className="empty-icon">{hasFilters ? <Search size={25} /> : <Users size={25} />}</span><h3>{hasFilters ? 'لا توجد نتائج مطابقة' : 'قائمة المعازيم فارغة'}</h3>{hasFilters ? <button className="secondary-button" onClick={clearFilters}>مسح البحث والتصفية</button> : <button className="primary-button" onClick={openAdd}><Plus size={18} />إضافة أول معزوم</button>}</div>}
      </section>
    </main>
    <div className="mobile-action-bar"><div><strong className="mobile-action-count">{partySize(guests)}</strong><span>إجمالي الأشخاص</span></div><button onClick={openAdd} disabled={!family || loading}><Plus size={20} />إضافة معزوم</button></div>
    {dialog === 'add' && <GuestFormDialog title="إضافة معزوم" initial={null} onClose={() => { setDialog(null); setError('') }} onSave={(draft) => saveGuest(draft)} error={error} clearError={() => setError('')} />}
    {dialog === 'edit' && selected && <GuestFormDialog title="تعديل المعزوم" initial={selected} onClose={() => { setDialog('details'); setError('') }} onSave={(draft) => saveGuest(draft, selected.id)} error={error} clearError={() => setError('')} />}
    {dialog === 'details' && selected && <GuestDetailsDialog guest={selected} events={selectedEvents} onClose={() => { setDialog(null); setError('') }} onEdit={() => setDialog('edit')} onRecord={recordContact} error={error} clearError={() => setError('')} />}
    {toast && <div className="toast" role="status" aria-live="polite"><span className="toast-check"><Check size={16} /></span>{toast}</div>}
  </div>
}

function StatCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: number; detail: string; tone: string }) {
  return <article className={`stat-card stat-${tone}`}><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><MoreHorizontal size={17} className="stat-more" /></div><div className="stat-value">{value.toLocaleString('en-US')}</div><div className="stat-detail">{detail}</div></article>
}

function StatusBadge({ status }: { status: GuestStatus }) {
  return <span className={`status-badge status-${STATUS_META[status].tone}`}><i />{STATUS_META[status].label}</span>
}

function GuestCard({ guest, pending, onOpen, onStatus }: { guest: Guest; pending: boolean; onOpen: () => void; onStatus: (outcome: ContactOutcome) => void }) {
  return <article className="guest-card"><div className="guest-card-head"><button className="guest-card-person" onClick={onOpen}><span className="guest-avatar">{initials(fullName(guest))}</span><span className="guest-main-copy"><strong>{fullName(guest)}</strong><small dir="ltr">{guest.phone || 'بدون رقم هاتف'}</small></span></button><StatusBadge status={guest.status} /></div><div className="guest-card-meta"><span>من طرف <strong>{guest.invited_by || 'غير محدد'}</strong></span><span><Users size={14} /><strong>{guest.family_count}</strong> أشخاص</span></div><div className="guest-card-actions"><button disabled={pending || guest.status === 'invited'} className={`quick-status ${guest.status === 'invited' ? 'done' : ''}`} onClick={() => onStatus('invited')}><Check size={15} />تمت العزيمة</button><button disabled={pending || guest.status === 'no_answer'} className={`quick-status ${guest.status === 'no_answer' ? 'missed' : ''}`} onClick={() => onStatus('no_answer')}><PhoneMissed size={15} />لم يرد</button><button className="card-secondary" onClick={onOpen} aria-label={`تفاصيل ${fullName(guest)}`}><MoreHorizontal size={19} /></button>{guest.phone && <a className="card-call" href={`tel:${guest.phone}`} aria-label={`اتصال بـ ${fullName(guest)}`}><Phone size={16} /></a>}</div></article>
}

function useDialog(ref: React.RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    dialog.querySelector<HTMLInputElement>('[data-initial-focus]')?.focus()
    const close = () => onCloseRef.current()
    dialog.addEventListener('close', close)
    return () => { dialog.removeEventListener('close', close) }
  }, [ref])
}

function GuestFormDialog({ title, initial, onClose, onSave, error, clearError }: { title: string; initial: Guest | null; onClose: () => void; onSave: (draft: GuestDraft) => Promise<boolean>; error: string; clearError: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [firstName, setFirstName] = useState(initial?.first_name ?? '')
  const [lastName, setLastName] = useState(initial?.last_name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [familyCount, setFamilyCount] = useState(String(initial?.family_count ?? 1))
  const [invitedBy, setInvitedBy] = useState<FamilyContact | ''>((FAMILY_CONTACTS as readonly string[]).includes(initial?.invited_by ?? '') ? initial?.invited_by as FamilyContact : '')
  const [busy, setBusy] = useState(false)
  useDialog(dialogRef, onClose)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true)
    const saved = await onSave({ first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim(), family_count: Math.max(1, Math.min(500, Math.trunc(Number(familyCount)) || 1)), invited_by: invitedBy })
    setBusy(false); if (saved) clearError()
  }
  const clearVisibleError = () => { if (error) clearError() }
  return <dialog className="app-dialog guest-form-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target === dialogRef.current) onClose() }}><div className="dialog-header"><div><span className="dialog-eyebrow">سريع وسهل</span><h2>{title}</h2><p>الاسم فقط يكفي. باقي المعلومات اختيارية.</p></div><button className="icon-button" aria-label="إغلاق" onClick={onClose}><X size={19} /></button></div><form className="guest-form" onSubmit={submit}>
    <div className="name-fields"><label>الاسم <span className="required-mark">*</span><input data-initial-focus autoFocus value={firstName} onChange={(event) => { setFirstName(event.target.value); clearVisibleError() }} placeholder="الاسم الأول" required minLength={1} maxLength={80} /></label><label>اللقب <span className="optional-label">اختياري</span><input value={lastName} onChange={(event) => { setLastName(event.target.value); clearVisibleError() }} placeholder="اسم العائلة" maxLength={100} /></label></div>
    <div className="phone-count-fields"><label>رقم الهاتف <span className="optional-label">اختياري</span><div className="phone-input"><Phone size={16} /><input type="tel" dir="ltr" value={phone} onChange={(event) => { setPhone(event.target.value); clearVisibleError() }} placeholder="09X XXX XXXX" /></div></label><label>عدد المعازيم من عائلته<div className="stepper-input"><button type="button" aria-label="إنقاص العدد" onClick={() => setFamilyCount((value) => String(Math.max(1, (Number(value) || 1) - 1)))}>−</button><input type="number" min="1" max="500" inputMode="numeric" value={familyCount} onChange={(event) => setFamilyCount(event.target.value)} /><button type="button" aria-label="زيادة العدد" onClick={() => setFamilyCount((value) => String(Math.min(500, (Number(value) || 1) + 1)))}>+</button></div><small>يشمل المعزوم نفسه</small></label></div>
    <fieldset className="inviter-fieldset"><legend>من طرف <span className="optional-label">اختياري</span></legend><div className="inviter-options">{FAMILY_CONTACTS.map((person) => <button type="button" key={person} className={`inviter-option ${invitedBy === person ? 'selected' : ''}`} aria-pressed={invitedBy === person} onClick={() => setInvitedBy((value) => value === person ? '' : person)}>{invitedBy === person && <Check size={13} />}{person}</button>)}</div></fieldset>
    {error && <div className="form-alert" role="alert">{error}</div>}
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>إلغاء</button><button className="primary-button" disabled={busy || !firstName.trim()}>{busy ? <span className="button-spinner" /> : <>{initial ? 'حفظ' : 'إضافة إلى القائمة'}<Check size={17} /></>}</button></div><div className="duplicate-hint"><ShieldCheck size={15} /><span>نتحقق من الاسم ورقم الهاتف حتى لا يتكرر المعزوم.</span></div>
  </form></dialog>
}

function GuestDetailsDialog({ guest, events, onClose, onEdit, onRecord, error, clearError }: { guest: Guest; events: GuestActivity[]; onClose: () => void; onEdit: () => void; onRecord: (guest: Guest, outcome: ContactOutcome, note: string) => Promise<boolean>; error: string; clearError: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [outcome, setOutcome] = useState<ContactOutcome>(guest.status === 'no_answer' ? 'no_answer' : 'invited')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useDialog(dialogRef, onClose)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (outcome === 'note' && !note.trim()) return
    setBusy(true)
    const saved = await onRecord(guest, outcome, note.trim())
    setBusy(false)
    if (saved) { setNote(''); clearError() }
  }
  return <dialog className="app-dialog guest-details-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target === dialogRef.current) onClose() }}>
    <div className="details-top"><button className="icon-button details-close" aria-label="إغلاق التفاصيل" onClick={onClose}><X size={19} /></button><span className="details-avatar">{initials(fullName(guest))}</span><div className="details-head-copy"><span className="dialog-eyebrow">تفاصيل المعزوم</span><h2>{fullName(guest)}</h2><StatusBadge status={guest.status} /></div></div>
    <div className="details-info-grid"><div><span>رقم الهاتف</span>{guest.phone ? <a dir="ltr" href={`tel:${guest.phone}`}><Phone size={15} />{guest.phone}</a> : <strong>غير مضاف</strong>}</div><div><span>عدد المعازيم</span><strong>{guest.family_count.toLocaleString('en-US')} من العائلة</strong></div><div><span>من طرف</span><strong>{guest.invited_by || 'غير محدد'}</strong></div><div><span>أضيف</span><strong>{shortDate(guest.created_at)}</strong></div></div>
    <div className="details-section-title"><div><h3>سجل العزيمة والملاحظات</h3><p>كل تحديث يظهر لدى العائلة</p></div><span>{events.length.toLocaleString('en-US')}</span></div>
    <div className="activity-list">{events.length === 0 ? <div className="activity-empty"><Clock3 size={17} /><span>لا توجد تحديثات بعد.</span></div> : events.map((event) => <article className="activity-entry" key={event.id}><span className={`activity-dot event-${event.outcome}`}><Activity size={13} /></span><div className="activity-entry-main"><strong>{event.outcome === 'added' ? 'أُضيف إلى القائمة' : event.outcome === 'note' ? 'ملاحظة' : OUTCOME_META[event.outcome].label}</strong>{event.note && <p>{event.note}</p>}<span>{event.actor_name} <i /> {formatStamp(event.created_at)}</span></div></article>)}</div>
    <form className="contact-form" onSubmit={submit}><div className="contact-form-title"><MessageCircle size={17} /><strong>حدّث حالة العزيمة</strong></div><div className="outcome-grid" role="group" aria-label="حالة العزيمة"><button type="button" className={`outcome-choice ${outcome === 'invited' ? 'selected' : ''}`} aria-pressed={outcome === 'invited'} onClick={() => setOutcome('invited')}><Check size={14} />تمت العزيمة</button><button type="button" className={`outcome-choice ${outcome === 'no_answer' ? 'selected' : ''}`} aria-pressed={outcome === 'no_answer'} onClick={() => setOutcome('no_answer')}><PhoneMissed size={14} />لم يرد</button><button type="button" className={`outcome-choice ${outcome === 'note' ? 'selected' : ''}`} aria-pressed={outcome === 'note'} onClick={() => setOutcome('note')}><MessageCircle size={14} />ملاحظة فقط</button></div><label className="sr-only" htmlFor="contact-note">الملاحظة</label><textarea id="contact-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder={outcome === 'no_answer' ? 'مثال: لم يرد، أعيد الاتصال مساءً...' : 'اكتب ملاحظة (اختياري)...'} maxLength={1200} rows={2} />{error && <div className="form-alert" role="alert">{error}</div>}<div className="contact-submit-row"><span>{note.length.toLocaleString('en-US')} / 1200</span><button className="primary-button" disabled={busy}>{busy ? <span className="button-spinner" /> : <>حفظ التحديث <Check size={16} /></>}</button></div></form>
    <div className="details-footer"><span>آخر تحديث {formatStamp(guest.updated_at)}</span><button onClick={onEdit}><MoreHorizontal size={15} />تعديل بياناته</button></div>
  </dialog>
}

export default App

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, ArrowDownToLine, ArrowLeft, CalendarDays, Check, CheckCheck, ChevronDown,
  ChevronLeft, CircleHelp, ClipboardCheck, Clock3, FileSpreadsheet, HeartHandshake,
  ListFilter, Menu, MessageCircle, MoreHorizontal, Phone, PhoneMissed, Plus, Search,
  Share2, ShieldCheck, Sparkles, Users, UserRoundPlus, X,
} from 'lucide-react'
import { ACCESS_CODE_KEY, downloadCsv, findDuplicate, fullName, loadDemoActivity, loadDemoGuests, normalizePhone, resetDemoData, saveDemoData } from './lib/data'
import { isCloudConfigured, supabase } from './lib/supabase'
import { FAMILY_CONTACTS, OUTCOME_META, STATUS_META, type ContactOutcome, type Family, type FamilyContact, type Guest, type GuestActivity, type GuestStatus } from './lib/types'

type GuestDraft = Pick<Guest, 'first_name' | 'last_name' | 'phone' | 'family_count' | 'invited_by'>
type Filter = GuestStatus | 'all'
const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'not_contacted', label: 'بانتظار العزيمة' },
  { value: 'invited', label: 'تمت العزيمة' },
  { value: 'no_answer', label: 'لم يرد' },
]
const demoFamily: Family = { id: 'demo-family', name: 'عائلة السالم', realtime_topic: '' }

function initialAccessCode(): string {
  try {
    const fromLink = new URLSearchParams(window.location.hash.slice(1)).get('join')
    return fromLink || localStorage.getItem(ACCESS_CODE_KEY) || ''
  } catch { return '' }
}

function explainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const text = message.toLowerCase()
  if (text.includes('invalid_access_code')) return 'رمز الدفتر غير صحيح. تحقق من الرمز وجرّب مرة أخرى.'
  if (text.includes('guest_duplicate')) return 'هذا الاسم أو الرقم مسجل من قبل. افتح اسمه الموجود لتعديل بياناته.'
  if (text.includes('invalid_phone')) return 'تأكد من رقم الهاتف؛ أدخل ستة أرقام على الأقل أو اتركه فارغاً.'
  if (text.includes('invalid_family_name')) return 'اكتب اسم العائلة (حرفان على الأقل).'
  if (text.includes('invalid_guest_name')) return 'اكتب اسم الضيف (حرف واحد على الأقل).'
  if (text.includes('invalid_family_count')) return 'عدد أفراد المجموعة يجب أن يكون من 1 إلى 500.'
  if (text.includes('failed to fetch') || text.includes('network')) return 'تعذر الاتصال. تحقق من الإنترنت وإعداد الخدمة.'
  if (text.includes('jwt') || text.includes('api key')) return 'إعداد Supabase غير مكتمل. راجع رابط المشروع ومفتاحه.'
  return message || 'حدث خطأ. حاول مرة أخرى.'
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words[0]?.[0] ?? '؟') + (words[1]?.[0] ?? '')
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short' }).format(new Date(value))
}

function formatStamp(value?: string): string {
  if (!value) return 'لا يوجد تحديث بعد'
  return new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function App() {
  const demo = !isCloudConfigured
  const [accessCode, setAccessCode] = useState(initialAccessCode)
  const [family, setFamily] = useState<Family | null>(demo ? demoFamily : null)
  const [guests, setGuests] = useState<Guest[]>(() => demo ? loadDemoGuests() : [])
  const [activity, setActivity] = useState<GuestActivity[]>(() => demo ? loadDemoActivity() : [])
  const [loading, setLoading] = useState(!demo && Boolean(initialAccessCode()))
  const [realtime, setRealtime] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [inviterFilter, setInviterFilter] = useState<FamilyContact | 'all'>('all')
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'group' | 'inviter'>('updated')
  const [search, setSearch] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<'add' | 'edit' | 'details' | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = guests.find((guest) => guest.id === selectedId) ?? null
  const selectedEvents = useMemo(() => activity.filter((entry) => entry.guest_id === selectedId).sort((a, b) => b.created_at.localeCompare(a.created_at)), [activity, selectedId])

  const refreshCloudData = useCallback(async (code = accessCode) => {
    if (!supabase || !code) return
    const [guestResult, activityResult] = await Promise.all([
      supabase.rpc('list_guests', { p_access_code: code }),
      supabase.rpc('list_guest_activities', { p_access_code: code }),
    ])
    if (guestResult.error) throw guestResult.error
    if (activityResult.error) throw activityResult.error
    setGuests((guestResult.data ?? []) as Guest[])
    setActivity((activityResult.data ?? []) as GuestActivity[])
  }, [accessCode])

  useEffect(() => {
    if (demo || !accessCode || !supabase) return
    let active = true
    setLoading(true)
    setError('')
    void (async () => {
      const { data, error: familyError } = await supabase.rpc('get_family', { p_access_code: accessCode })
      if (!active) return
      if (familyError) {
        setError(explainError(familyError)); setLoading(false); setFamily(null)
        localStorage.removeItem(ACCESS_CODE_KEY); setAccessCode('')
        const clean = new URL(window.location.href); clean.hash = ''; window.history.replaceState({}, '', clean)
        return
      }
      const row = Array.isArray(data) ? data[0] : data
      if (!row) { setError('رمز الدفتر غير موجود.'); setLoading(false); return }
      const nextFamily = row as Family
      setFamily(nextFamily)
      try { await refreshCloudData(accessCode) }
      catch (loadError) { if (active) setError(explainError(loadError)) }
      if (active) setLoading(false)
      const clean = new URL(window.location.href); clean.hash = ''; window.history.replaceState({}, '', clean)
    })()
    return () => { active = false }
  }, [accessCode, demo, refreshCloudData])

  useEffect(() => {
    if (demo || !family?.realtime_topic || !supabase) return
    const client = supabase
    const channel = client.channel(family.realtime_topic)
      .on('broadcast', { event: 'family-change' }, () => {
        void refreshCloudData().catch((loadError: unknown) => setError(explainError(loadError)))
      })
      .subscribe((status) => setRealtime(status === 'SUBSCRIBED'))
    // A slow refresh also recovers after a phone sleeps or changes networks.
    const recovery = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshCloudData().catch(() => undefined)
    }, 20000)
    return () => { window.clearInterval(recovery); setRealtime(false); void client.removeChannel(channel) }
  }, [demo, family?.realtime_topic, refreshCloudData])

  useEffect(() => { if (demo) saveDemoData(guests, activity) }, [activity, demo, guests])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ar-LY')
    return guests.filter((guest) => {
      const matchesStatus = filter === 'all' || guest.status === filter
      const matchesQuery = !query || [fullName(guest), guest.phone, guest.invited_by].some((value) => value.toLocaleLowerCase('ar-LY').includes(query))
      const matchesInviter = inviterFilter === 'all' || guest.invited_by === inviterFilter
      return matchesStatus && matchesQuery && matchesInviter
    }).sort((a, b) => {
      if (sortBy === 'name') return fullName(a).localeCompare(fullName(b), 'ar')
      if (sortBy === 'group') return b.family_count - a.family_count || fullName(a).localeCompare(fullName(b), 'ar')
      if (sortBy === 'inviter') return FAMILY_CONTACTS.indexOf(a.invited_by as FamilyContact) - FAMILY_CONTACTS.indexOf(b.invited_by as FamilyContact) || fullName(a).localeCompare(fullName(b), 'ar')
      return b.updated_at.localeCompare(a.updated_at)
    })
  }, [filter, guests, inviterFilter, search, sortBy])

  const count = (status: GuestStatus) => guests.filter((guest) => guest.status === status).length
  const partySize = (items: Guest[]) => items.reduce((sum, guest) => sum + guest.family_count, 0)
  const latestUpdate = guests.reduce((latest, guest) => guest.updated_at > latest ? guest.updated_at : latest, '')

  const saveAccessCode = (code: string, nextFamily: Family) => {
    const normalized = code.trim().toLowerCase()
    localStorage.setItem(ACCESS_CODE_KEY, normalized)
    setAccessCode(normalized)
    setFamily(nextFamily)
    setError('')
    const clean = new URL(window.location.href); clean.hash = ''; window.history.replaceState({}, '', clean)
  }

  const saveGuest = async (draft: GuestDraft, guestId?: string): Promise<boolean> => {
    const duplicate = findDuplicate(guests, draft.first_name, draft.last_name, draft.phone, guestId)
    if (duplicate) {
      setError(`هذا الضيف موجود بالفعل: «${fullName(duplicate)}»${duplicate.phone ? ` · ${duplicate.phone}` : ''}. لن نضيفه مرة ثانية.`)
      return false
    }
    if (draft.phone && normalizePhone(draft.phone).length < 6) { setError('رقم الهاتف غير مكتمل. اتركه فارغاً أو أدخل ستة أرقام على الأقل.'); return false }
    setError('')
    if (demo) {
      const now = new Date().toISOString()
      if (guestId) {
        setGuests((current) => current.map((guest) => guest.id === guestId ? { ...guest, ...draft, updated_at: now } : guest))
        setToast('تم تعديل بيانات الضيف')
      } else {
        const guest: Guest = { id: crypto.randomUUID(), family_id: demoFamily.id, ...draft, status: 'not_contacted', created_at: now, updated_at: now, latest_note: '' }
        setGuests((current) => [guest, ...current])
        setActivity((current) => [{ id: crypto.randomUUID(), family_id: demoFamily.id, guest_id: guest.id, outcome: 'added', note: 'أُضيف إلى دفتر العائلة', actor_name: 'العائلة', created_at: now }, ...current])
        setToast('أُضيف الاسم إلى القائمة')
      }
      setDialog(null)
      return true
    }
    if (!supabase || !accessCode) return false
    const { data, error: saveError } = await supabase.rpc('save_guest', {
      p_access_code: accessCode, p_guest_id: guestId ?? null,
      p_first_name: draft.first_name, p_last_name: draft.last_name, p_phone: draft.phone,
      p_family_count: draft.family_count, p_invited_by: draft.invited_by,
    })
    if (saveError) { setError(explainError(saveError)); return false }
    const result = Array.isArray(data) ? data[0] : data
    if (result?.was_duplicate) {
      const existing = guests.find((guest) => guest.id === result.guest_id)
      setError(`الضيف موجود${existing ? ` باسم «${fullName(existing)}»` : ''} حسب ${result.duplicate_by === 'phone' ? 'رقم الهاتف' : 'الاسم'}.`)
      return false
    }
    try { await refreshCloudData() } catch (loadError) { setError(explainError(loadError)); return false }
    setDialog(null); setToast(guestId ? 'تم تعديل بيانات الضيف' : 'أُضيف الاسم وظهر لدى العائلة')
    return true
  }

  const recordContact = async (guest: Guest, outcome: ContactOutcome, note: string): Promise<boolean> => {
    if (demo) {
      const now = new Date().toISOString()
      const event: GuestActivity = { id: crypto.randomUUID(), family_id: demoFamily.id, guest_id: guest.id, outcome, note, actor_name: 'العائلة', created_at: now }
      setActivity((current) => [event, ...current])
      setGuests((current) => current.map((item) => item.id === guest.id ? { ...item, status: outcome === 'note' ? item.status : outcome, latest_note: note || item.latest_note, updated_at: now } : item))
      setToast(outcome === 'note' ? 'تم حفظ الملاحظة' : 'تم تحديث حالة العزيمة')
      return true
    }
    if (!supabase || !accessCode) return false
    const { error: saveError } = await supabase.rpc('record_guest_activity', {
      p_access_code: accessCode, p_guest_id: guest.id, p_outcome: outcome, p_note: note,
    })
    if (saveError) { setError(explainError(saveError)); return false }
    try { await refreshCloudData() } catch (loadError) { setError(explainError(loadError)); return false }
    setToast(outcome === 'note' ? 'تم حفظ الملاحظة لدى العائلة' : 'تم تحديث حالة العزيمة لدى العائلة')
    return true
  }

  const createFamily = async (name: string): Promise<boolean> => {
    if (!supabase) return false
    const { data, error: createError } = await supabase.rpc('create_family', { p_name: name })
    if (createError) { setError(explainError(createError)); return false }
    const row = Array.isArray(data) ? data[0] : data
    if (!row?.access_code) { setError('تعذر إنشاء الدفتر. حاول مرة أخرى.'); return false }
    saveAccessCode(row.access_code, row as Family)
    setToast('أُنشئ الدفتر. شارك رمزه مع العائلة')
    return true
  }

  const joinFamily = async (code: string): Promise<boolean> => {
    if (!supabase) return false
    const normalized = code.trim().toLowerCase()
    const { data, error: joinError } = await supabase.rpc('get_family', { p_access_code: normalized })
    if (joinError) { setError(explainError(joinError)); return false }
    const row = Array.isArray(data) ? data[0] : data
    if (!row) { setError('لم نعثر على دفتر بهذا الرمز. راجع الرمز الذي أرسلته العائلة.'); return false }
    saveAccessCode(normalized, row as Family)
    setToast(`أنت الآن في ${row.name}`)
    return true
  }

  const shareFamily = async () => {
    if (!family || demo || !accessCode) return
    const inviteUrl = new URL(window.location.href)
    inviteUrl.hash = new URLSearchParams({ join: accessCode }).toString()
    try {
      if (navigator.share) await navigator.share({ title: `دفتر ${family.name}`, text: `افتح دفتر عزيمة ${family.name} المشترك.`, url: inviteUrl.toString() })
      else { await navigator.clipboard.writeText(inviteUrl.toString()); setToast('نُسخ رابط الانضمام') }
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name === 'AbortError') return
      try { await navigator.clipboard.writeText(inviteUrl.toString()); setToast('نُسخ رابط الانضمام') }
      catch { setError(`رمز الدفتر: ${accessCode}`) }
    }
  }

  const openDetails = (guest: Guest) => { setSelectedId(guest.id); setDialog('details'); setError('') }
  const openAdd = () => { setSelectedId(null); setError(''); setDialog('add') }

  if (!demo && loading) return <LoadingScreen />
  if (!demo && !accessCode) return <FamilySetup onCreate={createFamily} onJoin={joinFamily} error={error} clearError={() => setError('')} />

  return <div className="app-shell" dir="rtl">
    <aside className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`} aria-label="القائمة">
      <div className="brand-lockup"><div className="brand-mark"><ClipboardCheck size={21} /></div><div><div className="brand-name">دفتر العزيمة</div><div className="brand-caption">سجل عائلتكم للعرس</div></div><button className="icon-button sidebar-close" aria-label="إغلاق القائمة" onClick={() => setMobileMenuOpen(false)}><X size={18} /></button></div>
      <div className="sidebar-divider" />
      <div className="side-section-label">دفتر العائلة</div>
      <div className="family-switcher"><div className="family-avatar"><HeartHandshake size={19} /></div><div className="family-copy"><strong>{family?.name}</strong><span>{demo ? 'عرض على هذا الجهاز' : realtime ? 'متصل ومزامَن' : 'قائمة مشتركة'}</span></div><ChevronDown size={16} className="family-chevron" /></div>
      <nav className="side-nav" aria-label="التنقل"><button className="side-nav-item active" onClick={() => { document.getElementById('guest-list')?.scrollIntoView({ behavior: 'smooth' }); setMobileMenuOpen(false) }}><Users size={18} /><span>كل المعازيم</span><span className="nav-count">{guests.length.toLocaleString('en-US')}</span></button><button className="side-nav-item" onClick={() => { setFilter('no_answer'); document.getElementById('guest-list')?.scrollIntoView({ behavior: 'smooth' }); setMobileMenuOpen(false) }}><Activity size={18} /><span>لم يردوا</span><span className="nav-count subtle">{count('no_answer').toLocaleString('en-US')}</span></button></nav>
      <div className="side-section-label side-team-title">خيارات «من طرف» <span>٥</span></div>
      <div className="side-contact-list">{FAMILY_CONTACTS.map((person, index) => <div className="team-member" key={person}><span className={`member-avatar member-color-${index % 3}`}>{person[0]}</span><span className="member-name">{person}</span></div>)}</div>
      <div className="sidebar-spacer" />
      <section className="invite-card"><div className="invite-card-top"><span className="invite-icon"><UserRoundPlus size={17} /></span><span>{demo ? 'مزامنة العائلة' : 'شارك الدفتر'}</span></div><p>{demo ? 'اربط Supabase لتفعيل الدفتر المشترك بين الهواتف.' : 'أرسل رابط الدفتر؛ يفتح عندهم مباشرة دون تسجيل دخول.'}</p>{demo ? <div className="invite-code-row"><span className="invite-code">محفوظ محلياً</span></div> : <button className="invite-share" onClick={shareFamily}>مشاركة رابط العائلة <Share2 size={15} /></button>}</section>
      <div className="sidebar-footer"><button onClick={() => downloadCsv(guests)}><FileSpreadsheet size={17} />تنزيل القائمة <ArrowDownToLine size={15} className="footer-arrow" /></button>{demo ? <button onClick={() => { resetDemoData(); setGuests(loadDemoGuests()); setActivity(loadDemoActivity()); setToast('استعيدت بيانات العرض') }}><Activity size={16} />إعادة بيانات العرض</button> : <button onClick={() => { localStorage.removeItem(ACCESS_CODE_KEY); setAccessCode(''); setFamily(null); setGuests([]); setActivity([]); setError('') }}><HeartHandshake size={16} />تغيير دفتر العائلة</button>}<div className="privacy-line"><ShieldCheck size={14} />{demo ? 'بيانات تجريبية على هذا الجهاز' : 'مشاركة عبر رابط خاص للعائلة'}</div></div>
    </aside>
    {mobileMenuOpen && <button className="mobile-scrim" aria-label="إغلاق القائمة" onClick={() => setMobileMenuOpen(false)} />}

    <div className="main-area"><header className="topbar"><button className="mobile-menu icon-button" aria-label="فتح القائمة" onClick={() => setMobileMenuOpen(true)}><Menu size={20} /></button><div className="breadcrumb"><span>دفتر العزيمة</span><ChevronLeft size={14} /><strong>قائمة المعازيم</strong></div><div className="topbar-tools"><div className={`sync-indicator ${demo ? 'demo' : realtime ? 'online' : 'offline'}`}><span className="sync-dot" /><span>{demo ? 'استعراض' : realtime ? 'تحديث مباشر' : 'جاري الربط'}</span></div><div className="top-date"><CalendarDays size={16} />{new Intl.DateTimeFormat('ar-LY', { weekday: 'short', day: 'numeric', month: 'long' }).format(new Date())}</div></div></header>
      <main className="content-area">
        {demo && <div className="demo-banner"><Sparkles size={15} /><span><strong>عرض تجريبي</strong> — جرّب الإضافة والتعديل. البيانات محفوظة على هذا الهاتف فقط حتى ربط Supabase.</span><button onClick={() => downloadCsv(guests)} aria-label="تنزيل القائمة التجريبية"><ArrowDownToLine size={16} /></button></div>}
        {error && <div className="inline-alert" role="alert"><CircleHelp size={17} /><span>{error}</span><button aria-label="إخفاء التنبيه" onClick={() => setError('')}><X size={16} /></button></div>}
        <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />ليلة تجمعنا</div><h1>قائمة المعازيم</h1><p>أضف الاسم بسرعة، وسجّل العزيمة أو الملاحظة بسهولة.</p></div><div className="heading-actions"><button className="secondary-button export-button" onClick={() => downloadCsv(guests)}><ArrowDownToLine size={17} /><span>تنزيل</span></button><button className="primary-button" onClick={openAdd}><Plus size={18} /><span>إضافة اسم</span></button></div></section>

        <section className="wedding-panel" aria-label="إجمالي المعازيم"><div className="panel-copy"><div className="panel-kicker"><span className="panel-kicker-dot" />دفتر العائلة <span className="panel-kicker-rule" /> {family?.name}</div><h2>الفرحة تجمعنا،<br className="mobile-break" /> <em>والأسماء عندنا.</em></h2><p>تحديث واحد يظهر للجميع. لا حسابات ولا كلمات مرور.</p><button className="panel-link" onClick={() => document.getElementById('guest-list')?.scrollIntoView({ behavior: 'smooth' })}>عرض الأسماء <ArrowLeft size={15} /></button></div><div className="panel-stamp" aria-hidden="true"><div className="stamp-ring"><span>دعوة العائلة</span><HeartHandshake size={32} strokeWidth={1.4} /><small>ليلة فرح</small></div></div><div className="panel-number"><strong>{partySize(guests).toLocaleString('en-US')}</strong><span>إجمالي المعازيم مع العائلة</span></div><div className="panel-perforation" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /></div></section>

        <section className="stats-grid" aria-label="ملخص المعازيم"><StatCard icon={<Users size={17} />} label="الأسماء المسجلة" value={guests.length} detail="ضيف رئيسي" tone="ink" /><StatCard icon={<HeartHandshake size={17} />} label="إجمالي المعازيم" value={partySize(guests)} detail="يشمل أفراد عائلاتهم" tone="green" /><StatCard icon={<CheckCheck size={17} />} label="تمت عزيمتهم" value={partySize(guests.filter((guest) => guest.status === 'invited'))} detail={`${count('invited').toLocaleString('en-US')} اسم`} tone="amber" /><StatCard icon={<PhoneMissed size={17} />} label="لم يردوا" value={partySize(guests.filter((guest) => guest.status === 'no_answer'))} detail={`${count('no_answer').toLocaleString('en-US')} اسم يحتاج إعادة اتصال`} tone="rose" /></section>

        <section className="list-section" id="guest-list" aria-labelledby="list-title"><div className="list-heading"><div><div className="list-eyebrow">دفتر الدعوات</div><h2 id="list-title">كل المعازيم <span>{guests.length.toLocaleString('en-US')}</span></h2></div><div className="list-heading-meta"><span className="live-marker" />آخر تحديث {formatStamp(latestUpdate)}</div></div><div className="list-toolbar"><div className="search-box"><Search size={17} /><input type="search" aria-label="ابحث عن معزوم" placeholder="ابحث بالاسم أو الهاتف..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="toolbar-selects"><label className="compact-select"><span className="sr-only">تصفية حسب الشخص</span><select aria-label="تصفية حسب الشخص" value={inviterFilter} onChange={(event) => setInviterFilter(event.target.value as FamilyContact | 'all')}><option value="all">كل الأشخاص</option>{FAMILY_CONTACTS.map((person) => <option key={person} value={person}>من طرف {person}</option>)}</select><ChevronDown size={13} /></label><label className="compact-select"><span className="sr-only">ترتيب القائمة</span><select aria-label="ترتيب القائمة" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="updated">الأحدث تحديثاً</option><option value="name">الاسم: أ إلى ي</option><option value="group">أكبر مجموعة</option><option value="inviter">ترتيب حسب الشخص</option></select><ChevronDown size={13} /></label></div><div className="filter-count"><ListFilter size={15} /><span>{filtered.length.toLocaleString('en-US')} اسم</span></div></div><div className="filter-row" role="group" aria-label="تصفية القائمة">{filters.map((option) => <button key={option.value} className={`filter-chip ${filter === option.value ? 'selected' : ''}`} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label}{option.value === 'all' && <span>{guests.length.toLocaleString('en-US')}</span>}</button>)}</div>
          {filtered.length ? <><div className="guest-table-wrap"><table className="guest-table"><thead><tr><th scope="col">الاسم</th><th scope="col">من طرف</th><th scope="col">عدد المجموعة</th><th scope="col">الحالة</th><th scope="col">الملاحظة</th><th scope="col"><span className="sr-only">التفاصيل</span></th></tr></thead><tbody>{filtered.map((guest) => <tr key={guest.id}><td><button className="guest-name-button" onClick={() => openDetails(guest)}><span className="guest-avatar">{initials(fullName(guest))}</span><span className="guest-main-copy"><strong>{fullName(guest)}</strong><small dir="ltr">{guest.phone || 'رقم غير مضاف'}</small></span></button></td><td><span className="inviter-name">{guest.invited_by || '—'}</span></td><td><span className="party-count">{guest.family_count.toLocaleString('en-US')} <small>أفراد</small></span></td><td><StatusBadge status={guest.status} /></td><td><span className="table-note">{guest.latest_note || '—'}</span></td><td><button className="row-open" aria-label={`عرض ${fullName(guest)}`} onClick={() => openDetails(guest)}><MoreHorizontal size={19} /></button></td></tr>)}</tbody></table></div><div className="guest-cards">{filtered.map((guest) => <GuestCard key={guest.id} guest={guest} onOpen={() => openDetails(guest)} onStatus={(outcome) => { setSelectedId(guest.id); void recordContact(guest, outcome, guest.latest_note || '') }} />)}</div><div className="table-footer"><span>عرض <strong>{filtered.length.toLocaleString('en-US')}</strong> من <strong>{guests.length.toLocaleString('en-US')}</strong> اسم</span><span className="table-footer-right"><span className="live-marker" />{demo ? 'محفوظ على هذا الهاتف' : realtime ? 'مزامنة مباشرة' : 'يتم تحديث البيانات'}</span></div></> : <EmptyState hasGuests={guests.length > 0} onAdd={openAdd} onReset={() => { setFilter('all'); setInviterFilter('all'); setSortBy('updated'); setSearch('') }} />}
        </section>
        <footer className="page-footer"><span><ShieldCheck size={14} />{demo ? 'بيانات عرض محفوظة محلياً' : 'لا يوجد تسجيل دخول · رمز واحد للعائلة'}</span><span>دفتر العزيمة <span className="footer-separator">·</span> {family?.name}</span></footer>
      </main>
    </div>
    <div className="mobile-action-bar"><div><span className="mobile-action-count">{partySize(guests).toLocaleString('en-US')}</span><span>معزوم في المجموع</span></div><button onClick={openAdd}><Plus size={19} />إضافة اسم</button></div>
    {dialog === 'add' && <GuestFormDialog title="إضافة معزوم" initial={null} onClose={() => { setDialog(null); setError('') }} onSave={(draft) => saveGuest(draft)} error={error} clearError={() => setError('')} />}
    {dialog === 'edit' && selected && <GuestFormDialog title="تعديل الاسم" initial={selected} onClose={() => { setDialog('details'); setError('') }} onSave={(draft) => saveGuest(draft, selected.id)} error={error} clearError={() => setError('')} />}
    {dialog === 'details' && selected && <GuestDetailsDialog guest={selected} events={selectedEvents} onClose={() => { setDialog(null); setError('') }} onEdit={() => setDialog('edit')} onRecord={recordContact} error={error} clearError={() => setError('')} />}
    {toast && <div className="toast" role="status" aria-live="polite"><span className="toast-check"><Check size={15} /></span>{toast}</div>}
  </div>
}

function StatCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: number; detail: string; tone: string }) {
  return <article className={`stat-card stat-${tone}`}><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><MoreHorizontal size={17} className="stat-more" /></div><div className="stat-value">{value.toLocaleString('en-US')}</div><div className="stat-detail">{detail}</div></article>
}

function StatusBadge({ status }: { status: GuestStatus }) {
  return <span className={`status-badge status-${STATUS_META[status].tone}`}><i />{STATUS_META[status].label}</span>
}

function GuestCard({ guest, onOpen, onStatus }: { guest: Guest; onOpen: () => void; onStatus: (outcome: ContactOutcome) => void }) {
  return <article className="guest-card"><div className="guest-card-head"><button className="guest-card-person" onClick={onOpen}><span className="guest-avatar">{initials(fullName(guest))}</span><span className="guest-main-copy"><strong>{fullName(guest)}</strong><small dir="ltr">{guest.phone || 'لا يوجد رقم'}</small></span></button><StatusBadge status={guest.status} /></div><div className="guest-card-details"><span><small>من طرف</small><strong>{guest.invited_by || '—'}</strong></span><span><small>عدد المجموعة</small><strong>{guest.family_count.toLocaleString('en-US')} أفراد</strong></span><span><small>ملاحظة</small><strong>{guest.latest_note || '—'}</strong></span></div><div className="guest-card-actions"><button className={`quick-status ${guest.status === 'invited' ? 'done' : ''}`} onClick={() => onStatus('invited')}><Check size={14} />تمت العزيمة</button><button className={`quick-status ${guest.status === 'no_answer' ? 'missed' : ''}`} onClick={() => onStatus('no_answer')}><PhoneMissed size={14} />لم يرد</button><button className="card-secondary" onClick={onOpen}>ملاحظة <ChevronLeft size={14} /></button>{guest.phone && <a className="card-call" href={`tel:${guest.phone}`} aria-label={`اتصال بـ ${fullName(guest)}`}><Phone size={14} /></a>}</div></article>
}

function EmptyState({ hasGuests, onAdd, onReset }: { hasGuests: boolean; onAdd: () => void; onReset: () => void }) {
  return <div className="empty-state"><span className="empty-icon">{hasGuests ? <Search size={23} /> : <Users size={23} />}</span><h3>{hasGuests ? 'لا توجد أسماء هنا' : 'ابدأوا بأول اسم'}</h3><p>{hasGuests ? 'غيّر البحث أو التصفية لإظهار بقية القائمة.' : 'أدخل الاسم، وعدد المعازيم من عائلته، ثم تابعوا العزيمة.'}</p>{hasGuests ? <button className="secondary-button" onClick={onReset}>مسح البحث والتصفية</button> : <button className="primary-button" onClick={onAdd}><Plus size={17} />إضافة اسم</button>}</div>
}

function LoadingScreen() {
  return <div className="loading-screen" dir="rtl"><div className="loading-mark"><ClipboardCheck size={24} /></div><div className="loading-copy"><strong>دفتر العزيمة</strong><span>جاري فتح الدفتر المشترك...</span></div><span className="loader" /></div>
}

function FamilySetup({ onCreate, onJoin, error, clearError }: { onCreate: (name: string) => Promise<boolean>; onJoin: (code: string) => Promise<boolean>; error: string; clearError: () => void }) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [familyName, setFamilyName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); clearError()
    await (mode === 'create' ? onCreate(familyName.trim()) : onJoin(code.trim()))
    setBusy(false)
  }
  return <div className="setup-page" dir="rtl"><header className="setup-top"><div className="brand-lockup"><div className="brand-mark"><ClipboardCheck size={21} /></div><div><div className="brand-name">دفتر العزيمة</div><div className="brand-caption">من غير تسجيل دخول</div></div></div></header><main className="setup-card"><span className="setup-icon"><HeartHandshake size={24} /></span><div className="eyebrow"><span className="eyebrow-line" />دفتر واحد للعائلة</div><h1>{mode === 'create' ? 'ابدأ دفتر العائلة' : 'انضم إلى دفتر العائلة'}</h1><p>{mode === 'create' ? 'اكتب اسم العائلة. سننشئ رابطاً خاصاً تشاركه مع بقية العائلة.' : 'الصق رابط أو رمز الدفتر الذي أرسله لك أحد أفراد العائلة.'}</p><div className="setup-tabs" role="tablist"><button role="tab" aria-selected={mode === 'create'} className={mode === 'create' ? 'selected' : ''} onClick={() => { setMode('create'); clearError() }}>دفتر جديد</button><button role="tab" aria-selected={mode === 'join'} className={mode === 'join' ? 'selected' : ''} onClick={() => { setMode('join'); clearError() }}>عندي رمز</button></div><form className="setup-form" onSubmit={submit}>{mode === 'create' ? <label>اسم الدفتر<input value={familyName} onChange={(event) => setFamilyName(event.target.value)} placeholder="مثال: عائلة السالم" minLength={2} maxLength={100} required /></label> : <label>رمز أو رابط الدفتر<input dir="ltr" className="code-input" value={code} onChange={(event) => { const value = event.target.value; try { const parsed = new URL(value); setCode(new URLSearchParams(parsed.hash.slice(1)).get('join') || value) } catch { setCode(new URLSearchParams(value.replace(/^#/, '')).get('join') || value) } }} placeholder="الصق رابط الدعوة أو الرمز" required /></label>}{error && <div className="form-alert" role="alert">{error}</div>}<button className="primary-button auth-submit" disabled={busy}>{busy ? <span className="button-spinner" /> : <>{mode === 'create' ? 'إنشاء الدفتر' : 'فتح دفتر العائلة'}<ArrowLeft size={17} /></>}</button></form><div className="setup-footnote"><ShieldCheck size={15} /><span>لا حساب ولا كلمة مرور. يُحفظ رمز العائلة على هذا الجهاز لفتح الدفتر لاحقاً.</span></div></main></div>
}

function useDialog(ref: React.RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const close = () => onCloseRef.current()
    dialog.addEventListener('close', close)
    return () => { dialog.removeEventListener('close', close); if (dialog.open) dialog.close() }
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
    const saved = await onSave({ first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim(), family_count: Math.max(1, Math.min(500, Number(familyCount) || 1)), invited_by: invitedBy })
    setBusy(false); if (saved) clearError()
  }
  const clearVisibleError = () => { if (error) clearError() }
  return <dialog className="app-dialog guest-form-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target === dialogRef.current) onClose() }}><div className="dialog-header"><div><span className="dialog-eyebrow">سريع وسهل</span><h2>{title}</h2><p>الاسم فقط يكفي. باقي المعلومات اختيارية.</p></div><button className="icon-button" aria-label="إغلاق" onClick={onClose}><X size={19} /></button></div><form className="guest-form" onSubmit={submit}>
    <div className="name-fields"><label>الاسم <span className="required-mark">*</span><input autoFocus value={firstName} onChange={(event) => { setFirstName(event.target.value); clearVisibleError() }} placeholder="الاسم الأول" required minLength={1} maxLength={80} /></label><label>اللقب <span className="optional-label">اختياري</span><input value={lastName} onChange={(event) => { setLastName(event.target.value); clearVisibleError() }} placeholder="اسم العائلة" maxLength={100} /></label></div>
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

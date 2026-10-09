import { createClient } from '@supabase/supabase-js'

// Public browser configuration. Deployment environment variables can override it.
const url = import.meta.env.VITE_SUPABASE_URL?.trim() || 'https://oxlsxignqmhimasfenoe.supabase.co'
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || 'sb_publishable_3Z3SHdnmEnmR572kR2IRmQ_Prv_Ky_O'
export const FAMILY_ACCESS_CODE = 'turki-family-shared-book-2026'

export const isCloudConfigured = Boolean(url && anonKey && !url.includes('your-project'))
export const supabase = isCloudConfigured ? createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}) : null

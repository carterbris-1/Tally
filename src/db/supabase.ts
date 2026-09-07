import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Tally runs perfectly well with no Supabase project configured — it is simply
 * local-only until you add the two variables. Nothing in the UI blocks on this.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSyncConfigured = Boolean(url && anonKey)

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient | null {
  if (!isSyncConfigured) return null
  client ??= createClient(url!, anonKey!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}

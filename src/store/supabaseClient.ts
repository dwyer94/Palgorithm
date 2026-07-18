import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Absent env vars mean "cloud sync not configured" — the app must keep working fully
 * guest/local-only (CLAUDE.md audience: guest-first, zero sign-in required). Every
 * consumer (AuthContext, remoteStore) checks `supabase` for null before using it rather
 * than assuming a project is always configured. */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

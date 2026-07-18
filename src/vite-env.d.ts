/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** Supabase project URL + anon key for the opt-in cloud sync layer (Phase 1,
   * docs/PRODUCTION_READINESS_PLAN.md). Absent/empty means "no cloud sync configured" —
   * the app still works fully guest/local-only, see src/store/supabaseClient.ts. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

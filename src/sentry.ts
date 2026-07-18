import * as Sentry from '@sentry/react';

/** Absent env var means "error tracking not configured" — mirrors the same pattern used in
 * src/store/supabaseClient.ts for Supabase. `initSentry()` is a no-op (not even imported by
 * Sentry.init) when VITE_SENTRY_DSN is unset, so local dev / PR previews without a DSN
 * configured don't send events anywhere and don't throw. */
const dsn = import.meta.env.VITE_SENTRY_DSN;

export const sentryConfigured = Boolean(dsn);

export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    // Defaults collect standard error/breadcrumb data without extra PII categories
    // (user info, request/response bodies, etc.) — see Sentry's dataCollection option
    // to opt into any of those individually if ever needed.
    dataCollection: {},
  });
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!sentryConfigured) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

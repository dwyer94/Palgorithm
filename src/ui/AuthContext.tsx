import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../store/supabaseClient';
import { setActiveUser } from '../store/remoteStore';

/** Session state for the opt-in cloud sync layer (Phase 1, docs/PRODUCTION_READINESS_PLAN.md).
 * Mirrors the RulesetContext/ReferenceContext/LiveContext pattern already used in src/ui.
 * `configured === false` means no Supabase project is set up for this deployment — the app
 * still works fully guest/local-only (CLAUDE.md audience: guest-first, zero sign-in
 * required), and every auth method below just returns a clear error in that case rather
 * than throwing, so a signed-out guest never has code paths that assume cloud sync exists. */

interface AuthResult {
  error: string | null;
}

type OAuthProvider = 'google' | 'discord';

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<AuthResult>;
  deleteAccount: () => Promise<AuthResult>;
}

const NOT_CONFIGURED_ERROR = 'Cloud sync is not configured for this deployment.';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabase !== null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setActiveUser(data.session?.user.id ?? null);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setActiveUser(newSession?.user.id ?? null);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signInWithOAuth = useCallback(async (provider: OAuthProvider): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error: error?.message ?? null };
  }, []);

  // Deletes the auth.users row via the delete_user() RPC (supabase/migrations/0002_*.sql),
  // which cascades to every synced table (rosters/saved_plans/teams/team_slots/settings).
  // Signs out locally afterward since the session is no longer valid.
  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    const { error } = await supabase.rpc('delete_user');
    if (error) return { error: error.message };
    await supabase.auth.signOut();
    return { error: null };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: supabase !== null,
      loading,
      session,
      user: session?.user ?? null,
      signUp,
      signIn,
      signInWithOAuth,
      signOut,
      resetPassword,
      deleteAccount,
    }),
    [loading, session, signUp, signIn, signInWithOAuth, signOut, resetPassword, deleteAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}

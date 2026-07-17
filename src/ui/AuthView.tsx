import { useState } from 'react';
import { useAuthContext } from './AuthContext';

/** Minimal account UI (Phase 1, docs/PRODUCTION_READINESS_PLAN.md) — email/password
 * sign-in/up + password reset, all built on Supabase Auth's own flows (email
 * verification, reset emails). Guest-first: this view is entirely optional, the app
 * works fully local-only without ever visiting it. */

const inputClass =
  'w-full rounded-panel border-[1.5px] border-border-input px-[11px] py-2 font-mono text-[12.5px] outline-none focus:border-primary';
const labelClass = 'mb-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[.5px] text-muted';
const primaryButtonClass =
  'cursor-pointer rounded-lg border-[1.5px] border-[#26241f] bg-white px-3.5 py-2 font-mono text-[12.5px] font-semibold hover:bg-panel-subtle disabled:cursor-default disabled:opacity-50';

type Mode = 'sign-in' | 'sign-up' | 'reset';

function AuthForm() {
  const { signIn, signUp, resetPassword } = useAuthContext();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    if (mode === 'reset') {
      const { error: resetError } = await resetPassword(email);
      if (resetError) setError(resetError);
      else setMessage('Check your email for a password reset link.');
    } else if (mode === 'sign-up') {
      const { error: signUpError } = await signUp(email, password);
      if (signUpError) setError(signUpError);
      else setMessage('Check your email to confirm your account, then sign in.');
    } else {
      const { error: signInError } = await signIn(email, password);
      if (signInError) setError(signInError);
    }
    setSubmitting(false);
  };

  return (
    <div className="mx-auto max-w-[360px]">
      <div className="mb-4 flex rounded-lg bg-panel-subtle p-[3px]">
        {(['sign-in', 'sign-up', 'reset'] as Mode[]).map((m) => (
          <span
            key={m}
            onClick={() => {
              setMode(m);
              setError(null);
              setMessage(null);
            }}
            className={`flex-1 cursor-pointer rounded-[6px] py-[7px] text-center font-sans text-[12px] font-semibold ${
              mode === m ? 'bg-white shadow-card' : 'text-muted'
            }`}
          >
            {m === 'sign-in' ? 'Sign in' : m === 'sign-up' ? 'Sign up' : 'Reset'}
          </span>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <div>
          <div className={labelClass}>Email</div>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        {mode !== 'reset' && (
          <div>
            <div className={labelClass}>Password</div>
            <input
              type="password"
              required
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
        )}

        {error && <div className="font-mono text-[12px] text-danger-text">{error}</div>}
        {message && <div className="font-mono text-[12px] text-success-text">{message}</div>}

        <button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? 'Working…' : mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : 'Send reset email'}
        </button>
      </form>
    </div>
  );
}

export default function AuthView() {
  const { configured, loading, user, signOut } = useAuthContext();

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[860px] px-4 pb-[70px] pt-[26px] md:px-[34px]">
        <div className="mb-0.5 font-sans text-[22px] font-bold tracking-[-.4px]">Account</div>
        <div className="mb-[26px] font-sans text-[13px] text-muted">
          Optional — sign in to sync your roster, plans, teams, and settings across devices. The planner works fully without
          one, saved locally on this device.
        </div>

        <div className="rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
          {!configured ? (
            <div className="font-sans text-[13px] text-muted">
              Cloud sync isn't configured for this deployment — everything stays local to this device.
            </div>
          ) : loading ? (
            <div className="font-sans text-[13px] text-muted">Loading…</div>
          ) : user ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-sans text-[13.5px] font-semibold">Signed in</div>
                <div className="font-mono text-[12.5px] text-muted">{user.email}</div>
              </div>
              <span onClick={() => void signOut()} className={primaryButtonClass}>
                Sign out
              </span>
            </div>
          ) : (
            <AuthForm />
          )}
        </div>
      </div>
    </main>
  );
}

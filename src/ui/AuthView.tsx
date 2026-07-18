import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff } from 'lucide-react';
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
const secondaryButtonClass =
  'cursor-pointer rounded-lg px-3.5 py-2 font-mono text-[12.5px] font-semibold text-muted hover:bg-panel-subtle disabled:cursor-default disabled:opacity-50';
const dangerButtonClass =
  'cursor-pointer rounded-lg border-[1.5px] border-danger-border bg-danger-bg px-3.5 py-2 font-mono text-[12.5px] font-semibold text-danger-text hover:bg-[#fbe6da] disabled:cursor-default disabled:opacity-50';
const oauthButtonClass =
  'flex cursor-pointer items-center justify-center gap-2 rounded-lg border-[1.5px] border-border-input px-3.5 py-2 font-sans text-[12.5px] font-semibold hover:bg-panel-subtle disabled:cursor-default disabled:opacity-50';

type Mode = 'sign-in' | 'sign-up' | 'reset';

/** Shared password input with a show/hide toggle (sign-in password, sign-up password, and
 * sign-up confirm-password all use this). */
function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <div className={labelClass}>{label}</div>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} pr-9`}
        />
        <span
          onClick={() => setVisible((v) => !v)}
          className="absolute right-0 top-0 flex h-full cursor-pointer items-center px-2.5 text-muted hover:text-primary-dark"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </span>
      </div>
    </div>
  );
}

function AuthForm() {
  const { signIn, signUp, signInWithOAuth, resetPassword } = useAuthContext();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    if (mode === 'sign-up' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
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

  const oauth = async (provider: 'google' | 'discord') => {
    setSubmitting(true);
    setError(null);
    const { error: oauthError } = await signInWithOAuth(provider);
    if (oauthError) {
      setError(oauthError);
      setSubmitting(false);
    }
    // On success the browser is redirected to the provider, so no further local state update happens.
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

      {mode !== 'reset' && (
        <div className="mb-3 flex flex-col gap-2">
          <span onClick={() => void oauth('google')} className={oauthButtonClass}>
            Continue with Google
          </span>
          <span onClick={() => void oauth('discord')} className={oauthButtonClass}>
            Continue with Discord
          </span>
          <div className="my-0.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.5px] text-muted-light">
            <div className="h-px flex-1 bg-border-input" />
            or
            <div className="h-px flex-1 bg-border-input" />
          </div>
        </div>
      )}

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
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          />
        )}
        {mode === 'sign-up' && (
          <PasswordField
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
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

/** Delete-account confirmation, gating the irreversible action behind an explicit second
 * click (same portal/modal pattern as GuestMigrationPrompt.tsx's import dialog). */
function DangerZone() {
  const { deleteAccount } = useAuthContext();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doDelete = async () => {
    setDeleting(true);
    setError(null);
    const { error: deleteError } = await deleteAccount();
    setDeleting(false);
    if (deleteError) {
      setError(deleteError);
      return;
    }
    setConfirming(false);
  };

  return (
    <div className="mt-4 rounded-card border border-danger-border bg-danger-bg p-5 px-[22px]">
      <div className="mb-0.5 font-sans text-[13.5px] font-bold text-danger-text">Danger zone</div>
      <div className="mb-3.5 font-sans text-[12px] text-danger-text">
        Permanently delete your account and all synced data (roster, plans, teams, settings). This can't be undone.
      </div>
      <span onClick={() => setConfirming(true)} className={dangerButtonClass}>
        Delete account
      </span>

      {confirming &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-[420px] rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
              <div className="mb-1.5 font-sans text-[15px] font-bold">Delete your account?</div>
              <div className="mb-4 font-sans text-[12.5px] text-muted">
                This permanently deletes your account and every roster, saved plan, team, and settings row synced to
                it. There's no undo. Your local guest data on this device (if any) is unaffected.
              </div>
              {error && <div className="mb-3 font-mono text-[12px] text-danger-text">{error}</div>}
              <div className="flex justify-end gap-2">
                <button disabled={deleting} onClick={() => setConfirming(false)} className={secondaryButtonClass}>
                  Cancel
                </button>
                <button disabled={deleting} onClick={() => void doDelete()} className={dangerButtonClass}>
                  {deleting ? 'Deleting…' : 'Permanently delete'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
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

        {configured && user && <DangerZone />}

        {configured && !user && (
          <div className="mt-3 font-sans text-[11.5px] text-muted-light">
            Creating an account means you agree to the{' '}
            <a href="/legal/terms.html" target="_blank" rel="noreferrer" className="underline hover:text-primary-dark">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/legal/privacy.html" target="_blank" rel="noreferrer" className="underline hover:text-primary-dark">
              Privacy Policy
            </a>
            .
          </div>
        )}
      </div>
    </main>
  );
}

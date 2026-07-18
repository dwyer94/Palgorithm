import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Fixed keys for the Supabase CLI's local dev stack (`supabase start`) — not
 * secrets, published in Supabase's own docs and identical on every machine.
 * Never used against a real/hosted project.
 */
const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** service_role bypasses RLS entirely — only ever used here, in a Node test script
 * against a throwaway local instance, never in src/ (the CI tripwire greps src/ for
 * this exact reason: this key must never reach a browser bundle). */
export const adminClient: SupabaseClient = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY);

let counter = 0;

/** Creates a pre-confirmed test user (no email round-trip needed) and returns a
 * signed-in client scoped to that user, for exercising RLS as a real `authenticated`
 * role rather than faking auth.uid() by hand. */
export async function createTestUser(): Promise<{ userId: string; client: SupabaseClient }> {
  counter += 1;
  const email = `rls-test-${Date.now()}-${counter}@example.test`;
  const password = 'test-password-not-real-12345';

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`failed to create test user: ${error?.message}`);

  const client = createClient(LOCAL_URL, LOCAL_ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`failed to sign in test user: ${signInError.message}`);

  return { userId: data.user.id, client };
}

export async function deleteTestUser(userId: string): Promise<void> {
  // `on delete cascade` on every table's user_id FK removes their rows too.
  await adminClient.auth.admin.deleteUser(userId);
}

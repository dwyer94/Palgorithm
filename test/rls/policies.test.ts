import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { adminClient, createTestUser, deleteTestUser } from './setup';

/**
 * Exercises the actual RLS policies in supabase/migrations/0001_init_schema.sql
 * against a real local Postgres (via `supabase start`) — not a mocked client, since
 * a mock would only prove the test calls the right method, not that the policy SQL
 * is correct. Requires Docker + the Supabase CLI; see test/rls/README.md.
 *
 * `rosters` stands in for `saved_plans`/`settings`/`team_slots`, which share the
 * identical `auth.uid() = user_id` policy shape — not re-tested per table for
 * brevity. `teams` (cap 50) is used for the cap tests since it's cheapest to hit.
 */

describe('RLS: cross-user isolation (rosters)', () => {
  let userA: Awaited<ReturnType<typeof createTestUser>>;
  let userB: Awaited<ReturnType<typeof createTestUser>>;
  let rosterRowId: string;

  beforeAll(async () => {
    userA = await createTestUser();
    userB = await createTestUser();

    const { data, error } = await userA.client
      .from('rosters')
      .insert({ species: 'Lamball', gender: 'male', passives: [] })
      .select()
      .single();
    if (error || !data) throw new Error(`setup insert failed: ${error?.message}`);
    rosterRowId = data.id;
  });

  afterAll(async () => {
    await deleteTestUser(userA.userId);
    await deleteTestUser(userB.userId);
  });

  it("user B cannot select user A's roster row", async () => {
    const { data, error } = await userB.client.from('rosters').select().eq('id', rosterRowId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("user B's update on user A's roster row affects nothing", async () => {
    const { data, error } = await userB.client
      .from('rosters')
      .update({ notes: 'hijacked' })
      .eq('id', rosterRowId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: stillOwned } = await adminClient.from('rosters').select().eq('id', rosterRowId).single();
    expect(stillOwned.notes).not.toBe('hijacked');
  });

  it("user B's delete of user A's roster row affects nothing", async () => {
    const { data, error } = await userB.client.from('rosters').delete().eq('id', rosterRowId).select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: stillExists } = await adminClient.from('rosters').select().eq('id', rosterRowId).single();
    expect(stillExists).not.toBeNull();
  });

  it('user A cannot insert a row claiming user_id = user B', async () => {
    const { error } = await userA.client
      .from('rosters')
      .insert({ species: 'Lamball', gender: 'male', passives: [], user_id: userB.userId });
    expect(error).not.toBeNull();
  });

  it("user A cannot update their own row's user_id to user B", async () => {
    const { error } = await userA.client.from('rosters').update({ user_id: userB.userId }).eq('id', rosterRowId);
    expect(error).not.toBeNull();

    const { data: stillOwnedByA } = await adminClient.from('rosters').select().eq('id', rosterRowId).single();
    expect(stillOwnedByA.user_id).toBe(userA.userId);
  });
});

describe('RLS: per-user row cap (teams, cap = 50)', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    user = await createTestUser();
  });

  afterAll(async () => {
    await deleteTestUser(user.userId);
  });

  it('allows inserting up to the cap one row at a time', async () => {
    for (let i = 0; i < 50; i++) {
      const { error } = await user.client.from('teams').insert({ name: `team-${i}` });
      expect(error).toBeNull();
    }
  });

  it('rejects the row past the cap', async () => {
    const { error } = await user.client.from('teams').insert({ name: 'one-too-many' });
    expect(error).not.toBeNull();

    const { count } = await adminClient
      .from('teams')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.userId);
    expect(count).toBe(50);
  });

  it('rejects a single bulk insert that would exceed the cap (regression: statement-snapshot bypass)', async () => {
    const fresh = await createTestUser();
    try {
      const rows = Array.from({ length: 51 }, (_, i) => ({ name: `bulk-${i}` }));
      const { error } = await fresh.client.from('teams').insert(rows);
      expect(error).not.toBeNull();

      // The whole statement should roll back — none of the 51 should have landed.
      const { count } = await adminClient
        .from('teams')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', fresh.userId);
      expect(count).toBe(0);
    } finally {
      await deleteTestUser(fresh.userId);
    }
  });
});

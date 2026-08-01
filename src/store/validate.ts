import { CLOUD_ROW_CAPS, type RosterEntry } from './types';
import { newId } from './localStore';

/**
 * Structural validation for data crossing a trust boundary into the store.
 *
 * Two boundaries exist and they want different strictness:
 *
 *  - **A file the user picked** (roster import) is fully foreign — it may be a different
 *    app's export, a Palworld save, or an arbitrary `.json`. Nothing about its shape is
 *    implied, so it gets checked field by field here and is rejected wholesale on the first
 *    entry that doesn't fit.
 *  - **This origin's own localStorage** only ever gets a cheap `Array.isArray` gate in
 *    localStore.ts, not this. Re-validating every field of every entry on load would reject
 *    data written by an older version of the app over a field that has since been added —
 *    trading a rare crash for routine silent data loss. The only shape error that actually
 *    crashes the app is "not an array at all" (Sentry PALGORITHM-8/-9/-A), and that is what
 *    the cheap gate catches.
 *
 * Prior art: `isTeamArray` in src/ui/TeamsView.tsx, which did this for Team Builder backups.
 * Roster import predates it and was still casting `JSON.parse`'s result straight to
 * `RosterEntry[]`, which is what let a non-array reach the store and take down three views
 * at once.
 */

/** `rosters.id` is a `uuid` column (supabase/migrations/0001_init_schema.sql). A foreign or
 * hand-written file can carry anything in `id`, and a non-uuid would only fail later, inside
 * the cloud upsert, as a Postgres 22P02 — leaving local and cloud silently diverged for a
 * signed-in user. Ids are re-minted on import rather than trusted, so that can't happen. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRosterEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.species === 'string' &&
    (entry.gender === 'male' || entry.gender === 'female') &&
    Array.isArray(entry.passives) &&
    entry.passives.every((p) => typeof p === 'string') &&
    (entry.notes === undefined || entry.notes === null || typeof entry.notes === 'string')
  );
}

export type RosterImportResult =
  | { ok: true; roster: RosterEntry[] }
  | { ok: false; reason: 'not-json' | 'not-roster' | 'too-large' };

/**
 * Validates parsed JSON as a roster export and returns entries safe to hand to `setRoster`.
 *
 * Beyond the shape check this normalizes two things that are valid JSON but break the cloud
 * write, so a signed-in user can't end up with a roster that renders locally and silently
 * fails to sync:
 *
 *  - ids that aren't uuids (see `UUID_RE` above), and
 *  - ids duplicated within the file — a single upsert containing the same primary key twice
 *    fails outright with "ON CONFLICT DO UPDATE command cannot affect row a second time".
 *
 * Species and passive ids are deliberately *not* checked against the loaded dataset. They're
 * dataset-version-dependent (CLAUDE.md invariant 3: game data comes from the dataset JSON,
 * which 1.0 already changed once), so an id this build doesn't recognize means "imported from
 * a different dataset version", not "corrupt file". The views already render an unknown id as
 * its raw string rather than crashing.
 */
export function parseImportedRoster(data: unknown): RosterImportResult {
  if (!Array.isArray(data)) return { ok: false, reason: 'not-roster' };
  // Bounded by the same cap the cloud enforces, so an implausibly large file is refused with
  // a clear message here instead of blowing the localStorage quota mid-write (a
  // QuotaExceededError during `setRoster` would be its own crash) or bouncing off the
  // row-count trigger later.
  if (data.length > CLOUD_ROW_CAPS.roster) return { ok: false, reason: 'too-large' };
  if (!data.every(isRosterEntry)) return { ok: false, reason: 'not-roster' };

  const seen = new Set<string>();
  const roster = (data as RosterEntry[]).map((entry) => {
    const id = UUID_RE.test(entry.id) && !seen.has(entry.id) ? entry.id : newId();
    seen.add(id);
    return {
      id,
      species: entry.species,
      gender: entry.gender,
      passives: [...entry.passives],
      ...(entry.notes ? { notes: entry.notes } : {}),
    };
  });
  return { ok: true, roster };
}

/** User-facing copy for each rejection reason — kept next to the reasons themselves so a new
 * one can't be added without deciding what the user gets told. */
export const ROSTER_IMPORT_ERRORS: Record<Exclude<RosterImportResult, { ok: true }>['reason'], string> = {
  'not-json': 'That file isn’t valid JSON.',
  'not-roster': 'That file doesn’t look like a roster export.',
  'too-large': `That file has more than ${CLOUD_ROW_CAPS.roster} entries — too large to import.`,
};

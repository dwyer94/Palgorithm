import { describe, expect, it } from 'vitest';
import { parseImportedRoster } from '../../src/store/validate';
import { CLOUD_ROW_CAPS, type RosterEntry } from '../../src/store/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function entry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id: crypto.randomUUID(),
    species: 'lamball',
    gender: 'male',
    passives: ['runner'],
    ...overrides,
  } as RosterEntry;
}

describe('parseImportedRoster — rejects what crashed production', () => {
  // The three Sentry issues on 2026-08-01 (PALGORITHM-8/-9/-A) were one non-array reaching
  // the store from Roster import. Every shape here would have done the same.
  it.each([
    ['an object', { roster: [] }],
    ['a bare string', 'lamball'],
    ['a number', 42],
    ['null', null],
    ['a Palworld-save-shaped wrapper', { version: 1, entries: [] }],
  ])('rejects %s', (_label, data) => {
    const result = parseImportedRoster(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-roster');
  });

  it('rejects an array whose entries are the wrong shape', () => {
    expect(parseImportedRoster([{ id: 'a', species: 'lamball' }]).ok).toBe(false);
    expect(parseImportedRoster([{ ...entry(), gender: 'unknown' }]).ok).toBe(false);
    expect(parseImportedRoster([{ ...entry(), passives: 'runner' }]).ok).toBe(false);
    expect(parseImportedRoster([{ ...entry(), passives: [1, 2] }]).ok).toBe(false);
  });

  it('rejects a file over the cloud row cap', () => {
    const result = parseImportedRoster(Array.from({ length: CLOUD_ROW_CAPS.roster + 1 }, () => entry()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-large');
  });

  it('accepts an empty roster — a legitimate export, not a malformed file', () => {
    expect(parseImportedRoster([])).toEqual({ ok: true, roster: [] });
  });
});

describe('parseImportedRoster — normalizes what would break the cloud write', () => {
  it('round-trips a genuine export unchanged', () => {
    const roster = [entry(), entry({ species: 'cattiva', gender: 'female', notes: 'breeder' })];
    const result = parseImportedRoster(JSON.parse(JSON.stringify(roster)));
    expect(result).toEqual({ ok: true, roster });
  });

  it('re-mints ids that are not uuids, since rosters.id is a uuid column', () => {
    const result = parseImportedRoster([entry({ id: 'legacy-1' })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.roster[0]!.id).not.toBe('legacy-1');
    expect(result.roster[0]!.id).toMatch(UUID_RE);
    // Everything else survives the re-mint.
    expect(result.roster[0]!.species).toBe('lamball');
  });

  it('re-mints duplicate ids, which would fail one upsert with two identical primary keys', () => {
    const id = crypto.randomUUID();
    const result = parseImportedRoster([entry({ id }), entry({ id })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.roster[0]!.id).toBe(id);
    expect(result.roster[1]!.id).not.toBe(id);
    expect(new Set(result.roster.map((r) => r.id)).size).toBe(2);
  });

  it('accepts unknown species/passive ids — a different dataset version is not a corrupt file', () => {
    const result = parseImportedRoster([entry({ species: 'some_1_0_species', passives: ['some_1_0_passive'] })]);
    expect(result.ok).toBe(true);
  });

  it('drops a null notes field rather than carrying it into an optional string', () => {
    const result = parseImportedRoster([{ ...entry(), notes: null }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('notes' in result.roster[0]!).toBe(false);
  });

  it('does not alias the caller`s arrays', () => {
    const passives = ['runner'];
    const result = parseImportedRoster([entry({ passives })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.roster[0]!.passives).not.toBe(passives);
  });
});

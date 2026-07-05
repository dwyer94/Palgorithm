/**
 * Pipeline normalizer (spec §4.2, §5) — the ONLY code that understands FModel's export
 * shape. It maps raw Palworld DataTables into the source-agnostic `dataset.<version>.json`
 * the app consumes. All source-specific messiness (enum names, admin duplicate rows,
 * unreleased dev stubs, JP/EN localization split, casing quirks) is quarantined here so the
 * schema stays defined by app needs, not by what any dump happens to provide.
 *
 * Run offline:  node src/pipeline/normalize.ts [--in <exportRoot>] [--out <file>]
 *
 * Inputs (relative to <exportRoot>, default: Output/Exports/Pal/Content):
 *   Pal/DataTable/Character/DT_PalMonsterParameter.json   ranks, gender, elements, flags
 *   Pal/DataTable/Character/DT_PalCombiUnique.json         special-combo overrides
 *   L10N/en/Pal/DataTable/Text/DT_PalNameText_Common.json  English display names
 *
 * Output: src/data/dataset.0.6.json (validated against DatasetSchema before writing).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatasetSchema, ELEMENTS, type Dataset, type Species, type SpecialCombo } from '../data/schema.ts';

// --- Paths --------------------------------------------------------------------------------

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../..');

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function asPath(p: string | undefined, fallback: string): string {
  if (!p) return fallback;
  return isAbsolute(p) ? p : resolve(repoRoot, p);
}

const IN_ROOT = asPath(arg('--in'), join(repoRoot, 'Output', 'Exports', 'Pal', 'Content'));
const OUT_FILE = asPath(arg('--out'), join(repoRoot, 'src', 'data', 'dataset.0.6.json'));

const P_MONSTER = join(IN_ROOT, 'Pal', 'DataTable', 'Character', 'DT_PalMonsterParameter.json');
const P_COMBI = join(IN_ROOT, 'Pal', 'DataTable', 'Character', 'DT_PalCombiUnique.json');
const P_NAMES = join(IN_ROOT, 'L10N', 'en', 'Pal', 'DataTable', 'Text', 'DT_PalNameText_Common.json');

// --- Raw shapes (only the fields we read) -------------------------------------------------

interface FModelTable<Row> {
  Rows: Record<string, Row>;
}
type Bool = boolean;
interface MonsterRow {
  Tribe?: string;
  OverrideNameTextID?: string;
  ZukanIndex?: number;
  ZukanIndexSuffix?: string;
  ElementType1?: string;
  ElementType2?: string;
  Rarity?: number;
  Hp?: number;
  ShotAttack?: number;
  Defense?: number;
  CombiRank?: number;
  MaleProbability?: number;
  IgnoreCombi?: Bool;
  [k: string]: unknown; // WorkSuitability_* etc.
}
interface CombiRow {
  ParentTribeA: string;
  ParentGenderA: string;
  ParentTribeB: string;
  ParentGenderB: string;
  ChildCharacterID: string;
}
interface NameRow {
  TextData?: { LocalizedString?: string };
}

function loadTable<Row>(path: string): FModelTable<Row> {
  const arr = JSON.parse(readFileSync(path, 'utf8')) as Array<FModelTable<Row>>;
  const tbl = arr.find((o) => o && (o as { Rows?: unknown }).Rows);
  if (!tbl) throw new Error(`No DataTable with Rows in ${path}`);
  return tbl;
}

// --- Enum mapping -------------------------------------------------------------------------

const enumTail = (v: string | undefined): string => (v ? v.split('::').pop()! : '');

/** Raw EPalElementType names → our closed element set (schema ELEMENTS). */
const ELEMENT_MAP: Record<string, (typeof ELEMENTS)[number]> = {
  Normal: 'Neutral',
  Fire: 'Fire',
  Water: 'Water',
  Electricity: 'Electric',
  Leaf: 'Grass',
  Earth: 'Ground',
  Ice: 'Ice',
  Dark: 'Dark',
  Dragon: 'Dragon',
};

function mapElement(raw: string | undefined): (typeof ELEMENTS)[number] | null {
  const tail = enumTail(raw);
  if (!tail || tail === 'None') return null;
  const mapped = ELEMENT_MAP[tail];
  if (!mapped) throw new Error(`Unmapped element "${tail}" — extend ELEMENT_MAP`);
  return mapped;
}

// --- Inclusion policy ---------------------------------------------------------------------
//
// The export is a dev build: alongside the ~208 released standard-breeding Pals it carries
// combat-stat duplicate rows (BOSS_/RAID_/GYM_/PREDATOR_/SUMMON_/Quest_ of a base tribe),
// oil-rig / Yakushima field-boss variants, and ~60 unreleased Feybreak stubs (CombiRank 0,
// ZukanIndex -1, no localized name). We include a row only if it is a real, released Pal.
//
// Release gate = "has a resolvable English name". Released Pals have a localized name; dev
// stubs and cut variant forms (Kirin_Ice, WindChimes, …) have none. This cleanly keeps the
// real special-combo variant children (Pengullet Lux, Azurobe Cryst, …) while dropping
// stubs, without hand-maintaining a keep/skip list.

const ADMIN_PREFIXES = ['BOSS_', 'Boss_', 'RAID_', 'GYM_', 'PREDATOR_', 'SUMMON_', 'Quest_'];

function isAdminDuplicate(charId: string): boolean {
  if (ADMIN_PREFIXES.some((p) => charId.startsWith(p))) return true;
  if (charId.endsWith('_Oilrig')) return true; // oil-rig fixed-spawn boss variants
  if (charId.startsWith('YakushimaMonster') || charId.startsWith('YakushimaBoss')) return true;
  return false;
}

// --- Build ---------------------------------------------------------------------------------

function main(): void {
  const monster = loadTable<MonsterRow>(P_MONSTER);
  const combi = loadTable<CombiRow>(P_COMBI);
  const nameTbl = loadTable<NameRow>(P_NAMES);

  // "en_text" is Unreal's own placeholder LocalizedString for keys that were never actually
  // localized (only a dev source-string stub exists) — it shows up verbatim in the export for
  // unreleased content and must be treated the same as a missing name, not a real one.
  const UNLOCALIZED_PLACEHOLDER = 'en_text';

  // Keyed case-insensitively: PAL_NAME_<CharacterID> fallback keys don't always match the
  // DataTable row's CharacterID casing (e.g. row "WindChimes" vs. text key
  // "PAL_NAME_Windchimes") — a casing quirk, same class as the tribe-name mismatches already
  // handled below for special combos.
  const names = new Map<string, string>();
  for (const [key, row] of Object.entries(nameTbl.Rows)) {
    const s = row.TextData?.LocalizedString?.trim();
    if (s && s.toLowerCase() !== UNLOCALIZED_PLACEHOLDER) names.set(key.toLowerCase(), s);
  }

  const resolveName = (charId: string, row: MonsterRow): string | undefined => {
    const override = row.OverrideNameTextID;
    if (override && override !== 'None') {
      const viaOverride = names.get(override.toLowerCase());
      if (viaOverride) return viaOverride;
    }
    return names.get(`pal_name_${charId}`.toLowerCase());
  };

  const workSuits = (row: MonsterRow) => {
    const out: { type: string; level: number }[] = [];
    for (const [k, v] of Object.entries(row)) {
      if (k.startsWith('WorkSuitability_') && typeof v === 'number' && v > 0) {
        out.push({ type: k.slice('WorkSuitability_'.length), level: v });
      }
    }
    return out.length ? out : undefined;
  };

  const species: Species[] = [];
  const excluded: { charId: string; reason: string }[] = [];
  let index = 0; // sequential game-file order over INCLUDED species → tie-break key (spec §3)

  for (const [charId, row] of Object.entries(monster.Rows)) {
    if (isAdminDuplicate(charId)) {
      excluded.push({ charId, reason: 'admin/boss/oilrig duplicate' });
      continue;
    }
    const displayName = resolveName(charId, row);
    if (!displayName) {
      excluded.push({ charId, reason: 'no English name (unreleased/dev stub)' });
      continue;
    }

    const mp = row.MaleProbability ?? 50;
    const male = mp / 100;
    const elements = [mapElement(row.ElementType1), mapElement(row.ElementType2)].filter(
      (e): e is (typeof ELEMENTS)[number] => e !== null,
    );

    // IgnoreCombi is the game's own "excluded from the standard combination formula" flag.
    // Special-combo-only children and legendaries carry it → not standardBreedable, but they
    // remain valid parents and are still produced (via specialCombos).
    const standardBreedable = !row.IgnoreCombi;

    const zukan = row.ZukanIndex ?? -1;
    const paldexNo = zukan >= 0 ? `${zukan}${row.ZukanIndexSuffix ?? ''}` : undefined;

    species.push({
      id: charId,
      displayName,
      index: index++,
      standardBreedable,
      // No spawner tables were extracted, so wild-catchability is a documented approximation:
      // released standard-breeding Pals are treated as catchable; special-only variants and
      // legendaries as not. Refine from DT_PalSpawner* later. See EXTRACTION.md.
      wildCatchable: standardBreedable,
      otherObtainOnly: !standardBreedable,
      rank: row.CombiRank ?? null,
      genderRatio: { male, female: 1 - male },
      elements,
      paldexNo,
      rarity: typeof row.Rarity === 'number' ? row.Rarity : undefined,
      workSuitabilities: workSuits(row),
      baseStats: { hp: row.Hp, attack: row.ShotAttack, defense: row.Defense },
      internalName: charId,
    });
  }

  const includedIds = new Set(species.map((s) => s.id));

  // tribe enum name → canonical species id. Parents in DT_PalCombiUnique are referenced by
  // tribe (sometimes a numeric enum the usmap couldn't name, e.g. "262"); children by
  // CharacterID. Canonical = the species whose id equals the tribe name (case-insensitive,
  // e.g. tribe "Blueplatypus" → species "BluePlatypus"), else the lowest-index species of
  // that tribe.
  const byTribe = new Map<string, Species[]>();
  for (const s of species) {
    const row = monster.Rows[s.id]!; // s.id came from monster.Rows, always present
    const tribe = enumTail(row.Tribe).toLowerCase();
    const list = byTribe.get(tribe) ?? [];
    list.push(s);
    byTribe.set(tribe, list);
  }
  const tribeToId = (rawTribe: string): string | undefined => {
    const t = enumTail(rawTribe).toLowerCase();
    const list = byTribe.get(t);
    if (!list || list.length === 0) return undefined;
    return (list.find((s) => s.id.toLowerCase() === t) ?? list[0]!).id;
  };

  const specialCombos: SpecialCombo[] = [];
  let droppedCombos = 0;
  for (const row of Object.values(combi.Rows)) {
    const a = tribeToId(row.ParentTribeA);
    const b = tribeToId(row.ParentTribeB);
    const child = row.ChildCharacterID;
    if (!a || !b || !includedIds.has(child)) {
      droppedCombos++; // references unreleased/excluded content
      continue;
    }
    const genderA = enumTail(row.ParentGenderA);
    const genderB = enumTail(row.ParentGenderB);
    // Gender-dependent special combo (spec invariant #2): the same parent pair yields a
    // different child depending on which parent is female. Encode the required female parent
    // so the ruleset can resolve — or, with genders unknown, split into a distribution.
    let genderRule: SpecialCombo['genderRule'] = null;
    if (genderA === 'Female' || genderB === 'Female') {
      const femaleParent = genderA === 'Female' ? a : b;
      genderRule = { femaleParent, child };
    }
    specialCombos.push({ parents: [a, b], child, genderRule });
  }

  const dataset: Dataset = {
    meta: {
      version: '0.6',
      ruleset: 'combirank-0.6',
      provisional: false, // real ranks + gender ratios for every included species
      source:
        'FModel export of local Palworld build 22461598 (usmap Mappings.0.6.6); EN L10N names. ' +
        'Normalized by src/pipeline/normalize.ts. Passive model is a flagged estimate (verified:false).',
      generatedAt: new Date().toISOString(),
    },
    species,
    specialCombos,
    passives: [], // not extracted in 0.1 (needs DT_PalPassiveSkill*); UI-only, non-breeding-critical
    // Passive-inheritance odds are NOT reliably extractable and ship as flagged estimates
    // (spec §3.3). verified:false → the UI must present these as provisional. Do not treat
    // as ground truth; they are placeholders until measured.
    passiveModel: {
      maxSlots: 4,
      inheritCountDist: [0, 0.4, 0.4, 0.15, 0.05],
      mutationDist: [0.7, 0.25, 0.05],
      verified: false,
    },
  };

  // Self-validate: the pipeline must emit data that passes the same gate the loader enforces.
  const parsed = DatasetSchema.safeParse(dataset);
  if (!parsed.success) {
    console.error('Normalizer produced an INVALID dataset:');
    for (const issue of parsed.error.issues) {
      console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  writeFileSync(OUT_FILE, JSON.stringify(parsed.data, null, 2) + '\n', 'utf8');

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  species:        ${species.length}`);
  console.log(`    standardBreedable: ${species.filter((s) => s.standardBreedable).length}`);
  console.log(`    otherObtainOnly:   ${species.filter((s) => s.otherObtainOnly).length}`);
  console.log(`  specialCombos:  ${specialCombos.length} (dropped ${droppedCombos} referencing excluded species)`);
  console.log(`  gender-rules:   ${specialCombos.filter((c) => c.genderRule).length}`);
  console.log(`  excluded rows:  ${excluded.length}`);
}

main();

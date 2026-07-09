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
 *   Pal/DataTable/Character/DT_PalMonsterParameter.json         ranks, gender, elements, flags
 *   Pal/DataTable/Character/DT_PalCombiUnique.json                special-combo overrides
 *   L10N/en/Pal/DataTable/Text/DT_PalNameText_Common.json         English display names
 *   Pal/DataTable/Character/DT_PalCharacterIconDataTable.json     species id -> icon texture asset
 *   Pal/Texture/PalIcon/Normal/*.png                              the icon textures themselves
 *   L10N/en/Pal/DataTable/Text/DT_SkillDescText_Common.json       English passive effect text
 *
 * Icon textures referenced by the icon table are copied to public/icons/pals/<id>.png
 * (repo-root-relative, served as-is by Vite) — this is the one step that touches the
 * filesystem outside of reading inputs / writing the dataset. Both the icon table and the
 * texture folder are optional inputs: a re-run without them (e.g. an export that only
 * refreshed the DataTables) skips icon population with a warning rather than failing.
 *
 * Output: src/data/dataset.0.6.json (validated against DatasetSchema before writing).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DatasetSchema,
  ELEMENTS,
  type Dataset,
  type Species,
  type SpecialCombo,
  type Passive,
} from '../data/schema.ts';

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
const P_PASSIVES = join(IN_ROOT, 'Pal', 'DataTable', 'PassiveSkill', 'DT_PassiveSkill_Main_Common.json');
const P_SKILL_NAMES = join(IN_ROOT, 'L10N', 'en', 'Pal', 'DataTable', 'Text', 'DT_SkillNameText_Common.json');
const P_SKILL_DESCS = join(IN_ROOT, 'L10N', 'en', 'Pal', 'DataTable', 'Text', 'DT_SkillDescText_Common.json');
const P_ICON_TABLE = join(IN_ROOT, 'Pal', 'DataTable', 'Character', 'DT_PalCharacterIconDataTable.json');
const P_ICON_DIR = join(IN_ROOT, 'Pal', 'Texture', 'PalIcon', 'Normal');
const ICON_OUT_DIR = join(repoRoot, 'public', 'icons', 'pals');

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
interface PassiveSkillRow {
  Rank?: number;
  LotteryWeight?: number;
  Category?: string;
  OverrideNameTextID?: string;
  OverrideDescMsgID?: string;
  EffectType1?: string;
  EffectType2?: string;
  EffectType3?: string;
  EffectValue1?: number;
  EffectValue2?: number;
  EffectValue3?: number;
  [k: string]: unknown;
}
interface IconRow {
  Icon?: { AssetPathName?: string };
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

/** Raw EPalPassiveSkillEffectType tails → a human category for the UI's passive filter
 * ("find all attack traits by rank"). ShotAttack is the game's only real attack effect on
 * released passives (melee and ranged share it) — deliberately folded into plain "Attack"
 * rather than split by weapon type. Element boost/resist effects are handled separately
 * below since they're parameterized by element rather than being their own fixed tails. */
const EFFECT_CATEGORY_MAP: Record<string, string> = {
  ShotAttack: 'Attack',
  MeleeAttack: 'Attack',
  MaxHP: 'Max HP',
  Defense: 'Defense',
  MoveSpeed: 'Move Speed',
  SwimSpeed: 'Swim Speed',
  BreedSpeed: 'Breeding Speed',
  CraftSpeed: 'Crafting Speed',
  Mining: 'Mining',
  Logging: 'Logging',
  CollectItem: 'Gathering',
  GainItemDrop: 'Item Drop Rate',
  ActiveSkillCoolTime_Decrease: 'Skill Cooldown',
  PalSP_Increase: 'SP',
  FullStomatch_Decrease: 'Food Consumption',
  Sanity_Decrease: 'Sanity',
  ShopSellPrice_Money_Increase: 'Sell Price',
  ShopBuyPrice_Money_Increase: 'Buy Price',
  LifeSteal: 'Life Steal',
  Nocturnal: 'Nocturnal',
  NonKilling: 'Non-Lethal',
  Homing: 'Projectile Homing',
  Explosive: 'Explosive',
  BulletSpeed: 'Bullet Speed',
  Recoil: 'Recoil',
  BulletAccuracy: 'Accuracy',
  Mute: 'Silence',
  TemperatureResist_Heat: 'Heat Resistance',
  TemperatureResist_Cold: 'Cold Resistance',
  MaxInventoryWeight: 'Carry Weight',
  Support: 'Support',
};

/** A passive's effect type can be an element boost/resist parameterized by element
 * (`ElementBoost_Fire`, `ElementResist_Dragon`, …) — translate the element tail through the
 * same `ELEMENT_MAP` used for species so the category reads as e.g. "Fire Boost". */
function mapEffectCategory(raw: string | undefined): string | undefined {
  const tail = enumTail(raw);
  if (!tail || tail === 'no') return undefined;
  const boost = /^ElementBoost_(.+)$/.exec(tail);
  if (boost) return `${ELEMENT_MAP[boost[1]!] ?? boost[1]} Boost`;
  const resist = /^ElementResist_(.+)$/.exec(tail);
  if (resist) return `${ELEMENT_MAP[resist[1]!] ?? resist[1]} Resistance`;
  return EFFECT_CATEGORY_MAP[tail] ?? tail; // unmapped tail: surface as-is rather than drop it
}

/** Raw EPalPassiveSkillEffectTargetType tails → a human suffix. ToSelf is the overwhelming
 * default for pal passives and reads as noise if spelled out, so it (and the empty/None
 * case) is omitted rather than mapped — only the less-common targets get a "(...)" suffix. */
const TARGET_TYPE_MAP: Record<string, string> = {
  ToOtomo: 'Partner Pal',
  ToBaseCampPal: 'Base Pals',
  ToTrainer: 'Trainer',
  ToBuildObject: 'Built Objects',
  ToSelfAndTrainer: 'Self & Trainer',
};

function mapEffectTarget(raw: string | undefined): string | undefined {
  const tail = enumTail(raw);
  if (!tail || tail === 'None' || tail === 'ToSelf') return undefined;
  return TARGET_TYPE_MAP[tail] ?? tail;
}

/** Fallback passive description, generated from the row's own EffectType/EffectValue/
 * TargetType fields for passives with no authored `OverrideDescMsgID` (spec: ~23 of 92 —
 * the plain stat-tier passives like Serious/Diamond Body/Musclehead never got hand-written
 * flavor text in the source data). Community data-mining sites (e.g. paldb.cc) render these
 * exact passives the same mechanical way — "<Category> +/-<Value>% (<Target>)" — strongly
 * suggesting the game itself has no authored string for them either and builds this
 * on the fly, so this isn't guessing at unknown values, just formatting real extracted ones
 * the way the source data implies they're meant to be read. */
function generateFallbackDesc(row: PassiveSkillRow): string | undefined {
  const clauses: string[] = [];
  for (const i of [1, 2, 3] as const) {
    const category = mapEffectCategory(row[`EffectType${i}`] as string | undefined);
    const value = row[`EffectValue${i}`] as number | undefined;
    if (!category || value === undefined) continue;
    const sign = value >= 0 ? '+' : '';
    const target = mapEffectTarget(row[`TargetType${i}`] as string | undefined);
    clauses.push(`${category} ${sign}${value}%${target ? ` (${target})` : ''}`);
  }
  return clauses.length ? clauses.join('\n') : undefined;
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
  const passiveTbl = loadTable<PassiveSkillRow>(P_PASSIVES);
  const skillNameTbl = loadTable<NameRow>(P_SKILL_NAMES);
  const skillDescTbl = existsSync(P_SKILL_DESCS) ? loadTable<NameRow>(P_SKILL_DESCS) : undefined;

  // Icon textures: DT_PalCharacterIconDataTable maps species id -> texture asset path. Both
  // this table and the texture folder are optional — an export that didn't include icons
  // (or a re-run against an older export) just skips icon population, it doesn't fail the
  // whole normalize run (icon is UI-only, spec §6 / schema.ts comment on Species.icon).
  const iconTbl = existsSync(P_ICON_TABLE) ? loadTable<IconRow>(P_ICON_TABLE) : undefined;
  const iconFiles = existsSync(P_ICON_DIR) ? new Set(readdirSync(P_ICON_DIR)) : undefined;
  // Keyed case-insensitively: the icon table's row keys don't always match a species id's
  // casing (e.g. "BadCatGirl" vs. species "BadCatgirl", "Blueplatypus" vs. "BluePlatypus") —
  // the same class of casing quirk already handled for tribe names below.
  const iconFileByLowerId = new Map<string, string>();
  if (iconTbl) {
    for (const [key, row] of Object.entries(iconTbl.Rows)) {
      const asset = row.Icon?.AssetPathName;
      if (!asset) continue;
      const fname = `${asset.split('/').pop()!.split('.')[0]}.png`;
      iconFileByLowerId.set(key.toLowerCase(), fname);
    }
  }
  const missingIcons: string[] = []; // species with no resolvable icon (no table row, or file absent from export)

  // "en_text" / "en Text" is Unreal's own placeholder LocalizedString for keys that were never
  // actually localized (only a dev source-string stub exists) — it shows up verbatim in the
  // export for unreleased content and must be treated the same as a missing name, not a real
  // one. The species and skill name tables spell it with a different separator, so match both.
  const isUnlocalizedPlaceholder = (s: string): boolean => /^en[ _]text$/i.test(s);

  // Keyed case-insensitively: PAL_NAME_<CharacterID> fallback keys don't always match the
  // DataTable row's CharacterID casing (e.g. row "WindChimes" vs. text key
  // "PAL_NAME_Windchimes") — a casing quirk, same class as the tribe-name mismatches already
  // handled below for special combos.
  const names = new Map<string, string>();
  for (const [key, row] of Object.entries(nameTbl.Rows)) {
    const s = row.TextData?.LocalizedString?.trim();
    if (s && !isUnlocalizedPlaceholder(s)) names.set(key.toLowerCase(), s);
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

    // Icon: resolve via DT_PalCharacterIconDataTable, then confirm the referenced texture was
    // actually exported (a handful of table rows point at PNGs missing from this export — a
    // real extraction gap, not something to paper over). Copies the source PNG once per
    // species into public/icons/pals so the built app can serve it without reaching into the
    // pipeline's raw export tree.
    let icon: string | undefined;
    if (iconFiles) {
      const srcName = iconFileByLowerId.get(charId.toLowerCase());
      if (srcName && iconFiles.has(srcName)) {
        mkdirSync(ICON_OUT_DIR, { recursive: true });
        copyFileSync(join(P_ICON_DIR, srcName), join(ICON_OUT_DIR, `${charId}.png`));
        icon = `/icons/pals/${charId}.png`;
      } else {
        missingIcons.push(charId);
      }
    }

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
      icon,
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

  // Passive skills: the table carries dev-only rows (Category: SortNotDisplayable, e.g. the
  // TestSkill* rows) alongside the real ones, and the name table has the same "en Text"
  // dev-stub placeholder as species names for anything never localized. Same release gate as
  // species: displayable AND has a resolvable English name.
  const skillNames = new Map<string, string>();
  for (const [key, row] of Object.entries(skillNameTbl.Rows)) {
    const s = row.TextData?.LocalizedString?.trim();
    if (s && !isUnlocalizedPlaceholder(s)) skillNames.set(key.toLowerCase(), s);
  }
  const resolvePassiveName = (skillId: string, row: PassiveSkillRow): string | undefined => {
    const override = row.OverrideNameTextID;
    if (override && override !== 'None') {
      const viaOverride = skillNames.get(override.toLowerCase());
      if (viaOverride) return viaOverride;
    }
    return skillNames.get(`passive_${skillId}`.toLowerCase());
  };

  // Passive effect text: unlike names, there's no reliable `passive_<skillId>` fallback key —
  // it's OverrideDescMsgID or nothing (23 real passives ship with neither; description stays
  // unset for those, an extraction gap rather than a fabricated value). The source string
  // carries a game template (`{EffectValue1-3}`) resolved against this row's own numeric
  // values, plus the game's `<NumBlue_13>`/`<NumRed_13>`/`</>` colour tags around some
  // pre-baked numbers — stripped since Phase 0 UI has no rich-text renderer for them.
  const skillDescs = new Map<string, string>();
  if (skillDescTbl) {
    for (const [key, row] of Object.entries(skillDescTbl.Rows)) {
      const s = row.TextData?.LocalizedString?.trim();
      if (s && !isUnlocalizedPlaceholder(s)) skillDescs.set(key.toLowerCase(), s);
    }
  }
  const resolvePassiveDesc = (row: PassiveSkillRow): string | undefined => {
    const key = row.OverrideDescMsgID;
    if (!key || key === 'None') return undefined;
    const raw = skillDescs.get(key.toLowerCase());
    if (!raw) return undefined;
    const fmt = (v: number | undefined): string => (v === undefined ? '' : String(v));
    return raw
      .replace(/\{EffectValue1\}/g, fmt(row.EffectValue1))
      .replace(/\{EffectValue2\}/g, fmt(row.EffectValue2))
      .replace(/\{EffectValue3\}/g, fmt(row.EffectValue3))
      .replace(/<\/?[A-Za-z0-9_]*>/g, '')
      .replace(/\r\n/g, '\n')
      .trim();
  };

  const passives: Passive[] = [];
  let excludedPassives = 0;
  let passivesGeneratedDesc = 0; // no authored text — description built from EffectType/Value/Target
  let passivesMissingDesc = 0; // neither authored nor generatable (shouldn't happen; flagged if it does)
  for (const [skillId, row] of Object.entries(passiveTbl.Rows)) {
    if (row.Category !== 'EPalPassiveCategory::SortDisplayable') {
      excludedPassives++; // dev-only row (e.g. TestSkill*), never shown in-game
      continue;
    }
    const displayName = resolvePassiveName(skillId, row);
    if (!displayName) {
      excludedPassives++; // unreleased/dev stub, no English name
      continue;
    }
    // Up to 3 effect types per passive; de-duplicated since e.g. two ElementBoost slots on
    // the same element would otherwise repeat a category.
    const categories = Array.from(
      new Set(
        [row.EffectType1, row.EffectType2, row.EffectType3]
          .map(mapEffectCategory)
          .filter((c): c is string => c !== undefined),
      ),
    );
    let description = resolvePassiveDesc(row);
    if (!description) {
      description = generateFallbackDesc(row);
      if (description) passivesGeneratedDesc++;
      else passivesMissingDesc++;
    }
    passives.push({
      id: skillId,
      displayName,
      tier: row.Rank,
      categories,
      lotteryWeight: row.LotteryWeight,
      description,
    });
  }

  const dataset: Dataset = {
    meta: {
      version: '0.6',
      ruleset: 'combirank-0.6',
      provisional: false, // real ranks + gender ratios for every included species
      source:
        'FModel export of local Palworld build 22461598 (species/names: usmap Mappings.0.6.6; ' +
        'passives: usmap Mappings073.usmap, same game build); EN L10N names. Normalized by ' +
        'src/pipeline/normalize.ts. passiveModel (inherit/mutation odds) remains a flagged ' +
        'estimate (verified:false) — the passive list itself is real extracted data.',
      generatedAt: new Date().toISOString(),
    },
    species,
    specialCombos,
    passives,
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
  console.log(`    with icon:         ${species.filter((s) => s.icon).length}${missingIcons.length ? ` (missing: ${missingIcons.join(', ')})` : ''}`);
  console.log(`  specialCombos:  ${specialCombos.length} (dropped ${droppedCombos} referencing excluded species)`);
  console.log(`  passives:       ${passives.length} (excluded ${excludedPassives} dev-only/unreleased rows)`);
  console.log(`    with categories:   ${passives.filter((p) => p.categories.length > 0).length}`);
  console.log(
    `    with description:  ${passives.length - passivesMissingDesc} ` +
      `(${passivesGeneratedDesc} generated from effect values; missing ${passivesMissingDesc})`,
  );
  console.log(`  gender-rules:   ${specialCombos.filter((c) => c.genderRule).length}`);
  console.log(`  excluded rows:  ${excluded.length}`);
}

main();

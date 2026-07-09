import { z } from 'zod';

/**
 * Dataset schema — the source-agnostic contract every later session consumes.
 *
 * This shape is defined by what the solver/UI need (spec §6), NOT by what any data
 * source happens to provide. A source missing a field is a data-population problem, not
 * a reason to change this schema. All source-specific parsing is quarantined in the
 * /pipeline normalizer, which emits data conforming to this. Community bootstrap data,
 * our own extraction, and a future 1.0 dump all target this identical shape.
 */

/** Palworld element types (closed set in 0.6). The normalizer maps raw names to these. */
export const ELEMENTS = [
  'Neutral',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Dark',
  'Dragon',
  'Ground',
  'Ice',
] as const;
export const ElementSchema = z.enum(ELEMENTS);

export const GenderSchema = z.enum(['male', 'female']);

export const GenderRatioSchema = z.object({
  male: z.number().min(0).max(1),
  female: z.number().min(0).max(1),
});

export const WorkSuitabilitySchema = z.object({
  type: z.string(),
  level: z.number().int().min(0),
});

export const BaseStatsSchema = z.object({
  hp: z.number().optional(),
  attack: z.number().optional(),
  defense: z.number().optional(),
});

export const SpeciesSchema = z.object({
  // --- Structural identity (always present, source-independent) ---
  id: z.string().min(1), // stable internal id, e.g. "Relaxaurus_Lux"
  displayName: z.string().min(1),
  index: z.number().int().min(0), // game-file order; tie-break for the closest-rank rule

  // --- Reachability (three-way split, spec §3.2) ---
  standardBreedable: z.boolean(), // can appear as a breeding output
  wildCatchable: z.boolean(), // obtainable in the wild → may be suggested as an anchor
  otherObtainOnly: z.boolean(), // event/raid/boss/shop-only → valid parent only if owned

  // --- Game values our model needs. Nullable ONLY while provisional (see DatasetSchema
  //     refinement): a dataset that declares itself final must populate these. ---
  rank: z.number().int().nullable(), // CombiRank / breeding power; lower = rarer
  genderRatio: GenderRatioSchema.nullable(),
  elements: z.array(ElementSchema).default([]),

  // --- Optional, provisioned for later use (UI / filtering). Never breeding-critical,
  //     so extraction can capture them once without ever being required to. ---
  paldexNo: z.string().optional(),
  rarity: z.number().int().optional(),
  workSuitabilities: z.array(WorkSuitabilitySchema).optional(),
  baseStats: BaseStatsSchema.optional(),
  icon: z.string().optional(), // image path — UI only, not used by the solver
  internalName: z.string().optional(), // raw game name, for matching across sources
  aliases: z.array(z.string()).optional(),
});

/** Gender-dependent special-combo rule (spec §3.1, §6.2). */
export const GenderRuleSchema = z.object({
  femaleParent: z.string(),
  child: z.string(),
});

export const SpecialComboSchema = z.object({
  parents: z.tuple([z.string(), z.string()]),
  child: z.string(),
  genderRule: GenderRuleSchema.nullable().default(null),
});

export const PassiveSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  tier: z.number().int().optional(),
  // What the passive boosts (e.g. "Attack", "Fire Boost", "Move Speed"), derived from the
  // game's own effect-type fields — a passive can carry more than one effect (e.g. "Legend"
  // boosts Attack + Defense + Move Speed) and should be findable under every one of them, so
  // this is a list rather than a single value. Empty when the source row carries no mapped
  // effect (extraction gap, not a real "no category" state).
  categories: z.array(z.string()).default([]),
  // Raw game weight for the random-passive-selection pool (e.g. mutation rolls). Extracted
  // as-is; NOT yet validated as the authoritative mutation-odds source (see passiveModel /
  // spec §3.3) — don't treat it as verified until that's confirmed.
  lotteryWeight: z.number().optional(),
  // English effect text (e.g. "Attack +20%\nDefense +20%\nMovement Speed increases 15%"),
  // with the game's own {EffectValue1-3} template resolved against this row's numeric
  // effect values. UI only — never used by the solver. Missing for a handful of passives
  // whose source row carries no OverrideDescMsgID (extraction gap, not a real "no effect").
  description: z.string().optional(),
});

/**
 * Passive-inheritance odds (spec §3.3). These are NOT reliably extractable and ship as
 * flagged estimates — `verified: false` means the UI must present them as provisional.
 */
export const PassiveModelSchema = z.object({
  maxSlots: z.number().int().positive(), // 4 today
  inheritCountDist: z.array(z.number().min(0)), // P(inherit k passives), index = k
  mutationDist: z.array(z.number().min(0)), // P(add m random passives), index = m
  verified: z.boolean(),
});

export const DatasetMetaSchema = z.object({
  version: z.string(), // game-data version, e.g. "0.6"
  ruleset: z.string(), // ruleset this data targets, e.g. "combirank-0.6"
  provisional: z.boolean(), // true = bootstrap; game-value fields may be null
  source: z.string(), // provenance note (which source(s) produced this)
  generatedAt: z.string(), // ISO timestamp
});

export const DatasetSchema = z
  .object({
    meta: DatasetMetaSchema,
    species: z.array(SpeciesSchema),
    specialCombos: z.array(SpecialComboSchema).default([]),
    passives: z.array(PassiveSchema).default([]),
    passiveModel: PassiveModelSchema,
  })
  .superRefine((data, ctx) => {
    // A dataset that declares itself final (not provisional) must fully populate the
    // game-value fields the solver depends on. This is the contract our own extraction
    // must satisfy — flip provisional to false and validation enforces completeness.
    if (!data.meta.provisional) {
      data.species.forEach((s, i) => {
        if (s.rank === null) {
          ctx.addIssue({
            code: 'custom',
            path: ['species', i, 'rank'],
            message: `rank is required when meta.provisional is false (species "${s.id}")`,
          });
        }
        if (s.genderRatio === null) {
          ctx.addIssue({
            code: 'custom',
            path: ['species', i, 'genderRatio'],
            message: `genderRatio is required when meta.provisional is false (species "${s.id}")`,
          });
        }
      });
    }

    // Referential integrity: special combos must reference known species.
    const ids = new Set(data.species.map((s) => s.id));
    data.specialCombos.forEach((c, i) => {
      const refs: [string, 'parents' | 'child'][] = [
        [c.parents[0], 'parents'],
        [c.parents[1], 'parents'],
        [c.child, 'child'],
      ];
      for (const [ref, field] of refs) {
        if (!ids.has(ref)) {
          ctx.addIssue({
            code: 'custom',
            path: ['specialCombos', i, field],
            message: `specialCombo references unknown species "${ref}"`,
          });
        }
      }
    });
  });

export type Element = z.infer<typeof ElementSchema>;
export type Gender = z.infer<typeof GenderSchema>;
export type GenderRatio = z.infer<typeof GenderRatioSchema>;
export type Species = z.infer<typeof SpeciesSchema>;
export type SpecialCombo = z.infer<typeof SpecialComboSchema>;
export type Passive = z.infer<typeof PassiveSchema>;
export type PassiveModel = z.infer<typeof PassiveModelSchema>;
export type DatasetMeta = z.infer<typeof DatasetMetaSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;

/** Stable internal species id (e.g. "Relaxaurus_Lux"). */
export type SpeciesId = string;

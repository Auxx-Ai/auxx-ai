// packages/lib/src/dedup/config.ts

import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { Band, DedupConfig, SignalType } from './types'

/**
 * Entity types the v1 engine scans.
 *
 * The engine is entity-agnostic — `deriveMatchKeys` derives strong keys from
 * field types and `isUnique` for ANY definition — but v1 rolls out behind an
 * explicit allowlist rather than "any def with a strong key". Widening later is
 * a one-line change here plus honouring {@link DEDUP_DENYLIST}; custom entities
 * join in that second step, not in v1.
 *
 * `company` is the post-migration `EntityDefinition.entityType` for company
 * definitions — `004-company.ts` upgrades template-installed and user-created
 * company defs (which carry a NULL entityType) onto it.
 */
export const DEDUP_V1_ALLOWLIST: readonly string[] = ['contact', 'company']

/**
 * Entity types that must NEVER be scanned, whatever the default becomes.
 *
 * These are not user-mergeable records: `user` would qualify on the type-driven
 * rule (it has an email field) but merging two users is an auth-layer
 * operation, not a CRM one; `thread` and `entity_group` have no merge path at
 * all; and `inbox` / `personal_inbox` are mail INFRASTRUCTURE definitions whose
 * rows back channel routing.
 *
 * This list only becomes load-bearing when the allowlist above is replaced by a
 * derived default. It ships now so the flip cannot forget it.
 */
export const DEDUP_DENYLIST: readonly string[] = [
  'user',
  'thread',
  'entity_group',
  'inbox',
  'personal_inbox',
]

/**
 * systemAttributes treated as STRONG exact keys regardless of their field type.
 *
 * `company_domain` is the whole reason this list exists: it is a plain TEXT
 * field with no `unique` capability (nothing anywhere enforces it — the field
 * description claiming "Unique per organization" is simply wrong), so the
 * type-driven rule would skip the single highest-yield company signal.
 */
export const STRONG_KEY_SYSTEM_ATTRIBUTES: readonly SystemAttribute[] = ['company_domain']

/**
 * Email local-parts that address a ROLE, not a person. Two contacts sharing
 * `info@acme.com` are usually two humans behind one mailbox, so an exact match
 * on one of these is downgraded: it needs a second signal before it can pair.
 *
 * Kept as an explicit denylist rather than inverse-frequency weighting. That
 * alternative solves a PRECISION problem the denylist plus {@link BLOCK_CAP}
 * already handle, while this feature's real difficulty is RECALL. Inverse
 * frequency is reserved for the one job where it is decisive — surname rarity.
 */
export const ROLE_EMAIL_LOCALS: ReadonlySet<string> = new Set([
  'abuse',
  'accounting',
  'accounts',
  'admin',
  'administrator',
  'billing',
  'careers',
  'contact',
  'customerservice',
  'enquiries',
  'feedback',
  'finance',
  'general',
  'hello',
  'help',
  'helpdesk',
  'hr',
  'info',
  'inquiries',
  'invoice',
  'invoices',
  'it',
  'jobs',
  'legal',
  'mail',
  'marketing',
  'newsletter',
  'no-reply',
  'noreply',
  'notifications',
  'office',
  'orders',
  'postmaster',
  'privacy',
  'procurement',
  'purchasing',
  'reception',
  'sales',
  'security',
  'service',
  'shop',
  'support',
  'team',
  'webmaster',
])

/**
 * Default cap on how many records a single blocking VALUE may return before the
 * value is discarded entirely.
 *
 * A shared reception phone line, a placeholder domain, or a mis-imported
 * default address can sit on hundreds of records; pairing them would be
 * O(n²) rows of noise. Per-type overrides live on {@link DedupConfig.blockCap}.
 */
export const BLOCK_CAP = 20

/**
 * Score contribution per signal type, in `[0, 1]`. `scorePair` sums the
 * distinct signals and clamps to 1.
 *
 * Calibrated so any single STRONG signal clears {@link BAND_THRESHOLDS.high} on
 * its own, a bare name match lands exactly on the medium floor, and no
 * combination of corroborating signals can reach high without a strong or
 * name signal present.
 *
 * These are starting values to be tuned against real data behind the feature
 * flag — not measured constants.
 */
export const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  /** Exact shared address. Enforced org-wide since migration 084, so a hit is a backfill row or an enforcement leak. */
  email: 0.9,
  /** Exact shared E.164 number. Deliberately never unique (households, shared lines), so this is the steady exact producer. */
  phone: 0.9,
  /** Exact match on a field carrying `capabilities.unique`. Check-then-write with no DB constraint, so a hit means a leak. */
  unique: 0.9,
  /** Overlapping `RecordIdentity` rows — the same externalId under two connections. */
  identity: 0.9,
  /** Structured given+surname match. Never a raw `displayName` trigram score. */
  name: 0.5,
  /** Shared employer / company relationship. */
  company: 0.2,
  /** Shared normalized address. */
  address: 0.2,
  /** Both records' `firstInteractionAt` on the same second. Corroborating only. */
  ingest: 0.2,
}

/**
 * Weight of a signal whose `strength` is `corroborating`, per type.
 *
 * 🔴 **A signal's TYPE is not enough to weigh it.** `identity` is worth
 * {@link SIGNAL_WEIGHTS}`.identity` when it means "the same external id under
 * two connections" and almost nothing when it means "these two records were
 * synced from different systems". The `strength` field already carries that
 * distinction — `scorePair` reads it rather than letting a corroborating
 * `identity` signal score like a strong one and push a pair to `high` on its own.
 *
 * Types absent here fall back to {@link CORROBORATION_WEIGHT}.
 */
export const CORROBORATING_WEIGHTS: Partial<Record<SignalType, number>> = {}

/** Default weight for a corroborating signal — see {@link CORROBORATING_WEIGHTS}. */
export const CORROBORATION_WEIGHT = 0.2

/**
 * Ceiling on the TOTAL contribution of corroborating signals to one pair.
 *
 * 🔴 **Without it, piling on corroborators reaches `high`.** A name match (0.5)
 * plus a shared employer, a shared address, complementary identity sources and a
 * same-second `firstInteractionAt` sums to 1.3 — clamped to 1, which is `high`,
 * a band that is supposed to mean "a strong exact key matched". Two contacts at
 * the same company, the same address and the same ingest event are exactly the
 * shape of two REAL colleagues, so that is the wrong direction to fail in.
 * Capped at 0.3, the most a name-only pair can score is 0.8 — comfortably
 * `medium`, and `high` stays reserved for exact keys.
 */
export const MAX_CORROBORATION_SCORE = 0.3

/** Minimum score for each band. A pair below `medium` is not stored. */
export const BAND_THRESHOLDS: Record<Band, number> = {
  high: 0.9,
  medium: 0.5,
}

/**
 * Minimum `pg_trgm` similarity for two SURNAMES to count as the same surname.
 *
 * 0.6 is a typo threshold, not a similarity threshold: `klooth`/`kloth` measures
 * 0.625 and passes, while unrelated surnames of similar length sit far below it.
 * Surnames are the one place trigram is genuinely good — `klooth`/`klooth` = 1.0,
 * `klooth`/`kloth` = 0.625 — which is exactly why it is used HERE and nowhere
 * else in the name rule. Given names get `nicknames.ts` instead, because
 * `bob`/`robert` and `peggy`/`margaret` share zero trigrams.
 */
export const SURNAME_TRIGRAM_THRESHOLD = 0.6

/**
 * A surname held by no more than this many records is rare in ANY org, however
 * small.
 *
 * The floor exists so a young org is not excluded from the rule by arithmetic: a
 * share-based test alone would need 500 contacts before a single surname could
 * clear it, and a 40-contact org with two Kloothes has exactly the duplicate
 * this feature is for.
 */
export const SURNAME_RARE_MIN_COUNT = 3

/**
 * …and in a large org, a surname is rare while it stays under this share of the
 * definition's named records.
 *
 * The absolute floor alone would stop firing as an org grows (a 50k-contact org
 * has more than three of most surnames); the share keeps the rule scaling with
 * the corpus. Whichever bound is more generous wins — see `surnameIdf`.
 */
export const SURNAME_RARE_MAX_SHARE = 0.002

/**
 * How many fuzzy neighbours the trigram blocker returns per anchor.
 *
 * 🔴 **Raised from 5 after Phase 5 verification.** The original value came with
 * the reasoning "a record with more than five plausible name neighbours is a
 * common name, which the surname-rarity condition rejects anyway" — which is
 * false for exactly the case the plan requires: `Bob Smith` / `Robert Smith`
 * reaches `medium` through CORROBORATION, not rarity, and corroboration cannot
 * rescue a pair the blocker never generated. Measured on dev: 19 Smiths truncate
 * at 5, and Robert was not among them.
 *
 * Widening is close to free because `evaluateFuzzyPair` compares the structured
 * names in JS first and bails before its corroboration queries: a candidate that
 * is not a name match costs one map lookup. Precision still comes from the
 * comparator and the rarity condition, never from starving the blocker.
 */
export const FUZZY_BLOCK_LIMIT = 20

/**
 * Cap on the EXACT-surname anchor pass (`blockSurnameRecord`).
 *
 * The trigram blocker orders by similarity to the whole query string, so on a
 * common surname the true same-surname candidates compete with — and lose to —
 * trigram neighbours that merely look alike. The exact-surname pass removes that
 * competition entirely by asking the surname field directly, and it needs a
 * bound of its own because "every record called Smith" is unbounded.
 *
 * Higher than {@link FUZZY_BLOCK_LIMIT} on purpose: these candidates already
 * satisfy condition (a) of the name rule, so the only thing left to decide is
 * the given name — the cheapest possible filter.
 */
export const SURNAME_ANCHOR_LIMIT = 50

/**
 * Per-entity-type dedup tuning, mirroring the `HOOKS_BY_ENTITY_TYPE` registry
 * shape in `resources/hooks/system-hooks.ts`.
 *
 * When adding an entity type:
 *  1. add its `DedupConfig` here,
 *  2. add its `entityType` to {@link DEDUP_V1_ALLOWLIST},
 *  3. confirm it is not in {@link DEDUP_DENYLIST}.
 */
export const DEDUP_CONFIG_BY_ENTITY_TYPE: Record<string, DedupConfig> = {
  contact: {
    entityType: 'contact',
    // Contacts get their strong keys from field TYPES (EMAIL, PHONE_INTL) plus
    // `primary_email`'s `unique` capability — nothing needs promoting by hand.
    strongKeySystemAttributes: [],
    givenNameSystemAttribute: 'first_name',
    surnameSystemAttribute: 'last_name',
    blockCap: BLOCK_CAP,
  },
  company: {
    entityType: 'company',
    strongKeySystemAttributes: STRONG_KEY_SYSTEM_ATTRIBUTES,
    blockCap: BLOCK_CAP,
  },
}

/**
 * Resolve the dedup config for an entity type, or `null` when the type is not
 * scanned.
 *
 * Three ways to get `null`, and the order matters: the denylist is checked
 * BEFORE the allowlist so a denied type can never be scanned even if someone
 * adds it to the allowlist by mistake.
 *
 * @param entityType - `EntityDefinition.entityType`; `null` for org-created
 *   definitions, which are never scanned in v1.
 *
 * @example
 * ```typescript
 * getDedupConfig('contact')      // → DedupConfig
 * getDedupConfig('user')         // → null (denylisted)
 * getDedupConfig('ticket')       // → null (not allowlisted)
 * getDedupConfig(null)           // → null (custom definition)
 * ```
 */
export function getDedupConfig(entityType: string | null): DedupConfig | null {
  if (!entityType) return null
  if (DEDUP_DENYLIST.includes(entityType)) return null
  if (!DEDUP_V1_ALLOWLIST.includes(entityType)) return null
  return DEDUP_CONFIG_BY_ENTITY_TYPE[entityType] ?? null
}

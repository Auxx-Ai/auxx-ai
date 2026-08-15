// packages/lib/src/dedup/scoring.ts
//
// Pure — no db, no I/O. Turns evidence into a score, a band, and a
// canonically-ordered pair.

import type { BlockGroup, BlockMatch, IdentityGroup } from './blocking'
import {
  BAND_THRESHOLDS,
  CORROBORATING_WEIGHTS,
  CORROBORATION_WEIGHT,
  MAX_CORROBORATION_SCORE,
  SIGNAL_WEIGHTS,
} from './config'
import type { Band, CandidatePair, Signal, SignalType } from './types'

/** A {@link CandidatePair} the scorer has accepted, ready for `upsertPairs`. */
export interface ScoredPair extends CandidatePair {
  score: number
  band: Band
}

/** The weight one signal is worth, which depends on its STRENGTH as well as its type. */
function weightFor(signal: Signal): number {
  if (signal.strength === 'corroborating') {
    return CORROBORATING_WEIGHTS[signal.type] ?? CORROBORATION_WEIGHT
  }
  return SIGNAL_WEIGHTS[signal.type] ?? 0
}

/**
 * Weighted sum of the DISTINCT signal types present, clamped to 1.
 *
 * Distinct *types*, not distinct signals: two shared email addresses are one
 * fact about the pair, not two, and letting the same evidence stack would let a
 * multi-value field manufacture confidence out of one match. A type carrying
 * both a strong and a corroborating signal counts once, at the higher weight.
 *
 * Three properties this function holds, each of which is load-bearing:
 *
 *  1. **Strength is read, not just type.** `identity` means "the same external
 *     id under two connections" when it is `strong` (0.9, `high` unaided) and
 *     "these two records came from different systems" when it is
 *     `corroborating` (0.2). Weighing by type alone would let the second push a
 *     pair to `high` on its own.
 *  2. **Corroboration alone scores ZERO.** Not "a little" — zero. A corroborating
 *     signal only ever promotes a strong or fuzzy one; three of them summing
 *     past the medium floor would make "same company + same address + same
 *     ingest event" suggest a merge for two genuine colleagues.
 *  3. **Corroboration is capped** at {@link MAX_CORROBORATION_SCORE}, so a name
 *     match plus every corroborator we have still lands in `medium`. `high`
 *     means an exact key matched, and nothing else may reach it.
 *
 * The similarity value of a fuzzy blocker is never an input here. Full-name
 * trigram scores `john smith`/`jane smith` (0.4666667) ABOVE `william
 * klooth`/`bill klooth` (0.4210526) — measured — because the surname dominates.
 * If that number ever reaches this function the queue leads with siblings and
 * spouses.
 */
export function scoreSignals(signals: Signal[]): number {
  const anchored = new Map<SignalType, number>()
  const corroborating = new Map<SignalType, number>()

  for (const signal of signals) {
    const target = signal.strength === 'corroborating' ? corroborating : anchored
    const weight = weightFor(signal)
    target.set(signal.type, Math.max(target.get(signal.type) ?? 0, weight))
  }

  // Nothing to promote → nothing to score.
  if (anchored.size === 0) return 0

  let score = 0
  for (const weight of anchored.values()) score += weight

  let support = 0
  for (const [type, weight] of corroborating) {
    if (anchored.has(type)) continue
    support += weight
  }
  score += Math.min(support, MAX_CORROBORATION_SCORE)

  return Math.min(score, 1)
}

/**
 * Band for a score, or `null` when the pair is not worth a human's attention.
 *
 * A pair we would not ask someone to look at is a pair we do not store — there
 * is deliberately no `low`.
 */
export function bandForScore(score: number): Band | null {
  if (score >= BAND_THRESHOLDS.high) return 'high'
  if (score >= BAND_THRESHOLDS.medium) return 'medium'
  return null
}

/**
 * Score one canonically-ordered pair. Returns `null` below the medium floor.
 *
 * **`high` comes from the exact engine, `medium` from the name rule.** Every
 * signal `blocking.ts` emits is `strong`, and `SIGNAL_WEIGHTS` is calibrated so
 * any one of them clears the high threshold unaided. A `name` signal weighs
 * exactly the medium floor, so it lands on `medium` alone, and corroboration —
 * capped at {@link MAX_CORROBORATION_SCORE} — can lift it within `medium`
 * without ever reaching `high`.
 *
 * 🔴 **The name rule is NOT implemented here, and must never be.** This function
 * stays a pure weighted sum over distinct signal types; whether a `name` signal
 * is warranted at all — equivalent given names AND a near-exact surname AND
 * either a surname rare in this org or a corroborating signal — is decided by
 * `decideNameSignal` before the signal is ever constructed. That keeps "medium"
 * a statement about evidence rather than a threshold to tune around, and it is
 * why `bob smith`/`robert smith` and `bill klooth`/`william klooth` can land in
 * different places while producing the same shape of pair here.
 */
export function scorePair(pair: CandidatePair): ScoredPair | null {
  const score = scoreSignals(pair.signals)
  const band = bandForScore(score)
  if (!band) return null
  return { ...pair, score, band }
}

/**
 * Flip a self-oriented signal onto the canonical low/high axis.
 *
 * Blocking emits `value` = the scanned record's value. Storage wants `value` =
 * the LOW record's value, so when the scanned record turns out to be the HIGH
 * one the two sides swap. Exact matches share one value and are unaffected;
 * only the Gmail-fold case (and, later, fuzzy names) actually differs.
 */
function orientSignal(signal: Signal, swap: boolean): Signal {
  if (!swap || signal.otherValue === undefined) return signal
  return { ...signal, value: signal.otherValue, otherValue: signal.value }
}

/**
 * Build the canonical pair for one blocking match.
 *
 * `instanceIdLow` < `instanceIdHigh` by string comparison. This is a STORAGE
 * invariant, not a display preference: it is the only reason `(A,B)` and
 * `(B,A)` collapse onto one row via `DuplicateSuggestion_org_def_pair_key`
 * instead of showing every duplicate twice.
 */
export function toCandidatePair(params: {
  organizationId: string
  entityDefinitionId: string
  /** The scanned record — either side of the canonical pair. */
  instanceId: string
  match: BlockMatch
}): CandidatePair | null {
  const { organizationId, entityDefinitionId, instanceId, match } = params
  if (match.instanceId === instanceId) return null

  const swap = instanceId > match.instanceId
  return {
    organizationId,
    entityDefinitionId,
    instanceIdLow: swap ? match.instanceId : instanceId,
    instanceIdHigh: swap ? instanceId : match.instanceId,
    signals: match.signals.map((s) => orientSignal(s, swap)),
  }
}

/**
 * Score every candidate found for one record. The per-record scan path:
 * `deriveMatchKeys` → `blockRecord` → here → `upsertPairs`.
 */
export function scoreRecordMatches(params: {
  organizationId: string
  entityDefinitionId: string
  instanceId: string
  matches: BlockMatch[]
}): ScoredPair[] {
  const scored: ScoredPair[] = []
  for (const match of params.matches) {
    const pair = toCandidatePair({ ...params, match })
    if (!pair) continue
    const result = scorePair(pair)
    if (result) scored.push(result)
  }
  return scored
}

/**
 * Expand an org-wide blocking bucket into every pair it contains.
 *
 * A bucket of `n` records is `n·(n-1)/2` pairs — which is exactly why
 * `blockOrgKey` refuses to return a bucket above the cap.
 */
export function scoreBlockGroup(params: {
  organizationId: string
  entityDefinitionId: string
  group: BlockGroup
}): ScoredPair[] {
  const { group } = params
  const signal: Signal = { ...group.signal, value: group.value }
  return expandGroup(params.organizationId, params.entityDefinitionId, group.instanceIds, [signal])
}

/**
 * Expand a `RecordIdentity` collision into pairs.
 *
 * `Signal.value` carries `source:externalId` — the identity that collided —
 * because "matched on: identity" alone cannot tell a reviewer WHICH external
 * system said these are the same customer.
 */
export function scoreIdentityGroup(params: {
  organizationId: string
  entityDefinitionId: string
  group: IdentityGroup
}): ScoredPair[] {
  const { group } = params
  const signal: Signal = {
    type: 'identity',
    strength: 'strong',
    value: `${group.source}:${group.externalId}`,
  }
  return expandGroup(params.organizationId, params.entityDefinitionId, group.instanceIds, [signal])
}

/** Every unordered pair from a bucket, canonicalized and scored. */
function expandGroup(
  organizationId: string,
  entityDefinitionId: string,
  instanceIds: string[],
  signals: Signal[]
): ScoredPair[] {
  const ids = [...new Set(instanceIds)].sort()
  const scored: ScoredPair[] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const result = scorePair({
        organizationId,
        entityDefinitionId,
        instanceIdLow: ids[i] as string,
        instanceIdHigh: ids[j] as string,
        signals,
      })
      if (result) scored.push(result)
    }
  }
  return scored
}

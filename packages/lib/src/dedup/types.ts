// packages/lib/src/dedup/types.ts

import type { SystemAttribute } from '@auxx/types/system-attribute'

/**
 * Confidence band for a scored pair.
 *
 *  - `high`   — a strong exact key matched (email, E.164 phone, an `isUnique`
 *               field, a systemAttribute identifier such as `company_domain`,
 *               or overlapping `RecordIdentity` rows).
 *  - `medium` — fuzzy evidence plus at least one corroborating signal, OR the
 *               name-alone rule (equivalent given names + near-exact surname +
 *               a surname that is rare in this org).
 *
 * There is deliberately no `low`: a pair we would not ask a human to look at is
 * a pair we do not store.
 */
export type Band = 'high' | 'medium'

/** Lifecycle of a stored pair. Snoozed is `open` plus a future `snoozeUntil`, not a status. */
export type DuplicateStatus = 'open' | 'dismissed' | 'merged'

/**
 * What kind of evidence a {@link Signal} represents. Drives both the weight
 * applied by the scorer and the "matched on:" chip rendered in the UI.
 */
export type SignalType =
  | 'email'
  | 'phone'
  | 'unique'
  | 'name'
  | 'company'
  | 'address'
  | 'identity'
  /**
   * Both records' `firstInteractionAt` land on the same SECOND — they were
   * almost certainly created by one ingest event. Corroborating only, and the
   * one signal type that comes from neither a field nor a `RecordIdentity` row.
   */
  | 'ingest'

/**
 * How much a signal is allowed to move the score on its own.
 *
 *  - `strong`        — sufficient for `high` unaided.
 *  - `fuzzy`         — never sufficient alone except under the name-alone rule.
 *  - `corroborating` — never sufficient alone, ever; it only promotes fuzzy
 *                      evidence.
 */
export type SignalStrength = 'strong' | 'fuzzy' | 'corroborating'

/**
 * One piece of evidence that two records are the same entity.
 *
 * **A Signal always carries the matched VALUE, not just the field.** Contact
 * `primary_email`, contact `phone` and company `website` are multi-value: a
 * contact can hold up to `MAX_MULTI_VALUES` addresses, and a pair may well have
 * matched on a non-primary alias. "matched on: email" cannot say *which*
 * address, which is exactly the fact a reviewer needs before merging.
 */
export interface Signal {
  type: SignalType
  strength: SignalStrength
  /**
   * The normalized value that produced the match — the shared value for exact
   * signals, and the LOW record's value for fuzzy ones (see {@link otherValue}).
   */
  value: string
  /**
   * The HIGH record's value, present only when the two sides matched on
   * *different* values (a trigram-tolerant surname, a nickname, a domain-shape
   * variant). Absent for exact matches, where both sides share {@link value}.
   */
  otherValue?: string
  /**
   * `CustomField.key` of the field that produced the match, when one field is
   * responsible. Absent for signals derived from something other than a field
   * (`identity`, which comes from `RecordIdentity` rows).
   */
  fieldKey?: string
  /** `CustomField.systemAttribute`, when the producing field has one. */
  systemAttribute?: SystemAttribute
}

/**
 * A pair the engine wants to score or store, in CANONICAL order —
 * `instanceIdLow` < `instanceIdHigh` by string comparison. Canonicalization is
 * what collapses `(A,B)` and `(B,A)` onto one `DuplicateSuggestion` row; it is a
 * storage invariant, not a display preference.
 */
export interface CandidatePair {
  organizationId: string
  entityDefinitionId: string
  instanceIdLow: string
  instanceIdHigh: string
  signals: Signal[]
}

/**
 * Per-entity-type dedup tuning. The engine itself is entity-agnostic —
 * `deriveMatchKeys` works off field types and `isUnique` for any definition —
 * so this config only carries what cannot be derived from the field registry.
 *
 * Resolved through `getDedupConfig(entityType)`; a type with no entry is not
 * scanned in v1.
 */
export interface DedupConfig {
  /** `EntityDefinition.entityType` this config applies to. */
  entityType: string
  /**
   * systemAttributes promoted to STRONG exact keys even though their field type
   * would not qualify. `company_domain` is a plain TEXT field, so the
   * type-driven rule alone would miss the companies' single best signal.
   */
  strongKeySystemAttributes: readonly SystemAttribute[]
  /**
   * The structured name parts the Phase-2 scorer compares. Comparing the
   * concatenated `displayName` throws away exactly the structure that makes the
   * decision — surname and given name need different comparators. Absent for
   * definitions with no person-name shape (companies).
   */
  givenNameSystemAttribute?: SystemAttribute
  surnameSystemAttribute?: SystemAttribute
  /**
   * Maximum records a single blocking VALUE may return before the value is
   * discarded as too common (a shared reception line, `info@`, a placeholder
   * domain). Overrides {@link BLOCK_CAP} for types that need a different bound.
   */
  blockCap: number
}

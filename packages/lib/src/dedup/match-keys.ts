// packages/lib/src/dedup/match-keys.ts

import type { FieldType } from '@auxx/database/types'
import type { FieldId } from '@auxx/types/field'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { MAX_MULTI_VALUES } from '../field-values/primary-value'
import { type StoredFieldType, toFieldType } from '../field-values/stored-field-type'
import type { ResourceField } from '../resources/registry/field-types'
import { STRONG_KEY_SYSTEM_ATTRIBUTES } from './config'
import type { DedupConfig, SignalType } from './types'

/**
 * Which `FieldValue` column a match key's values live in.
 *
 * Only the two scalar columns a real identifier field ever uses. A field whose
 * value lands in `optionId` / `relatedEntityId` / `valueJson` is not a usable
 * exact key: the stored cell is an id or a blob, so "the same value" is not a
 * question the blocking query can ask without resolving the referent first.
 * Those fields are skipped by {@link deriveMatchKeys} rather than half-supported.
 */
export type MatchKeyColumn = 'valueText' | 'valueNumber'

/**
 * One field the engine will block on, with everything blocking and signal
 * provenance need — resolved once per definition, then reused per record.
 */
export interface MatchKey {
  /** `CustomField.id` — what `FieldValue.fieldId` holds. */
  fieldId: FieldId
  /** `CustomField.key`, carried into {@link Signal.fieldKey} for the UI chip. */
  fieldKey: string
  /** Folded field type (legacy `PHONE` rows arrive as `PHONE_INTL`). */
  fieldType: FieldType
  systemAttribute?: SystemAttribute
  /** The `Signal.type` a match on this key produces. */
  signalType: Extract<SignalType, 'email' | 'phone' | 'unique'>
  column: MatchKeyColumn
  /**
   * `options.multi` — the field holds up to {@link MAX_MULTI_VALUES} values.
   *
   * **This flag is what tells blocking to fan out.** Contact `primary_email`,
   * contact `phone` and company `website` are all multi now: a record
   * contributes one blocking candidate PER VALUE, not per field, and a pair that
   * matches on a non-primary alias is a duplicate exactly like a primary match.
   * Blocking only the primary silently misses a large share of real duplicates.
   */
  multi: boolean
  /** Hard bound on values read from this field — 1 for single-value fields. */
  maxValues: number
}

/**
 * `FieldValue` column per field type, for the types that can carry an exact key.
 * Anything absent here is not blockable — see {@link MatchKeyColumn}.
 */
const COLUMN_BY_FIELD_TYPE: Partial<Record<FieldType, MatchKeyColumn>> = {
  EMAIL: 'valueText',
  PHONE_INTL: 'valueText',
  URL: 'valueText',
  TEXT: 'valueText',
  RICH_TEXT: 'valueText',
  NAME: 'valueText',
  ADDRESS: 'valueText',
  NUMBER: 'valueNumber',
}

/**
 * Signal type produced by a match on a given field type. Everything that is not
 * an address or a phone number reports as `unique` — including `company_domain`,
 * whose weight is the same and whose provenance is carried by
 * {@link MatchKey.systemAttribute} anyway.
 */
function signalTypeFor(fieldType: FieldType): MatchKey['signalType'] {
  if (fieldType === 'EMAIL') return 'email'
  if (fieldType === 'PHONE_INTL') return 'phone'
  return 'unique'
}

/**
 * Derive the STRONG exact match keys for one entity definition.
 *
 * Three independent reasons a field qualifies, in the order they are checked:
 *
 *  1. **Field type** — `EMAIL` and `PHONE_INTL`. Phone is deliberately never
 *     `isUnique` (households and companies share a line, and arming the gate
 *     would 409 ordinary ingest writes), which is precisely why it is the
 *     steady exact producer: there is no write-time guarantee at all.
 *  2. **`isUnique`** — check-then-write with no DB constraint, only covering
 *     rows written after the flag was set, and per-field rather than per-value.
 *     The block usually finds nothing; a hit means an enforcement leak.
 *  3. **`systemAttribute` promotion** — `company_domain` is a plain TEXT field
 *     with no `unique` capability, so rules 1 and 2 would both skip the single
 *     highest-yield company signal.
 *
 * Reads nothing: the caller passes the fields it already has from
 * `getCachedResourceFields`, so a scan of N records costs one cache read, not N
 * field queries.
 *
 * @param fields - `ResourceField[]` for the definition, from
 *   `getCachedResourceFields(orgId, entityDefinitionId)`.
 * @param config - Optional per-type config. Its `strongKeySystemAttributes`
 *   narrows rule 3 to the promotions that type actually wants; omitted, the
 *   global {@link STRONG_KEY_SYSTEM_ATTRIBUTES} list applies (harmless, since a
 *   definition without the field simply has no such field to promote).
 *
 * @example
 * ```typescript
 * const fields = await getCachedResourceFields(orgId, defId)
 * const keys = deriveMatchKeys(fields, getDedupConfig('contact') ?? undefined)
 * // → [{ signalType: 'email', multi: true, … }, { signalType: 'phone', multi: true, … }]
 * ```
 */
export function deriveMatchKeys(fields: ResourceField[], config?: DedupConfig): MatchKey[] {
  const promoted = new Set<string>(
    config?.strongKeySystemAttributes ?? STRONG_KEY_SYSTEM_ATTRIBUTES
  )

  const keys: MatchKey[] = []
  const seen = new Set<string>()

  for (const field of fields) {
    if (field.active === false) continue
    if (!field.fieldType) continue

    const fieldType = toFieldType(field.fieldType as StoredFieldType)
    const column = COLUMN_BY_FIELD_TYPE[fieldType]
    if (!column) continue

    const isTypeDriven = fieldType === 'EMAIL' || fieldType === 'PHONE_INTL'
    const isUnique = field.isUnique === true || field.capabilities?.unique === true
    const isPromoted = !!field.systemAttribute && promoted.has(field.systemAttribute)
    if (!isTypeDriven && !isUnique && !isPromoted) continue

    // A field can qualify under two rules at once (contact `primary_email` is
    // both EMAIL-typed and `isUnique`); it is still ONE key, and the type-driven
    // signal type wins so the chip says "email" rather than "unique".
    if (seen.has(field.id)) continue
    seen.add(field.id)

    const multi = field.options?.multi === true
    keys.push({
      fieldId: field.id,
      fieldKey: field.key,
      fieldType,
      systemAttribute: field.systemAttribute,
      signalType: signalTypeFor(fieldType),
      column,
      multi,
      maxValues: multi ? MAX_MULTI_VALUES : 1,
    })
  }

  return keys
}

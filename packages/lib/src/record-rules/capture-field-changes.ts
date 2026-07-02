// packages/lib/src/record-rules/capture-field-changes.ts
// Shared old→new field-change capture for bulk writers (connector sink + CSV import,
// B2 §2b/§5a). Given a writeSet keyed by CustomField uuid AND/OR systemAttribute, reads
// the pre-write values for the subscribed intersection and returns `{o, n}` entries
// keyed by the manifest OUTPUT KEY (`systemAttribute ?? field.id` — the same key the
// consumer's `buildFieldKeyMap` resolves rule fieldIds to, and the key space
// `fetchResourceSnapshots` uses). `n` is normalized through the write path's own
// validators into the stored/flattened value space so transition matching compares
// like with like (raw source date vs stored ISO, unlowercased email, `{recordId}`
// wrapper vs bare id, …). Lazy-imports cache + field-value helpers so callers that
// never capture (no subscriptions) don't load them.

import type { Database } from '@auxx/database'
import { buildWriteKeyToFieldIdMap } from '../field-values/write-key-map'
import type { ManifestFieldChange } from './sync-manifest-types'

/** Which writeSet keys map to a subscribed CustomField row id, + that row's field. */
async function subscribedWrittenKeys(
  organizationId: string,
  entityDefinitionId: string,
  writeSet: Record<string, unknown>,
  subscribedFieldIds: ReadonlySet<string>
): Promise<{ subscribed: Array<{ key: string; rowId: string }>; fieldMap: Map<string, any> }> {
  const { getCachedFieldMap } = await import('../cache')
  const fieldMap = await getCachedFieldMap(organizationId, entityDefinitionId)

  // writeSet keys are `systemAttribute ?? id` — resolve both forms to the row id.
  const writeKeyToId = buildWriteKeyToFieldIdMap(fieldMap.values())

  const subscribed: Array<{ key: string; rowId: string }> = []
  for (const key of Object.keys(writeSet)) {
    const rowId = writeKeyToId.get(key)
    if (rowId && subscribedFieldIds.has(rowId)) subscribed.push({ key, rowId })
  }
  return { subscribed, fieldMap }
}

/**
 * The manifest key the consumer looks a rule's field up under: `systemAttribute ??
 * field.id`. Matches `getFieldOutputKey` for entity-def fields (whose ResourceField
 * `key` IS the row id) — the connector sink keys its writeSet by bare uuid, so storing
 * entries under the raw write key would strand every systemAttribute-carrying field
 * (the consumer would look up `email`, find only `fld_…`, and skip the rule).
 */
function outputKeyFor(field: { id: string; systemAttribute?: string | null }): string {
  return field.systemAttribute ?? field.id
}

/**
 * Normalize a written raw value into the flattened STORED value space (`o`'s space):
 * run it through the write path's own `validateAndConvertValue` (date → ISO, email →
 * lowercased, number coercion, `{recordId}` → typed relationship, …) and flatten like
 * `flattenTypedFieldValue` does for read-back values. Referential checks are the write
 * path's job — relationship validation is short-circuited so no per-value query is
 * issued here. Falls back to the raw value when validation rejects it (the write
 * itself will surface that failure).
 */
async function makeWrittenValueNormalizer(
  db: Database | undefined,
  organizationId: string
): Promise<(field: { id: string; type: string }, raw: unknown) => Promise<unknown>> {
  const { createFieldValueContext, validateAndConvertValue, flattenTypedFieldValue } = await import(
    '../field-values/field-value-helpers'
  )
  const { toActorId } = await import('@auxx/types/actor')

  const ctx = createFieldValueContext(organizationId, undefined, db)
  // Capture compares value SPACES, not referential validity — pretend every
  // relationship target is valid so `validateSingleValue` never hits the DB.
  ctx.batchRelationshipValidationCache = {
    has: () => true,
    get: () => ({ success: true }),
  } as never

  const flatten = (v: unknown): unknown => {
    if (v == null) return null
    if (Array.isArray(v)) return v.map(flatten)
    const typed = v as { type?: string; actorType?: string; id?: string }
    // TypedFieldValueInput actors carry `{actorType, id}` (no composed actorId, unlike
    // stored rows) — compose it so `n` matches the flattened stored `o` (`user:xxx`).
    if (typed.type === 'actor' && typed.actorType && typed.id != null) {
      return toActorId(typed.actorType as never, typed.id)
    }
    return flattenTypedFieldValue(v as never)
  }

  return async (field, raw) => {
    try {
      const typed = await validateAndConvertValue(ctx, raw, field.type as never, field as never)
      return flatten(typed)
    } catch {
      return raw
    }
  }
}

/**
 * Capture an UPDATE's subscribed field changes. Reads existing values via
 * `batchGetExistingFieldValues` (one query) and pairs each with its written value.
 * MUST be called BEFORE the write. Returns null when nothing subscribed is written.
 */
export async function captureUpdateFieldChanges(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  instanceId: string,
  writeSet: Record<string, unknown>,
  subscribedFieldIds: ReadonlySet<string>
): Promise<Record<string, ManifestFieldChange> | null> {
  if (subscribedFieldIds.size === 0) return null
  const { subscribed, fieldMap } = await subscribedWrittenKeys(
    organizationId,
    entityDefinitionId,
    writeSet,
    subscribedFieldIds
  )
  if (subscribed.length === 0) return null

  const { batchGetExistingFieldValues } = await import('../field-values/batch-existing-values')
  const { flattenTypedFieldValue } = await import('../field-values/field-value-helpers')
  const existing = await batchGetExistingFieldValues(
    { db, organizationId },
    [instanceId],
    subscribed.map((s) => s.rowId),
    fieldMap
  )
  const inner = existing.get(instanceId)
  const normalize = await makeWrittenValueNormalizer(db, organizationId)

  const entries: Record<string, ManifestFieldChange> = {}
  for (const { key, rowId } of subscribed) {
    const field = fieldMap.get(rowId)
    if (!field) continue
    entries[outputKeyFor(field)] = {
      o: flattenTypedFieldValue(inner?.get(rowId) ?? null),
      n: await normalize(field, writeSet[key]),
    }
  }
  return entries
}

/**
 * Capture a CREATE's subscribed field writes (no `o` — the row is new), so `set` field
 * rules fire on synced/imported creates. No DB read. Returns null when nothing subscribed
 * is written. NOTE: `o`-absence is the manifest's "created this run" marker — the fold
 * (`mergeFieldChange`) and the consumer both rely on it; never emit `o` here.
 */
export async function captureCreateFieldChanges(
  organizationId: string,
  entityDefinitionId: string,
  writeSet: Record<string, unknown>,
  subscribedFieldIds: ReadonlySet<string>
): Promise<Record<string, ManifestFieldChange> | null> {
  if (subscribedFieldIds.size === 0) return null
  const { subscribed, fieldMap } = await subscribedWrittenKeys(
    organizationId,
    entityDefinitionId,
    writeSet,
    subscribedFieldIds
  )
  if (subscribed.length === 0) return null
  const normalize = await makeWrittenValueNormalizer(undefined, organizationId)

  const entries: Record<string, ManifestFieldChange> = {}
  for (const { key, rowId } of subscribed) {
    const field = fieldMap.get(rowId)
    if (!field) continue
    entries[outputKeyFor(field)] = { n: await normalize(field, writeSet[key]) }
  }
  return entries
}

/**
 * Capture ALL written values for a CREATE, keyed by systemAttribute and RAW (unnormalized) —
 * the exact shape `extractEventData` produces on the interactive door, so native
 * entity-trigger handlers (`enrichCompanyOnCreate`, etc.) read identical input whether the
 * record was created interactively or by a connector sync. Unlike `captureCreateFieldChanges`
 * (subscribed FIELD rules only), this captures every written field with a systemAttribute, for
 * lifecycle handlers that read arbitrary values. No DB read. Returns null when nothing with a
 * systemAttribute was written.
 */
export async function captureCreatedValues(
  organizationId: string,
  entityDefinitionId: string,
  writeSet: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const { getCachedFieldMap } = await import('../cache')
  const fieldMap = await getCachedFieldMap(organizationId, entityDefinitionId)
  const writeKeyToId = buildWriteKeyToFieldIdMap(fieldMap.values())

  const values: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(writeSet)) {
    const rowId = writeKeyToId.get(key)
    const field = rowId ? fieldMap.get(rowId) : undefined
    if (!field?.systemAttribute) continue
    values[field.systemAttribute] = raw
  }
  return Object.keys(values).length > 0 ? values : null
}

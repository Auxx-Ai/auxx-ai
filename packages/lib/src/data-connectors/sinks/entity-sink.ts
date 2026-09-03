// packages/lib/src/data-connectors/sinks/entity-sink.ts
// The entity sink — the ONLY entity writer (04 §1b). Resolves identity against
// the DataConnectorItem binding (else a match-flag bootstrap), skips
// unchanged records by a sorted-key content hash, applies per-field merge
// strategy, and writes via UnifiedCrudHandler reusing the importer's bulk-upsert
// shape (warmCache once). Owned mode stamps provenance + may archive;
// contributing mode narrows to managedFields and never archives. Unlike the
// importer, events are NOT skipped — workflows/agents react.

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldId, ResourceFieldId } from '@auxx/types/field'
import { getFieldId } from '@auxx/types/field'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { stableHash } from '@auxx/utils/hash'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { resolveConnectorFieldRef } from '../../agents/bindings/resolve'
import { getCachedFieldMap } from '../../cache'
import { UniqueValueConflictError } from '../../errors'
import { fieldValueSchemas } from '../../field-values/field-value-validator'
import { upsertRecordIdentity } from '../../identity'
import { toRecordId } from '../../resources/resource-id'
import { buildWriteKeyToFieldId } from '../field-id-resolver'
import {
  type DecodedMapping,
  findItem,
  findItemByDef,
  listItemsForMapping,
  markItemArchived,
  type PendingRelation,
  setItemPendingRelations,
  touchItem,
  upsertItem,
} from '../service'
import { type SyncFieldShape, wouldHealField } from '../sync-state'
import type { FieldMergeStrategy } from '../types'
import {
  executeRowLevelWrites,
  planRowLevelWrites,
  type RowLevelField,
  type RowLevelWrite,
} from './row-level-writes'
import type { EntitySink, ProjectedRecord, SyncCtx } from './types'

const logger = createScopedLogger('data-connector-entity-sink')

/** Normalize a match value the way the importer's find-existing path expects. */
function normalizeMatch(value: unknown, normalize?: 'email' | 'phone' | 'domain' | 'none'): string {
  const s = String(value ?? '').trim()
  if (normalize === 'email') return s.toLowerCase()
  if (normalize === 'domain')
    return s
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
  return s
}

/** Extract the raw scalar from a TypedFieldValue (for merge comparison). */
function rawOf(v: TypedFieldValue | TypedFieldValue[] | undefined): unknown {
  if (v === undefined) return undefined
  if (Array.isArray(v)) return v.length > 0 ? v : undefined
  const t = v as TypedFieldValue
  if ('value' in t) return (t as { value: unknown }).value
  return undefined
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * Format-validated scalar field types: the write path normalizes these through a
 * zod schema that REJECTS unparseable input (`fieldValueSchemas`), and the
 * rejection surfaces as a bare `Error` from `validateSingleValue` — no field
 * identity, so the write-time catch cannot attribute it and fails the whole
 * record.
 */
const FORMAT_VALIDATED_TYPES: Record<string, keyof typeof fieldValueSchemas> = {
  EMAIL: 'email',
  URL: 'url',
  PHONE_INTL: 'phone',
}

/**
 * Would this scalar value be REJECTED by the write path's format validation?
 *
 * Providers send free-form contact data — a Shopify customer's `phone` is not
 * guaranteed to be a dialable number, and E.164 normalization refuses what it
 * can't parse. Without this pre-flight the throw happens inside
 * `handler.update`, where the catch can only special-case
 * `UniqueValueConflictError`; everything else costs the ENTIRE record (no
 * contact created or updated, just a `failed` counter). Dropping the one value
 * instead mirrors what the row-level multi path already does per value, and
 * keeps the sync green.
 *
 * Scoped to the three format-validated types on purpose: it is a pure zod parse
 * (no ctx, no DB), unlike the relation/file validators.
 */
function rejectsFormat(fieldType: string | undefined, value: unknown): boolean {
  // Arrays have their own guards on both paths (a connector cannot source one);
  // never let `String([…])` decide a drop here.
  if (!fieldType || isBlank(value) || Array.isArray(value)) return false
  const schemaKey = FORMAT_VALIDATED_TYPES[fieldType]
  if (!schemaKey) return false
  return !fieldValueSchemas[schemaKey].safeParse(value).success
}

/** Field types whose value is a LIST, delivered by a connector as a comma string. */
const LIST_VALUED_TYPES = new Set(['TAGS', 'MULTI_SELECT'])

/**
 * Split a connector's comma-delimited string into the list a `TAGS`/`MULTI_SELECT`
 * field actually wants.
 *
 * A connector cannot source an array — the fan-out drops array-shaped source values
 * before this layer (`hasArrayShapedSource`, "connectors cannot source arrays"), and
 * the multi path below drops them again. So the only shape a connector CAN deliver for
 * a list field is a comma string. Without this split that string was written whole, and
 * a two-tag source landed as one compound tag (`'vip, gift'` as a single tag value)
 * — i.e. a connector could never write more than one tag to a tag column.
 *
 * `normalizeFieldValue` already splits a comma string for these types, but the
 * connector write path does not route through it; splitting here hands the write path
 * the array form, which it does understand.
 *
 * Deliberately narrow:
 * - LIST-valued types only. A comma is ordinary content in `TEXT` and would be
 *   destroyed by splitting.
 * - Non-`isMulti` only. The row-level multi path is per-row by construction and
 *   explicitly refuses arrays; leave it exactly as it was.
 * - A value with no comma is returned untouched, so the overwhelmingly common
 *   single-tag case keeps its existing behaviour byte for byte.
 */
export function coerceListValue(
  fieldType: string | undefined,
  value: unknown,
  isMulti: boolean
): unknown {
  if (isMulti || !fieldType || !LIST_VALUED_TYPES.has(fieldType)) return value
  if (typeof value !== 'string' || !value.includes(',')) return value
  const parts = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  // `,` / `, ,` carries no tags — fall through to the original value so the existing
  // blank handling decides, rather than writing an empty array over the current list.
  return parts.length > 0 ? parts : value
}

/**
 * Remove the write-set entry carrying a unique-value conflict (B1 per-value
 * tolerance). Prefers the error's `fieldId` when it names a write-set key, else
 * scans values (case-insensitively — the hook lowercases before checking). For
 * an array value only the offending element is removed. Returns the touched key,
 * or null when nothing matched (the caller then fails the record as before).
 */
function dropConflictingKey(
  writeSet: Record<string, unknown>,
  error: UniqueValueConflictError
): string | null {
  const conflict = String(error.conflictingValue).trim().toLowerCase()
  const matchesConflict = (v: unknown) => String(v).trim().toLowerCase() === conflict

  if (error.fieldId && error.fieldId in writeSet) {
    delete writeSet[error.fieldId]
    return error.fieldId
  }
  for (const [key, value] of Object.entries(writeSet)) {
    if (Array.isArray(value)) {
      const remaining = value.filter((v) => !matchesConflict(v))
      if (remaining.length === value.length) continue
      if (remaining.length === 0) delete writeSet[key]
      else writeSet[key] = remaining
      return key
    }
    if (matchesConflict(value)) {
      delete writeSet[key]
      return key
    }
  }
  return null
}

/**
 * Merge this mapping's `connectionAppFields` values (connection metadata, e.g.
 * Shopify `shopDomain`) into a COPY of the record's fields before the normal
 * write-set pipeline runs — reusing every existing ref-resolution / merge-strategy /
 * provenance / content-hash code path for free (map-record already skipped
 * evaluating these `connectionMetaKey`-flagged entries against the source subtree,
 * since they have nothing to evaluate). A key with no metadata value (no bound
 * connection, credential load failed, or the metadata is missing that key) is left
 * out entirely rather than writing `null` over a previously-synced value.
 */
function injectConnectionAppFields(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  record: ProjectedRecord
): ProjectedRecord {
  const connMetaFields = mapping.fieldMappings.filter(
    (fm): fm is typeof fm & { connectionMetaKey: string; targetFieldRef: string } =>
      fm.connectionMetaKey != null && fm.targetFieldRef != null
  )
  if (connMetaFields.length === 0) return record

  const fields = { ...record.fields }
  for (const fm of connMetaFields) {
    const value = ctx.connectionMeta?.[fm.connectionMetaKey]
    if (value === undefined) continue
    fields[fm.targetFieldRef] = value
  }
  return { ...record, fields }
}

/**
 * Resolve every distinct `targetFieldRef` a record references (write fields +
 * identity candidates) to a concrete `ResourceFieldId`. Concrete refs pass
 * through; the late-bound `@app:` form resolves against the connector's bound
 * connection (its `credentialId`). An unresolved ref (no bound connection / no
 * provisioned field) is dropped from the map + recorded as a run error — the
 * caller skips that field/candidate rather than writing a garbage field id.
 */
async function resolveFieldRefs(
  ctx: SyncCtx,
  record: ProjectedRecord
): Promise<Map<string, ResourceFieldId>> {
  const refs = new Set<string>()
  for (const k of Object.keys(record.fields)) refs.add(k)
  for (const c of record.identityCandidates) refs.add(c.targetFieldRef)

  const connectionId = ctx.connector.credentialId ?? undefined
  const out = new Map<string, ResourceFieldId>()
  for (const ref of refs) {
    const resolved = await resolveConnectorFieldRef(ref as ResourceFieldId, ctx.orgId, connectionId)
    if (resolved) {
      out.set(ref, resolved)
      continue
    }
    logger.warn('targetFieldRef did not resolve — skipping field/candidate', {
      connectorId: ctx.connector.id,
      mappingExternalId: record.externalId,
      ref,
    })
    if (ctx.counters.errorSample.length < 50) {
      ctx.counters.errorSample.push({
        externalId: record.externalId,
        error: `unresolved targetFieldRef: ${ref}`,
        tier: 'invalid', // caught before the write — bad shape / missing identity
      })
    }
  }
  return out
}

/**
 * Resolve the entity instance an upstream record binds to via its SECONDARY
 * match keys (the external-id binding is resolved first by the caller). Returns
 * `{ instanceId }`; null ⇒ no match → caller creates. Match candidates were
 * resolved from the source record by the mapping layer (flagged `match`
 * bindings → identityCandidates); each candidate's `targetFieldRef` is resolved
 * to a concrete field id via `refToConcrete`, then keyed by `fieldId` so
 * `lookupByField` matches connector-provisioned fields (systemAttribute null).
 *
 * Array-shaped candidate values are DROPPED with a warning (never stringified —
 * `'a@x,b@x'` can only miss and mint a duplicate). If every configured candidate
 * was dropped that way, `failed: true` tells the caller to FAIL the record
 * instead of falling through to create: a visible failure beats a silent
 * duplicate. `matched` echoes `lookupByField`'s `matchedBy` — which candidate
 * (field + normalized value) hit — so the write path knows the matched row IS
 * the incoming value (the match-by-alias natural no-op, B1).
 */
async function resolveIdentity(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  record: ProjectedRecord,
  refToConcrete: Map<string, ResourceFieldId>
): Promise<{
  instanceId: string | null
  matched?: { fieldId?: FieldId; value: unknown; exclusive?: boolean }
  failed?: boolean
}> {
  let droppedArrayCandidate = false
  const candidates = record.identityCandidates
    .map((c) => {
      if (Array.isArray(c.value)) {
        droppedArrayCandidate = true
        logger.warn('array-shaped identity match candidate — dropped, never stringified', {
          mappingId: mapping.row.id,
          externalId: record.externalId,
          targetFieldRef: c.targetFieldRef,
        })
        return null
      }
      if (isBlank(c.value)) return null
      const concrete = refToConcrete.get(c.targetFieldRef)
      if (!concrete) return null
      return {
        fieldId: getFieldId(concrete),
        value: normalizeMatch(c.value, c.normalize),
        exclusive: c.exclusive === true,
      }
    })
    .filter((c): c is { fieldId: FieldId; value: string; exclusive: boolean } => c !== null)

  if (candidates.length === 0) {
    // All configured match keys degraded to unusable array values → FAIL the
    // record rather than create a duplicate. External-id-only records (no match
    // keys at all) keep falling through to create.
    if (droppedArrayCandidate) return { instanceId: null, failed: true }
    return { instanceId: null } // external-id only → create
  }

  // `limit: 6` rather than 2: one slot decides the match, the rest are the
  // duplicate SET this lookup just discovered. Capping at 2 made the ambiguity
  // detectable but unrecordable — we could say "more than one" and nothing else.
  const { items } = await ctx.crud.lookupByField({
    entityDefinitionId: mapping.entityDefinitionId,
    candidates,
    limit: 6,
  })
  if (items.length === 0) return { instanceId: null }
  if (items.length > 1) {
    const instanceIds = items.map((i) => i.recordId.split(':').slice(1).join(':'))
    logger.warn('ambiguous identity match — using first', {
      mappingId: mapping.row.id,
      externalId: record.externalId,
      matches: items.length,
      // The ids, not just the count: the loser of this resolution is a silent
      // duplicate, and "3 matched" is not something anyone can act on.
      instanceIds,
    })
    void captureAmbiguousMatch(ctx, mapping, record, instanceIds)
  }
  // recordId is `entityDefId:instanceId`.
  const match = items[0]!
  const instanceId = match.recordId.split(':').slice(1).join(':')
  // Which declared candidate hit decides whether the binding is `exclusive`; a
  // composite key is exclusive when any of its candidates is.
  const hit = candidates.find((c) => c.fieldId === match.matchedBy.fieldId)
  const exclusive = hit ? hit.exclusive : candidates.some((c) => c.exclusive)
  return {
    instanceId,
    matched: { fieldId: match.matchedBy.fieldId, value: match.matchedBy.value, exclusive },
  }
}

/**
 * Record the duplicate an ambiguous identity resolution just walked past.
 *
 * `resolveIdentity` takes the first match and proceeds — it has to, or a sync
 * would fail on data the user can only fix by merging. But no scan is guaranteed
 * to rediscover the loser: neither record need ever go dirty again. This is the
 * cheapest true positive in the whole dedup feature, because the connector's own
 * match keys already asserted these records are the same customer.
 *
 * Fire-and-forget and non-throwing: a sync must never fail because a suggestion
 * could not be written. Gated on the plan feature so a connector run for an org
 * without duplicate detection writes nothing.
 */
async function captureAmbiguousMatch(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  record: ProjectedRecord,
  instanceIds: string[]
): Promise<void> {
  try {
    const { FeaturePermissionService } = await import(
      '../../permissions/feature-permission-service'
    )
    const { FeatureKey } = await import('../../permissions/types')
    const features = new FeaturePermissionService()
    if (!(await features.hasAccess(ctx.orgId, FeatureKey.duplicateDetection))) return

    const { emitPairsFromIdentityMatch } = await import('../../dedup/emit-identity-pairs')
    await emitPairsFromIdentityMatch(ctx.db, {
      organizationId: ctx.orgId,
      entityDefinitionId: mapping.entityDefinitionId,
      instanceIds,
      source: ctx.connector.type,
      externalId: record.externalId,
    })
  } catch (error) {
    logger.debug('ambiguous-match duplicate capture failed', {
      connectorId: ctx.connector.id,
      externalId: record.externalId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Build the write set from a projected record, applying each field's merge
 * strategy against the current target value. Contributing mode narrows to the
 * mapping's managed (mapped) fields; owned mode writes everything mapped.
 *
 * Multi-value (`options.multi`) target fields on an EXISTING instance are
 * diverted out of the whole-field write set into `rowWrites` — the row-level
 * own-row-upsert path (B1; see `row-level-writes.ts`). A whole-field `set`
 * would wipe every row's connector marker and regenerate all sortKeys. On a
 * CREATE they stay in the write set (a fresh instance has no rows to protect).
 *
 * `pinnedFields` are the concrete `CustomField` ids the user PAUSED on this
 * record (`DataConnectorItem.pinnedFields`, plans/money/tasks/40). A pinned field
 * reaches neither `writeSet` nor `rowWrites`, so it is never written and never
 * stamped (stamping keys off the write set); it stays in `managedFields`, so the
 * read side can show `paused` rather than nothing.
 */
async function buildWriteSet(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  record: ProjectedRecord,
  existingInstanceId: string | null,
  refToConcrete: Map<string, ResourceFieldId>,
  pinnedFields: readonly string[],
  matched?: { fieldId?: FieldId; value: unknown }
): Promise<{
  writeSet: Record<string, unknown>
  rowWrites: RowLevelWrite[]
  managedFields: string[]
  identityFieldKeys: string[]
}> {
  // managedFields stay keyed by the raw `targetFieldRef` — the same key space as
  // `record.fields`, `mergeByKey`, and the prior runs' stored `managedFields`
  // (used by the `connector_owned_only` ownership check below).
  const managedFields = Object.keys(record.fields)
  // Write-set keys are concrete field ids (`getFieldId(resolvedRef)`) — what
  // `setFieldValues`/`createEntity` expect (a bare uuid or systemAttribute).
  const writeSet: Record<string, unknown> = {}
  // Concrete write-set keys of identity-flagged fields (`identityRole.kind ===
  // 'externalId'`) resolved this run — used by the caller to mirror into
  // RecordIdentity and to exclude from contributing provenance stamping.
  const identityFieldKeys: string[] = []

  // Per-field merge strategy, derived from the binding entries (folded in from the
  // old parallel column). Keyed by raw `targetFieldRef`; unassigned drafts skipped.
  const mergeByKey = new Map<string, FieldMergeStrategy>()
  // Identity-flagged refs (owned `isExternalId` or contributing `identity: true`
  // target). Write-ownership rule below: fill-blank + drift-exempt (see
  // computeDriftedInstances) + no-provenance (see stampContributingProvenance's
  // caller) — enforced by the sink regardless of the mapping's own
  // `mergeStrategy`, so a connector author can't misconfigure this away.
  const identityRefs = new Set<string>()
  for (const fm of mapping.fieldMappings) {
    if (fm.targetFieldRef == null) continue
    if (fm.mergeStrategy) mergeByKey.set(fm.targetFieldRef, fm.mergeStrategy)
    if (fm.identityRole?.kind === 'externalId') identityRefs.add(fm.targetFieldRef)
  }
  const strategyFor = (key: string): FieldMergeStrategy =>
    identityRefs.has(key) ? 'fill_blank' : (mergeByKey.get(key) ?? 'overwrite')

  // Multi-value fields diverted to the row-level path (existing instances only).
  const rowWrites: RowLevelWrite[] = []

  // Field metadata: multi-detection + the fill_blank key-space fix. Write-set
  // keys may be systemAttributes while `getFieldValues` / `FieldValue.fieldId`
  // key by the CustomField uuid — resolve through the shared write-key map, or a
  // missed lookup silently turns `fill_blank` into `overwrite`.
  let keyToId: Map<string, string> | null = null
  let fieldMap: Map<string, RowLevelField> | null = null
  if (managedFields.length > 0) {
    keyToId = await buildWriteKeyToFieldId(ctx.orgId, mapping.entityDefinitionId)
    fieldMap = (await getCachedFieldMap(ctx.orgId, mapping.entityDefinitionId)) as unknown as Map<
      string,
      RowLevelField
    >
  }

  // Read current values once (only needed for fill_blank / connector_owned_only).
  const needsCurrent = managedFields.some((k) => {
    const strat = strategyFor(k)
    return strat === 'fill_blank' || strat === 'connector_owned_only' || strat === 'manual_review'
  })
  let current: Map<string, TypedFieldValue | TypedFieldValue[]> | null = null
  if (needsCurrent && existingInstanceId) {
    const recordId = toRecordId(mapping.entityDefinitionId, existingInstanceId)
    current = await ctx.crud.getFieldValues(recordId)
  }

  for (const [rawRef, sourceValue] of Object.entries(record.fields)) {
    const strategy = strategyFor(rawRef)
    if (strategy === 'ignore') continue

    const concrete = refToConcrete.get(rawRef)
    if (!concrete) continue // unresolved @app: ref — already recorded in resolveFieldRefs
    const fieldId = getFieldId(concrete)
    if (identityRefs.has(rawRef)) identityFieldKeys.push(fieldId)

    const fieldUuid = keyToId?.get(fieldId)
    // Paused on this record: the pin holds the concrete `CustomField.id`, which is
    // `fieldUuid`; the write key itself is that uuid for a custom field and the
    // systemAttribute for a system field, so both forms are checked.
    if (pinnedFields.includes(fieldId) || (fieldUuid != null && pinnedFields.includes(fieldUuid))) {
      continue
    }
    const fieldRow = fieldUuid ? fieldMap?.get(fieldUuid) : undefined
    const isMulti =
      !identityRefs.has(rawRef) &&
      (fieldRow?.options as { multi?: boolean } | null | undefined)?.multi === true

    // A list-valued field (TAGS / MULTI_SELECT) arrives as a comma string, because a
    // connector cannot source an array. Split it into the list form the write path
    // understands — otherwise a multi-tag source writes ONE compound tag. Every
    // reference to `value` below is post-coercion by design.
    const value = coerceListValue(fieldRow?.type, sourceValue, isMulti)

    // Pre-flight the format-validated types (EMAIL/URL/PHONE_INTL): a value the
    // write path would refuse costs the WHOLE record if it throws inside
    // `handler.update`. Drop the one value and keep syncing — the multi path
    // below reaches the same outcome per value (`row-level-writes.ts`), so the
    // record's fate no longer depends on whether the field happens to be multi.
    if (rejectsFormat(fieldRow?.type, value)) {
      logger.warn('source value rejected by field format validation — value dropped', {
        mappingId: mapping.row.id,
        externalId: record.externalId,
        field: rawRef,
        fieldType: fieldRow?.type,
      })
      continue
    }

    if (isMulti && strategy !== 'manual_review') {
      // Never write null/empty over a multi field: a source key present-but-null
      // must not clear the row list (B1). Arrays can't be sourced — belt-and-braces
      // for the map-record guard.
      if (isBlank(value)) continue
      if (Array.isArray(value)) {
        logger.warn('array-shaped value reached a multi field — skipped', {
          mappingId: mapping.row.id,
          externalId: record.externalId,
          field: rawRef,
        })
        continue
      }
      if (!existingInstanceId) {
        // Fresh instance: no rows to protect — plain write (becomes the one row).
        writeSet[fieldId] = value
        continue
      }
      // Row-level own-row upsert for overwrite / connector_owned_only / fill_blank.
      // Row-marker ownership subsumes the per-field managedFields check.
      const candidate = record.identityCandidates.find((c) => c.targetFieldRef === rawRef)
      const knownPresent =
        matched?.fieldId === fieldId &&
        normalizeMatch(value, candidate?.normalize) === String(matched.value)
      rowWrites.push({
        writeKey: fieldId,
        fieldUuid: fieldUuid!,
        field: fieldRow as RowLevelField,
        value,
        strategy,
        knownPresent,
      })
      continue
    }

    if (strategy === 'overwrite') {
      writeSet[fieldId] = value
      continue
    }
    if (strategy === 'connector_owned_only') {
      // Write only if this connector created/owns the field on this record.
      const item = await findItem(ctx.db, ctx.connector.id, mapping.row.id, record.externalId)
      const owns = !item || (item.managedFields ?? []).includes(rawRef)
      if (owns) writeSet[fieldId] = value
      continue
    }
    if (strategy === 'fill_blank') {
      const cur = current ? rawOf(current.get(fieldUuid ?? fieldId)) : undefined
      if (isBlank(cur)) writeSet[fieldId] = value
      continue
    }
    if (strategy === 'manual_review') {
      // Deferred UI — log a conflict instead of writing.
      logger.info('manual_review merge — conflict logged, not written', {
        mappingId: mapping.row.id,
        externalId: record.externalId,
        field: rawRef,
      })
    }
  }

  return { writeSet, rowWrites, managedFields, identityFieldKeys }
}

/**
 * Stamp the per-cell contributing provenance marker (`FieldValue.managedByConnectorId`)
 * on the values this connector just wrote. Contributing-mode only — owned writes
 * never call this (the column-grain `CustomField.dataConnectorId` carries owned
 * provenance instead). The marker drives the soft "Synced by <connector>" cell
 * badge; the cell stays editable.
 *
 * `writeFieldKeys` are the concrete write-set keys (a bare CustomField uuid OR a
 * systemAttribute). `FieldValue.fieldId` is always the CustomField uuid, so we
 * resolve systemAttribute keys back to their uuid via the cached field map before
 * the batched UPDATE. One UPDATE per upserted contributing record (cold path).
 *
 * ROW-ACCURACY: the UPDATE is keyed on `(org, entity, fieldId)` — every row of
 * the field. That is exact for scalar fields (one row) and for multi fields on a
 * CREATE (every row on a fresh instance is the connector's). Multi fields on an
 * UPDATE never reach here: they divert to the row-level path, which stamps only
 * the specific row it wrote (`row-level-writes.ts`).
 */
async function stampContributingProvenance(
  ctx: SyncCtx,
  entityDefinitionId: string,
  instanceId: string,
  writeFieldKeys: string[]
): Promise<void> {
  if (writeFieldKeys.length === 0) return

  const keyToId = await buildWriteKeyToFieldId(ctx.orgId, entityDefinitionId)
  const concreteIds = Array.from(
    new Set(writeFieldKeys.map((k) => keyToId.get(k)).filter((v): v is string => !!v))
  )
  if (concreteIds.length === 0) return

  await ctx.db
    .update(schema.FieldValue)
    .set({ managedByConnectorId: ctx.connector.id })
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.orgId),
        eq(schema.FieldValue.entityId, instanceId),
        inArray(schema.FieldValue.fieldId, concreteIds)
      )
    )
}

/**
 * Mirror this run's identity-flagged writes into `RecordIdentity` — the
 * write-through reverse-lookup index. Runs for BOTH owned and contributing
 * mode (an owned Shopify order becomes a hub record keyed by its order id,
 * same as a contributing contact's `customerId`) — one rule covers both,
 * per the identity plan. Best-effort: a mirror failure is logged, never fails
 * the sync — `reconcileRecordIdentities` is the drift backstop.
 */
async function mirrorIdentityWrites(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  instanceId: string,
  externalId: string,
  identityFieldKeys: string[]
): Promise<void> {
  if (identityFieldKeys.length === 0) return

  const fieldMap = await getCachedFieldMap(ctx.orgId, mapping.entityDefinitionId)
  for (const fieldId of identityFieldKeys) {
    const field = fieldMap.get(fieldId)
    if (!field) continue
    if (!field.appSlug) {
      logger.warn('identity field has no appSlug — skipping RecordIdentity mirror', {
        connectorId: ctx.connector.id,
        fieldId,
        appFieldKey: field.appFieldKey,
      })
      continue
    }
    const mirrored = await upsertRecordIdentity(
      {
        organizationId: ctx.orgId,
        entityInstanceId: instanceId,
        entityDefinitionId: mapping.entityDefinitionId,
        source: field.appSlug,
        appInstallationId: field.appInstallationId,
        connectionId: field.connectionId,
        appFieldKey: field.appFieldKey,
        fieldId: field.id,
        externalId,
      },
      ctx.db
    )
    if (!mirrored.ok) {
      logger.warn('Failed to mirror identity write into RecordIdentity', {
        connectorId: ctx.connector.id,
        mappingId: mapping.row.id,
        fieldId,
        error: mirrored.error.message,
      })
    }
  }
}

/**
 * The set of bound instance ids for `mapping` whose `overwrite` cells have
 * DRIFTED — i.e. a `FieldValue.managedByConnectorId` that this connector stamped
 * on write is now cleared (someone hand-edited the cell in the grid) or owned by
 * a different connector. The content-hash skip must NOT skip these, because an
 * `overwrite` field is connector-owned and has to re-assert the source value (the
 * write re-stamps the marker, so a healed record drops out of this set next run).
 *
 * Computed ONCE per mapping per slice (one bulk query), memoized on `ctx` as a
 * Promise so records processed concurrently share it — never a per-record read.
 * Contributing-mode only: owned fields are `isUpdatable:false` (the grid can't
 * edit them) and owned writes don't stamp the marker, so there's nothing to
 * detect. A mapping with no `overwrite` field (all conservative strategies) pays
 * nothing — it short-circuits to an empty set before querying.
 */
function driftedInstances(ctx: SyncCtx, mapping: DecodedMapping): Promise<Set<string>> {
  const memo = (ctx.driftByMapping ??= new Map())
  let pending = memo.get(mapping.row.id)
  if (!pending) {
    pending = computeDriftedInstances(ctx, mapping)
    memo.set(mapping.row.id, pending)
  }
  return pending
}

async function computeDriftedInstances(
  ctx: SyncCtx,
  mapping: DecodedMapping
): Promise<Set<string>> {
  if (mapping.targetMode !== 'contributing') return new Set()

  // The bindings that re-assert the source value over a hand edit: strategy
  // `overwrite` (or unset, which `strategyFor` in buildWriteSet defaults to it),
  // not identity-flagged (the sink forces those to fill-blank, so they never
  // re-assert and cannot drift), and not multi (checked below once the field is
  // known). `wouldHealField` is the same rule the read path uses to show a cell
  // as `edited`, so the badge and this query cannot disagree (plan 40 D2). The
  // field-less call here is the strategy and identity half; a mapping with no
  // healing binding pays nothing and short-circuits before querying.
  const healingBindings = mapping.fieldMappings.filter(
    (fm): fm is typeof fm & { targetFieldRef: ResourceFieldId } =>
      fm.targetFieldRef != null && wouldHealField(fm, null)
  )
  if (healingBindings.length === 0) return new Set()

  // Resolve each ref to the concrete CustomField uuid `FieldValue.fieldId` carries
  // (refs may be the late-bound `@app:` form; system fields key by systemAttribute).
  const connectionId = ctx.connector.credentialId ?? undefined
  const keyToId = await buildWriteKeyToFieldId(ctx.orgId, mapping.entityDefinitionId)
  const fieldMap = await getCachedFieldMap(ctx.orgId, mapping.entityDefinitionId)
  // The concrete `CustomField.id` a `FieldValue` row and a pin carry, paired with
  // the RAW `targetFieldRef` an item's `managedFields` carries — the cleared-cell
  // arm below needs both key spaces.
  const fields: Array<{ uuid: string; ref: string }> = []
  const seen = new Set<string>()
  for (const fm of healingBindings) {
    const concrete = await resolveConnectorFieldRef(fm.targetFieldRef, ctx.orgId, connectionId)
    if (!concrete) continue
    const uuid = keyToId.get(getFieldId(concrete))
    if (!uuid) continue
    // Multi-value (`options.multi`) fields are ROW-SCOPED out of drift detection:
    // under row-level semantics, unmarked/foreign rows are legitimate (user
    // aliases, other connectors' rows), so a null-or-foreign marker no longer
    // signals a hand-edit. Without this, a single user alias makes every bound
    // record permanently "drifted" and the content-hash skip never fires again.
    // A user edit of the connector's own row is respected (never re-asserted)
    // until the SOURCE value changes, consistent with never-touch-other-rows.
    const field = fieldMap.get(uuid) as SyncFieldShape | undefined
    if (!wouldHealField(fm, field)) continue
    if (seen.has(uuid)) continue
    seen.add(uuid)
    fields.push({ uuid, ref: fm.targetFieldRef })
  }
  if (fields.length === 0) return new Set()

  // One query: the mapping's live bindings CROSS JOINed with the healing fields
  // and LEFT JOINed to the cell. A bound instance is drifted when a healing cell
  //
  //   - carries a row no longer stamped by this connector (NULL = hand-edited,
  //     or a different connector took it over), or
  //   - carries NO row at all — the user CLEARED it. `overwrite` means
  //     overwrite, so a cleared cell is re-filled like any other drift (task 42
  //     §3); before this it stayed empty forever, because the join was an INNER
  //     one and the content-hash skip never fell through.
  //
  // The cleared arm is narrowed to fields the item already MANAGES: the
  // connector has written that field on this record before, so it has a value to
  // put back. Without that, a mapping whose source omits a field would mark
  // every bound record permanently drifted and the content-hash skip would never
  // fire again. It is also the exact rule the badge's `edited` state uses, so the
  // two cannot disagree (plan 40 D2).
  //
  // A cell the user PAUSED (`pinnedFields`, plan 40) is not drift in either arm:
  // the sink will not write it, so counting it would strand the record in the
  // same never-skip loop, and an ARCHIVED binding is not drift either: the
  // record is no longer bound through this mapping. jsonb `?` tests string
  // membership in the top-level array; `managedFields` holds raw refs,
  // `pinnedFields` concrete ids.
  const I = schema.DataConnectorItem
  const FV = schema.FieldValue
  const result = await ctx.db.execute(sql`
    SELECT DISTINCT ${I.entityInstanceId} AS "entityId"
    FROM ${I}
    CROSS JOIN unnest(
        ${sql.param(fields.map((f) => f.uuid))}::text[],
        ${sql.param(fields.map((f) => f.ref))}::text[]
      ) AS healing(field_id, field_ref)
    LEFT JOIN ${FV}
      ON ${FV.entityId} = ${I.entityInstanceId}
      AND ${FV.fieldId} = healing.field_id
    WHERE ${I.dataConnectorId} = ${ctx.connector.id}
      AND ${I.mappingId} = ${mapping.row.id}
      AND ${I.archivedAt} IS NULL
      AND ${I.entityInstanceId} IS NOT NULL
      AND NOT (${I.pinnedFields} ? healing.field_id)
      AND (
        CASE WHEN ${FV.id} IS NULL
          THEN ${I.managedFields} ? healing.field_ref
          ELSE ${FV.managedByConnectorId} IS DISTINCT FROM ${ctx.connector.id}
        END
      )
  `)
  return new Set((result.rows ?? []).map((r) => (r as { entityId: string }).entityId))
}

/**
 * Whether another LIVE (non-archived) binding of this connector references the same
 * entity instance (relationship-linking v3 §9.6 step 5). Under def-keyed sharing one
 * instance can be co-owned by several mappings; archiving one source must not strip a
 * record a sibling binding still maintains. Excludes the binding being archived.
 */
async function findOtherLiveBinding(
  ctx: SyncCtx,
  itemId: string,
  entityInstanceId: string
): Promise<boolean> {
  const row = await ctx.db.query.DataConnectorItem.findFirst({
    where: and(
      eq(schema.DataConnectorItem.dataConnectorId, ctx.connector.id),
      eq(schema.DataConnectorItem.entityInstanceId, entityInstanceId),
      ne(schema.DataConnectorItem.id, itemId),
      isNull(schema.DataConnectorItem.archivedAt)
    ),
    columns: { id: true },
  })
  return !!row
}

/**
 * The externalId of a LIVE binding of the SAME mapping that already references
 * `instanceId`, other than `externalId` itself, or null when there is none
 * (money plan 39 section 6.1). The in-slice claim is checked first: a sibling
 * processed earlier this slice has claimed the instance in `sliceWriteWinners`
 * before its binding row is necessarily visible, and the map answers without a
 * query. The `DataConnectorItem` read covers the sibling that bound the instance
 * in an earlier slice or run.
 */
async function findSiblingBinding(
  ctx: SyncCtx,
  mappingId: string,
  instanceId: string,
  externalId: string
): Promise<string | null> {
  const winner = ctx.sliceWriteWinners?.get(`${mappingId}::${instanceId}`)
  if (winner !== undefined && winner !== externalId) return winner

  const row = await ctx.db.query.DataConnectorItem.findFirst({
    where: and(
      eq(schema.DataConnectorItem.dataConnectorId, ctx.connector.id),
      eq(schema.DataConnectorItem.mappingId, mappingId),
      eq(schema.DataConnectorItem.entityInstanceId, instanceId),
      ne(schema.DataConnectorItem.externalId, externalId),
      isNull(schema.DataConnectorItem.archivedAt)
    ),
    columns: { externalId: true },
  })
  return row?.externalId ?? null
}

/**
 * Human label for the field a secondary-key match hit on, for the skip reason
 * (`SKU 177A already belongs to 45678`). Falls back to the field id: the reason
 * must never be the thing that fails a record.
 */
async function matchFieldLabel(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  fieldId: FieldId | undefined
): Promise<string> {
  if (!fieldId) return 'match value'
  try {
    const fieldMap = await getCachedFieldMap(ctx.orgId, mapping.entityDefinitionId)
    return fieldMap.get(fieldId)?.name ?? fieldId
  } catch {
    return fieldId
  }
}

export const entitySink: EntitySink = {
  async upsertRecord(ctx, mapping, record) {
    ctx.counters.fetched += 1
    ctx.touchedDefs.add(mapping.entityDefinitionId)

    // Fold in connection-metadata-sourced fields (e.g. Shopify `storeDomain`)
    // before anything else reads `record.fields` — downstream logic treats them
    // exactly like any other mapped field from here on.
    record = injectConnectionAppFields(ctx, mapping, record)

    // Resolve every mapped `targetFieldRef` to a concrete field id once — both the
    // identity lookup and the write set key off this table (§3.3).
    const refToConcrete = await resolveFieldRefs(ctx, record)

    // 1. Resolve identity — exact bind, else strategy bootstrap.
    const bound = await findItem(ctx.db, ctx.connector.id, mapping.row.id, record.externalId)

    // 1a. Out-of-order guard (§9 Q7). The high-concurrency webhook lane lets two
    //     events for one externalId race (A fetches v1, B fetches v2, A lands last);
    //     the sink is last-write-wins, so the stale write would clobber newer upstream
    //     data. When BOTH the incoming record and the bound item carry an upstream
    //     `updatedAt`, drop a STRICTLY-older write — only advancing the version stamp +
    //     lastSeenRunId, exactly like the content-hash skip. Equal/missing passes through
    //     (content-hash handles the unchanged case; missing ⇒ today's last-write-wins).
    if (
      bound?.entityInstanceId &&
      bound.upstreamUpdatedAt &&
      record.upstreamUpdatedAt &&
      record.upstreamUpdatedAt.getTime() < bound.upstreamUpdatedAt.getTime()
    ) {
      await touchItem(ctx.db, bound.id, ctx.runId)
      ctx.counters.skipped += 1
      if (record.pendingRelations.length > 0) {
        await mergePendingRelations(
          ctx,
          bound.id,
          bound.pendingRelations ?? [],
          record.pendingRelations,
          new Set(bound.linkedRelations ?? [])
        )
      }
      return
    }

    let instanceId: string | null = bound?.entityInstanceId ?? null
    // 1b. Def-keyed instance reuse-read (relationship-linking v3 §9.6 step 4). Before
    //     match/create, reuse an instance ANY mapping already bound for
    //     (connector, def, externalId) — so an embedded `Order → Customer` branch
    //     converges on the Customers stream's Contact instead of minting a duplicate.
    //     Best-effort (no lock): the rare concurrent first-contact still double-creates,
    //     same tolerance as Match (§9.3a).
    if (!instanceId) {
      const shared = await findItemByDef(
        ctx.db,
        ctx.connector.id,
        mapping.entityDefinitionId,
        record.externalId
      )
      instanceId = shared?.entityInstanceId ?? null
    }
    let matched: { fieldId?: FieldId; value: unknown; exclusive?: boolean } | undefined
    if (!instanceId) {
      const resolved = await resolveIdentity(ctx, mapping, record, refToConcrete)
      if (resolved.failed) {
        // Every configured match candidate was array-shaped — fail the record
        // VISIBLY instead of falling through to create a silent duplicate.
        ctx.counters.failed += 1
        if (ctx.counters.errorSample.length < 50) {
          ctx.counters.errorSample.push({
            externalId: record.externalId,
            error: 'identity match candidates were array-shaped — record failed, not created',
            tier: 'invalid',
          })
        }
        return
      }
      instanceId = resolved.instanceId
      matched = resolved.matched
    }

    // 1b'. One instance, one binding per mapping, for an EXCLUSIVE match key only
    //     (money plan 39 section 6.1). A `match` hit on an instance that a
    //     DIFFERENT externalId of this same mapping already binds is a true
    //     in-source duplicate when the key is exclusive (two Shopify variants
    //     sharing one SKU): binding both would weld two upstream records onto one
    //     part, with the slice dedupe below letting the first win the writes and
    //     the second keep its binding forever. Skip the record with a reason
    //     instead: no binding, no write, counted `skipped` rather than `failed`,
    //     so the run is not `partial` for as long as the duplicate stands
    //     upstream. A plain match key keeps the B1 behaviour (both bind, first
    //     wins the writes): two customer records sharing an email are one person,
    //     and a guest checkout carries a synthetic externalId per order, so
    //     skipping it would leave that order's contact edge pending forever.
    //     External-id bindings and def-keyed reuse never land here (`matched` is
    //     only set on the secondary-key path).
    if (instanceId && matched?.exclusive) {
      const siblingExternalId = await findSiblingBinding(
        ctx,
        mapping.row.id,
        instanceId,
        record.externalId
      )
      if (siblingExternalId !== null) {
        const label = await matchFieldLabel(ctx, mapping, matched.fieldId)
        const reason = `${label} ${String(matched.value)} already belongs to ${siblingExternalId}`
        logger.info(
          'match hit an instance a sibling record of this mapping already binds - skipped',
          {
            mappingId: mapping.row.id,
            externalId: record.externalId,
            instanceId,
            siblingExternalId,
            reason,
          }
        )
        ctx.counters.skipped += 1
        if (ctx.counters.errorSample.length < 50) {
          ctx.counters.errorSample.push({
            externalId: record.externalId,
            error: reason,
            tier: 'skipped',
          })
        }
        return
      }
    }

    // 1c. In-slice two-source dedupe (B1, locked): the FIRST source record that
    //     binds an instance this slice wins its field writes; a later one still
    //     upserts its DataConnectorItem binding but logs + skips the field writes
    //     (`managedByConnectorId` cannot tell two bindings of one connector apart,
    //     so both writing would flip-flop the connector-owned row every run).
    let lostSliceDedupe = false
    if (instanceId) {
      const winners = (ctx.sliceWriteWinners ??= new Map())
      const winnerKey = `${mapping.row.id}::${instanceId}`
      const winner = winners.get(winnerKey)
      if (winner === undefined) winners.set(winnerKey, record.externalId)
      else if (winner !== record.externalId) lostSliceDedupe = true
    }

    // 2. Content hash — skip unchanged + already bound, UNLESS an overwrite cell
    //    has drifted (hand-edited in the grid). The hash is computed over the
    //    SOURCE only, so a destination edit is invisible to it; without the drift
    //    guard an `overwrite` field silently never re-asserts the source value
    //    while the source is stable. Drift is detected in bulk, once per mapping.
    const contentHash = stableHash({ fields: record.fields, displayName: record.displayName })
    if (bound?.entityInstanceId && bound.contentHash === contentHash) {
      // Source is unchanged — skip, unless an overwrite cell drifted (hand-edited),
      // in which case fall through to re-assert the source value. Drift is only
      // queried here, when we'd otherwise skip, so a create-only backfill pays nothing.
      const drifted = await driftedInstances(ctx, mapping)
      if (!drifted.has(bound.entityInstanceId)) {
        // Advance the version high-watermark even on a no-op content update so a
        // later genuinely-older event is still caught by the §9 Q7 guard above.
        const newerStamp =
          record.upstreamUpdatedAt &&
          (!bound.upstreamUpdatedAt ||
            record.upstreamUpdatedAt.getTime() > bound.upstreamUpdatedAt.getTime())
            ? record.upstreamUpdatedAt
            : undefined
        await touchItem(ctx.db, bound.id, ctx.runId, newerStamp)
        ctx.counters.skipped += 1
        // Still re-register pending relations so a later-arriving target resolves
        // (and a clear-on-empty edge fires even when the source is otherwise unchanged).
        if (record.pendingRelations.length > 0) {
          await mergePendingRelations(
            ctx,
            bound.id,
            bound.pendingRelations ?? [],
            record.pendingRelations,
            new Set(bound.linkedRelations ?? [])
          )
        }
        return
      }
    }

    // 2b. Slice-dedupe loser: keep the binding current, skip all field writes.
    if (lostSliceDedupe && instanceId) {
      logger.warn(
        'two source records resolved to one instance in this slice — field writes skipped (first wins)',
        {
          mappingId: mapping.row.id,
          externalId: record.externalId,
          instanceId,
          winnerExternalId: ctx.sliceWriteWinners?.get(`${mapping.row.id}::${instanceId}`),
        }
      )
      ctx.counters.skipped += 1
      await upsertItem(ctx.db, {
        dataConnectorId: ctx.connector.id,
        organizationId: ctx.orgId,
        mappingId: mapping.row.id,
        externalId: record.externalId,
        entityDefinitionId: mapping.entityDefinitionId,
        entityInstanceId: instanceId,
        contentHash,
        managedFields: bound?.managedFields ?? [],
        pendingRelations: mergePending(
          bound?.pendingRelations ?? [],
          record.pendingRelations,
          new Set(bound?.linkedRelations ?? [])
        ),
        upstreamUpdatedAt: record.upstreamUpdatedAt ?? null,
        lastSeenRunId: ctx.runId,
        mintedInstance: false,
      })
      return
    }

    // 3. Build the write set with per-field merge strategy. Multi fields on an
    //    existing instance divert to `rowWrites` (row-level own-row upserts).
    const { writeSet, rowWrites, managedFields, identityFieldKeys } = await buildWriteSet(
      ctx,
      mapping,
      record,
      instanceId,
      refToConcrete,
      bound?.pinnedFields ?? [],
      matched
    )

    // 3b. Plan the row-level writes BEFORE the write: the plan reads the field's
    //     current rows to decide per value between no-op / in-place update /
    //     append, so its reads must be pre-write.
    const rowPlan =
      instanceId && rowWrites.length > 0
        ? await planRowLevelWrites(ctx, mapping.entityDefinitionId, instanceId, rowWrites)
        : { actions: [], captureSet: {} }

    // 4. Write — owned uses the bypass handler; contributing uses the standard
    //    handler and leaves the row pair alone. `justCreated` marks a minted
    //    instance so the binding (below) records "this connector created this
    //    record" — the durable marker that lets connector deletion touch only
    //    records it created, leaving ENRICHED pre-existing records untouched
    //    (replaces the retired `EntityInstance.integrationSource` stamp).
    const handler = mapping.targetMode === 'owned' ? ctx.ownedCrud : ctx.crud
    let justCreated = false
    // Per-value uniqueness tolerance (B1): a `UniqueValueConflictError` thrown from
    // inside the write (A1's pre-hooks / unique-field validation) fails ONE value,
    // not the record — drop the conflicting key from the write set and retry, so
    // the sync stays green instead of the whole record retrying forever.
    const maxConflictDrops = Object.keys(writeSet).length
    for (let conflictDrops = 0; ; ) {
      try {
        if (instanceId) {
          const recordId = toRecordId(mapping.entityDefinitionId, instanceId)
          // Manifest capture (tier-1 membership + tier-2 `{o, n}` deltas) happens
          // inside the write engine's seams, keyed off the ambient `sync` session
          // (plan 07 PR 2) — no producer-side capture here.
          //
          // Shallow copy per attempt: a conflict retry mutates `writeSet`.
          // Event suppression comes from the handler's silent `sync` session
          // (plan 03 §3.4), not a per-call flag.
          await handler.update(recordId, { ...writeSet })
          ctx.counters.updated += 1
        } else {
          const created = await handler.create(mapping.entityDefinitionId, { ...writeSet })
          instanceId = created.instance.id
          justCreated = true
          ctx.counters.created += 1
          // Claim the fresh instance for this slice's two-source dedupe so a later
          // source record matching it (e.g. by alias) defers its field writes.
          ;(ctx.sliceWriteWinners ??= new Map()).set(
            `${mapping.row.id}::${instanceId}`,
            record.externalId
          )
          // Lifecycle-created membership, raw created values, and the create's
          // `{n}`-only field deltas are all captured at the engine's create seam
          // (plan 07 PR 2) — no producer-side capture here.
        }
        break
      } catch (error) {
        if (error instanceof UniqueValueConflictError && conflictDrops < maxConflictDrops) {
          const droppedKey = dropConflictingKey(writeSet, error)
          if (droppedKey) {
            conflictDrops += 1
            logger.warn('unique-value conflict — value dropped, record still syncs', {
              mappingId: mapping.row.id,
              externalId: record.externalId,
              field: droppedKey,
              conflictingValue: error.conflictingValue,
            })
            continue
          }
        }
        const message = error instanceof Error ? error.message : String(error)
        ctx.counters.failed += 1
        if (ctx.counters.errorSample.length < 50) {
          ctx.counters.errorSample.push({
            externalId: record.externalId,
            error: message,
            tier: 'rejected', // the entity write itself failed
          })
        }
        logger.warn('upsertRecord failed', {
          mappingId: mapping.row.id,
          externalId: record.externalId,
          error: message,
        })
        return
      }
    }

    // 4a. Execute the planned row-level writes (multi fields): in-place own-row
    //     updates + end-appends, each stamping only its own row. Per-value
    //     failures are logged inside — they never fail the record.
    if (instanceId && rowPlan.actions.length > 0) {
      await executeRowLevelWrites(
        ctx,
        mapping.entityDefinitionId,
        handler,
        instanceId,
        rowPlan.actions
      )
    }

    // 4b. Contributing mode — stamp per-cell provenance on the written values so
    //     the grid/drawer can show a "Synced by <connector>" marker. Owned mode
    //     skips this (column-grain provenance lives on CustomField.dataConnectorId).
    //     Identity fields are excluded — no false "synced by connector" badge
    //     over a value that may be chat-verified.
    if (mapping.targetMode === 'contributing' && instanceId) {
      const stampableKeys = Object.keys(writeSet).filter((key) => !identityFieldKeys.includes(key))
      await stampContributingProvenance(ctx, mapping.entityDefinitionId, instanceId, stampableKeys)
    }

    // 4c. Mirror identity-flagged fields into RecordIdentity, regardless of
    //     whether fill-blank actually wrote this run — the mirror stays in
    //     sync with the (already-established) cell value either way.
    if (instanceId) {
      await mirrorIdentityWrites(ctx, mapping, instanceId, record.externalId, identityFieldKeys)
    }

    // 5. Upsert the binding — merge any new managed fields with prior ones
    //    (contributing records are co-owned field-by-field across connectors).
    const mergedManaged = Array.from(new Set([...(bound?.managedFields ?? []), ...managedFields]))
    await upsertItem(ctx.db, {
      dataConnectorId: ctx.connector.id,
      organizationId: ctx.orgId,
      mappingId: mapping.row.id,
      externalId: record.externalId,
      entityDefinitionId: mapping.entityDefinitionId,
      entityInstanceId: instanceId,
      contentHash,
      managedFields: mergedManaged,
      pendingRelations: mergePending(
        bound?.pendingRelations ?? [],
        record.pendingRelations,
        new Set(bound?.linkedRelations ?? [])
      ),
      upstreamUpdatedAt: record.upstreamUpdatedAt ?? null,
      lastSeenRunId: ctx.runId,
      mintedInstance: justCreated,
    })
  },

  async archiveRecord(ctx, item, behavior) {
    if (behavior === 'ignore' || !item.entityInstanceId) return
    if (behavior === 'archive') {
      // Def-keyed sharing guard (relationship-linking v3 §9.6 step 5): the SAME
      // instance may be bound by more than one mapping (an embedded child + a
      // sibling stream). Archive the instance only when NO other live binding of
      // this connector still references it — else just stamp this binding archived
      // and leave the record (a sibling still owns it). This chokepoint catches both
      // owned orphan reconcile and the explicit-delete path.
      const otherLive = await findOtherLiveBinding(ctx, item.id, item.entityInstanceId)
      if (otherLive) {
        await markItemArchived(ctx.db, item.id, ctx.runId)
        return
      }
      const recordId = toRecordId(item.entityDefinitionId, item.entityInstanceId)
      try {
        // Archived membership is captured at the engine's archive seam,
        // unconditionally (plan 07 PR 2) — no producer-side capture here.
        await ctx.ownedCrud.archive(recordId)
        ctx.touchedDefs.add(item.entityDefinitionId)
        ctx.counters.archived += 1
      } catch (error) {
        logger.warn('archiveRecord failed', {
          itemId: item.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    // mark_deleted: set a connector status field — left as a no-op stub for v1
    // (no canonical status field is provisioned yet); the item is still stamped.
    await markItemArchived(ctx.db, item.id, ctx.runId)
  },

  async listExistingItems(ctx, mapping) {
    const items = await listItemsForMapping(ctx.db, ctx.connector.id, mapping.row.id)
    return items.map((i) => ({
      id: i.id,
      entityInstanceId: i.entityInstanceId,
      entityDefinitionId: i.entityDefinitionId,
      lastSeenRunId: i.lastSeenRunId,
    }))
  },
}

/**
 * Merge incoming pending relations onto an item's existing ones, LAST-WINS by
 * `fieldKey` (v1 `belongs_to` = one edge per field). A clear (FK went empty) or a
 * changed set for a field supersedes any stale pending set for that field —
 * otherwise a never-resolved set could land after a clear and re-establish the
 * edge. A clear whose field has no live edge (`fieldKey ∉ linkedRelations`) is
 * dropped, and discards any abandoned pending set for it (set in run 1 but never
 * resolved, FK empties in run 2 ⇒ no edge, correct).
 */
export function mergePending(
  existing: PendingRelation[],
  incoming: PendingRelation[],
  linkedRelations: Set<string>
): PendingRelation[] {
  const byField = new Map<string, PendingRelation>()
  for (const r of existing) byField.set(r.fieldKey, r)
  for (const r of incoming) {
    const isClear = r.targetExternalId === null
    if (isClear && !linkedRelations.has(r.fieldKey)) {
      byField.delete(r.fieldKey)
      continue
    }
    byField.set(r.fieldKey, r)
  }
  return [...byField.values()]
}

/** Persist a merged pending-relations list onto an already-bound item. */
async function mergePendingRelations(
  ctx: SyncCtx,
  itemId: string,
  existing: PendingRelation[],
  incoming: PendingRelation[],
  linkedRelations: Set<string>
): Promise<void> {
  await setItemPendingRelations(ctx.db, itemId, mergePending(existing, incoming, linkedRelations))
}

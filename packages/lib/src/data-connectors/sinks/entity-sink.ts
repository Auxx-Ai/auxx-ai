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
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import { resolveConnectorFieldRef } from '../../agents/bindings/resolve'
import { getCachedFieldMap } from '../../cache'
import { UniqueValueConflictError } from '../../errors'
import { fieldValueSchemas } from '../../field-values/field-value-validator'
import { upsertRecordIdentity } from '../../identity'
import type { ManifestFieldChange } from '../../record-rules/sync-manifest-types'
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
  matched?: { fieldId?: FieldId; value: unknown }
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
      return { fieldId: getFieldId(concrete), value: normalizeMatch(c.value, c.normalize) }
    })
    .filter((c): c is { fieldId: FieldId; value: string } => c !== null)

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
  return { instanceId, matched: { fieldId: match.matchedBy.fieldId, value: match.matchedBy.value } }
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
 */
async function buildWriteSet(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  record: ProjectedRecord,
  existingInstanceId: string | null,
  refToConcrete: Map<string, ResourceFieldId>,
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

  for (const [rawRef, value] of Object.entries(record.fields)) {
    const strategy = strategyFor(rawRef)
    if (strategy === 'ignore') continue

    const concrete = refToConcrete.get(rawRef)
    if (!concrete) continue // unresolved @app: ref — already recorded in resolveFieldRefs
    const fieldId = getFieldId(concrete)
    if (identityRefs.has(rawRef)) identityFieldKeys.push(fieldId)

    const fieldUuid = keyToId?.get(fieldId)
    const fieldRow = fieldUuid ? fieldMap?.get(fieldUuid) : undefined
    const isMulti =
      !identityRefs.has(rawRef) &&
      (fieldRow?.options as { multi?: boolean } | null | undefined)?.multi === true

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

  // `overwrite` is the default when a binding carries no explicit mergeStrategy
  // (mirrors `strategyFor` in buildWriteSet), so an unset strategy counts here.
  // Identity-flagged refs are excluded — the sink forces them to fill-blank
  // (mirrors `strategyFor`'s override), so they never re-assert and can't drift.
  const overwriteRefs = mapping.fieldMappings
    .filter(
      (fm) =>
        fm.targetFieldRef != null &&
        fm.identityRole?.kind !== 'externalId' &&
        (fm.mergeStrategy == null || fm.mergeStrategy === 'overwrite')
    )
    .map((fm) => fm.targetFieldRef as ResourceFieldId)
  if (overwriteRefs.length === 0) return new Set()

  // Resolve each ref to the concrete CustomField uuid `FieldValue.fieldId` carries
  // (refs may be the late-bound `@app:` form; system fields key by systemAttribute).
  const connectionId = ctx.connector.credentialId ?? undefined
  const keyToId = await buildWriteKeyToFieldId(ctx.orgId, mapping.entityDefinitionId)
  const fieldMap = await getCachedFieldMap(ctx.orgId, mapping.entityDefinitionId)
  const fieldIds = new Set<string>()
  for (const ref of overwriteRefs) {
    const concrete = await resolveConnectorFieldRef(ref, ctx.orgId, connectionId)
    if (!concrete) continue
    const uuid = keyToId.get(getFieldId(concrete))
    if (!uuid) continue
    // Multi-value (`options.multi`) fields are ROW-SCOPED out of drift detection:
    // under row-level semantics, unmarked/foreign rows are legitimate (user
    // aliases, other connectors' rows), so a null-or-foreign marker no longer
    // signals a hand-edit. Without this, a single user alias makes every bound
    // record permanently "drifted" and the content-hash skip never fires again.
    // A user edit of the connector's own row is respected (never re-asserted)
    // until the SOURCE value changes — consistent with never-touch-other-rows.
    const field = fieldMap.get(uuid)
    if ((field?.options as { multi?: boolean } | null | undefined)?.multi === true) continue
    fieldIds.add(uuid)
  }
  if (fieldIds.size === 0) return new Set()

  // One query: bound instances of this mapping holding an overwrite cell no longer
  // stamped by this connector (NULL = hand-edited, or a different connector took over).
  const rows = await ctx.db
    .selectDistinct({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(
      schema.DataConnectorItem,
      eq(schema.DataConnectorItem.entityInstanceId, schema.FieldValue.entityId)
    )
    .where(
      and(
        eq(schema.DataConnectorItem.dataConnectorId, ctx.connector.id),
        eq(schema.DataConnectorItem.mappingId, mapping.row.id),
        inArray(schema.FieldValue.fieldId, Array.from(fieldIds)),
        or(
          isNull(schema.FieldValue.managedByConnectorId),
          ne(schema.FieldValue.managedByConnectorId, ctx.connector.id)
        )
      )
    )
  return new Set(rows.map((r) => r.entityId))
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
 * B2 sync-change capture. Reads existing values for the subset of `writeSet` keys the
 * org has an enabled field rule on (via the collector's subscription index), so record
 * rules can transition-match `{o, n}` for a connector write that suppressed per-write
 * events. Returns null when nothing subscribed is written (no query issued). MUST be
 * called BEFORE the write so `o` is the pre-write value. Field-value deps are
 * lazy-imported so the sink's mocked unit tests (no manifest) never load them.
 */
async function captureSubscribedChanges(
  ctx: SyncCtx,
  entityDefinitionId: string,
  instanceId: string,
  writeSet: Record<string, unknown>
): Promise<Record<string, ManifestFieldChange> | null> {
  const subs = ctx.manifest.subscriptionsFor(entityDefinitionId)
  if (!subs || subs.fieldIds.size === 0) return null
  const { captureUpdateFieldChanges } = await import('../../record-rules/capture-field-changes')
  return captureUpdateFieldChanges(
    ctx.db,
    ctx.orgId,
    entityDefinitionId,
    instanceId,
    writeSet,
    subs.fieldIds
  )
}

/**
 * B2 capture for a CREATE: subscribed written fields with no `o` (the row is new), so
 * `set` field rules fire on synced creates. No DB read.
 */
async function buildCreateChangeEntries(
  ctx: SyncCtx,
  entityDefinitionId: string,
  writeSet: Record<string, unknown>,
  subscribedFieldIds: ReadonlySet<string>
): Promise<Record<string, ManifestFieldChange> | null> {
  const { captureCreateFieldChanges } = await import('../../record-rules/capture-field-changes')
  return captureCreateFieldChanges(ctx.orgId, entityDefinitionId, writeSet, subscribedFieldIds)
}

/**
 * B2 §9: raw created values (systemAttribute-keyed) for native entity-trigger lifecycle
 * handlers on the sync door. No DB read — the writeSet is already in hand.
 */
async function buildCreatedValues(
  ctx: SyncCtx,
  entityDefinitionId: string,
  writeSet: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const { captureCreatedValues } = await import('../../record-rules/capture-field-changes')
  return captureCreatedValues(ctx.orgId, entityDefinitionId, writeSet)
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
    let matched: { fieldId?: FieldId; value: unknown } | undefined
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
      matched
    )

    // 3b. Plan the row-level writes BEFORE capture/write: the plan's projected
    //     arrays feed the manifest capture (record rules must see the resulting
    //     LIST as `n`, not the scalar source value), and its reads must be
    //     pre-write anyway.
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
          // B2: read pre-write old values for subscribed fields BEFORE the write.
          // Row-level fields contribute their PROJECTED resulting array (not the
          // scalar source value) so `{o, n}` describes the post-write list.
          //
          // KNOWN NON-ATOMICITY (F10): capture-read → write → recordChange are three
          // unlocked steps. A concurrent interactive edit (or sibling stream slice) on
          // the same subscribed field in that window can yield a manifest transition
          // that never happened as written. Tolerated: it needs same-field overlap
          // during an in-flight sync AND an old-value-conditioned rule; fixing it means
          // pushing capture inside the write's transaction (or RETURNING the prior
          // value from the write itself).
          //
          // KNOWN N+1 (F9): one pre-read per updated record that writes a subscribed
          // field. Records stream one at a time and the instanceId only exists after
          // per-record identity resolution, so there is no slice-level id list to batch
          // against — and the content-hash skip above means only genuinely changed
          // records pay it.
          const captured = ctx.manifest?.enabled
            ? await captureSubscribedChanges(ctx, mapping.entityDefinitionId, instanceId, {
                ...writeSet,
                ...rowPlan.captureSet,
              })
            : null
          // Shallow copy per attempt: a conflict retry mutates `writeSet`.
          await handler.update(recordId, { ...writeSet }, undefined, {
            skipEvents: true,
          })
          ctx.counters.updated += 1
          if (captured) ctx.manifest.recordChange(recordId, captured)
        } else {
          const created = await handler.create(
            mapping.entityDefinitionId,
            { ...writeSet },
            { skipEvents: true }
          )
          instanceId = created.instance.id
          justCreated = true
          ctx.counters.created += 1
          // Claim the fresh instance for this slice's two-source dedupe so a later
          // source record matching it (e.g. by alias) defers its field writes.
          ;(ctx.sliceWriteWinners ??= new Map()).set(
            `${mapping.row.id}::${instanceId}`,
            record.externalId
          )
          // B2: lifecycle-created + `set`-transition capture for synced creates.
          if (ctx.manifest?.enabled) {
            const recordId = toRecordId(mapping.entityDefinitionId, instanceId)
            const subs = ctx.manifest.subscriptionsFor(mapping.entityDefinitionId)
            if (subs) {
              if (subs.lifecycle.created) {
                // Thread the raw created values so native entity-trigger lifecycle handlers
                // (e.g. enrichCompanyOnCreate) can read them on the sync door without a DB
                // refetch (Phase 9 / Option A). No DB read — writeSet is already in hand.
                const createdValues = await buildCreatedValues(
                  ctx,
                  mapping.entityDefinitionId,
                  writeSet
                )
                ctx.manifest.recordCreated(recordId, createdValues ?? undefined)
              }
              const entries = await buildCreateChangeEntries(
                ctx,
                mapping.entityDefinitionId,
                writeSet,
                subs.fieldIds
              )
              if (entries) ctx.manifest.recordChange(recordId, entries)
            }
          }
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
        await ctx.ownedCrud.archive(recordId, {
          skipEvents: true,
        })
        ctx.touchedDefs.add(item.entityDefinitionId)
        ctx.counters.archived += 1
        // B2: lifecycle-deleted capture for synced archives (soft-archive; the record
        // still exists, so the consumer can snapshot last-known values).
        if (
          ctx.manifest?.enabled &&
          ctx.manifest.subscriptionsFor(item.entityDefinitionId)?.lifecycle.deleted
        ) {
          ctx.manifest.recordArchived(recordId)
        }
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

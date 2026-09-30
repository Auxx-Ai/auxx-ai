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
import { dayKeyInZone } from '@auxx/utils/calendar-day'
import { stableHash } from '@auxx/utils/hash'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import {
  FinancialSourceIdentityConflictError,
  recordStaleFinancialObservation,
  StaleFinancialSourceRevisionError,
} from '../../accounting/money/customer-money/source-write-errors'
import { resolveConnectorFieldRef } from '../../agents/bindings/resolve'
import { getCachedFieldMap } from '../../cache'
import { NotFoundError, UniqueValueConflictError } from '../../errors'
import { fieldValueSchemas } from '../../field-values/field-value-validator'
import { enqueueRecordImageFetch } from '../../files/remote-image/enqueue'
import { findRecordByIdentity, upsertRecordIdentity } from '../../identity'
import { ACQUISITION_METADATA_ATTRIBUTES } from '../../resources/registry/resources/financial-source-fields'
import { getInstanceId, toRecordId } from '../../resources/resource-id'
import { buildWriteKeyToFieldId } from '../field-id-resolver'
import { countOutcome } from '../run-counters'
import {
  type DataConnectorItemRow,
  type DecodedMapping,
  findItem,
  findItemByDef,
  listItemsForMapping,
  markItemArchived,
  markItemRemovedUpstream,
  type PendingRelation,
  setItemPendingRelations,
  touchItem,
  upsertItem,
} from '../service'
import { type SyncFieldShape, wouldHealField } from '../sync-state'
import type { FieldMergeStrategy } from '../types'
import { mintOptionKeys } from './mint-option-keys'
import {
  executeRowLevelWrites,
  planRowLevelWrites,
  type RowLevelField,
  type RowLevelWrite,
} from './row-level-writes'
import {
  createSinkPage,
  type IdentityScope,
  type ItemIo,
  identityScope,
  type SinkPage,
} from './sink-page'
import type { EntitySink, PageWrite, ProjectedRecord, SyncCtx } from './types'
import { type SinkWriter, sinkWriterForDef, writerKeyOf } from './writers'

const logger = createScopedLogger('data-connector-entity-sink')

/** The per-record lane: the service functions, forwarded with the caller's exact arguments. */
const directIo: ItemIo = {
  findItem: (...a) => findItem(...a),
  findItemByDef: (...a) => findItemByDef(...a),
  touchItem: (...a) => touchItem(...a),
  setItemPendingRelations: (...a) => setItemPendingRelations(...a),
  upsertItem: (...a) => upsertItem(...a),
  findRecordByIdentity: (...a) => findRecordByIdentity(...a),
  enqueueRecordImageFetch: (...a) => enqueueRecordImageFetch(...a),
}

/** The open page when `upsertRecords` is sinking one, else the database. */
function io(ctx: SyncCtx): ItemIo {
  return ctx.sinkPage ?? directIo
}

/**
 * The content hash: the projected source minus acquisition metadata, which a financial source
 * re-stamps on every fetch (`ACQUISITION_METADATA_ATTRIBUTES`). `exemptRefs` are raw refs.
 */
export function contentHashOf(record: ProjectedRecord, exemptRefs: ReadonlySet<string>): string {
  const fields =
    exemptRefs.size === 0
      ? record.fields
      : Object.fromEntries(Object.entries(record.fields).filter(([ref]) => !exemptRefs.has(ref)))
  return stableHash({ fields, displayName: record.displayName })
}

/** The record's refs whose target field is acquisition metadata. */
async function hashExemptRefs(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  record: ProjectedRecord,
  refToConcrete: Map<string, ResourceFieldId>
): Promise<Set<string>> {
  const exempt = new Set<string>()
  const fieldIds = new Map<string, string>()
  for (const ref of Object.keys(record.fields)) {
    const concrete = refToConcrete.get(ref)
    if (concrete) fieldIds.set(ref, getFieldId(concrete))
  }
  if (fieldIds.size === 0) return exempt
  const fieldMap = await getCachedFieldMap(ctx.orgId, mapping.entityDefinitionId)
  for (const [ref, id] of fieldIds) {
    const attribute = fieldMap?.get(id)?.systemAttribute ?? id
    if (ACQUISITION_METADATA_ATTRIBUTES.has(attribute)) exempt.add(ref)
  }
  return exempt
}

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

/** A connector-sourced image URL, fetched by the remote-image job after the record write. */
interface PendingImage {
  /** `CustomField.id` of the FILE field. */
  fieldId: string
  url: string
}

/** Multi-file FILE fields already logged as skipped, so a large sync logs each once. */
const loggedMultiFileFields = new Set<string>()

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
 * - Blank strings represent an empty selection, including delimiter-only strings.
 *   A nonblank single tag keeps its existing representation.
 */
export function coerceListValue(
  fieldType: string | undefined,
  value: unknown,
  isMulti: boolean
): unknown {
  if (isMulti || !fieldType || !LIST_VALUED_TYPES.has(fieldType)) return value
  if (typeof value !== 'string') return value
  if (!value.trim()) return []
  if (!value.includes(',')) return value
  const parts = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  return parts
}

/** An ISO datetime: date, clock time, optional offset. */
const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/

/**
 * The calendar day a connector's datetime falls on in `timeZone`, for a DATE field.
 *
 * The DATE converter rounds an instant to the nearest UTC midnight, which is right for a
 * midnight-encoded day but a day late for any real event after 12:00 UTC (a Shopify refund
 * at 15:21 PDT became the next day). A midnight or offset-less value keeps the day it names.
 */
export function coerceCalendarDay(value: unknown, timeZone: string): unknown {
  if (typeof value !== 'string') return value
  const match = ISO_DATETIME.exec(value.trim())
  if (!match) return value
  const [, day, time, offset] = match
  if (!offset || /^00:00(:00(\.0+)?)?$/.test(time!)) return day
  const instant = new Date(value.trim())
  return Number.isNaN(instant.getTime()) ? value : dayKeyInZone(instant, timeZone)
}

/** The book zone, read once per run and only when a DATE field receives a datetime. */
const bookZoneByCtx = new WeakMap<SyncCtx, Promise<string>>()
function bookZone(ctx: SyncCtx): Promise<string> {
  let zone = bookZoneByCtx.get(ctx)
  if (!zone) {
    zone = readBookTimeZoneOrUtc(ctx.orgId)
    bookZoneByCtx.set(ctx, zone)
  }
  return zone
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
 * The instance that already owns this record's external id in `RecordIdentity`,
 * via the mapping's `externalId`-role fields — the same key the mirror writes.
 */
async function findInstanceByRecordIdentity(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  record: ProjectedRecord,
  refToConcrete: Map<string, ResourceFieldId>
): Promise<string | null> {
  const identityRefs = mapping.fieldMappings.filter(
    (fm) => fm.targetFieldRef != null && fm.identityRole?.kind === 'externalId'
  )
  if (identityRefs.length === 0) return null

  const fieldMap = await getCachedFieldMap(ctx.orgId, mapping.entityDefinitionId)
  for (const fm of identityRefs) {
    const concrete = refToConcrete.get(fm.targetFieldRef!)
    const field = concrete ? fieldMap.get(getFieldId(concrete)) : undefined
    if (!field?.appSlug) continue
    const match = await io(ctx).findRecordByIdentity(
      {
        organizationId: ctx.orgId,
        entityDefinitionId: mapping.entityDefinitionId,
        source: field.appSlug,
        connectionId: field.connectionId ?? null,
        appFieldKey: field.appFieldKey ?? null,
        externalId: record.externalId,
      },
      ctx.db
    )
    if (match) return getInstanceId(match.recordId)
  }
  return null
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
 * stamped (stamping keys off the write set); it stays in `managedFields` when the source
 * carries a value, so the read side can show `paused` rather than nothing.
 *
 * `managedFields` lists the refs this run wrote a non-blank value for; `clearedFields` the
 * refs it wrote blank (the write clears the cell, so there is nothing left to heal).
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
  clearedFields: string[]
  identityFieldKeys: string[]
  pendingImages: PendingImage[]
}> {
  const mappedRefs = Object.keys(record.fields)
  // Raw `targetFieldRef` keys, the key space of the stored `DataConnectorItem.managedFields`.
  // A ref with no row after this write must not be managed, or drift re-syncs it every run.
  const managedFields: string[] = []
  const clearedFields: string[] = []
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
  const pendingImages: PendingImage[] = []

  // Field metadata: multi-detection + the fill_blank key-space fix. Write-set
  // keys may be systemAttributes while `getFieldValues` / `FieldValue.fieldId`
  // key by the CustomField uuid — resolve through the shared write-key map, or a
  // missed lookup silently turns `fill_blank` into `overwrite`.
  let keyToId: Map<string, string> | null = null
  let fieldMap: Map<string, RowLevelField> | null = null
  if (mappedRefs.length > 0) {
    keyToId = await buildWriteKeyToFieldId(ctx.orgId, mapping.entityDefinitionId)
    fieldMap = (await getCachedFieldMap(ctx.orgId, mapping.entityDefinitionId)) as unknown as Map<
      string,
      RowLevelField
    >
  }

  // Read current values once (only needed for fill_blank / connector_owned_only).
  const needsCurrent = mappedRefs.some((k) => {
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
      // Stays managed so unpinning re-asserts it; drift ignores it while pinned.
      if (!isBlank(sourceValue)) managedFields.push(rawRef)
      continue
    }
    const fieldRow = fieldUuid ? fieldMap?.get(fieldUuid) : undefined

    // A URL string on a FILE field would normalize to null and clear the image, so it is
    // diverted to the remote-image job; a blank one is neither written nor cleared.
    if (fieldRow?.type === 'FILE' && (typeof sourceValue === 'string' || isBlank(sourceValue))) {
      const url = typeof sourceValue === 'string' ? sourceValue.trim() : ''
      if (!url || !fieldUuid || strategy === 'manual_review') continue
      // Image ingest is one file per record; a multi-file gallery is left untouched.
      if (
        (fieldRow.options as { file?: { allowMultiple?: boolean } } | null)?.file?.allowMultiple
      ) {
        if (!loggedMultiFileFields.has(fieldUuid)) {
          loggedMultiFileFields.add(fieldUuid)
          logger.debug('URL on a multi-file FILE field — not fetched', {
            mappingId: mapping.row.id,
            fieldId: fieldUuid,
          })
        }
        continue
      }
      const hasImage = !isBlank(current ? rawOf(current.get(fieldUuid)) : undefined)
      if (strategy === 'fill_blank' && hasImage) continue
      if (strategy === 'connector_owned_only') {
        const item = await io(ctx).findItem(
          ctx.db,
          ctx.connector.id,
          mapping.row.id,
          record.externalId
        )
        if (item && !(item.managedFields ?? []).includes(rawRef)) continue
      }
      pendingImages.push({ fieldId: fieldUuid, url })
      managedFields.push(rawRef)
      continue
    }

    const isMulti =
      !identityRefs.has(rawRef) &&
      (fieldRow?.options as { multi?: boolean } | null | undefined)?.multi === true

    // A list-valued field (TAGS / MULTI_SELECT) arrives as a comma string, because a
    // connector cannot source an array. Split it into the list form the write path
    // understands — otherwise a multi-tag source writes ONE compound tag. Every
    // reference to `value` below is post-coercion by design.
    const dayValue =
      fieldRow?.type === 'DATE' && typeof sourceValue === 'string' && sourceValue.includes('T')
        ? coerceCalendarDay(sourceValue, await bookZone(ctx))
        : sourceValue
    const listValue = coerceListValue(fieldRow?.type, dayValue, isMulti)
    // Option labels become option keys, minted on the field when allowed — an
    // identity value is matched verbatim and must not be rewritten.
    const value = identityRefs.has(rawRef)
      ? listValue
      : await mintOptionKeys(ctx.db, ctx.orgId, fieldRow, listValue)

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
      managedFields.push(rawRef)
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

    const write = () => {
      writeSet[fieldId] = value
      ;(isBlank(value) ? clearedFields : managedFields).push(rawRef)
    }
    if (strategy === 'overwrite') {
      write()
      continue
    }
    if (strategy === 'connector_owned_only') {
      // Write only if this connector created/owns the field on this record. An empty cell is
      // nobody's, so a field that was blank upstream until now is still taken.
      const item = await io(ctx).findItem(
        ctx.db,
        ctx.connector.id,
        mapping.row.id,
        record.externalId
      )
      const cur = current ? rawOf(current.get(fieldUuid ?? fieldId)) : undefined
      const owns = !item || (item.managedFields ?? []).includes(rawRef) || isBlank(cur)
      if (owns) write()
      continue
    }
    if (strategy === 'fill_blank') {
      const cur = current ? rawOf(current.get(fieldUuid ?? fieldId)) : undefined
      if (isBlank(cur)) write()
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

  return { writeSet, rowWrites, managedFields, clearedFields, identityFieldKeys, pendingImages }
}

/** The record's refs a writer owns (ref → writer key), and the record without them. */
function splitWriterFields(
  writer: SinkWriter,
  record: ProjectedRecord
): { owned: Map<string, string>; rest: ProjectedRecord } {
  const owned = new Map<string, string>()
  const fields: Record<string, unknown> = {}
  for (const [ref, value] of Object.entries(record.fields)) {
    const key = writerKeyOf(writer, ref)
    if (key) owned.set(ref, key)
    else fields[ref] = value
  }
  return { owned, rest: { ...record, fields } }
}

/**
 * Hand a writer its keys of one record, with `buildWriteSet`'s strategy and pin rules: a
 * pinned key is skipped but stays managed, `connector_owned_only` writes over a key the item
 * manages and else fills a blank, identity keys only fill. Null when the write failed, counted.
 */
async function applyWriterValues(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  writer: SinkWriter,
  record: ProjectedRecord,
  owned: Map<string, string>,
  instanceId: string | null,
  bound: { managedFields?: string[] | null; pinnedFields?: string[] | null } | null | undefined
): Promise<{ instanceId: string; managed: string[]; cleared: string[] } | null> {
  const strategies = new Map<string, FieldMergeStrategy>()
  for (const fm of mapping.fieldMappings) {
    if (fm.targetFieldRef == null) continue
    const identity = fm.identityRole?.kind === 'externalId'
    strategies.set(fm.targetFieldRef, identity ? 'fill_blank' : (fm.mergeStrategy ?? 'overwrite'))
  }
  const values: Record<string, unknown> = {}
  const fillBlank: string[] = []
  const managed: string[] = []
  const cleared: string[] = []
  for (const [ref, key] of owned) {
    const strategy = strategies.get(ref) ?? 'overwrite'
    const value = record.fields[ref]
    if (strategy === 'ignore') continue
    if (bound?.pinnedFields?.includes(key)) {
      if (!isBlank(value)) managed.push(ref)
      continue
    }
    if (strategy === 'manual_review') continue
    const ownsKey = !bound || (bound.managedFields ?? []).includes(ref)
    if (strategy === 'fill_blank' || (strategy === 'connector_owned_only' && !ownsKey)) {
      fillBlank.push(key)
    }
    values[key] = value
  }
  const applied = await writer.apply(ctx.db, ctx.orgId, {
    instanceId,
    connectorId: ctx.connector.id,
    values,
    parents: {},
    ...(fillBlank.length > 0 ? { fillBlank } : {}),
  })
  if (applied.isOk()) {
    const wrote = new Set(applied.value.changed)
    for (const [ref, key] of owned) {
      if (!(key in values) || (fillBlank.includes(key) && !wrote.has(key))) continue
      ;(isBlank(values[key]) ? cleared : managed).push(ref)
    }
    return { instanceId: applied.value.instanceId, managed, cleared }
  }

  const message = applied.error.message
  countOutcome(ctx.counters, mapping.row.id, 'failed')
  if (ctx.counters.errorSample.length < 50) {
    ctx.counters.errorSample.push({
      externalId: record.externalId,
      error: message,
      tier: 'rejected',
    })
  }
  logger.warn('sink writer apply failed', {
    mappingId: mapping.row.id,
    externalId: record.externalId,
    error: message,
  })
  return null
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
  if (ctx.sinkPage) {
    ctx.sinkPage.stamp(instanceId, concreteIds)
    return
  }

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
    ctx.sinkPage?.noteIdentityWrite(
      identityScope(mapping.entityDefinitionId, { ...field, appSlug: field.appSlug }),
      externalId
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
function driftedInstances(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  writer?: SinkWriter
): Promise<Set<string>> {
  const memo = (ctx.driftByMapping ??= new Map())
  let pending = memo.get(mapping.row.id)
  if (!pending) {
    // The query reads items and cell markers, so a page's deferred writes land first.
    const page = ctx.sinkPage
    pending = page
      ? page.flush().then(() => computeDriftedInstances(ctx, mapping, writer))
      : computeDriftedInstances(ctx, mapping, writer)
    memo.set(mapping.row.id, pending)
  }
  return pending
}

type HealingBinding = DecodedMapping['fieldMappings'][number] & { targetFieldRef: ResourceFieldId }

async function computeDriftedInstances(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  writer?: SinkWriter
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
    (fm): fm is HealingBinding => fm.targetFieldRef != null && wouldHealField(fm, null)
  )
  if (healingBindings.length === 0) return new Set()
  if (!writer) return fieldValueDrift(ctx, mapping, healingBindings)
  const rest = healingBindings.filter((fm) => !writerKeyOf(writer, fm.targetFieldRef))
  return rest.length > 0 ? fieldValueDrift(ctx, mapping, rest) : new Set()
}

type DriftItem = Pick<
  DataConnectorItemRow,
  'mappingId' | 'entityInstanceId' | 'archivedAt' | 'managedFields' | 'pinnedFields'
>

/** Writer drift per open page, so one `readMarks` covers the page's bound items of a mapping. */
const writerDriftByPage = new WeakMap<SinkPage, Map<string, Promise<Set<string>>>>()

/**
 * Whether a writer key of `bound` drifted: its mark is another connector's, or absent while
 * the item manages it. Pinned keys never drift. Reads the open page's items, else `bound` alone.
 */
async function writerDrifted(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  writer: SinkWriter,
  bound: DriftItem
): Promise<boolean> {
  if (mapping.targetMode !== 'contributing' || !bound.entityInstanceId) return false
  const bindings = mapping.fieldMappings.filter(
    (fm): fm is HealingBinding =>
      fm.targetFieldRef != null &&
      wouldHealField(fm, null) &&
      writerKeyOf(writer, fm.targetFieldRef) !== undefined
  )
  if (bindings.length === 0) return false
  const page = ctx.sinkPage
  if (!page) return (await writerDrift(ctx, writer, bindings, [bound])).has(bound.entityInstanceId)

  const memo = writerDriftByPage.get(page) ?? new Map<string, Promise<Set<string>>>()
  writerDriftByPage.set(page, memo)
  let pending = memo.get(mapping.row.id)
  if (!pending) {
    pending = writerDrift(ctx, writer, bindings, page.itemsOf(mapping.row.id))
    memo.set(mapping.row.id, pending)
  }
  return (await pending).has(bound.entityInstanceId)
}

async function writerDrift(
  ctx: SyncCtx,
  writer: SinkWriter,
  bindings: HealingBinding[],
  candidates: DriftItem[]
): Promise<Set<string>> {
  const items = candidates.filter((i) => i.archivedAt == null && i.entityInstanceId != null)
  if (items.length === 0) return new Set()
  const marksById = await writer.readMarks(
    ctx.db,
    ctx.orgId,
    items.map((i) => i.entityInstanceId!)
  )
  const drifted = new Set<string>()
  for (const item of items) {
    const marks = marksById.get(item.entityInstanceId!) ?? {}
    const managed = item.managedFields ?? []
    const pinned = item.pinnedFields ?? []
    const off = bindings.some((fm) => {
      const key = writerKeyOf(writer, fm.targetFieldRef)!
      if (pinned.includes(key)) return false
      const mark = marks[key]
      return mark === undefined ? managed.includes(fm.targetFieldRef) : mark !== ctx.connector.id
    })
    if (off) drifted.add(item.entityInstanceId!)
  }
  return drifted
}

async function fieldValueDrift(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  healingBindings: HealingBinding[]
): Promise<Set<string>> {
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

  await ctx.sinkPage?.flushForItemReads()
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
 * Un-archive a record this connector archived on an earlier reconcile, now that its
 * upstream record reappeared (v12.1 Phase 1). The instance's own `archivedAt` is read
 * first: under the def-keyed sharing guard `archiveRecord` stamps the binding but
 * leaves the record live, and `restoreEntity` on a live record is not a no-op (it
 * rewrites `updatedAt`) and would count a restore that never happened. Failure is
 * logged and swallowed, like `archiveRecord`: one bad row must not fail the record.
 */
async function restoreArchivedRecord(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  itemId: string,
  entityInstanceId: string
): Promise<void> {
  try {
    const instance = await ctx.db.query.EntityInstance.findFirst({
      where: and(
        eq(schema.EntityInstance.id, entityInstanceId),
        eq(schema.EntityInstance.organizationId, ctx.orgId)
      ),
      columns: { archivedAt: true },
    })
    if (!instance?.archivedAt) return
    const handler = mapping.targetMode === 'owned' ? ctx.ownedCrud : ctx.crud
    await handler.restore(toRecordId(mapping.entityDefinitionId, entityInstanceId))
    ctx.touchedDefs.add(mapping.entityDefinitionId)
    ctx.counters.restored += 1
  } catch (error) {
    logger.warn('restore of a reappeared record failed', {
      itemId,
      entityInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
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

    // A writer-backed def: its keys go to `writer.apply`, the rest take the ordinary write.
    const writer = await sinkWriterForDef(ctx.orgId, mapping.entityDefinitionId)
    const split = writer ? splitWriterFields(writer, record) : null
    const ordinary = split?.rest ?? record

    // Resolve every mapped `targetFieldRef` to a concrete field id once — both the
    // identity lookup and the write set key off this table (§3.3).
    const refToConcrete = await resolveFieldRefs(ctx, ordinary)

    const items = io(ctx)
    // 1. Resolve identity — exact bind, else strategy bootstrap.
    const bound = await items.findItem(ctx.db, ctx.connector.id, mapping.row.id, record.externalId)

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
      await items.touchItem(ctx.db, bound.id, ctx.runId)
      countOutcome(ctx.counters, mapping.row.id, 'skipped')
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
      const shared = await items.findItemByDef(
        ctx.db,
        ctx.connector.id,
        mapping.entityDefinitionId,
        record.externalId
      )
      instanceId = shared?.entityInstanceId ?? null
    }
    // 1b''. An unbound record whose external id is already held in RecordIdentity
    //       (bindings wiped, record kept) re-binds rather than minting a duplicate.
    if (!instanceId) {
      instanceId = await findInstanceByRecordIdentity(ctx, mapping, record, refToConcrete)
    }
    let matched: { fieldId?: FieldId; value: unknown; exclusive?: boolean } | undefined
    if (!instanceId) {
      const resolved = await resolveIdentity(ctx, mapping, record, refToConcrete)
      if (resolved.failed) {
        // Every configured match candidate was array-shaped — fail the record
        // VISIBLY instead of falling through to create a silent duplicate.
        countOutcome(ctx.counters, mapping.row.id, 'failed')
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
        countOutcome(ctx.counters, mapping.row.id, 'skipped')
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

    // A page defers provenance stamps; this instance's land before its cells are read or written.
    if (instanceId) await ctx.sinkPage?.flushStampsFor(instanceId)

    // 1d. A binding THIS connector archived (item.archivedAt set) whose record is back
    //     in the crawl: restore the record, then let the normal path (touchItem or
    //     upsertItem) clear the item stamps. Only the connector's own archive is
    //     undone: a human archive leaves item.archivedAt null and is never touched.
    if (bound?.entityInstanceId && bound.archivedAt) {
      await restoreArchivedRecord(ctx, mapping, bound.id, bound.entityInstanceId)
    }

    // 2. Content hash — skip unchanged + already bound, UNLESS an overwrite cell
    //    has drifted (hand-edited in the grid). The hash is computed over the
    //    SOURCE only, so a destination edit is invisible to it; without the drift
    //    guard an `overwrite` field silently never re-asserts the source value
    //    while the source is stable. Drift is detected in bulk, once per mapping.
    const contentHash = contentHashOf(
      record,
      await hashExemptRefs(ctx, mapping, record, refToConcrete)
    )
    if (bound?.entityInstanceId && bound.contentHash === contentHash) {
      // Source is unchanged — skip, unless an overwrite cell drifted (hand-edited),
      // in which case fall through to re-assert the source value. Drift is only
      // queried here, when we'd otherwise skip, so a create-only backfill pays nothing.
      const drifted =
        (await driftedInstances(ctx, mapping, writer)).has(bound.entityInstanceId) ||
        (writer ? await writerDrifted(ctx, mapping, writer, bound) : false)
      if (!drifted) {
        // Advance the version high-watermark even on a no-op content update so a
        // later genuinely-older event is still caught by the §9 Q7 guard above.
        const newerStamp =
          record.upstreamUpdatedAt &&
          (!bound.upstreamUpdatedAt ||
            record.upstreamUpdatedAt.getTime() > bound.upstreamUpdatedAt.getTime())
            ? record.upstreamUpdatedAt
            : undefined
        await items.touchItem(ctx.db, bound.id, ctx.runId, newerStamp)
        countOutcome(ctx.counters, mapping.row.id, 'skipped')
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
      countOutcome(ctx.counters, mapping.row.id, 'skipped')
      await items.upsertItem(ctx.db, {
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
    let { writeSet, rowWrites, managedFields, clearedFields, identityFieldKeys, pendingImages } =
      await buildWriteSet(
        ctx,
        mapping,
        ordinary,
        instanceId,
        refToConcrete,
        bound?.pinnedFields ?? [],
        matched
      )

    // 3b. Plan the row-level writes BEFORE the write: the plan reads the field's
    //     current rows to decide per value between no-op / in-place update /
    //     append, so its reads must be pre-write.
    let rowPlan =
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
    let ignoredRevision = false
    let retriedIdentity = false
    // Per-value uniqueness tolerance (B1): a `UniqueValueConflictError` thrown from
    // inside the write (A1's pre-hooks / unique-field validation) fails ONE value,
    // not the record — drop the conflicting key from the write set and retry, so
    // the sync stays green instead of the whole record retrying forever.
    const maxConflictDrops = Object.keys(writeSet).length
    const droppedKeys = new Set<string>()

    // 4-. The writer mints or updates first; the ordinary write then lands on its instance.
    let writerManaged: string[] = []
    let unhashed = false
    let writerCleared: string[] = []
    if (writer && split) {
      const applied = await applyWriterValues(
        ctx,
        mapping,
        writer,
        record,
        split.owned,
        instanceId,
        bound
      )
      if (!applied) return
      ;({ managed: writerManaged, cleared: writerCleared } = applied)
      if (instanceId) {
        countOutcome(ctx.counters, mapping.row.id, 'updated')
      } else {
        instanceId = applied.instanceId
        justCreated = true
        countOutcome(ctx.counters, mapping.row.id, 'created')
        ;(ctx.sliceWriteWinners ??= new Map()).set(
          `${mapping.row.id}::${instanceId}`,
          record.externalId
        )
      }
    }

    for (let conflictDrops = 0; ; ) {
      if (writer && instanceId && Object.keys(writeSet).length === 0) break
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
          if (!writer) countOutcome(ctx.counters, mapping.row.id, 'updated')
        } else {
          const created = await handler.create(mapping.entityDefinitionId, { ...writeSet })
          instanceId = created.instance.id
          justCreated = true
          countOutcome(ctx.counters, mapping.row.id, 'created')
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
        if (instanceId && error instanceof NotFoundError) {
          const instance = await ctx.db.query.EntityInstance.findFirst({
            where: and(
              eq(schema.EntityInstance.id, instanceId),
              eq(schema.EntityInstance.organizationId, ctx.orgId)
            ),
            columns: { archivedAt: true },
          })
          if (instance?.archivedAt) {
            if (bound) await items.touchItem(ctx.db, bound.id, ctx.runId)
            countOutcome(ctx.counters, mapping.row.id, 'skipped')
            return
          }
        }
        if (
          !instanceId &&
          !retriedIdentity &&
          error instanceof FinancialSourceIdentityConflictError
        ) {
          // The failed create rolled back. Re-check the normal match field after
          // the competing transaction committed; never redirect an existing record.
          retriedIdentity = true
          const resolved = await resolveIdentity(ctx, mapping, record, refToConcrete)
          if (resolved.instanceId === error.canonicalRecordId) {
            instanceId = resolved.instanceId
            matched = resolved.matched
            if (instanceId) await ctx.sinkPage?.flushStampsFor(instanceId)
            ;({
              writeSet,
              rowWrites,
              managedFields,
              clearedFields,
              identityFieldKeys,
              pendingImages,
            } = await buildWriteSet(
              ctx,
              mapping,
              ordinary,
              instanceId,
              refToConcrete,
              bound?.pinnedFields ?? [],
              matched
            ))
            rowPlan = await planRowLevelWrites(
              ctx,
              mapping.entityDefinitionId,
              instanceId,
              rowWrites
            )
            continue
          }
        }
        if (instanceId && error instanceof StaleFinancialSourceRevisionError) {
          await recordStaleFinancialObservation(ctx.db, ctx.orgId, error)
          countOutcome(ctx.counters, mapping.row.id, 'skipped')
          ignoredRevision = true
          break
        }
        if (error instanceof UniqueValueConflictError && conflictDrops < maxConflictDrops) {
          const droppedKey = dropConflictingKey(writeSet, error)
          if (droppedKey) {
            conflictDrops += 1
            droppedKeys.add(droppedKey)
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
        countOutcome(ctx.counters, mapping.row.id, 'failed')
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
        if (!(writer && justCreated && instanceId)) return
        // The writer already minted the instance: bind it unhashed, so the next sync retries.
        ignoredRevision = true
        unhashed = true
        break
      }
    }

    // 4a. Execute the planned row-level writes (multi fields): in-place own-row
    //     updates + end-appends, each stamping only its own row. Per-value
    //     failures are logged inside — they never fail the record.
    if (!ignoredRevision && instanceId && rowPlan.actions.length > 0) {
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
    if (!ignoredRevision && mapping.targetMode === 'contributing' && instanceId) {
      const stampableKeys = Object.keys(writeSet).filter((key) => !identityFieldKeys.includes(key))
      await stampContributingProvenance(ctx, mapping.entityDefinitionId, instanceId, stampableKeys)
    }

    // 4c. Mirror identity-flagged fields into RecordIdentity, regardless of
    //     whether fill-blank actually wrote this run — the mirror stays in
    //     sync with the (already-established) cell value either way.
    if (!ignoredRevision && instanceId) {
      await mirrorIdentityWrites(ctx, mapping, instanceId, record.externalId, identityFieldKeys)
    }

    // 4d. Image URLs on FILE fields: fetched off the slice, after the record exists.
    if (!ignoredRevision && instanceId) {
      for (const image of pendingImages) {
        await items.enqueueRecordImageFetch({
          organizationId: ctx.orgId,
          entityDefinitionId: mapping.entityDefinitionId,
          instanceId,
          fieldId: image.fieldId,
          url: image.url,
          connectorId: ctx.connector.id,
        })
      }
    }

    // 5. Upsert the binding — merge any new managed fields with prior ones
    //    (contributing records are co-owned field-by-field across connectors).
    const cleared = new Set(ignoredRevision ? [] : [...clearedFields, ...writerCleared])
    const written = ignoredRevision
      ? []
      : managedFields
          .filter((ref) => {
            const concrete = refToConcrete.get(ref)
            return !concrete || !droppedKeys.has(getFieldId(concrete))
          })
          .concat(writerManaged)
    const mergedManaged = Array.from(new Set([...(bound?.managedFields ?? []), ...written])).filter(
      (ref) => !cleared.has(ref)
    )
    await items.upsertItem(ctx.db, {
      dataConnectorId: ctx.connector.id,
      organizationId: ctx.orgId,
      mappingId: mapping.row.id,
      externalId: record.externalId,
      entityDefinitionId: mapping.entityDefinitionId,
      entityInstanceId: instanceId,
      contentHash: unhashed ? '' : contentHash,
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

  async upsertRecords(writes, ctx) {
    const opened = !ctx.sinkPage
    if (opened) await openSinkPage(ctx, writes)
    try {
      for (const w of writes) await entitySink.upsertRecord(ctx, w.mapping, w.record)
    } catch (error) {
      if (opened) await closeSinkPage(ctx).catch((e) => logFlushFailure(ctx, e))
      throw error
    }
    if (opened) await closeSinkPage(ctx)
  },

  async archiveRecord(ctx, item, behavior) {
    if (behavior === 'ignore' || !item.entityInstanceId) return

    // A page's deferred writes to this item land before the archive, then memory lets go of it.
    if (ctx.sinkPage) {
      await ctx.sinkPage.flush()
      ctx.sinkPage.forget(item.id)
    }

    // `mark_deleted` leaves the record LIVE and flags the binding instead. This is the
    // safe answer whenever "gone upstream" is not authority to remove the record: a
    // record this connector did not mint, a part carrying stock movements, or any
    // crawl whose completeness we don't fully trust yet. A human acts on the flag.
    if (behavior === 'mark_deleted') {
      await markItemRemovedUpstream(ctx.db, item.id, ctx.runId)
      ctx.counters.markedDeleted += 1
      return
    }

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
    await markItemArchived(ctx.db, item.id, ctx.runId)
  },

  async listExistingItems(ctx, mapping) {
    const items = await listItemsForMapping(ctx.db, ctx.connector.id, mapping.row.id)
    return items.map((i) => ({
      id: i.id,
      entityInstanceId: i.entityInstanceId,
      entityDefinitionId: i.entityDefinitionId,
      lastSeenRunId: i.lastSeenRunId,
      mintedInstance: i.mintedInstance,
      removedUpstreamAt: i.removedUpstreamAt,
      archivedAt: i.archivedAt,
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
  await io(ctx).setItemPendingRelations(
    ctx.db,
    itemId,
    mergePending(existing, incoming, linkedRelations)
  )
}

/**
 * Open a page on `ctx`: one read for the items every write binds by mapping or def, and one
 * `RecordIdentity` read per scope for the writes with no bound instance. A failed read leaves
 * no page, so the writes sink per record exactly as before.
 */
export async function openSinkPage(ctx: SyncCtx, writes: PageWrite[]): Promise<void> {
  if (ctx.sinkPage) return
  try {
    const page = createSinkPage(ctx)
    await page.loadItems(
      writes.map((w) => ({
        mappingId: w.mapping.row.id,
        defId: w.mapping.entityDefinitionId,
        externalId: w.record.externalId,
      }))
    )
    const unbound: PageWrite[] = []
    for (const w of writes) {
      const args = [ctx.db, ctx.connector.id] as const
      const bound = await page.findItem(...args, w.mapping.row.id, w.record.externalId)
      if (bound?.entityInstanceId) continue
      const shared = await page.findItemByDef(
        ...args,
        w.mapping.entityDefinitionId,
        w.record.externalId
      )
      if (!shared?.entityInstanceId) unbound.push(w)
    }
    await loadUnboundIdentities(ctx, page, unbound)
    ctx.sinkPage = page
  } catch (error) {
    logger.warn('page bind read failed — sinking this page per record', {
      connectorId: ctx.connector.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Write what the open page deferred and close it. */
export async function closeSinkPage(ctx: SyncCtx): Promise<void> {
  const page = ctx.sinkPage
  ctx.sinkPage = undefined
  await page?.flush()
}

function logFlushFailure(ctx: SyncCtx, error: unknown): void {
  logger.warn('page flush failed after a sink error', {
    connectorId: ctx.connector.id,
    error: error instanceof Error ? error.message : String(error),
  })
}

/** `findInstanceByRecordIdentity`'s lookups for the page's unbound writes, one per scope. */
async function loadUnboundIdentities(
  ctx: SyncCtx,
  page: SinkPage,
  unbound: PageWrite[]
): Promise<void> {
  const connectionId = ctx.connector.credentialId ?? undefined
  const scopes = new Map<string, { scope: IdentityScope; ids: Set<string> }>()
  for (const { mapping, record: raw } of unbound) {
    const identityRefs = mapping.fieldMappings.filter(
      (fm) => fm.targetFieldRef != null && fm.identityRole?.kind === 'externalId'
    )
    if (identityRefs.length === 0) continue
    const record = injectConnectionAppFields(ctx, mapping, raw)
    const present = new Set([
      ...Object.keys(record.fields),
      ...record.identityCandidates.map((c) => c.targetFieldRef as string),
    ])
    const fieldMap = await getCachedFieldMap(ctx.orgId, mapping.entityDefinitionId)
    for (const fm of identityRefs) {
      if (!present.has(fm.targetFieldRef!)) continue
      const concrete = await resolveConnectorFieldRef(
        fm.targetFieldRef as ResourceFieldId,
        ctx.orgId,
        connectionId
      )
      const field = concrete ? fieldMap.get(getFieldId(concrete)) : undefined
      if (!field?.appSlug) continue
      const scope = identityScope(mapping.entityDefinitionId, { ...field, appSlug: field.appSlug })
      const key = JSON.stringify(scope)
      const entry = scopes.get(key) ?? { scope, ids: new Set<string>() }
      entry.ids.add(record.externalId)
      scopes.set(key, entry)
    }
  }
  for (const { scope, ids } of scopes.values()) await page.loadIdentities(scope, [...ids])
}

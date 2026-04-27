// packages/lib/src/field-values/timeline-snapshot.ts

import { type Database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { type ActorId, toActorId } from '@auxx/types/actor'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import {
  type CachedGroup,
  getCachedGroups,
  getCachedMembersByUserIds,
  getCachedResources,
  type OrgMemberInfo,
} from '../cache'
import type { Resource as CachedResource } from '../resources/registry/types'
import {
  TIMELINE_SNAPSHOT_ARRAY_LIMIT,
  TIMELINE_SNAPSHOT_BODY_LIMIT,
  TIMELINE_SNAPSHOT_LABEL_LIMIT,
  type TimelineFieldChangeSnapshot,
  type TimelineFieldChangeSnapshotValue,
  truncateForSnapshot,
} from '../timeline/field-change-snapshot'
import { booleanConverter } from './converters/boolean'
import { currencyConverter, numberConverter } from './converters/number'
import { phoneConverter } from './converters/phone'
import type { CachedField } from './types'

const logger = createScopedLogger('timeline-snapshot')

// =============================================================================
// PUBLIC API
// =============================================================================

export interface SnapshotContext {
  db: Database
  organizationId: string
  /**
   * Optional preloaded cache data; bulk callers should pass these once per
   * operation. Single-write callers may omit them and let the resolver
   * lazily fetch the small set it needs.
   */
  cache?: {
    resourcesById?: Map<string, CachedResource>
    membersByUserId?: Map<string, OrgMemberInfo>
    groupsById?: Map<string, CachedGroup>
  }
}

/**
 * Resolve a `TypedFieldValue` (or array) into a self-contained snapshot
 * suitable for storing on a `TimelineEvent` row. Uses cached metadata
 * first and performs batched DB lookups only when relationship/actor
 * values lack denormalized labels. Returns `null` when value is empty.
 */
export async function resolveFieldChangeSnapshot(
  ctx: SnapshotContext,
  field: CachedField,
  value: TypedFieldValue | TypedFieldValue[] | null
): Promise<TimelineFieldChangeSnapshotValue> {
  const { oldDisplay } = await resolveFieldChangeSnapshotPair(ctx, field, value, null)
  return oldDisplay
}

/**
 * Batched variant — resolve old + new together. Used by `setValueWithBuiltIn`
 * so a single field write does cache lookups once and performs at most one
 * DB fallback query per unresolved ref type.
 */
export async function resolveFieldChangeSnapshotPair(
  ctx: SnapshotContext,
  field: CachedField,
  oldValue: TypedFieldValue | TypedFieldValue[] | null,
  newValue: TypedFieldValue | TypedFieldValue[] | null
): Promise<{
  oldDisplay: TimelineFieldChangeSnapshotValue
  newDisplay: TimelineFieldChangeSnapshotValue
}> {
  try {
    const lookups = await collectAndResolveRefs(ctx, [{ field, values: [oldValue, newValue] }])
    return {
      oldDisplay: buildSnapshotValue(field, oldValue, lookups),
      newDisplay: buildSnapshotValue(field, newValue, lookups),
    }
  } catch (error) {
    logger.error('Snapshot resolution failed; falling back to legacy shape', {
      fieldId: field.id,
      fieldType: field.type,
      error: error instanceof Error ? error.message : String(error),
    })
    // Fallback: build snapshots without lookups so the post-hook still
    // publishes a usable event. Never let snapshot resolution fail a write.
    return {
      oldDisplay: buildSnapshotValue(field, oldValue, EMPTY_LOOKUPS),
      newDisplay: buildSnapshotValue(field, newValue, EMPTY_LOOKUPS),
    }
  }
}

/**
 * One write inside a bulk dispatch — `(recordId, field, oldValue, newValue)`.
 */
export interface BulkSnapshotWrite {
  recordId: RecordId
  field: CachedField
  oldValue: TypedFieldValue | TypedFieldValue[] | null
  newValue: TypedFieldValue | TypedFieldValue[] | null
}

/**
 * Vectorized variant of `resolveFieldChangeSnapshotPair` — collects all
 * unresolved relationship/actor refs across every write in the bulk op and
 * issues at most one DB query per ref type. Returns a map keyed by
 * `${recordId}:${fieldId}` with the same `{ oldDisplay, newDisplay }` shape.
 *
 * Callers should preload `ctx.cache` once per bulk op (resources, members,
 * groups) so even cache-only paths skip per-write fetches.
 */
export async function resolveFieldChangeSnapshotsBulk(
  ctx: SnapshotContext,
  writes: BulkSnapshotWrite[]
): Promise<
  Map<
    string,
    { oldDisplay: TimelineFieldChangeSnapshotValue; newDisplay: TimelineFieldChangeSnapshotValue }
  >
> {
  const out = new Map<
    string,
    { oldDisplay: TimelineFieldChangeSnapshotValue; newDisplay: TimelineFieldChangeSnapshotValue }
  >()
  if (writes.length === 0) return out

  // Group by fieldId so collectAndResolveRefs sees one entry per distinct
  // field — same shape it expects for the single-write path, just summed.
  const byField = new Map<
    string,
    { field: CachedField; values: Array<TypedFieldValue | TypedFieldValue[] | null> }
  >()
  for (const w of writes) {
    const existing = byField.get(w.field.id)
    if (existing) {
      existing.values.push(w.oldValue, w.newValue)
    } else {
      byField.set(w.field.id, {
        field: w.field,
        values: [w.oldValue, w.newValue],
      })
    }
  }

  let lookups: ResolvedLookups
  try {
    lookups = await collectAndResolveRefs(ctx, [...byField.values()])
  } catch (error) {
    logger.error('Bulk snapshot resolution failed; falling back to empty lookups', {
      writes: writes.length,
      error: error instanceof Error ? error.message : String(error),
    })
    lookups = EMPTY_LOOKUPS
  }

  for (const w of writes) {
    out.set(`${w.recordId}:${w.field.id}`, {
      oldDisplay: buildSnapshotValue(w.field, w.oldValue, lookups),
      newDisplay: buildSnapshotValue(w.field, w.newValue, lookups),
    })
  }
  return out
}

/**
 * Preload the per-org caches the snapshot resolver consults so a bulk
 * dispatch hits each one exactly once. Pass the resulting object as
 * `ctx.cache` to `resolveFieldChangeSnapshotsBulk`. Skips loads we can prove
 * unnecessary based on the field types involved.
 */
export async function preloadSnapshotCache(
  organizationId: string,
  writes: BulkSnapshotWrite[]
): Promise<NonNullable<SnapshotContext['cache']>> {
  let needsResources = false
  let needsGroups = false
  const userIds = new Set<string>()

  for (const w of writes) {
    const fieldType = w.field.type as FieldType
    if (fieldType === 'RELATIONSHIP') {
      needsResources = true
    } else if (fieldType === 'ACTOR') {
      // Actor values may be users, groups, or both — preload both lookups
      // unless we can confirm the field is locked to one actor type.
      needsGroups = true
      for (const v of [w.oldValue, w.newValue]) {
        if (v === null) continue
        const arr = Array.isArray(v) ? v : [v]
        for (const single of arr) {
          if (single.type === 'actor' && single.actorType === 'user') {
            userIds.add(single.id)
          }
        }
      }
    }
  }

  const [resourcesById, groupsById, members] = await Promise.all([
    needsResources
      ? getCachedResources(organizationId).then((rs) => new Map(rs.map((r) => [r.id, r])))
      : Promise.resolve(new Map<string, CachedResource>()),
    needsGroups
      ? getCachedGroups(organizationId).then((gs) => new Map(gs.map((g) => [g.id, g])))
      : Promise.resolve(new Map<string, CachedGroup>()),
    userIds.size > 0
      ? getCachedMembersByUserIds(organizationId, [...userIds])
      : Promise.resolve([] as OrgMemberInfo[]),
  ])

  const membersByUserId = new Map<string, OrgMemberInfo>()
  for (const m of members) membersByUserId.set(m.userId, m)

  return { resourcesById, membersByUserId, groupsById }
}

// =============================================================================
// REF COLLECTION + BATCHED RESOLUTION
// =============================================================================

interface ResolvedLookups {
  /** entityInstanceId → displayName (or null) for relationship recordIds. */
  relatedDisplayNames: Map<string, string | null>
  /** entityDefinitionId → CachedResource for relationship entityType resolution. */
  resourcesById: Map<string, CachedResource>
  /** userId → { displayName, avatarUrl } for actor user resolution. */
  users: Map<string, { displayName: string | null; avatarUrl: string | null }>
  /** groupInstanceId → CachedGroup for actor group resolution. */
  groups: Map<string, CachedGroup>
}

const EMPTY_LOOKUPS: ResolvedLookups = {
  relatedDisplayNames: new Map(),
  resourcesById: new Map(),
  users: new Map(),
  groups: new Map(),
}

async function collectAndResolveRefs(
  ctx: SnapshotContext,
  fieldGroups: Array<{
    field: CachedField
    values: Array<TypedFieldValue | TypedFieldValue[] | null>
  }>
): Promise<ResolvedLookups> {
  // Distinct refs needing batched resolution, summed across every field
  // group passed in. Bulk callers pass many groups; single-write callers
  // pass exactly one.
  const unresolvedRecordIds = new Set<RecordId>()
  const unresolvedUserIds = new Set<string>()
  const unresolvedGroupIds = new Set<string>()
  // Distinct entityDefIds (for relationship entityType lookup), even when
  // the value carries a denormalized displayName.
  const allEntityDefIds = new Set<string>()
  let anyRelationship = false
  let anyActor = false

  for (const { field, values } of fieldGroups) {
    const fieldType = field.type as FieldType
    const isRelationship = fieldType === 'RELATIONSHIP'
    const isActor = fieldType === 'ACTOR'
    if (!isRelationship && !isActor) continue
    anyRelationship = anyRelationship || isRelationship
    anyActor = anyActor || isActor

    for (const v of values) {
      if (v === null) continue
      const arr = Array.isArray(v) ? v : [v]
      for (const single of arr) {
        if (isRelationship && single.type === 'relationship') {
          const { entityDefinitionId } = parseRecordId(single.recordId)
          allEntityDefIds.add(entityDefinitionId)
          if (!single.displayName) unresolvedRecordIds.add(single.recordId)
        } else if (isActor && single.type === 'actor') {
          if (!single.displayName) {
            if (single.actorType === 'user') unresolvedUserIds.add(single.id)
            else if (single.actorType === 'group') unresolvedGroupIds.add(single.id)
          }
        }
      }
    }
  }

  if (!anyRelationship && !anyActor) return EMPTY_LOOKUPS

  // Resources cache is shared across the whole org; load once if needed.
  const resourcesById =
    ctx.cache?.resourcesById ??
    (allEntityDefIds.size > 0
      ? new Map((await getCachedResources(ctx.organizationId)).map((r) => [r.id, r]))
      : new Map<string, CachedResource>())

  // Relationship displayNames: prefer batched DB lookup over cache (cache is
  // stale-prone for arbitrary EntityInstance updates). Only one query for
  // the whole pair.
  const relatedDisplayNames =
    unresolvedRecordIds.size > 0
      ? await batchFetchRelatedDisplayNames(ctx.db, ctx.organizationId, [...unresolvedRecordIds])
      : new Map<string, string | null>()

  // User actor resolution: cache → DB fallback for misses.
  const users = await resolveUserActors(
    ctx,
    [...unresolvedUserIds],
    ctx.cache?.membersByUserId ?? null
  )

  // Group actor resolution: cache only.
  const groups =
    ctx.cache?.groupsById ??
    (unresolvedGroupIds.size > 0
      ? new Map((await getCachedGroups(ctx.organizationId)).map((g) => [g.id, g]))
      : new Map<string, CachedGroup>())

  return { relatedDisplayNames, resourcesById, users, groups }
}

async function batchFetchRelatedDisplayNames(
  db: Database,
  organizationId: string,
  recordIds: RecordId[]
): Promise<Map<string, string | null>> {
  if (recordIds.length === 0) return new Map()
  const instanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)
  const rows = await db
    .select({
      id: schema.EntityInstance.id,
      displayName: schema.EntityInstance.displayName,
    })
    .from(schema.EntityInstance)
    .where(
      and(
        inArray(schema.EntityInstance.id, instanceIds),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
  const map = new Map<string, string | null>()
  for (const row of rows) map.set(row.id, row.displayName)
  return map
}

async function resolveUserActors(
  ctx: SnapshotContext,
  userIds: string[],
  preloadedMembers: Map<string, OrgMemberInfo> | null
): Promise<Map<string, { displayName: string | null; avatarUrl: string | null }>> {
  const out = new Map<string, { displayName: string | null; avatarUrl: string | null }>()
  if (userIds.length === 0) return out

  const remaining = new Set(userIds)

  // Cache pass.
  if (preloadedMembers) {
    for (const id of userIds) {
      const m = preloadedMembers.get(id)
      if (m?.user) {
        out.set(id, { displayName: m.user.name ?? m.user.email, avatarUrl: m.user.image })
        remaining.delete(id)
      }
    }
  } else {
    const members = await getCachedMembersByUserIds(ctx.organizationId, userIds)
    for (const m of members) {
      if (m.user) {
        out.set(m.userId, {
          displayName: m.user.name ?? m.user.email,
          avatarUrl: m.user.image,
        })
        remaining.delete(m.userId)
      }
    }
  }

  // DB fallback for users that aren't org members (system users, deactivated, etc.)
  if (remaining.size > 0) {
    const rows = await ctx.db
      .select({
        id: schema.User.id,
        name: schema.User.name,
        email: schema.User.email,
        image: schema.User.image,
      })
      .from(schema.User)
      .where(inArray(schema.User.id, [...remaining]))
    for (const r of rows) {
      out.set(r.id, { displayName: r.name ?? r.email, avatarUrl: r.image })
    }
  }

  return out
}

// =============================================================================
// SNAPSHOT BUILDERS
// =============================================================================

function buildSnapshotValue(
  field: CachedField,
  value: TypedFieldValue | TypedFieldValue[] | null,
  lookups: ResolvedLookups
): TimelineFieldChangeSnapshotValue {
  if (value === null) return null

  if (Array.isArray(value)) {
    if (value.length === 0) return null
    const slice = value.slice(0, TIMELINE_SNAPSHOT_ARRAY_LIMIT)
    const built = slice
      .map((v) => buildSnapshotSingle(field, v, lookups))
      .filter((s): s is TimelineFieldChangeSnapshot => s !== null)
    return built.length > 0 ? built : null
  }

  return buildSnapshotSingle(field, value, lookups)
}

function buildSnapshotSingle(
  field: CachedField,
  value: TypedFieldValue,
  lookups: ResolvedLookups
): TimelineFieldChangeSnapshot | null {
  // CALC fields are persisted under the resolved sub-type so the renderer
  // never branches on `'CALC'`. Resolve once up front.
  const rawType = field.type as FieldType
  const fieldType: FieldType =
    rawType === 'CALC'
      ? (((field.options as { calc?: { resultFieldType?: string } } | null)?.calc
          ?.resultFieldType as FieldType | undefined) ?? 'TEXT')
      : rawType

  switch (fieldType) {
    case 'TEXT':
    case 'EMAIL':
    case 'URL':
    case 'NAME': {
      if (fieldType === 'NAME' && value.type === 'json') {
        const obj = value.value as { firstName?: string; lastName?: string }
        const text = [obj?.firstName, obj?.lastName].filter(Boolean).join(' ').trim()
        return { fieldType: 'NAME', text }
      }
      if (value.type !== 'text') return null
      const [text, truncated] = truncateForSnapshot(value.value ?? '', TIMELINE_SNAPSHOT_BODY_LIMIT)
      return truncated ? { fieldType, text, truncated: true } : { fieldType, text }
    }

    case 'PHONE_INTL': {
      if (value.type !== 'text') return null
      const formatted = phoneConverter.toDisplayValue(value, field.options ?? undefined)
      return { fieldType: 'PHONE_INTL', text: String(formatted ?? value.value ?? '') }
    }

    case 'RICH_TEXT': {
      if (value.type !== 'text') return null
      // Stored as raw HTML (truncated by char count). The renderer
      // re-sanitizes via DOMPurify before insertion. Truncation may break
      // mid-tag — DOMPurify's auto-close tolerates it.
      const [html, truncated] = truncateForSnapshot(value.value ?? '', TIMELINE_SNAPSHOT_BODY_LIMIT)
      return truncated
        ? { fieldType: 'RICH_TEXT', html, truncated: true }
        : { fieldType: 'RICH_TEXT', html }
    }

    case 'NUMBER': {
      if (value.type !== 'number') return null
      const formatted = numberConverter.toDisplayValue(value, field.options ?? undefined)
      return {
        fieldType: 'NUMBER',
        value: value.value,
        formatted: String(formatted ?? value.value),
      }
    }

    case 'CURRENCY': {
      if (value.type !== 'number') return null
      const formatted = currencyConverter.toDisplayValue(value, field.options ?? undefined)
      const currency = (field.options as { currency?: { currency?: string } } | null)?.currency
        ?.currency
      return {
        fieldType: 'CURRENCY',
        value: value.value,
        formatted: String(formatted ?? value.value),
        ...(currency ? { currency } : {}),
      }
    }

    case 'CHECKBOX': {
      if (value.type !== 'boolean') return null
      const bool = booleanConverter.toRawValue(value) as boolean
      return { fieldType: 'CHECKBOX', value: bool }
    }

    case 'DATE':
    case 'DATETIME':
    case 'TIME': {
      if (value.type !== 'date') return null
      return { fieldType, iso: value.value }
    }

    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
    case 'TAGS': {
      if (value.type !== 'option') return null
      const optionId = value.optionId
      const fieldOptions = (
        field.options as {
          options?: Array<{ id?: string; value: string; label: string; color?: string }>
        } | null
      )?.options
      const match = fieldOptions?.find((o) => (o.id ?? o.value) === optionId)
      const labelRaw = match?.label ?? value.label ?? optionId
      const [label] = truncateForSnapshot(labelRaw, TIMELINE_SNAPSHOT_LABEL_LIMIT)
      const color = match?.color ?? value.color
      return { fieldType, optionId, label, ...(color ? { color } : {}) }
    }

    case 'RELATIONSHIP': {
      if (value.type !== 'relationship') return null
      const { entityDefinitionId, entityInstanceId } = parseRecordId(value.recordId)
      const denormalized = value.displayName
      const resolvedFromDb = lookups.relatedDisplayNames.get(entityInstanceId)
      const labelRaw = denormalized ?? resolvedFromDb ?? value.recordId
      const [label] = truncateForSnapshot(labelRaw, TIMELINE_SNAPSHOT_LABEL_LIMIT)
      const resource = lookups.resourcesById.get(entityDefinitionId)
      return {
        fieldType: 'RELATIONSHIP',
        recordId: value.recordId,
        label,
        entityType: resource?.entityType ?? null,
      }
    }

    case 'ACTOR': {
      if (value.type !== 'actor') return null
      const denormalized = value.displayName
      let resolvedLabel: string | null = null
      let avatarUrl: string | null = null
      if (value.actorType === 'user') {
        const u = lookups.users.get(value.id)
        if (u) {
          resolvedLabel = u.displayName
          avatarUrl = u.avatarUrl
        }
      } else if (value.actorType === 'group') {
        const g = lookups.groups.get(value.id)
        if (g) {
          resolvedLabel = g.displayName
          avatarUrl = g.avatarUrl
        }
      }
      const labelRaw = denormalized ?? resolvedLabel ?? value.id
      const [label] = truncateForSnapshot(labelRaw, TIMELINE_SNAPSHOT_LABEL_LIMIT)
      const actorId: ActorId = value.actorId ?? toActorId(value.actorType, value.id)
      return {
        fieldType: 'ACTOR',
        actorId,
        actorType: value.actorType,
        label,
        ...(avatarUrl ? { avatarUrl } : {}),
      }
    }

    case 'FILE': {
      // V1: generic file activity, no metadata resolution.
      return { fieldType: 'FILE', label: 'File' }
    }

    case 'ADDRESS_STRUCT':
    case 'JSON': {
      if (value.type !== 'json') return null
      const stringified = JSON.stringify(value.value)
      if (stringified.length <= TIMELINE_SNAPSHOT_BODY_LIMIT) {
        return { fieldType, value: value.value }
      }
      // Drop into a small "_truncated" shape so the renderer doesn't dump
      // megabytes of JSON into the timeline view.
      const [truncated] = truncateForSnapshot(stringified, TIMELINE_SNAPSHOT_BODY_LIMIT)
      return { fieldType, value: { _truncated: truncated }, truncated: true }
    }

    default:
      return null
  }
}

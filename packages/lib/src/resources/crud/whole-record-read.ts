// packages/lib/src/resources/crud/whole-record-read.ts

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import type { CustomFieldEntity } from '@auxx/database/types'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { getInverseFieldId } from '@auxx/types/custom-field'
import { parseResourceFieldId, type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { isMultiRelationship } from '@auxx/utils'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { getRelationshipRedactedCount } from '../../field-values'
import type { BatchFieldValueResult, BatchGetValuesInput } from '../../field-values/types'
import type { RecordPickerItem } from '../picker/types'
import type { ReadOptions, RecordNode } from './types'

/**
 * What {@link readRecords} needs from its caller — the handler's own
 * already-scoped primitives (`getByIds`, `batchGetValues`, the cached field
 * list), plus raw `db` access for the one query shape neither primitive
 * covers: resolving an `include` relationship for a batch of parents (see
 * {@link resolveIncludeChildren}). Kept as a plain object rather than the
 * handler itself so this stays a pure function over data the caller resolved
 * — no capability re-checking, no session handling.
 */
export interface RecordReadContext {
  db: Database | Transaction
  organizationId: string
  getByIds(recordIds: RecordId[]): Promise<Record<RecordId, RecordPickerItem>>
  batchGetValues(params: BatchGetValuesInput): Promise<BatchFieldValueResult>
  getCustomFields(entityDefinitionId: string): Promise<CustomFieldEntity[]>
}

/**
 * `UnifiedCrudHandler.getRecords` — see plans/apps/outbound/01-records-api.md
 * §1. Composition, no new query paths: {@link RecordReadContext.getByIds} for
 * scope, one {@link RecordReadContext.batchGetValues} per distinct def for
 * values (field defaults differ per def, so one call can't cover a mixed-def
 * batch), then per include key one pair of batched queries — ALL parents of a
 * def in one round trip — to resolve child ids, `getByIds` again on the union
 * for scope, and a recursive call for the child nodes. Query count is
 * O(depth × includes × distinct defs), never O(records).
 */
export async function readRecords(
  ctx: RecordReadContext,
  recordIds: RecordId[],
  opts: ReadOptions
): Promise<Record<RecordId, RecordNode>> {
  if (recordIds.length === 0) return {}

  // Step 1 — ids the scope drops are gone before any value query, and absent
  // from the result entirely (missing-vs-hidden must stay indistinguishable).
  const visible = await ctx.getByIds(recordIds)
  const visibleIds = Object.keys(visible) as RecordId[]
  if (visibleIds.length === 0) return {}

  const idsByDef = groupByDef(visibleIds)
  const nodes = new Map<RecordId, RecordNode>()
  for (const id of visibleIds) {
    const item = visible[id]!
    nodes.set(id, {
      recordId: id,
      entityDefinitionId: parseRecordId(id).entityDefinitionId,
      displayName: item.displayName ?? null,
      values: {},
      included: {},
      redacted: [],
    })
  }

  // Step 2 — values, one batchGetValues per distinct def: the default field
  // set ("every field the def has") differs per def, so a single call across
  // mixed defs can't be given one field-reference list that's right for both.
  for (const [defId, ids] of idsByDef) {
    const fields = await ctx.getCustomFields(defId)
    const { refs, keyByFieldId } = resolveRequestedFields(defId, fields, opts.fields)
    if (refs.length === 0) continue
    const result = await ctx.batchGetValues({ recordIds: ids, fieldReferences: refs })
    const byRecord = groupBy(result.values, (r) => r.recordId)
    for (const id of ids) {
      const node = nodes.get(id)!
      for (const r of byRecord.get(id) ?? []) {
        const { fieldId } = parseResourceFieldId(r.fieldRef as ResourceFieldId)
        const key = keyByFieldId.get(fieldId) ?? fieldId
        node.values[key] = r.value ?? null
        if (getRelationshipRedactedCount(r.value) > 0) addRedacted(node, key)
      }
    }
  }

  // Steps 3-5 — includes, per def per key: resolve every parent's child ids
  // in one query, re-scope the union in one getByIds, recurse once for the
  // child nodes (their own nested include, if any, pays the same shape).
  const includeEntries = Object.entries(opts.include ?? {})
  if (includeEntries.length > 0) {
    for (const [defId, ids] of idsByDef) {
      const fields = await ctx.getCustomFields(defId)
      for (const [key, nestedOpts] of includeEntries) {
        const field = fields.find((f) => f.systemAttribute === key || f.id === key)
        // Absent, not an error — this def simply doesn't have that relationship.
        if (!field || field.type !== FieldType.RELATIONSHIP) continue

        const relConfig = (field.options as { relationship?: RelationshipConfig } | null)
          ?.relationship
        const childrenByParent = await resolveIncludeChildren(ctx, ids, field, relConfig)
        const allChildIds = [...new Set([...childrenByParent.values()].flat())]
        const isMulti = relConfig ? isMultiRelationship(relConfig.relationshipType) : true

        const childNodes =
          allChildIds.length > 0 ? await readRecords(ctx, allChildIds, nestedOpts) : {}

        for (const [parentId, childIds] of childrenByParent) {
          const parentNode = nodes.get(parentId)!
          const survivors = childIds
            .map((cid) => childNodes[cid])
            .filter((n): n is RecordNode => !!n)
          // Step 6 — the recursive getByIds dropped some of these children.
          if (survivors.length < childIds.length) addRedacted(parentNode, key)
          if (isMulti) {
            parentNode.included[key] = survivors
          } else if (survivors[0]) {
            parentNode.included[key] = survivors[0]
          }
        }
      }
    }
  }

  return Object.fromEntries(nodes)
}

/**
 * Resolve ONE include key's child ids for ALL parents of one def in one
 * query, the two ways `readOrderForFulfillment` (money/orders/reads.ts:379)
 * already does — generalized off the field's own {@link RelationshipConfig}
 * rather than a hand-built field context.
 *
 * `relationship-sync.ts` mirrors a write to both sides of a pair by default,
 * but a bulk writer (data-connector sync, importers) may pass
 * `skipInverseSync: true`, so the mirror side isn't guaranteed current.
 * `isInverse: false` marks the side {@link createRelationshipFieldWithInverse}
 * created first; prefer the auto-generated `isInverse: true` mirror's CHILD
 * def instead when one is configured, since that is the side more likely to
 * have been written through a path that skipped the mirror sync — falling
 * back to this field's own rows when no inverse resolves at all:
 *
 * - `isInverse: true` → resolve via the CHILD def's own field, keyed by
 *   `relatedEntityId IN (parent ids)` — `readOrderForFulfillment`'s
 *   `line_item_order` branch, generalized.
 * - `isInverse: false`, or no inverse configured → this field's own rows,
 *   keyed by `entityId IN (parent ids)` — `readOrderForFulfillment`'s
 *   `order_line_items` fallback branch.
 */
async function resolveIncludeChildren(
  ctx: RecordReadContext,
  parentIds: RecordId[],
  field: CustomFieldEntity,
  relConfig: RelationshipConfig | undefined
): Promise<Map<RecordId, RecordId[]>> {
  const instanceIdToRecordId = new Map(
    parentIds.map((id) => [parseRecordId(id).entityInstanceId, id])
  )
  const parentInstanceIds = [...instanceIdToRecordId.keys()]
  const inverseFieldId = relConfig?.isInverse ? getInverseFieldId(relConfig) : null

  const result = new Map<RecordId, RecordId[]>()
  const push = (parentId: RecordId | undefined, childId: RecordId) => {
    if (!parentId) return
    const list = result.get(parentId) ?? []
    list.push(childId)
    result.set(parentId, list)
  }

  if (inverseFieldId) {
    const rows = await ctx.db
      .select({
        entityId: schema.FieldValue.entityId,
        entityDefinitionId: schema.FieldValue.entityDefinitionId,
        relatedEntityId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, ctx.organizationId),
          eq(schema.FieldValue.fieldId, inverseFieldId),
          inArray(schema.FieldValue.relatedEntityId, parentInstanceIds)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))
    for (const row of rows) {
      if (!row.relatedEntityId) continue
      push(
        instanceIdToRecordId.get(row.relatedEntityId),
        toRecordId(row.entityDefinitionId, row.entityId)
      )
    }
    return result
  }

  const rows = await ctx.db
    .select({
      entityId: schema.FieldValue.entityId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
      relatedEntityDefinitionId: schema.FieldValue.relatedEntityDefinitionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        eq(schema.FieldValue.fieldId, field.id),
        inArray(schema.FieldValue.entityId, parentInstanceIds)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))
  for (const row of rows) {
    if (!row.relatedEntityId || !row.relatedEntityDefinitionId) continue
    push(
      instanceIdToRecordId.get(row.entityId),
      toRecordId(row.relatedEntityDefinitionId, row.relatedEntityId)
    )
  }
  return result
}

/** `opts.fields` resolved against one def's cached fields → batchGetValues refs + the output key each resolves to. */
function resolveRequestedFields(
  entityDefinitionId: string,
  fields: CustomFieldEntity[],
  requested?: readonly string[]
): { refs: ResourceFieldId[]; keyByFieldId: Map<string, string> } {
  const wanted = requested
    ? fields.filter((f) => requested.includes(f.systemAttribute ?? '') || requested.includes(f.id))
    : fields
  const keyByFieldId = new Map(wanted.map((f) => [f.id, f.systemAttribute ?? f.id]))
  const refs = wanted.map((f) => toResourceFieldId(entityDefinitionId, f.id))
  return { refs, keyByFieldId }
}

function groupByDef(recordIds: RecordId[]): Map<string, RecordId[]> {
  const byDef = new Map<string, RecordId[]>()
  for (const id of recordIds) {
    const { entityDefinitionId } = parseRecordId(id)
    const list = byDef.get(entityDefinitionId) ?? []
    list.push(id)
    byDef.set(entityDefinitionId, list)
  }
  return byDef
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = grouped.get(k) ?? []
    list.push(item)
    grouped.set(k, list)
  }
  return grouped
}

function addRedacted(node: RecordNode, key: string): void {
  if (!node.redacted.includes(key)) node.redacted.push(key)
}

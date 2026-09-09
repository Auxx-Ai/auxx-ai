// packages/lib/src/resources/crud/delete-closure.ts
//
// The transitive set of records a hard delete removes, derived from the
// `onDelete` declared on each definition's relationship fields, and the
// `restrict` check over that set. Both are READS. Nothing here writes, which
// is what lets `bulkDeleteEntities` collect, refuse, and only then delete
// (plans/relationships/01-delete-semantics.md,
// plans/records/bulk-delete-followups.md A.2).
//
// This replaces the hand-written per-entity cascades and the static
// `HOOKED_CHILD_DEF_SLUGS` ordering table: which children die with a parent is
// now a property of the relationship, read from the org cache, and the write
// order falls out of the closure's depth.

import { type Database, schema } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import type { CustomFieldEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import {
  getInverseFieldId,
  getRelatedEntityDefinitionId,
  type RelationDeleteBehavior,
  type RelationshipConfig,
} from '@auxx/types/custom-field'
import { and, count, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedCustomFields, getCachedResources } from '../../cache'
import { ConflictError } from '../../errors'
import { parseRecordId, type RecordId, toRecordId } from '../resource-id'

const logger = createScopedLogger('delete-closure')

/**
 * How many ids one `IN (…)` list carries. Matches the chunking of the delete
 * itself (`deleteEntityInstances`), so a closure over 10,000 orders is twenty
 * statements per (definition, field) per level rather than one with 10,000
 * parameters.
 */
const CLOSURE_CHUNK = 500

/** One record in a delete closure. */
export interface DeleteClosureRecord {
  /**
   * For a requested record, the `RecordId` exactly as the caller wrote it
   * (its definition part may be a slug); for a cascaded one, the canonical
   * `EntityDefinition.id` form. Errors are keyed on this, which is why the
   * caller's spelling is preserved.
   */
  recordId: RecordId
  entityInstanceId: string
  /**
   * The record whose cascade collected this one, or `null` for a record the
   * caller asked for. A requested record stays a root even when a cascade
   * reaches it too: it was asked for in its own right, so a refusal elsewhere
   * in the batch must not save it (the pre-split loop deleted it regardless).
   */
  requestedBy: RecordId | null
  /**
   * Distance from the request: requested records are 0, their cascaded
   * children 1, and so on. A record reached twice keeps the GREATER depth so
   * a line item both requested and collected under its order still sorts
   * with the lines, before the orders.
   */
  depth: number
}

/** One definition's slice of a delete closure. */
export interface DeleteClosureGroup {
  /** Canonical `EntityDefinition.id`, never a slug. */
  entityDefinitionId: string
  /** From the resources cache; `null` if the definition is not cached. */
  apiSlug: string | null
  /** The greatest depth of any record in the group. */
  depth: number
  records: DeleteClosureRecord[]
}

/** What {@link collectDeleteClosure} found. */
export interface DeleteClosure {
  /** Deepest first, so a group's children are always in an earlier group. Stable otherwise. */
  groups: DeleteClosureGroup[]
  /** Requested ids that resolve to no row in this organization. */
  notFound: RecordId[]
}

/** Parameters for {@link collectDeleteClosure}. */
export interface CollectDeleteClosureParams {
  organizationId: string
  recordIds: readonly RecordId[]
}

interface ClosureNode extends DeleteClosureRecord {
  entityDefinitionId: string
}

/**
 * One relationship edge as it is READ: the owning field on the parent
 * definition, and the field on the child definition whose `FieldValue` rows
 * name the parent.
 */
interface RelationEdge {
  /** The parent's owning (has_one / has_many / many_to_many) field. */
  owningField: CustomFieldEntity
  /** `CustomField.id` of the child-side field, resolved through the org cache. */
  childFieldId: string
}

/**
 * The stored relationship config of a RELATIONSHIP field, or `null` for any
 * other field. `options` is untyped jsonb, so this is the one place the shape
 * is asserted.
 */
function relationshipConfig(field: CustomFieldEntity): RelationshipConfig | null {
  if (field.type !== FieldType.RELATIONSHIP) return null
  const options = field.options as { relationship?: RelationshipConfig } | null | undefined
  return options?.relationship ?? null
}

/**
 * A definition's relationship edges carrying `onDelete === behavior`, each
 * resolved to the CHILD-side field the rows are read through.
 *
 * **Why the child side.** A relation is two mirror `FieldValue` rows, and the
 * parent's mirror row is the one that historically went missing: the relation
 * sweep exists because 1,619 of them dangled, and the stored self-relation
 * pairs (`stock_movement_parent_movement` / `stock_movement_child_movements`,
 * `build_reversal_of` / `build_reversed_by`) only ever wrote the child's row.
 * Reading `FieldValue.relatedEntityId IN (parents)` on the child's field is
 * the shape `field-hooks/pre/related-rows.ts` already reads, and it is served
 * by `FieldValue_relatedEntityId_idx`.
 *
 * The child field comes from the owning field's stored
 * `inverseResourceFieldId`, which every writer (`createRelationshipFieldWithInverse`,
 * the seeder's Pass 3, `linkNewRelationships`) stores as
 * `<EntityDefinition.id>:<CustomField.id>`; it is then confirmed against the
 * child definition's cached fields. An edge whose inverse is missing (the
 * seeder leaves `user`-typed inverses null) or no longer cached is skipped with
 * a debug log rather than followed blind: skipping cascades nothing, which is
 * the `unlink` default every relation already has.
 *
 * `onDelete` is declared on the owning side, never on a `belongs_to`: a child
 * cannot decide what happens to its parent when the child dies, so a value on
 * that side is ignored rather than read as "delete the parent". A missing
 * value means `unlink`.
 */
async function relationEdgesWithBehavior(
  organizationId: string,
  entityDefinitionId: string,
  behavior: RelationDeleteBehavior
): Promise<RelationEdge[]> {
  const fields = await getCachedCustomFields(organizationId, entityDefinitionId)
  const edges: RelationEdge[] = []

  for (const field of fields) {
    const config = relationshipConfig(field)
    if (!config || config.relationshipType === 'belongs_to' || config.onDelete !== behavior) {
      continue
    }

    const childDefinitionId = getRelatedEntityDefinitionId(config)
    const childFieldId = getInverseFieldId(config)
    const childField = childDefinitionId
      ? (await getCachedCustomFields(organizationId, childDefinitionId)).find(
          (candidate) => candidate.id === childFieldId
        )
      : undefined

    if (!childField) {
      logger.debug('Relationship edge has no resolvable inverse field, skipping', {
        organizationId,
        entityDefinitionId,
        fieldId: field.id,
        behavior,
        inverseResourceFieldId: config.inverseResourceFieldId,
      })
      continue
    }

    edges.push({ owningField: field, childFieldId: childField.id })
  }

  return edges
}

/** `EntityDefinition.id` -> what the closure and the refusal message need. */
async function definitionInfo(
  organizationId: string
): Promise<Map<string, { apiSlug: string; label: string }>> {
  const resources = await getCachedResources(organizationId)
  const info = new Map<string, { apiSlug: string; label: string }>()
  for (const resource of resources) {
    info.set(resource.entityDefinitionId, { apiSlug: resource.apiSlug, label: resource.label })
  }
  return info
}

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let offset = 0; offset < items.length; offset += CLOSURE_CHUNK) {
    out.push(items.slice(offset, offset + CLOSURE_CHUNK))
  }
  return out
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Every record that must die when `recordIds` are hard-deleted, following
 * only `onDelete: 'cascade'` relationship fields, breadth-first.
 *
 * **Reads, per level: one query per (definition, cascade field), chunked at
 * {@link CLOSURE_CHUNK}.** The frontier is grouped by definition, each
 * definition's cascade edges come from the org cache, and one join over
 * `FieldValue ⋈ EntityInstance` on the CHILD side (see
 * {@link relationEdgesWithBehavior} for why not the parent's mirror row)
 * answers "which rows name these parents through this field" for the whole
 * frontier at once. The child's definition comes from the join. For N orders
 * with lines, refunds, refund lines and tax lines that is 1 (resolve the
 * request) + 3 (the order's three cascade fields) + 1 (the refund's one) = 5
 * round trips, independent of N below 500.
 *
 * **Archived children are included**, and it is deliberate: a hard delete must
 * reach an archived row (see `deleteEntity`), and a guard reading through the
 * list path's `isNull(archivedAt)` is exactly how `PO-0002` was deleted while
 * an archived bill still named it (`field-hooks/pre/related-rows.ts`).
 *
 * **A record is collected once.** A visited set keyed on the instance id makes
 * a self-referential cascade (`stock_movement` parent -> child) terminate and
 * a record reachable through two parents appear once, attributed to the first
 * parent that reached it. Its `depth` is the greatest depth it was seen at.
 *
 * **Requested ids are resolved first.** The definition part of a caller's
 * `RecordId` may be a slug, and a cascaded child arrives with the canonical
 * `EntityDefinition.id`; resolving the request against `EntityInstance` puts
 * both in one keyspace so a line item requested directly and a line item
 * collected under its order land in the same group. Ids that resolve to
 * nothing are reported in `notFound` rather than silently dropped.
 *
 * @returns groups sorted deepest first, so children precede their parents.
 */
export async function collectDeleteClosure(
  db: Database,
  params: CollectDeleteClosureParams
): Promise<Result<DeleteClosure, Error>> {
  const { organizationId } = params

  try {
    const nodes = new Map<string, ClosureNode>()
    const notFound: RecordId[] = []

    // Level 0: the request, de-duplicated on the instance id (first spelling wins).
    const requested = new Map<string, RecordId>()
    for (const recordId of params.recordIds) {
      const { entityInstanceId } = parseRecordId(recordId)
      if (!requested.has(entityInstanceId)) requested.set(entityInstanceId, recordId)
    }

    const resolvedDefs = new Map<string, string>()
    for (const chunk of chunks([...requested.keys()])) {
      const rows = await db
        .select({
          id: schema.EntityInstance.id,
          entityDefinitionId: schema.EntityInstance.entityDefinitionId,
        })
        .from(schema.EntityInstance)
        .where(
          and(
            inArray(schema.EntityInstance.id, chunk),
            eq(schema.EntityInstance.organizationId, organizationId)
            // NO isNull(archivedAt): a hard delete must reach an archived row.
          )
        )
      for (const row of rows) resolvedDefs.set(row.id, row.entityDefinitionId)
    }

    let frontier: ClosureNode[] = []
    for (const [entityInstanceId, recordId] of requested) {
      const entityDefinitionId = resolvedDefs.get(entityInstanceId)
      if (!entityDefinitionId) {
        notFound.push(recordId)
        continue
      }
      const node: ClosureNode = {
        recordId,
        entityInstanceId,
        entityDefinitionId,
        requestedBy: null,
        depth: 0,
      }
      nodes.set(entityInstanceId, node)
      frontier.push(node)
    }

    // Levels 1..n: follow every cascade edge of every definition on the frontier.
    let depth = 0
    while (frontier.length > 0) {
      depth++
      const next: ClosureNode[] = []

      const byDef = new Map<string, ClosureNode[]>()
      for (const node of frontier) {
        const group = byDef.get(node.entityDefinitionId) ?? []
        group.push(node)
        byDef.set(node.entityDefinitionId, group)
      }

      for (const [entityDefinitionId, parents] of byDef) {
        const edges = await relationEdgesWithBehavior(organizationId, entityDefinitionId, 'cascade')
        if (edges.length === 0) continue

        const parentById = new Map(parents.map((parent) => [parent.entityInstanceId, parent]))
        const parentIds = [...parentById.keys()]

        for (const edge of edges) {
          for (const chunk of chunks(parentIds)) {
            // The child's row: `entityId` is the child, `relatedEntityId` the parent.
            const rows = await db
              .select({
                parentId: schema.FieldValue.relatedEntityId,
                childId: schema.FieldValue.entityId,
                childDefId: schema.EntityInstance.entityDefinitionId,
              })
              .from(schema.FieldValue)
              .innerJoin(
                schema.EntityInstance,
                and(
                  eq(schema.EntityInstance.id, schema.FieldValue.entityId),
                  eq(schema.EntityInstance.organizationId, schema.FieldValue.organizationId)
                )
              )
              .where(
                and(
                  eq(schema.FieldValue.organizationId, organizationId),
                  eq(schema.FieldValue.fieldId, edge.childFieldId),
                  inArray(schema.FieldValue.relatedEntityId, chunk)
                )
              )

            for (const row of rows) {
              if (!row.parentId) continue
              const parent = parentById.get(row.parentId)
              if (!parent) continue

              const existing = nodes.get(row.childId)
              if (existing) {
                existing.depth = Math.max(existing.depth, depth)
                continue
              }

              const node: ClosureNode = {
                recordId: toRecordId(row.childDefId, row.childId),
                entityInstanceId: row.childId,
                entityDefinitionId: row.childDefId,
                requestedBy: parent.recordId,
                depth,
              }
              nodes.set(row.childId, node)
              next.push(node)
            }
          }
        }
      }

      frontier = next
    }

    // Group by definition, in discovery order, then deepest first.
    const defs = await definitionInfo(organizationId)
    const groupsByDef = new Map<string, DeleteClosureGroup>()
    for (const node of nodes.values()) {
      let group = groupsByDef.get(node.entityDefinitionId)
      if (!group) {
        group = {
          entityDefinitionId: node.entityDefinitionId,
          apiSlug: defs.get(node.entityDefinitionId)?.apiSlug ?? null,
          depth: 0,
          records: [],
        }
        groupsByDef.set(node.entityDefinitionId, group)
      }
      group.depth = Math.max(group.depth, node.depth)
      group.records.push({
        recordId: node.recordId,
        entityInstanceId: node.entityInstanceId,
        requestedBy: node.requestedBy,
        depth: node.depth,
      })
    }

    const groups = [...groupsByDef.values()]
      .map((group, index) => ({ group, index }))
      .sort((a, b) => b.group.depth - a.group.depth || a.index - b.index)
      .map((entry) => entry.group)

    return ok({ groups, notFound })
  } catch (error) {
    return err(asError(error))
  }
}

/** Why one record in a closure may not be deleted. */
export interface RestrictViolation {
  /** The restricting field's label, lowercased, as it appears in the message. */
  fieldLabel: string
  /** Related rows still naming the record through that field. */
  count: number
  /** The 409 to surface. */
  error: ConflictError
}

/** Parameters for {@link findRestrictViolations}. */
export interface FindRestrictViolationsParams {
  organizationId: string
  groups: readonly DeleteClosureGroup[]
}

/**
 * The refusal a `restrict` relationship produces. Ends by pointing at archive
 * because that is the real remedy when hundreds of threads carry a tag, and
 * archive exists for every definition; the web tags list shows this verbatim.
 */
export function restrictViolationMessage(
  definitionLabel: string,
  fieldLabel: string,
  related: number
): string {
  return `This ${definitionLabel} has ${related} ${fieldLabel}. Remove them first, or archive the ${definitionLabel} instead.`
}

/**
 * Every record in a closure that a `onDelete: 'restrict'` relationship field
 * refuses to let go, with the first violated field and its count.
 *
 * One query per (definition, restrict field), chunked at {@link CLOSURE_CHUNK}:
 * a count of CHILD-side `FieldValue` rows naming the closure's records,
 * grouped by `relatedEntityId` and joined to the child's `EntityInstance`, so
 * a dangling row left by an older delete path does not refuse a delete on its
 * own. Archived related rows DO count, for the same reason the closure
 * includes them: an archived bill is still a document the vendor really sent.
 *
 * Rows that are themselves in the closure are counted too. Excluding them
 * would let a parent be deleted on the strength of a child that phase 2 then
 * refuses, which is the under-refusal `related-rows.ts` documents; deleting
 * the children first, as the message says, is one more request away.
 */
export async function findRestrictViolations(
  db: Database,
  params: FindRestrictViolationsParams
): Promise<Result<Map<RecordId, RestrictViolation>, Error>> {
  const { organizationId, groups } = params
  const violations = new Map<RecordId, RestrictViolation>()

  try {
    const defs = await definitionInfo(organizationId)

    for (const group of groups) {
      const edges = await relationEdgesWithBehavior(
        organizationId,
        group.entityDefinitionId,
        'restrict'
      )
      if (edges.length === 0) continue

      const definitionLabel = (defs.get(group.entityDefinitionId)?.label ?? 'record').toLowerCase()
      const recordByInstance = new Map(
        group.records.map((record) => [record.entityInstanceId, record.recordId])
      )

      for (const edge of edges) {
        const fieldLabel = edge.owningField.name.toLowerCase()

        for (const chunk of chunks([...recordByInstance.keys()])) {
          const rows = await db
            .select({
              parentId: schema.FieldValue.relatedEntityId,
              related: count(),
            })
            .from(schema.FieldValue)
            .innerJoin(
              schema.EntityInstance,
              and(
                eq(schema.EntityInstance.id, schema.FieldValue.entityId),
                eq(schema.EntityInstance.organizationId, schema.FieldValue.organizationId)
              )
            )
            .where(
              and(
                eq(schema.FieldValue.organizationId, organizationId),
                eq(schema.FieldValue.fieldId, edge.childFieldId),
                inArray(schema.FieldValue.relatedEntityId, chunk)
              )
            )
            .groupBy(schema.FieldValue.relatedEntityId)

          for (const row of rows) {
            const related = Number(row.related)
            const recordId = row.parentId ? recordByInstance.get(row.parentId) : undefined
            if (!recordId || related === 0 || violations.has(recordId)) continue
            violations.set(recordId, {
              fieldLabel,
              count: related,
              error: new ConflictError(
                restrictViolationMessage(definitionLabel, fieldLabel, related)
              ),
            })
          }
        }
      }
    }

    return ok(violations)
  } catch (error) {
    return err(asError(error))
  }
}

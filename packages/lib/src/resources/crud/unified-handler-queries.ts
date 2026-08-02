// packages/lib/src/resources/crud/unified-handler-queries.ts

import { type Database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import {
  type FieldId,
  type FieldReference,
  parseResourceFieldId,
  type ResourceFieldId,
  toFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { and, asc, desc, eq, isNull, type SQL, sql } from 'drizzle-orm'
import {
  findCachedResource,
  getCachedEntityDefId,
  getCachedResourceFields,
  getOrgCache,
} from '../../cache'
import type { ConditionGroup } from '../../conditions'
import { ForbiddenError } from '../../errors'
import { FieldValueService, formatToRawValue } from '../../field-values'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import { textSearchPredicate, textSearchRank } from '../../search/text-search-sql'
import { BaseType } from '../../workflow-engine/core/types'
import { isMailLensTableId, MAIL_LENS_REFUSAL } from '../picker/mail-lens-tables'
import type {
  DroppedCondition,
  DroppedConditionReason,
} from '../query-builder/base-condition-builder'
// Imported from the module, NOT the `query-builder` barrel: the barrel also
// pulls in `condition-query-builder`, and this module is already the hub every
// crud test mocks piecemeal.
import {
  canonicalizeSystemConditions,
  canonicalizeSystemFieldRef,
} from '../query-builder/canonicalize-system-fields'
import {
  type EntityQueryContext,
  entityConditionBuilder,
} from '../query-builder/entity-condition-builder'
import { systemConditionBuilder } from '../query-builder/system-condition-builder'
import {
  getFieldOutputKey,
  RESOURCE_TABLE_MAP,
  RESOURCE_TABLE_REGISTRY,
  type ResourceField,
} from '../registry'
import type { TableId } from '../registry/field-registry'
import type { ResourceRegistryService } from '../registry/resource-registry-service'
import { type RecordId, toRecordId } from '../resource-id'
import { recordSearchPredicate, recordSearchRank } from '../search/record-search-sql'
import { getSystemSearchBinding } from '../search/system-search-bindings'

const logger = createScopedLogger('unified-handler-queries')

/** Type for EntityInstance select */
type EntityInstanceEntity = typeof schema.EntityInstance.$inferSelect

/**
 * Input for listFiltered query
 */
export interface ListFilteredInput {
  /** Resource type: 'contact', 'ticket', or custom entity UUID */
  entityDefinitionId: string
  /** Filter groups (optional) */
  filters?: ConditionGroup[]
  /**
   * Free-text search from the search bar — a separate axis from {@link filters},
   * not a condition (plan decision 0.3). Conditions narrow the search; this IS
   * the search. Ranked + typo-tolerant.
   *
   * Honoured on the `EntityInstance` path, and on the system-resource path for
   * the tables that have a ranked binding in
   * `resources/search/system-search-bindings.ts` (today: `article`). A system
   * table without a binding ignores it — filters still apply, ordering is
   * unchanged.
   */
  search?: string
  /** Sort configuration (optional) */
  sorting?: Array<{ id: string; desc: boolean }>
  /** Limit per request (default: 100) */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Cursor for pagination (what tRPC's infinite query threads through) */
  cursor?: { offset: number }
  /**
   * Force the `COUNT(*)`. Defaults to `offset === 0` — the first page pays for the
   * total, later pages don't. Pass `true` when a caller needs the full count on a
   * deep page (paginating agent tools).
   */
  includeTotal?: boolean
}

/**
 * Upper bound on {@link ListFilteredResult.droppedConditions}. A pathological
 * filter set (a stored view against a wholesale-renamed resource, a generated
 * `in` fan-out) must not put an unbounded array on every list response — the
 * payload is a diagnostic, not a data channel. `droppedConditionCount` stays
 * exact past the cap so a UI never *undercounts* what it is warning about.
 *
 * 25 is far above any hand-built filter set; the filter UI tops out around a
 * dozen conditions.
 */
export const MAX_REPORTED_DROPPED_CONDITIONS = 25

/**
 * A filter condition the query builder could not turn into SQL, in the shape a
 * **client** is allowed to see.
 *
 * Deliberately narrower than the internal {@link DroppedCondition}: `detail` is
 * dropped, because it carries builder internals (the builder class name via
 * `this.constructor.name`, or the raw unresolved `valueSource` token) that say
 * nothing to a user and everything to someone probing the server. What survives
 * is what a UI needs to name the offender — the caller's own `conditionId` (so a
 * filter chip can be highlighted), the `fieldId` the caller itself sent, its
 * operator, and a coarse reason. No SQL, no column names, no table names.
 */
export interface DroppedFilterNotice {
  /** The condition's `id`, exactly as the caller sent it. */
  conditionId: string
  /**
   * The condition's `fieldId` — an array for relationship paths. Caller-supplied
   * for an unresolvable reference, which is the case a UI needs to name; a
   * reference that resolved to a field and dropped for another reason (an
   * operator the field does not support) reports its canonical key instead.
   */
  fieldRef: string | string[]
  /** The condition's operator, as sent. */
  operator: string
  /** Why it produced no SQL. Coarse by design — see {@link DroppedConditionReason}. */
  reason: DroppedConditionReason
}

/**
 * Result from listFiltered query
 */
export interface ListFilteredResult {
  /** Array of record IDs */
  ids: string[]
  /**
   * Total count matching filters. Present only when the COUNT ran (first page, or
   * an explicit `includeTotal`). Display data — {@link hasMore} is pagination truth.
   */
  total?: number
  /** Whether more results exist, derived from a `limit + 1` probe row */
  hasMore: boolean
  /**
   * Filter conditions the builder could not compile, and therefore **did not
   * apply**. Present only when at least one was dropped; `undefined` means every
   * requested condition made it into the `WHERE` clause.
   *
   * **A non-empty list means this page is WIDER than the caller asked for.** The
   * query lane fails open on purpose — a stored view naming a retired field must
   * still render — but that made the failure invisible by construction, which is
   * how KB free-text search, the KB Tag/Status/Kind filters, unfiltered dashboard
   * thread widgets and an unknown operator compiling to `eq(col, value)` all hid
   * in plain sight. This field is the observability channel for that whole class;
   * the AI boundary still *refuses* instead, via {@link inspectFilterConditions}.
   *
   * Purely additive: a caller that ignores it gets byte-identical behaviour.
   * Capped at {@link MAX_REPORTED_DROPPED_CONDITIONS} — read
   * {@link droppedConditionCount} for the true total.
   */
  droppedConditions?: DroppedFilterNotice[]
  /**
   * How many conditions were dropped in total, uncapped. Equals
   * `droppedConditions.length` unless the cap truncated the list. Present exactly
   * when {@link droppedConditions} is.
   */
  droppedConditionCount?: number
}

/**
 * Result of a count-only query — {@link countEntityInstances} /
 * {@link countSystemResource}.
 *
 * These used to return a bare `number`, and that was the last blind spot in the
 * fail-open: both build their `WHERE` clause through the *same* dropping path as
 * the list, so an unread badge or a "how many match" answer could silently widen
 * with nothing anywhere able to tell. A count is in fact the worse case — a list
 * that widens shows the extra rows, a count that widens is a single number that
 * looks exactly as authoritative as a correct one.
 *
 * `droppedConditions` / `droppedConditionCount` carry the same caller-facing
 * projection, under the same cap and the same exact-count rule, as
 * {@link ListFilteredResult}: a UI must not have to branch on whether it counted
 * or listed.
 */
export interface CountFilteredResult {
  /** Rows matching the WHERE clause that actually ran. */
  count: number
  /**
   * Conditions the builder could not compile, and therefore did not apply.
   * Present only when at least one was dropped — **a non-empty list means
   * {@link count} is HIGHER than the caller asked for.** Capped at
   * {@link MAX_REPORTED_DROPPED_CONDITIONS}.
   */
  droppedConditions?: DroppedFilterNotice[]
  /** Uncapped total behind {@link droppedConditions}. Present exactly when it is. */
  droppedConditionCount?: number
  /**
   * `true` only when conditions were requested and **none** of them produced
   * SQL — i.e. {@link count} is the unfiltered total wearing a filtered label.
   * `false` for the genuine no-filter case, so a caller can refuse on this alone
   * (see {@link import('../../ai/kopilot/capabilities/entities/shared/record-filters').assertCountFiltersApplied}).
   *
   * Deliberately absent from {@link ListFilteredResult}: the list lane reports
   * and renders, the AI count lane refuses, and only the latter needs the
   * discriminant.
   */
  allConditionsDropped: boolean
}

/** The caller-facing projection of a build's drop diagnostics, or `{}` when clean. */
type DroppedConditionReport = Pick<
  ListFilteredResult,
  'droppedConditions' | 'droppedConditionCount'
>

/**
 * Project internal builder diagnostics onto the caller-facing subset, bounded.
 *
 * Spread into a list result: `{ ids, hasMore, ...reportDroppedConditions(dropped) }`.
 * An empty input yields `{}`, so the two absent keys never appear on a clean
 * response and no existing consumer sees a shape change.
 *
 * Exported for the aggregate engine (`resources/aggregate/run-aggregate.ts`),
 * which has its own builder call sites and must report drops in the SAME shape
 * under the SAME cap — a second, hand-rolled projection there is how the cap and
 * the exact-count rule drift apart.
 */
export function reportDroppedConditions(dropped: DroppedCondition[]): DroppedConditionReport {
  if (dropped.length === 0) return {}
  return {
    droppedConditionCount: dropped.length,
    droppedConditions: dropped.slice(0, MAX_REPORTED_DROPPED_CONDITIONS).map((d) => ({
      conditionId: d.conditionId,
      fieldRef: d.fieldRef,
      operator: d.operator,
      reason: d.reason,
    })),
  }
}

/**
 * Scan conditions to identify which related entities are needed.
 * Returns set of relatedEntityDefinitionIds.
 *
 * @param filters - Condition groups to scan
 * @param sourceFields - Fields of the source entity
 */
export function extractRequiredRelatedEntities(
  filters: ConditionGroup[],
  sourceFields: ResourceField[]
): Set<string> {
  const relatedEntityIds = new Set<string>()

  for (const group of filters) {
    for (const condition of group.conditions) {
      const fieldRef = condition.fieldId
      let relationshipFieldKey: string | undefined

      // Array format: ['ticket:contact', 'contact:email']
      if (Array.isArray(fieldRef) && fieldRef.length >= 2) {
        const relationshipRef = fieldRef[0]
        relationshipFieldKey =
          typeof relationshipRef === 'string' && relationshipRef.includes(':')
            ? parseResourceFieldId(relationshipRef as ResourceFieldId).fieldId
            : relationshipRef
      }
      // Dot notation: 'contact.email'
      else if (typeof fieldRef === 'string' && fieldRef.includes('.')) {
        relationshipFieldKey = fieldRef.split('.')[0]
      } else {
        continue
      }

      if (!relationshipFieldKey) continue

      // Find relationship field in source fields
      const relationshipField = sourceFields.find(
        (f) =>
          getFieldOutputKey(f) === relationshipFieldKey ||
          f.key === relationshipFieldKey ||
          (f.id && f.id === relationshipFieldKey)
      )

      if (relationshipField?.relationship) {
        const relatedEntityId = getRelatedEntityDefinitionId(
          relationshipField.relationship as RelationshipConfig
        )
        if (relatedEntityId) {
          relatedEntityIds.add(relatedEntityId)
        }
      }
    }
  }

  return relatedEntityIds
}

/**
 * Internal: build the context, WHERE clause, and ORDER BY clauses for an entity-instance
 * query. Shared between the paged and count-only helpers so we don't duplicate field
 * resolution + related-entity lookups.
 *
 * `search` is the free-text half of the records search bar, kept OUT of
 * `filters` on purpose (plan decision 0.3): conditions **narrow**, the typed text
 * **is** the search. It is `AND`-ed into the WHERE clause — never OR-ed with the
 * filters — and, when the user has not picked a sort column, it also supplies the
 * default ordering.
 */
async function buildEntityInstanceQueryParts(params: {
  organizationId: string
  entityDefinitionId: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
  /** Free-text query from the search bar. Blank/whitespace is treated as absent. */
  search?: string
}): Promise<{
  whereClause: SQL<unknown> | undefined
  orderByClauses: SQL<unknown>[] | undefined
  /**
   * Conditions that produced no SQL. Returned rather than only logged so the
   * paged query can hand them to its caller — see
   * {@link ListFilteredResult.droppedConditions}.
   */
  dropped: DroppedCondition[]
  /**
   * `true` only when conditions were requested and none survived. Forwarded from
   * the builder rather than re-derived from `dropped.length`, which cannot tell
   * "no filters" from "every filter dropped" — the two produce the same empty
   * WHERE. Only the count path reads it; see {@link CountFilteredResult}.
   */
  allConditionsDropped: boolean
}> {
  const { organizationId, entityDefinitionId, filters, sorting } = params
  const search = params.search?.trim() || undefined

  const context = await buildEntityQueryContext(organizationId, entityDefinitionId, filters)

  const built = entityConditionBuilder.buildGroupedQueryWithDiagnostics(filters, context)

  if (built.droppedConditions.length > 0) {
    // Structured, not a JSON.stringify'd sentence — "how often does this happen
    // in production" has to be a query on `droppedCount` / `droppedConditions`,
    // not a grep. This path deliberately proceeds: the records list and stored
    // views must still render when a filter names a retired field. The AI
    // boundary escalates instead, via `inspectFilterConditions`, and the UI gets
    // the same diagnostics back on the response (`dropped`, below) so a list can
    // say it widened rather than leaving it to whoever reads the logs.
    logger.warn('Dropped filter conditions', {
      entityDefinitionId,
      organizationId,
      droppedCount: built.droppedConditions.length,
      requestedConditions: built.requestedConditions,
      allConditionsDropped: built.allConditionsDropped,
      droppedConditions: built.droppedConditions,
    })
  }

  // Search NARROWS. `and()` drops `undefined`, so a filter-less search and a
  // search-less filter both fall out of the same expression.
  const whereClause = search ? and(built.sql, recordSearchPredicate(search)) : built.sql

  // An explicit column sort beats relevance [decision, plan §3.3b]: sorting by
  // name and watching rows reorder by score would read as a bug. Rank is the
  // DEFAULT ordering, not an override.
  //
  // `updatedAt DESC` sits under rank (matching the picker) because rank ties are
  // the common case, not the exception — every row that matches only the ILIKE
  // fallback scores 0. The caller appends `id ASC` as the final tie-break.
  const [primarySort] = sorting
  const orderByClauses = primarySort
    ? entityConditionBuilder.buildOrderBySql(
        primarySort.id,
        primarySort.desc ? 'desc' : 'asc',
        context
      )
    : search
      ? [desc(recordSearchRank(search)), desc(schema.EntityInstance.updatedAt)]
      : undefined

  return {
    whereClause,
    orderByClauses,
    dropped: built.droppedConditions,
    allConditionsDropped: built.allConditionsDropped,
  }
}

/**
 * Resolve the fields + related-entity fields an {@link EntityQueryContext} needs
 * for a given filter set. Shared by the query path and the AI-boundary
 * preflight so both see exactly the same field universe.
 */
async function buildEntityQueryContext(
  organizationId: string,
  entityDefinitionId: string,
  filters: ConditionGroup[]
): Promise<EntityQueryContext> {
  // Get fields for this entity from org cache
  const fields = await getCachedResourceFields(organizationId, entityDefinitionId)

  // Inject `displayName` as a virtual filterable/sortable field — it is a
  // denormalized column on `EntityInstance`, not a `FieldValue` row, so it has no
  // entry in the resource-fields cache.
  //
  // This USED to be how the records search bar got its free text into SQL
  // (`displayName contains` → `ILIKE '%q%'`). Step 2.4 moved that onto the
  // `search` param, but the field STAYS: `displayName contains` is still a
  // legitimate explicit filter, it is what the KB articles table and any stored
  // view carrying such a condition still emit, and dropping it would fail OPEN —
  // the condition would be discarded and the list would silently widen.

  const fieldsWithDisplayName = fields.some((f) => f.key === 'displayName')
    ? fields
    : [
        ...fields,
        {
          id: toFieldId('displayName'),
          key: 'displayName',
          label: 'Display Name',
          name: 'Display Name',
          type: BaseType.STRING,
          fieldType: 'TEXT' as FieldType,
          isSystem: true,
          dbColumn: 'displayName',
          nullable: true,
          showInPanel: false,
          capabilities: {
            filterable: true,
            sortable: true,
            creatable: false,
            updatable: false,
            configurable: false,
          },
        } satisfies ResourceField,
      ]

  // Detect required related entities from filters
  const requiredRelatedEntities = extractRequiredRelatedEntities(filters, fieldsWithDisplayName)

  // Build relatedEntityFields map from org cache
  const relatedEntityFields: Record<string, ResourceField[]> = {}
  for (const relatedEntityId of requiredRelatedEntities) {
    const relatedFields = await getCachedResourceFields(organizationId, relatedEntityId)
    relatedEntityFields[relatedEntityId] = relatedFields
  }

  return {
    fields: fieldsWithDisplayName,
    outerTable: schema.EntityInstance,
    relatedEntityFields,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI-BOUNDARY PREFLIGHT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a filter set does when it reaches the query builder, without running the
 * query. Every field is diagnostic — nothing here changes the SQL.
 */
export interface FilterConditionReport {
  /** Total conditions across every group. */
  requestedConditions: number
  /**
   * Conditions the builder could not turn into SQL. **A non-empty list means
   * the query would return MORE rows than the caller asked for** — the fail-open.
   */
  dropped: DroppedCondition[]
  /** `true` when conditions were requested and none of them produced SQL. */
  allConditionsDropped: boolean
  /**
   * `validateConditionGroups` output — unknown field, missing operator, missing
   * value, invalid option value. A condition can appear here without being
   * dropped (it built, but into something the caller didn't mean).
   */
  validationErrors: string[]
  /**
   * Caller-facing sentence, present **only** when something is wrong.
   * `undefined` ⇒ every requested condition made it into the WHERE clause and
   * the result set is honest.
   */
  message?: string
}

/**
 * Preflight a filter set at an AI tool boundary.
 *
 * The records list, stored views and dashboard widgets deliberately fail open —
 * a view naming a retired field still renders, just wider. An AI tool must not:
 * a dropped filter turns "3 open tickets" into "all 6,470 tickets" with no
 * signal that the filter was ignored. Call this before running the query and
 * return `message` as a tool error when it is set.
 *
 * Dispatches on {@link isSystemResource}, so the same call covers entity
 * definitions and system tables.
 *
 * **Answers identically to the query lane, by construction.** On the system-table
 * branch this runs the *same* `canonicalizeSystemConditions` over the *same*
 * merged fields as {@link buildSystemWhereClause}, because the two diverging is a
 * bug in both directions: preflight missing a drop the query makes would let a
 * widened answer through, and preflight inventing one the query does not make
 * would refuse a filter that works. Canonicalization feeds `validateConditionGroups`
 * too — its `Unknown field:` errors reach `message`, so validating the raw shape
 * would refuse a cuid the build resolved.
 *
 * A genuinely unresolvable reference is untouched by all of this: it canonicalizes
 * to itself, drops, and is still reported.
 *
 * @param params.entityDefinitionId - Entity definition id, or a system `TableId`
 */
export async function inspectFilterConditions(params: {
  organizationId: string
  entityDefinitionId: string
  filters: ConditionGroup[]
}): Promise<FilterConditionReport> {
  const { organizationId, entityDefinitionId, filters } = params

  const { built, validation } = isSystemResource(entityDefinitionId)
    ? await (async () => {
        const tableId = entityDefinitionId as TableId
        const fields = await getCachedResourceFields(organizationId, tableId)
        const canonicalFilters = canonicalizeSystemConditions(filters, tableId, fields)
        return {
          built: systemConditionBuilder.buildGroupedQueryWithDiagnostics(canonicalFilters, tableId),
          validation: systemConditionBuilder.validateConditionGroups(canonicalFilters, tableId),
        }
      })()
    : await (async () => {
        const context = await buildEntityQueryContext(organizationId, entityDefinitionId, filters)
        return {
          built: entityConditionBuilder.buildGroupedQueryWithDiagnostics(filters, context),
          validation: entityConditionBuilder.validateConditionGroups(filters, context),
        }
      })()

  const dropped = built.droppedConditions
  const validationErrors = validation.valid ? [] : validation.errors

  return {
    requestedConditions: built.requestedConditions,
    dropped,
    allConditionsDropped: built.allConditionsDropped,
    validationErrors,
    message: describeFilterProblems(dropped, validationErrors),
  }
}

/**
 * One sentence an LLM can act on: which filters were ignored, and why.
 * `undefined` when there is nothing to report.
 */
function describeFilterProblems(
  dropped: DroppedCondition[],
  validationErrors: string[]
): string | undefined {
  if (dropped.length === 0 && validationErrors.length === 0) return undefined

  const parts: string[] = []

  if (dropped.length > 0) {
    const names = dropped
      .map((d) => {
        const ref = Array.isArray(d.fieldRef) ? d.fieldRef.join('.') : d.fieldRef
        return `'${ref}' ${d.operator}`
      })
      .join(', ')
    parts.push(
      `${dropped.length} filter condition(s) could not be applied and were ignored: ${names}. ` +
        `Running this query would return records that do NOT match them.`
    )
  }

  if (validationErrors.length > 0) {
    parts.push(`Filter validation: ${validationErrors.join('; ')}.`)
  }

  parts.push('Call list_entity_fields to check field ids and operators, then retry.')

  return parts.join(' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGED + COUNT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paged id query: `SELECT id ... LIMIT n + 1 OFFSET m`, optionally in parallel with
 * `COUNT(*)` over the same WHERE clause. Adds `EntityInstance.id ASC` as a deterministic
 * tie-break so OFFSET paging is stable when the sort column has ties.
 *
 * `hasMore` comes from the `limit + 1` probe row, never from `offset + ids.length < total`
 * — the probe stays honest under concurrent inserts/deletes, a stored total drifts.
 *
 * ## 🔴 `OFFSET` is deliberate here. Keyset pagination was tried and REJECTED.
 *
 * The ranked-search case (`search` set, no explicit `sorting`) is the obvious
 * candidate for a keyset cursor: the rank is recomputed over the whole matched
 * set on every page, and `OFFSET` makes Postgres produce and discard rows it has
 * already sorted. **It was implemented, measured against live Postgres, and
 * backed out.** Do not re-attempt it without new information — specifically,
 * without the rewrite named at the bottom of this comment.
 *
 * A correct three-part `(rank DESC, updatedAt DESC, id ASC)` keyset — cursor and
 * `ORDER BY` rendered from one term list via `keysetOrderBy` / `keysetAfter` in
 * `search/text-search-sql.ts` — was **slower than `OFFSET` at every depth and
 * every scale measured**, on the dev database:
 *
 * | matched | depth   | OFFSET | KEYSET  |
 * |---------|---------|--------|---------|
 * | 1,161   | 0       | 16 ms  | 15 ms   |
 * | 1,161   | 1,000   | 16 ms  | 24 ms   |
 * | 92,526  | 0       | 133 ms | 135 ms  |
 * | 92,526  | 50,000  | 155 ms | 214 ms  |
 * | 370,096 | 150,000 | 889 ms | 1208 ms |
 *
 * (Correctness was never the problem: full sweeps over 1,161 and 92,526 matched
 * rows — with 778- and 62,067-row blocks of *tied* rank — reproduced the offset
 * sequence exactly, no skips, no duplicates.)
 *
 * `EXPLAIN ANALYZE` says why, and it is the opposite of the usual keyset story.
 * The rank is a computed expression, so no index can serve the ordering and the
 * **scan + rank evaluation dominates** — 138 ms of a 165 ms page at 92k rows.
 * Against that the `OFFSET` skip is nearly free: the rows are already sorted, so
 * discarding 50,000 of them costs ~16 ms, showing up only as a full
 * `external merge Disk: 3496kB` sort instead of a `top-N heapsort Memory: 32kB`.
 * The keyset does buy that sort back — but its `WHERE` recomputes `similarity()`
 * + `ts_rank_cd()` **twice more per candidate row** (once for the `<` arm, once
 * for the `=` arm), costing ~70 ms at the same scale. Net loss.
 *
 * Worse, the loss **grows with depth**, for the same reason the three-part key
 * was needed at all: most rows score 0 on trigram, so a deep cursor lands inside
 * the huge zero-score tie block, where `rank < r0` is false for every row and the
 * `rank = r0` arm therefore always runs.
 *
 * The only version that could win computes the rank **once** — a materialized CTE
 * or `OFFSET 0` subquery projecting the score, with the keyset filtering on the
 * alias — which caps the win at the sort difference (~15% at 92k rows / depth
 * 50k) and is a different query shape from this one. Measure that before
 * reopening; a keyset bolted onto the current shape is a regression.
 *
 * @returns `ids` (length ≤ limit), `hasMore`, and `total` only when `includeTotal`.
 */
export async function queryEntityInstanceIdsPaged(params: {
  db: Database
  entityDefinitionId: string
  organizationId: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
  limit: number
  offset: number
  /**
   * Free-text search (plan step 2.4). ANDs the ranked predicate into `baseWhere`
   * — which the page query AND the `COUNT(*)` share, so `total` describes the
   * searched set — and, absent an explicit `sorting`, orders by relevance.
   */
  search?: string
  /** Run the parallel `COUNT(*)`. Callers pay for it on the first page only. */
  includeTotal?: boolean
  /**
   * The §5.1 per-record visibility predicate, from
   * {@link import('../../permissions/capabilities/record-visibility-scope').recordVisibilityScope}.
   *
   * Joined into `baseWhere`, which the page query AND the `COUNT(*)` both read —
   * so `total` stays honest over the VISIBLE set rather than describing rows the
   * member cannot open. `undefined` = arm 1 (the member sees every row): no
   * predicate is added and the query is byte-identical to the pre-P5 one.
   */
  visibilityWhere?: SQL
}): Promise<ListFilteredResult> {
  const { db, entityDefinitionId, organizationId, filters, sorting, limit, offset } = params

  const { whereClause, orderByClauses, dropped } = await buildEntityInstanceQueryParts({
    organizationId,
    entityDefinitionId,
    filters,
    sorting,
    search: params.search,
  })

  const baseWhere = and(
    eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
    eq(schema.EntityInstance.organizationId, organizationId),
    isNull(schema.EntityInstance.archivedAt),
    whereClause,
    params.visibilityWhere
  )

  // Deterministic tie-break: append id ASC so OFFSET paging is stable when the
  // user-chosen sort column has ties.
  const finalOrderBy = orderByClauses
    ? [...orderByClauses, asc(schema.EntityInstance.id)]
    : [asc(schema.EntityInstance.id)]

  // limit + 1: the extra row is a probe, never returned — its presence IS `hasMore`.
  const idsQuery = db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(baseWhere)
    .orderBy(...finalOrderBy)
    .limit(limit + 1)
    .offset(offset)

  const countQuery = params.includeTotal
    ? db.select({ count: sql<number>`count(*)::int` }).from(schema.EntityInstance).where(baseWhere)
    : undefined

  const [idsResult, countResult] = await Promise.all([idsQuery, countQuery])

  return {
    ids: idsResult.slice(0, limit).map((r) => r.id),
    ...(countResult ? { total: Number(countResult[0]?.count ?? 0) } : {}),
    hasMore: idsResult.length > limit,
    // `total` and `ids` both describe a WIDER set than the caller asked for when
    // this is non-empty. Reported, not thrown — see the field's JSDoc.
    ...reportDroppedConditions(dropped),
  }
}

/**
 * Count-only variant for entity instances. Skips the id fetch entirely.
 *
 * Takes the same `search` as {@link queryEntityInstanceIdsPaged} so a caller
 * counting "how many rows would this list show" cannot silently count the
 * unsearched set.
 *
 * Reports dropped conditions exactly as the paged query does — see
 * {@link CountFilteredResult}. Like the paged query it **fails open**: a count
 * behind a retired field still answers, just wider, and says so. Callers that
 * must not answer wider (the AI tools) refuse on `allConditionsDropped`.
 */
export async function countEntityInstances(params: {
  db: Database
  entityDefinitionId: string
  organizationId: string
  filters: ConditionGroup[]
  /** Free-text search, ANDed into the WHERE clause exactly as the page query does. */
  search?: string
}): Promise<CountFilteredResult> {
  const { db, entityDefinitionId, organizationId, filters } = params

  const { whereClause, dropped, allConditionsDropped } = await buildEntityInstanceQueryParts({
    organizationId,
    entityDefinitionId,
    filters,
    sorting: [],
    search: params.search,
  })

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt),
        whereClause
      )
    )

  return {
    count: Number(result[0]?.count ?? 0),
    allConditionsDropped,
    // Same projection, same cap, same exact count as the list lane — a dropped
    // condition makes this number too HIGH and that must be sayable.
    ...reportDroppedConditions(dropped),
  }
}

/**
 * **The mail-lens refusal for the generic system-table read path** (step 0.1).
 *
 * `thread` and `message` are registered system resources, so every `TableId`-keyed
 * helper below would happily serve them — and none of them can, because the
 * metadata / identity / read gradation lives only in `mail-query/`
 * (`buildMailVisibilityPredicate` + the per-tier search scopes). The record lane
 * has no equivalent: `UnifiedCrudHandler.recordScope` answers `{ arm: 'all' }` for
 * any system table, so a thread query here is org-wide by construction and its
 * `COUNT(*)` reports the whole organization's mailbox.
 *
 * Refusing rather than teaching this path a second lens implementation is the
 * decision recorded in `plans/search/2026-07-31-retrieval-execution-sequence.md`
 * step 0.1 — the same one behind the picker's guards
 * (`resources/picker/record-picker-service.ts`), the AI entity tools' `blocked`
 * resolution, and `thread`/`message`'s absence from the system search bindings.
 * A row predicate alone would not close it: this path's consumers hydrate a
 * thread's SUBJECT (`RESOURCE_DISPLAY_CONFIG.thread.primaryDisplayFieldId`)
 * through `FieldValueService`, which applies no lens, so a member holding only
 * `metadata` on a mailbox would still read subjects off rows the predicate
 * legitimately admits.
 *
 * Callers that legitimately need threads go through `mail-query/`.
 */
function assertNotMailLensTable(tableId: TableId): void {
  if (isMailLensTableId(tableId)) throw new ForbiddenError(MAIL_LENS_REFUSAL)
}

/**
 * System-resource twin of {@link queryEntityInstanceIdsPaged}: `SELECT id ... LIMIT n + 1
 * OFFSET m`, optional parallel `COUNT(*)`, `id ASC` as a deterministic tie-break.
 *
 * Refuses `thread` / `message` — see {@link assertNotMailLensTable}.
 */
export async function querySystemResourceIdsPaged(params: {
  db: Database
  tableId: TableId
  organizationId: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
  limit: number
  offset: number
  /**
   * Free-text search. ANDed into `baseWhere` — which the page query AND the
   * `COUNT(*)` share, so `total` describes the searched set — and, absent an
   * explicit `sorting`, orders by relevance.
   *
   * **Only for tables with a binding** in
   * `resources/search/system-search-bindings.ts`. For every other system table
   * this argument is ignored and the query is byte-identical to the one that ran
   * before search existed here; see {@link buildSystemSearchParts}.
   */
  search?: string
  /** Run the parallel `COUNT(*)`. Callers pay for it on the first page only. */
  includeTotal?: boolean
  /**
   * Per-row READ enforcement for this table, ANDed into `baseWhere` — the clause
   * the page query AND the `COUNT(*)` share, so `total` describes the **visible**
   * set rather than the org's (plan v3/06 W1b, the v3/02 short-page property).
   *
   * 🔴 Absent means "this table has no per-row policy in the record lane", which
   * is the truth for `user` / `participant` / `visit` and was assumed for
   * `article` until v3/06. It is the CALLER's job to supply it —
   * `UnifiedCrudHandler.systemTableScope` is the only site that does, and it is
   * the only site that should: a second producer is how the two read entry
   * points would start disagreeing about the same row.
   *
   * The predicate is qualified to its own table (`"Article"."id"`, …), so it is
   * only ever valid for the `tableId` it was built for.
   */
  visibilityWhere?: SQL
}): Promise<ListFilteredResult> {
  const { db, tableId, organizationId, filters, sorting, limit, offset } = params

  assertNotMailLensTable(tableId)

  const tableSchema = getTableSchema(tableId)
  if (!tableSchema) {
    throw new Error(`Unknown table: ${tableId}`)
  }

  // For a system resource the `tableId` IS the resource key, so this is the same
  // hydrated per-org cache entry the rest of the request already read.
  const fields = await getCachedResourceFields(organizationId, tableId)

  const { sql: whereClause, dropped } = buildSystemWhereClause(
    tableId,
    organizationId,
    filters,
    fields
  )
  const { searchWhere, searchOrderBy } = buildSystemSearchParts(tableId, params.search)
  // `visibilityWhere` rides in `baseWhere`, NOT beside the search predicate —
  // `article-search-sql.ts`'s own 🔴 comment demands the visibility clause be
  // ANDed OUTSIDE the ranked search predicate so relevance ordering can never
  // reorder an unauthorized row into the page.
  const baseWhere = and(
    eq(tableSchema.organizationId, organizationId),
    whereClause,
    searchWhere,
    params.visibilityWhere
  )

  // The sort column arrives from the same UIs as the filters and carries the
  // same cuid, so `buildOrderBySql` resolved nothing and returned `undefined` —
  // clicking a column header on a system table silently did nothing. There is
  // deliberately no drop reporting for sorts: an unsorted list is visibly odd,
  // unlike a widened one.
  const [primarySort] = sorting
  const orderByClauses = primarySort
    ? systemConditionBuilder.buildOrderBySql(
        canonicalizeSystemFieldRef(primarySort.id, tableId, fields),
        primarySort.desc ? 'desc' : 'asc',
        tableId
      )
    : searchOrderBy

  const finalOrderBy = orderByClauses
    ? [...orderByClauses, asc(tableSchema.id)]
    : [asc(tableSchema.id)]

  // limit + 1: the extra row is a probe, never returned — its presence IS `hasMore`.
  const idsQuery = db
    .select({ id: tableSchema.id })
    .from(tableSchema)
    .where(baseWhere)
    .orderBy(...finalOrderBy)
    .limit(limit + 1)
    .offset(offset)

  const countQuery = params.includeTotal
    ? db.select({ count: sql<number>`count(*)::int` }).from(tableSchema).where(baseWhere)
    : undefined

  const [idsResult, countResult] = await Promise.all([idsQuery, countQuery])

  return {
    ids: idsResult.slice(0, limit).map((r: { id: string }) => r.id),
    ...(countResult ? { total: Number(countResult[0]?.count ?? 0) } : {}),
    hasMore: idsResult.length > limit,
    // Identical shape to the EntityInstance twin above — the two paths must not
    // report the same failure differently, or a UI has to branch on which lane
    // served it. This is the lane where the KB articles table's Tag/Status/Kind
    // filters currently drop (cuid vs registry key), so it is not hypothetical.
    ...reportDroppedConditions(dropped),
  }
}

/**
 * Count-only variant for system resources. Skips the id fetch entirely.
 *
 * Takes the same `search` as {@link querySystemResourceIdsPaged} so a caller
 * counting "how many rows would this list show" cannot silently count the
 * unsearched set.
 *
 * Refuses `thread` / `message` for the same reason the paged query does — a bare
 * count is still a disclosure: "how many threads mention X" answered over the
 * whole org is exactly what the lens exists to prevent.
 */
export async function countSystemResource(params: {
  db: Database
  tableId: TableId
  organizationId: string
  filters: ConditionGroup[]
  /** Free-text search, ANDed into the WHERE clause exactly as the page query does. */
  search?: string
}): Promise<CountFilteredResult> {
  const { db, tableId, organizationId, filters } = params

  assertNotMailLensTable(tableId)

  const tableSchema = getTableSchema(tableId)
  if (!tableSchema) {
    throw new Error(`Unknown table: ${tableId}`)
  }

  // Same merged-field resolution as the paged query — a count that skipped it
  // would report the WIDER set the page no longer shows.
  const fields = await getCachedResourceFields(organizationId, tableId)

  const {
    sql: whereClause,
    dropped,
    allConditionsDropped,
  } = buildSystemWhereClause(tableId, organizationId, filters, fields)
  const { searchWhere } = buildSystemSearchParts(tableId, params.search)

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tableSchema)
    .where(and(eq(tableSchema.organizationId, organizationId), whereClause, searchWhere))

  return {
    count: Number(result[0]?.count ?? 0),
    allConditionsDropped,
    // Identical shape to the EntityInstance twin — the KB articles table's
    // cuid-addressed filters drop on THIS lane, so a widened count here is not
    // hypothetical.
    ...reportDroppedConditions(dropped),
  }
}

/**
 * Turn a free-text `search` into the WHERE fragment and the default ordering for
 * a system table — or into nothing at all when the table has no ranked binding.
 *
 * Three properties this has to hold, all of them mirroring the `EntityInstance`
 * path in {@link buildEntityInstanceQueryParts} so the two axes behave the same
 * wherever a user types:
 *
 * 1. **Search narrows, never ORs.** The predicate is returned as a WHERE
 *    fragment for `and()`, so a filter-less search and a search-less filter fall
 *    out of the same expression.
 * 2. **An explicit column sort beats relevance.** Relevance is returned as the
 *    *default* ordering; the caller only uses it when `sorting` is empty.
 *    Sorting by title and watching rows reorder by score would read as a bug.
 * 3. **No binding ⇒ no change.** A table absent from
 *    `system-search-bindings.ts` gets `{ undefined, undefined }`, which `and()`
 *    drops and the caller falls back through — the query is byte-identical to
 *    the pre-search one. That is what lets the remaining ~10 system tables adopt
 *    ranked search one at a time.
 *
 * Note the `EntityInstance` path puts `updatedAt DESC` between rank and the id
 * tie-break. That is deliberately not replicated: system tables share no common
 * recency column, so the middle tier would have to be per-table. Ties therefore
 * fall straight through to `id ASC` — deterministic, just not recency-ordered.
 */
function buildSystemSearchParts(
  tableId: TableId,
  rawSearch: string | undefined
): { searchWhere: SQL | undefined; searchOrderBy: SQL[] | undefined } {
  const search = rawSearch?.trim() || undefined
  if (!search) return { searchWhere: undefined, searchOrderBy: undefined }

  const columns = getSystemSearchBinding(tableId)
  if (!columns) return { searchWhere: undefined, searchOrderBy: undefined }

  return {
    searchWhere: textSearchPredicate(search, columns),
    searchOrderBy: [desc(textSearchRank(search, columns))],
  }
}

/**
 * System-table twin of the entity WHERE build: same fail-open (a dropped
 * condition widens rather than errors, because stored views must still render)
 * and the same structured warn so the rate is queryable.
 *
 * Returns the diagnostics alongside the clause rather than discarding them — the
 * old signature computed the full drop list, logged it, and then returned only
 * `.sql`, which is precisely why every fail-open on this lane had to be found by
 * accident. Callers surface it as {@link ListFilteredResult.droppedConditions}.
 *
 * Conditions are canonicalized first: the filter UIs address a system field by
 * the org's merged `CustomField` **cuid**, while `SystemConditionBuilder`
 * resolves against `RESOURCE_FIELD_REGISTRY[tableId]`, which is keyed by the
 * STATIC key — so every such condition dropped and the list widened. The
 * pre-pass is pure, synchronous and idempotent, which is why it lives here
 * rather than inside the builder, and why `fields` is a **parameter**: this
 * function must stay sync, so the (cached) field read belongs to the async
 * callers.
 *
 * @param fields - The org's merged fields for `tableId`. Pass `[]` only when the
 *   caller genuinely has none; an empty list restores the old cuid-drops-silently
 *   behaviour for merged fields, reported as usual via `dropped`.
 */
function buildSystemWhereClause(
  tableId: TableId,
  organizationId: string,
  filters: ConditionGroup[],
  fields: ResourceField[]
): {
  sql: SQL<unknown> | undefined
  dropped: DroppedCondition[]
  /** See {@link CountFilteredResult.allConditionsDropped} — only the count path reads it. */
  allConditionsDropped: boolean
} {
  const canonicalFilters = canonicalizeSystemConditions(filters, tableId, fields)
  const built = systemConditionBuilder.buildGroupedQueryWithDiagnostics(canonicalFilters, tableId)

  if (built.droppedConditions.length > 0) {
    logger.warn('Dropped filter conditions', {
      tableId,
      organizationId,
      droppedCount: built.droppedConditions.length,
      requestedConditions: built.requestedConditions,
      allConditionsDropped: built.allConditionsDropped,
      droppedConditions: built.droppedConditions,
    })
  }

  return {
    sql: built.sql,
    dropped: built.droppedConditions,
    allConditionsDropped: built.allConditionsDropped,
  }
}

/**
 * Get Drizzle table schema for a system resource
 *
 * @param tableId - System table ID
 */
export function getTableSchema(tableId: TableId) {
  const tableInfo = RESOURCE_TABLE_MAP[tableId]
  if (!tableInfo) return undefined

  // Contact, Ticket, and Part tables have been dropped - they now use EntityInstance.
  // `Inbox` is absent on purpose: `inbox`/`personal_inbox` are def-backed types, so
  // `RESOURCE_TABLE_REGISTRY` excludes them and `dbName` can never resolve to it.
  const tableMap: Record<string, any> = {
    User: schema.User,
    Thread: schema.Thread,
    Message: schema.Message,
    Participant: schema.Participant,
    Dataset: schema.Dataset,
    Article: schema.Article,
    KnowledgeBase: schema.KnowledgeBase,
  }

  return tableMap[tableInfo.dbName]
}

/**
 * Check if a resource ID is a system resource
 *
 * @param resourceId - Resource ID to check
 */
export function isSystemResource(resourceId: string): boolean {
  return RESOURCE_TABLE_REGISTRY.some((r) => r.id === resourceId)
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST ALL TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for listAll query
 */
export interface ListAllInput {
  /** Entity definition ID - can be UUID or type like 'tag', 'contact' */
  entityDefinitionId?: string
  /** API slug like 'tags', 'contacts' */
  apiSlug?: string
  /** Specific field IDs to fetch (all fields if undefined) */
  fieldIds?: FieldId[]
  /**
   * Specific field output keys to fetch (e.g. 'title', 'tag_color'). Ignored
   * when fieldIds is set. Prefer this over fetching all fields — the full
   * fan-out loads every FieldValue for up to 1000 records.
   */
  fieldKeys?: string[]
  /** Include archived records */
  includeArchived?: boolean
}

/**
 * Record with field values
 */
export type ListAllItem = EntityInstanceEntity & {
  recordId: RecordId
  fieldValues: Record<string, unknown>
}

/**
 * Field info for client-side operations
 */
export interface ListAllFieldInfo {
  id: string
  key: string
  type: string
}

/**
 * Result from listAll query
 */
export interface ListAllResult {
  /** Records with field values (inherits displayName, secondaryDisplayValue, avatarUrl from EntityInstanceEntity) */
  items: ListAllItem[]
  /** Resolved entityDefinitionId UUID */
  entityDefinitionId: string
  /** Map of field key to field info (for resolving fieldIds when saving) */
  fields: Record<string, ListAllFieldInfo>
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve entityDefinitionId or apiSlug to actual entityDefinitionId UUID using org cache.
 *
 * @param organizationId - Organization ID for cache lookup
 * @param params - Must provide either entityDefinitionId or apiSlug
 * @returns Resolved entityDefinitionId UUID
 * @throws Error if neither provided or not found
 */
export async function resolveEntityIdFromCache(
  organizationId: string,
  params: { entityDefinitionId?: string; apiSlug?: string }
): Promise<string> {
  const { entityDefinitionId, apiSlug } = params

  const key = apiSlug ?? entityDefinitionId
  if (!key) {
    throw new Error('Must provide entityDefinitionId or apiSlug')
  }

  // Try finding as a resource (handles entityType, apiSlug, and UUID)
  const resource = await findCachedResource(organizationId, key)
  if (resource) {
    return resource.entityDefinitionId ?? resource.id
  }

  // If it looks like a UUID/CUID (not a short type name), return as-is
  if (key.length >= 20) {
    return key
  }

  // Try entityDefs cache for entity types
  const resolved = await getCachedEntityDefId(organizationId, key)
  if (resolved) return resolved

  // Try entityDefSlugs cache for apiSlugs
  const slugs = await getOrgCache().get(organizationId, 'entityDefSlugs')
  if (slugs[key]) return slugs[key]

  throw new Error(`Entity not found for key: ${key}`)
}

/**
 * @deprecated Use resolveEntityIdFromCache instead
 */
export async function resolveEntityId(
  registryService: ResourceRegistryService,
  params: { entityDefinitionId?: string; apiSlug?: string }
): Promise<string> {
  const { entityDefinitionId, apiSlug } = params

  // Resolve from apiSlug if provided
  if (apiSlug) {
    return registryService.resolveEntityDefIdFromApiSlug(apiSlug)
  }

  // Resolve entityDefinitionId (handles 'tag' → UUID, or UUID → UUID)
  if (entityDefinitionId) {
    return registryService.resolveEntityDefId(entityDefinitionId)
  }

  throw new Error('Must provide entityDefinitionId or apiSlug')
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST ALL QUERY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all entities with field values for small datasets (no pagination).
 * Resolves entityDefinitionId (can be 'tag', 'contact', or UUID) or apiSlug to actual UUID.
 *
 * @param ctx - Query context
 * @param params - List all parameters
 * @returns Items with field values and resolved entityDefinitionId
 */
export async function listAll(
  ctx: {
    db: Database
    organizationId: string
    userId: string
    /**
     * Request-scoped read enforcement. Absent ⇒ no enforcement (internal/system
     * callers). Added by plan v3/03 §5.4: this ctx had no `capabilities` field at
     * all, so the `FieldValueService` below was constructed unenforced even when
     * the caller had a resolved capability set — dropping relationship redaction
     * from every `listAll` payload.
     */
    capabilities?: CapabilityView
    /**
     * The §5.1 per-record visibility predicate for THIS def. `undefined` = arm 1
     * (see {@link queryEntityInstanceIdsPaged.visibilityWhere}); the caller must
     * not call at all on arm 4.
     */
    visibilityWhere?: SQL
  },
  params: ListAllInput
): Promise<ListAllResult> {
  const { db, organizationId, userId } = ctx

  // Create services
  const fieldValueService = new FieldValueService(organizationId, userId, db, undefined, {
    capabilities: ctx.capabilities,
  })

  // Resolve to actual entityDefinitionId UUID
  const entityDefId = await resolveEntityIdFromCache(organizationId, {
    entityDefinitionId: params.entityDefinitionId,
    apiSlug: params.apiSlug,
  })

  // Fetch all records (safety limit for "all")
  const records = await db.query.EntityInstance.findMany({
    where: (ei, { eq, and, isNull }) => {
      const conditions = [
        eq(ei.entityDefinitionId, entityDefId),
        eq(ei.organizationId, organizationId),
      ]
      if (!params.includeArchived) {
        conditions.push(isNull(ei.archivedAt))
      }
      // Per-record visibility (§5.1) rides the SAME where clause as the rest of
      // the filter, so a grant-only member's `listAll` is one scoped query
      // rather than a full read plus a post-filter.
      if (ctx.visibilityWhere) conditions.push(ctx.visibilityWhere)
      return and(...conditions)
    },
    orderBy: (ei, { desc }) => [desc(ei.updatedAt)],
    limit: 1000,
  })

  // Get all fields for this entity from org cache
  const fields = await getCachedResourceFields(organizationId, entityDefId)

  // Build fields map (outputKey → { id, key, type })
  const fieldsMap: Record<string, ListAllFieldInfo> = {}
  for (const field of fields) {
    const outputKey = getFieldOutputKey(field)
    fieldsMap[outputKey] = {
      id: field.id,
      key: outputKey,
      type: field.fieldType ?? field.type,
    }
  }

  if (records.length === 0) {
    return { items: [], entityDefinitionId: entityDefId, fields: fieldsMap }
  }

  // Build field references and maps from ResourceFieldId → field.key and → fieldType
  const resourceFieldIdToKey = new Map<string, string>()
  const resourceFieldIdToType = new Map<string, FieldType>()
  let fieldReferences: FieldReference[]

  // Resolve fieldKeys (output keys) to field IDs — callers usually know keys, not IDs.
  // Unknown keys are dropped; an all-unknown list yields no field values (not all fields).
  let requestedFieldIds = params.fieldIds
  if ((!requestedFieldIds || requestedFieldIds.length === 0) && params.fieldKeys) {
    requestedFieldIds = params.fieldKeys
      .map((key) => fieldsMap[key]?.id)
      .filter((id): id is string => Boolean(id)) as FieldId[]
  }

  if (requestedFieldIds && (requestedFieldIds.length > 0 || params.fieldKeys)) {
    // Use specific fields provided
    fieldReferences = requestedFieldIds.map((fieldId) => {
      const resourceFieldId = toResourceFieldId(entityDefId, fieldId)
      // Find field by id to get its key and type
      const field = fields.find((f) => f.id === fieldId)
      if (field) {
        resourceFieldIdToKey.set(resourceFieldId, getFieldOutputKey(field))
        resourceFieldIdToType.set(resourceFieldId, (field.fieldType ?? field.type) as FieldType)
      }
      return resourceFieldId as ResourceFieldId
    })
  } else {
    // Use all fields
    fieldReferences = fields
      .filter((f) => f.resourceFieldId) // Only fields with resourceFieldId
      .map((f) => {
        resourceFieldIdToKey.set(f.resourceFieldId as string, getFieldOutputKey(f))
        resourceFieldIdToType.set(f.resourceFieldId as string, (f.fieldType ?? f.type) as FieldType)
        return f.resourceFieldId as ResourceFieldId
      })
  }

  // If no fields, return records without field values
  if (fieldReferences.length === 0) {
    return {
      items: records.map((r) => ({
        ...r,
        recordId: toRecordId(entityDefId, r.id),
        fieldValues: {},
      })),
      entityDefinitionId: entityDefId,
      fields: fieldsMap,
    }
  }

  // Fetch field values for all records
  const recordIds = records.map((r) => toRecordId(entityDefId, r.id))
  const { values } = await fieldValueService.batchGetValues({
    recordIds,
    fieldReferences,
  })

  // Group field values by recordId, using field key (not ResourceFieldId) as the key
  const fieldValuesByRecord = new Map<string, Record<string, unknown>>()
  for (const recordId of recordIds) {
    fieldValuesByRecord.set(recordId, {})
  }

  for (const result of values) {
    const existing = fieldValuesByRecord.get(result.recordId) ?? {}
    // Convert ResourceFieldId to field key for the output
    const resourceFieldId = Array.isArray(result.fieldRef)
      ? result.fieldRef.join('::')
      : result.fieldRef
    const fieldKey = resourceFieldIdToKey.get(resourceFieldId) ?? resourceFieldId
    const fieldType = resourceFieldIdToType.get(resourceFieldId)

    // Extract raw value from TypedFieldValue (e.g., { type: 'text', value: '#C9B6F2' } → '#C9B6F2')
    const rawValue =
      fieldType && result.value != null ? formatToRawValue(result.value, fieldType) : result.value
    existing[fieldKey] = rawValue
    fieldValuesByRecord.set(result.recordId, existing)
  }

  // Merge field values into records
  const items = records.map((record) => {
    const recordId = toRecordId(entityDefId, record.id)
    return {
      ...record,
      recordId,
      fieldValues: fieldValuesByRecord.get(recordId) ?? {},
    }
  })

  return {
    items,
    entityDefinitionId: entityDefId,
    fields: fieldsMap,
  }
}

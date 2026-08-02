// packages/lib/src/mail-filters/evaluate.ts
// THE mail-filter evaluator (plan §4.2, invariant 5).
//
// One evaluator, forever: the fire path, the preview count and the retroactive
// apply all compile their predicate here, through `condition-query-builder`.
// A second implementation — an in-memory fast path, a hand-rolled "just this one
// field" check — reintroduces exactly the divergence this design removed. If a
// field is missing, add it to the builder.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, type SQL, sql } from 'drizzle-orm'
import { getOperatorDefinition, type Operator } from '../conditions/operator-definitions'
import type { ConditionGroup } from '../conditions/types'
import { BadRequestError } from '../errors'
import {
  buildConditionGroupsQueryWithDiagnostics,
  type ConditionGroupsQueryResult,
  type DroppedCondition,
} from '../mail-query/condition-query-builder'
import { type MailViewer, SYSTEM_VISIBILITY } from '../permissions/visibility/context'
import { getMailFilterField } from './client'
import type { CachedMailFilter } from './types'

const logger = createScopedLogger('mail-filters-evaluate')

/**
 * Predicates per `UNION ALL` statement.
 *
 * Growth/Enterprise are unlimited (`mailFiltersLimit: -1`), so this is the
 * ENGINE's own ceiling: `ceil(n/25)` round trips means 200 enabled filters on
 * one inbox degrade linearly instead of compiling one 200-branch statement on
 * the `message:received` path.
 */
export const FILTER_PREDICATE_CHUNK_SIZE = 25

/**
 * Compile one filter's conditions, keeping the builder's drop diagnostics.
 *
 * `condition-query-builder` never throws: a condition whose field/operator/value
 * triple it cannot dispatch is DROPPED, and the surviving clause is whatever is
 * left — for a filter whose every condition drops, that is the bare org scope,
 * i.e. **every thread in the inbox**. Silently widening is the right behaviour
 * for a saved mail view (a view naming a retired field still renders); it is a
 * catastrophe for a rule that mutates mail, so mail filters read the diagnostics
 * rather than the clause alone.
 *
 * {@link buildFilterPredicate} is the clause-only projection every existing call
 * site keeps using — it applies the fail-closed rule below, so the diagnostics
 * are additive and no caller has to remember to check them.
 */
export function buildFilterPredicateWithDiagnostics(
  filter: Pick<CachedMailFilter, 'conditions'> | { conditions: ConditionGroup[] },
  organizationId: string,
  viewer: MailViewer
): ConditionGroupsQueryResult {
  return buildConditionGroupsQueryWithDiagnostics(filter.conditions, organizationId, viewer)
}

/**
 * Compile one filter's conditions into a `Thread` WHERE clause.
 *
 * Split out from {@link matchFilters} so the preview count (§7) can reuse the
 * identical compilation with the REQUESTING USER's viewer — a preview must not
 * count threads the author cannot see, while the engine has no user at all and
 * passes `SYSTEM_VISIBILITY`. Containment (§4.4) is what bounds the engine
 * instead.
 *
 * The clause is always the org scope AND the filter's own conditions;
 * `buildMailVisibilityPredicate` and `buildSearchScopes` both return `undefined`
 * for the system viewer, so nothing per-viewer narrows it there.
 *
 * ⚠️ **Fails CLOSED when every requested condition was dropped.** A filter that
 * asked to match something and compiled to nothing gets `AND false`, so it
 * matches no thread at all — on the fire path, in the preview count and in the
 * retroactive backfill alike, because all three come through here. The
 * alternative is the default: the clause collapses to `organizationId = $1 AND
 * mergedIntoThreadId IS NULL`, which AND-ed with `Thread.id = $2` matches, and a
 * single unsupported operator turns "Body starts with Unsubscribe → mark spam"
 * into "mark everything spam". Authoring such a filter is rejected up front by
 * {@link assertFilterConditionsCompile}; this bounds the rows that predate the
 * check, and the ones a later regression in field support would create.
 *
 * A filter with NO conditions is untouched — "every new message" is a legitimate
 * rule, and `allConditionsDropped` is false for it by construction.
 */
export function buildFilterPredicate(
  filter: Pick<CachedMailFilter, 'conditions'> | { conditions: ConditionGroup[] },
  organizationId: string,
  viewer: MailViewer
): SQL<unknown> {
  const compiled = buildFilterPredicateWithDiagnostics(filter, organizationId, viewer)
  if (!compiled.allConditionsDropped) return compiled.sql
  return and(compiled.sql, sql`false`)!
}

/** The label a person would recognise for a dropped condition's field. */
function fieldLabel(fieldId: string): string {
  return getMailFilterField(fieldId)?.label ?? fieldId
}

/** The label a person would recognise for a dropped condition's operator. */
function operatorLabel(operator: string): string {
  return getOperatorDefinition(operator as Operator)?.label ?? operator
}

/**
 * One dropped condition, in the author's vocabulary.
 *
 * Named rather than counted: "invalid conditions" tells the author nothing they
 * can act on, while "“Body starts with” is not a condition mail filters can
 * match on" points straight at the row to change.
 */
export function describeDroppedFilterCondition(dropped: DroppedCondition): string {
  const field = fieldLabel(dropped.fieldId)
  switch (dropped.reason) {
    case 'unknown-field':
      return `“${field}” is not a field mail filters can match on`
    case 'unresolved-value-source':
      return `“${field} ${operatorLabel(dropped.operator)}” uses a dynamic value mail filters cannot resolve`
    case 'build-error':
      return `“${field} ${operatorLabel(dropped.operator)}” could not be understood${dropped.detail ? ` (${dropped.detail})` : ''}`
    default:
      return `“${field}” does not support the “${operatorLabel(dropped.operator)}” operator`
  }
}

/**
 * Reject a filter whose conditions do not compile — the SAVE-TIME half of the
 * fail-closed rule, and the only one the author ever sees.
 *
 * The condition editor derives its catalog from `MAIL_VIEW_FIELD_DEFINITIONS`
 * and its operators from the field's `fieldType`, so it offers combinations the
 * query builder has no case for: `FieldType.TEXT` advertises `starts with` /
 * `ends with` / `empty` while `buildBodyQuery` handles `contains` and
 * `not contains` only. Every one of those saves a filter that matches the whole
 * inbox. This is the gate; {@link buildFilterPredicate}'s `AND false` is the
 * backstop for rows written before it existed.
 *
 * Compiled as SYSTEM (`SYSTEM_VISIBILITY`, the principal the engine fires as) —
 * which conditions survive is a property of the field/operator/value triple, not
 * of who is looking, so this is exactly the compilation the fire path performs.
 *
 * @throws BadRequestError naming every offending field and operator.
 */
export function assertFilterConditionsCompile(
  conditions: ConditionGroup[],
  organizationId: string
): void {
  const { droppedConditions } = buildFilterPredicateWithDiagnostics(
    { conditions },
    organizationId,
    SYSTEM_VISIBILITY
  )
  if (droppedConditions.length === 0) return

  const reasons = droppedConditions.map(describeDroppedFilterCondition).join('; ')
  throw new BadRequestError(
    `This filter can’t be saved because ${reasons}. Pick a different field or operator.`
  )
}

/**
 * Which of `filters` match `threadId`, in ONE round trip per chunk.
 *
 * ```sql
 * SELECT 'flt_a'::text AS fid FROM "Thread" WHERE id = $1 AND (<pred A>)
 * UNION ALL
 * SELECT 'flt_b'::text AS fid FROM "Thread" WHERE id = $1 AND (<pred B>)
 * ```
 *
 * The returned id set is exactly the filters that matched. **Ordering and
 * `stopProcessing` are applied in memory over this set** (§4.5) so the SQL never
 * has to encode filter order — which is also what lets the retroactive apply and
 * the preview reuse it unchanged.
 *
 * ⚠️ **The predicates stay in the WHERE position, never in a SELECT
 * projection** (invariant 6). A Drizzle `Column` in a single-table projection
 * loses its table qualifier, so correlated `exists(...)` subqueries — which
 * `buildToQuery` / `buildHasAttachmentsQuery` emit — silently self-join and fail
 * closed. That is the bug that broke every per-record grant. The
 * `UNION ALL`-of-`WHERE` shape exists specifically to avoid it.
 *
 * A filter whose every condition was dropped is SKIPPED — not compiled into a
 * branch that would match unconditionally (see {@link buildFilterPredicate}).
 * Dropping the branch rather than relying on its `AND false` also saves the
 * round trip, and the warning names the filter so a broken row is findable
 * instead of merely inert.
 *
 * Body conditions do NOT depend on `Thread.searchText`: `buildBodyQuery` emits a
 * correlated `EXISTS` over `Message.textPlain` / `Message.textHtml`, and the
 * `Message` row is committed inside `storeMessage`'s own transaction, well
 * before `message:received` publishes. `Thread.searchText` is written only by
 * `updateThreadMetadataEfficient`, which `store-message.ts` calls for
 * ALREADY-EXISTING threads only — which is why `freeText`, whose body arm reads
 * that column, is not an offerable filter field (`MAIL_FILTER_EXCLUDED_FIELD_IDS`).
 * Pinned by `evaluate.test.ts`.
 *
 * Throws on a DB error — the never-throws contract lives in the engine.
 */
export async function matchFilters(
  db: Database,
  organizationId: string,
  threadId: string,
  filters: CachedMailFilter[]
): Promise<Set<string>> {
  const matched = new Set<string>()
  if (filters.length === 0) return matched

  for (let offset = 0; offset < filters.length; offset += FILTER_PREDICATE_CHUNK_SIZE) {
    const chunk = filters.slice(offset, offset + FILTER_PREDICATE_CHUNK_SIZE)
    const branches = chunk.flatMap((filter) => {
      const compiled = buildFilterPredicateWithDiagnostics(
        filter,
        organizationId,
        SYSTEM_VISIBILITY
      )

      if (compiled.allConditionsDropped) {
        logger.warn(
          `Skipping mail filter '${filter.name}' (${filter.id}): none of its ${compiled.requestedConditions} conditions compile, so it would match every thread in the inbox`,
          {
            filterId: filter.id,
            inboxId: filter.inboxId,
            organizationId,
            dropped: compiled.droppedConditions.map(
              (d) => `${d.fieldId} ${d.operator} (${d.reason})`
            ),
          }
        )
        return []
      }

      if (compiled.droppedConditions.length > 0) {
        // Some conditions survived, so the filter still narrows — it is wider
        // than authored, not unbounded. The save-time gate is what stops new
        // ones; this makes the existing ones findable.
        logger.warn(
          `Mail filter '${filter.name}' (${filter.id}) is evaluating without ${compiled.droppedConditions.length} of its ${compiled.requestedConditions} conditions`,
          {
            filterId: filter.id,
            organizationId,
            dropped: compiled.droppedConditions.map(
              (d) => `${d.fieldId} ${d.operator} (${d.reason})`
            ),
          }
        )
      }

      // `${filter.id}::text` — the id is bound as a parameter, and Postgres
      // cannot infer a bare parameter's type in a UNION branch's select list.
      return [
        sql`SELECT ${filter.id}::text AS fid FROM ${schema.Thread} WHERE ${and(
          eq(schema.Thread.id, threadId),
          compiled.sql
        )}`,
      ]
    })

    if (branches.length === 0) continue

    const result = await db.execute(sql.join(branches, sql` UNION ALL `))
    for (const row of (result.rows ?? []) as { fid?: string }[]) {
      if (row?.fid) matched.add(row.fid)
    }
  }

  return matched
}

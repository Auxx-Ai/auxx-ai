// packages/lib/src/ai/kopilot/capabilities/record-views/count-matches.ts

import type { Database } from '@auxx/database'
import {
  countEntityInstances,
  countSystemResource,
  isSystemResource,
} from '../../../../resources/crud'
import type { TableId } from '../../../../resources/registry/field-registry'
import type { Resource } from '../../../../resources/registry/types'
import {
  assertCountFiltersApplied,
  convertToConditionGroup,
  type SimplifiedFilter,
} from '../entities/shared/record-filters'

/**
 * Count records matching a filter set, via the same read path `query_records`
 * uses (apiSlug-prefixed `ConditionGroup` → `UnifiedCrudHandler` count). Lets
 * the preview tool tell the user "matches N records" without fetching rows.
 *
 * **Refuses rather than answering wider.** The count lane fails open — a filter
 * the builder cannot compile is dropped and the `COUNT(*)` runs anyway — so a
 * preview whose every condition dropped would report the definition's full row
 * count as "matching your filters". `assertCountFiltersApplied` throws on that;
 * a partial drop still answers, and the previewed table surfaces those drops
 * itself through `DroppedFiltersNotice` on its own `listFiltered` page.
 *
 * @throws UnprocessableEntityError when every requested condition was dropped.
 */
export async function countRecordMatches(args: {
  db: Database
  organizationId: string
  resource: Resource
  entityDefinitionId: string
  filters: SimplifiedFilter[]
  logicalOperator: 'AND' | 'OR'
}): Promise<number> {
  const { db, organizationId, resource, entityDefinitionId, filters, logicalOperator } = args
  const group = convertToConditionGroup(filters, resource, logicalOperator)
  const groups = group ? [group] : []

  const counted = isSystemResource(entityDefinitionId)
    ? await countSystemResource({
        db,
        tableId: entityDefinitionId as TableId,
        organizationId,
        filters: groups,
      })
    : await countEntityInstances({ db, entityDefinitionId, organizationId, filters: groups })

  assertCountFiltersApplied(counted, resource.label)
  return counted.count
}

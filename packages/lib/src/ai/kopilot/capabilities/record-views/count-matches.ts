// packages/lib/src/ai/kopilot/capabilities/record-views/count-matches.ts

import type { Database } from '@auxx/database'
import {
  countEntityInstances,
  countSystemResource,
  isSystemResource,
} from '../../../../resources/crud'
import type { TableId } from '../../../../resources/registry/field-registry'
import type { Resource } from '../../../../resources/registry/types'
import { convertToConditionGroup, type SimplifiedFilter } from '../entities/shared/record-filters'

/**
 * Count records matching a filter set, via the same read path `query_records`
 * uses (apiSlug-prefixed `ConditionGroup` → `UnifiedCrudHandler` count). Lets
 * the preview tool tell the user "matches N records" without fetching rows.
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

  return isSystemResource(entityDefinitionId)
    ? countSystemResource({
        db,
        tableId: entityDefinitionId as TableId,
        organizationId,
        filters: groups,
      })
    : countEntityInstances({ db, entityDefinitionId, organizationId, filters: groups })
}

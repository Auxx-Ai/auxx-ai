// packages/lib/src/resources/grouping/types.ts

import type { ColumnAggregateOp, GroupByConfig } from '../../conditions/view-config'
import type { DroppedFilterNotice } from '../crud/unified-handler-queries'

/** A table group-by as the list and summary queries receive it (`groupBy` on the view config). */
export type GroupByInput = GroupByConfig

/** Column id (ResourceFieldId) → aggregate op, for the group header cells. */
export type GroupAggregatesInput = Record<string, ColumnAggregateOp>

/** One group's count and per-column aggregates. `key` is raw (option id, record id, bucket…). */
export interface GroupSummaryRow {
  key: string | null
  count: number
  aggregates: Record<string, number | null>
}

/** Groups in the list's group order, capped at {@link MAX_SUMMARY_GROUPS}. */
export interface GroupSummaryResult {
  groups: GroupSummaryRow[]
  hasMoreGroups: boolean
  droppedConditions?: DroppedFilterNotice[]
  droppedConditionCount?: number
}

/** Group cap for one summary; past it `hasMoreGroups` is set and the client shows "—". */
export const MAX_SUMMARY_GROUPS = 500

// apps/web/src/components/mrp/ui/plan/plan-tabs.ts

import type { MrpPlanTab } from '@auxx/lib/mrp/client'
import { CalendarDays, CheckCircle2, CircleAlert, Flag, List, Timer } from 'lucide-react'
import type { RouterOutputs } from '~/trpc/react'
import { formatQty } from '../rows/format'

type SummaryCounts = NonNullable<RouterOutputs['mrp']['summary']['counts']>

/** The action list's strip, in order; `all` is where a filtered link lands, e.g. every purchase. */
export const ACTION_LIST_TABS = ['overdue', 'this_week', 'later', 'flagged', 'fine', 'all'] as const
export type ActionListTab = (typeof ACTION_LIST_TABS)[number]

export const PLAN_TAB_LABEL: Record<ActionListTab, string> = {
  overdue: 'Overdue',
  this_week: 'This week',
  later: 'Later',
  flagged: 'Flagged',
  fine: 'Fine',
  all: 'All',
}

export const PLAN_TAB_ICON: Record<ActionListTab, typeof CircleAlert> = {
  overdue: CircleAlert,
  this_week: Timer,
  later: CalendarDays,
  flagged: Flag,
  fine: CheckCircle2,
  all: List,
}

/** Every MRP list's padding, which `SelectAllCheckbox` aligns its box against. */
export const MRP_LIST_PADDING = 12

/** A `?tab=` the strip does not show reads as Overdue. */
export function toActionListTab(tab: MrpPlanTab): ActionListTab {
  return (ACTION_LIST_TABS as readonly string[]).includes(tab) ? (tab as ActionListTab) : 'overdue'
}

/** A tab's badge count off `mrp.summary`; 0 before it loads. */
export function planTabCount(tab: ActionListTab, counts: SummaryCounts | null | undefined): number {
  if (!counts) return 0
  switch (tab) {
    case 'overdue':
      return counts.overdue
    case 'this_week':
      return counts.thisWeek
    case 'later':
      return counts.later
    case 'flagged':
      return counts.flagged
    case 'fine':
      return counts.fine
    case 'all':
      return counts.total
  }
}

/** Why a tab is empty; an empty Overdue tab is the healthy state and reads like one. */
export function planTabEmpty(tab: ActionListTab): { title: string; description: string } {
  switch (tab) {
    case 'overdue':
      return {
        title: 'Nothing is overdue',
        description: 'No part is past the date it had to be ordered or built by.',
      }
    case 'this_week':
      return {
        title: 'Nothing to order this week',
        description: 'No part needs ordering or building in the next seven days.',
      }
    case 'later':
      return {
        title: 'Nothing further out',
        description: 'The run dated no order beyond this week.',
      }
    case 'flagged':
      return {
        title: 'No flags',
        description: 'The run found nothing in the data that makes a date less certain.',
      }
    case 'fine':
      return {
        title: 'No part is fine yet',
        description: 'Every planned part has a suggestion or a flag.',
      }
    case 'all':
      return {
        title: 'No planned parts',
        description: 'The run planned no part that matches.',
      }
  }
}

export interface PlanGroup<T> {
  key: string
  label: string
  items: T[]
}

/** Rows grouped by suggested supplier, in the order the server sorted them; no supplier groups last. */
export function groupBySupplier<
  T extends { suggestedSupplierId: string | null; supplierName: string | null },
>(items: readonly T[]): PlanGroup<T>[] {
  const groups = new Map<string, PlanGroup<T>>()
  for (const item of items) {
    const key = item.suggestedSupplierId ?? ''
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        label: key ? (item.supplierName ?? 'Unnamed supplier') : 'No supplier',
        items: [],
      }
      groups.set(key, group)
    }
    group.items.push(item)
  }
  const none = groups.get('')
  groups.delete('')
  return none ? [...groups.values(), none] : [...groups.values()]
}

/** Rows grouped by the finished goods above them, first-seen order; a part under several finished goods appears under each. */
export function groupByFinishedGood<
  T extends { finishedGoodIds: string[]; finishedGoodNames: string[] },
>(items: readonly T[]): PlanGroup<T>[] {
  const groups = new Map<string, PlanGroup<T>>()
  const add = (key: string, label: string, item: T) => {
    let group = groups.get(key)
    if (!group) {
      group = { key, label, items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
  }
  for (const item of items) {
    if (item.finishedGoodIds.length === 0) add('', 'No finished good', item)
    item.finishedGoodIds.forEach((id, i) =>
      add(id, item.finishedGoodNames[i] ?? 'Unnamed part', item)
    )
  }
  const none = groups.get('')
  groups.delete('')
  return none ? [...groups.values(), none] : [...groups.values()]
}

/** A group's summed suggestion; undefined when nothing in it is suggested. */
export function suggestionTotal(
  items: ReadonlyArray<{ suggestedQty: number | null }>
): string | undefined {
  let total = 0
  let any = false
  for (const item of items) {
    if (item.suggestedQty === null) continue
    total += item.suggestedQty
    any = true
  }
  return any ? formatQty(total) : undefined
}

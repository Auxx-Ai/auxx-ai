// packages/lib/src/accounting/money/blocked-work.ts

/**
 * The Outbox's Blocked tab: parked accounting work, one row per
 * `(reasonCode, role, railId, glAccountId)`, expandable to its items (91 §4.6).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { ok } from 'neverthrow'
import type { ExportAvenue } from '../ledger/setup/export-settings'
import {
  countWorkItemGroups,
  listWorkItemGroups,
  listWorkItemsInGroup,
  type WorkItemCategory,
  type WorkItemFilters,
  type WorkItemGroup,
  type WorkItemListRow,
} from '../work-items/reads'
import type { WorkItemGroupKey } from '../work-items/wake'

/** The avenues a parked item can fall under; the rest of the Outbox vocabulary never parks here. */
const BLOCKED_CATEGORIES: ReadonlySet<ExportAvenue> = new Set<WorkItemCategory>([
  'receipt',
  'refund',
  'vendorPayment',
  'fulfillment',
  'creditMemo',
  'payout',
])

export interface BlockedWorkOptions {
  limit: number
  /** Offset into the list. */
  cursor?: number
  categories?: ExportAvenue[]
  search?: string
  from?: string
  to?: string
  bookTimeZone?: string
}

/** `null` when the chosen categories can never hold parked work. */
function toFilters(options: BlockedWorkOptions): WorkItemFilters | null {
  const categories = options.categories?.filter((category): category is WorkItemCategory =>
    BLOCKED_CATEGORIES.has(category)
  )
  if (options.categories?.length && !categories?.length) return null
  return {
    categories,
    search: options.search,
    from: options.from,
    to: options.to,
    bookTimeZone: options.bookTimeZone,
  }
}

/** One page of groups, newest write first. */
export async function listBlockedWork(
  db: Database,
  organizationId: string,
  options: BlockedWorkOptions
): Promise<Result<{ items: WorkItemGroup[]; nextCursor?: number }, Error>> {
  const filters = toFilters(options)
  if (!filters) return ok({ items: [] })
  const page = await listWorkItemGroups(db, organizationId, {
    ...filters,
    limit: options.limit,
    offset: options.cursor ?? 0,
  })
  return page.map(({ items, nextOffset }) => ({
    items,
    ...(nextOffset !== undefined ? { nextCursor: nextOffset } : {}),
  }))
}

/** One group expanded, paged. */
export async function listBlockedWorkItems(
  db: Database,
  organizationId: string,
  group: WorkItemGroupKey,
  options: BlockedWorkOptions
): Promise<Result<{ items: WorkItemListRow[]; nextCursor?: number }, Error>> {
  const filters = toFilters(options)
  if (!filters) return ok({ items: [] })
  const page = await listWorkItemsInGroup(db, organizationId, group, {
    ...filters,
    limit: options.limit,
    offset: options.cursor ?? 0,
  })
  return page.map(({ items, nextOffset }) => ({
    items,
    ...(nextOffset !== undefined ? { nextCursor: nextOffset } : {}),
  }))
}

/** The tab's badge: groups a person can act on. */
export async function countBlockedWork(db: Database, organizationId: string): Promise<number> {
  const counted = await countWorkItemGroups(db, organizationId)
  return counted.isOk() ? counted.value : 0
}

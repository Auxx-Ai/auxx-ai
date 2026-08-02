// packages/lib/src/mail-filters/cache.ts
// Org-cache reads for the `mailFilters` key + the per-inbox index the gate uses.
//
// The org cache is reached through a LAZY `await import('../cache')`, not a
// static import: this module is imported by `cache/providers/mail-filters-provider.ts`
// (for {@link dehydrateMailFilter}), and a static edge back into the cache
// barrel would close a provider ⇄ module cycle — the same one
// `record-rules/hook-handler.ts` and `inbox-record-ids/` avoid the same way. The
// barrel also re-exports the workflow-app cache queries, which drags the
// workflow engine into every importer's graph.

import type { ConditionGroup } from '../conditions/types'
import type { CachedMailFilter, MailFilterAction, MailFilterRecord } from './types'

/** Narrow a DB row to the serializable cache shape. */
export function dehydrateMailFilter(
  row: Pick<
    MailFilterRecord,
    | 'id'
    | 'inboxId'
    | 'name'
    | 'order'
    | 'stopProcessing'
    | 'enabled'
    | 'conditions'
    | 'actions'
    | 'templateKey'
  >
): CachedMailFilter {
  return {
    id: row.id,
    inboxId: row.inboxId,
    name: row.name,
    order: row.order,
    stopProcessing: row.stopProcessing,
    enabled: row.enabled,
    conditions: Array.isArray(row.conditions) ? (row.conditions as ConditionGroup[]) : [],
    actions: Array.isArray(row.actions) ? (row.actions as MailFilterAction[]) : [],
    templateKey: row.templateKey ?? null,
  }
}

/** Every filter in the org — enabled and disabled — straight from the cache. */
async function getCachedMailFiltersForOrg(organizationId: string): Promise<CachedMailFilter[]> {
  const { getCachedMailFilters } = await import('../cache')
  return getCachedMailFilters(organizationId)
}

/**
 * The enabled filters governing one inbox, in evaluation order.
 *
 * The cache holds the whole org's filters (enabled + disabled, so the settings
 * UI and the dispatch path share one key) and this filters in memory — an org
 * has tens of filters, not thousands, so a per-inbox cache key would buy nothing
 * and multiply the invalidation surface.
 */
export async function getEnabledMailFiltersForInbox(
  organizationId: string,
  inboxId: string
): Promise<CachedMailFilter[]> {
  const filters = await getCachedMailFiltersForOrg(organizationId)
  return filters.filter((f) => f.enabled && f.inboxId === inboxId).sort((a, b) => a.order - b.order)
}

/**
 * Does this org have ANY enabled filter? — the §4.1 step-3 early exit.
 *
 * This is the exit that fires for almost every org on almost every inbound
 * message, so it MUST stay a pure cache read: it runs *before* the gate's one
 * thread load, and an org that has never written a filter must pay zero queries
 * for the feature. Anything that turns this into a DB hit puts a query on every
 * inbound message in the system.
 */
export async function orgHasEnabledMailFilters(organizationId: string): Promise<boolean> {
  const filters = await getCachedMailFiltersForOrg(organizationId)
  return filters.some((f) => f.enabled)
}

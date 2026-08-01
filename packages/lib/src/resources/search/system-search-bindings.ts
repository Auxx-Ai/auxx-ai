// packages/lib/src/resources/search/system-search-bindings.ts
//
// Which system tables have a ranked-search binding — the lookup
// `querySystemResourceIdsPaged` / `countSystemResource` consult before they
// decide whether a `search` string can do anything.
//
// `RESOURCE_TABLE_REGISTRY` holds ~11 non-`EntityInstance` buckets (`article`,
// `thread`, `message`, `user`, `inbox`, `participant`, `dataset`,
// `knowledgeBase`, …). Each needs its own corpus column and its own pair of
// org-scoped GIN indexes before it can be searched; there is no generic answer,
// which is why this is a table rather than a flag.
//
// 🔴 **Absence must degrade, never throw.** A table with no entry here is
// searched exactly the way it was before this file existed: the `search` string
// is ignored, the filters still apply, the ordering is unchanged. That is the
// property that lets the remaining tables be adopted one at a time instead of in
// one flag-day change — and it is also why the *caller* is responsible for
// telling the user nothing happened. `unified-handler.ts` documents which
// resources are covered.

import type { TextSearchColumns } from '../../search/text-search-sql'
import type { TableId } from '../registry/field-registry'
import { articleSearchColumns } from './article-search-sql'

/**
 * A system table's binding of the shared search builder.
 *
 * A **thunk**, not a `TextSearchColumns` value: Drizzle schema columns read as
 * `undefined` under this package's Vitest setup, so a module-level const would
 * bake `undefined` chunks into every consumer's module graph. Same reason
 * `articleSearchColumns` and `recordSearchColumns` are functions.
 */
export type SystemSearchBinding = () => TextSearchColumns

/**
 * The system tables that can be free-text searched, by `TableId`.
 *
 * `thread` and `message` are absent **on purpose**, not pending: mail rows are
 * governed by the member lens, and `resources/picker/mail-lens-tables.ts` blocks
 * them from the generic record path entirely. Mail search goes through
 * `mail-query/`, which binds the same builder under its own scopes
 * (`mail-query/thread-search-sql.ts`). Adding them here would route mail content
 * through a query that carries no lens.
 */
const SYSTEM_SEARCH_BINDINGS: Partial<Record<TableId, SystemSearchBinding>> = {
  article: articleSearchColumns,
}

/**
 * The ranked-search binding for a system table, or `undefined` when the table
 * has none.
 *
 * `undefined` is the "search is not supported here" answer and callers must treat
 * it as *ignore the search*, not as an error — see the note at the top of this
 * file.
 */
export function getSystemSearchBinding(tableId: TableId): TextSearchColumns | undefined {
  return SYSTEM_SEARCH_BINDINGS[tableId]?.()
}

/** Whether a system table can serve a free-text `search`. */
export function hasSystemSearchBinding(tableId: TableId): boolean {
  return SYSTEM_SEARCH_BINDINGS[tableId] !== undefined
}

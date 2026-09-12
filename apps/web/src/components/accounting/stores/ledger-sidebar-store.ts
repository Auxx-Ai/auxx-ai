// apps/web/src/components/accounting/stores/ledger-sidebar-store.ts

import { createCalendarSidebarStore } from '~/components/calendar/core/sidebar-store'

/**
 * The ledger rail's open/closed state, persisted.
 *
 * Same factory the dispatch board's sidebar uses — the ledger's rail is the same
 * shape (a `ModuleSidebar` under the toolbar) and a third hand-rolled copy of
 * `open` would drift from both.
 *
 * ⚠️ The factory's `groupOpen` and `hidden` come along unused. Nothing in this
 * rail collapses: both groups are a few lines under a plain `SidebarGroupLabel`,
 * and `BooksGroup` hides itself entirely when the sweep found nothing, which is
 * the only disclosure either of them needs.
 *
 * Read with selectors (`useLedgerSidebarStore((s) => s.open)`), never by
 * destructuring the whole store.
 */
export const useLedgerSidebarStore = createCalendarSidebarStore('ledger-sidebar')

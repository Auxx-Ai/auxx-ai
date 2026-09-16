// apps/web/src/components/accounting/stores/ledger-sidebar-store.ts

import { createCalendarSidebarStore } from '~/components/calendar/core/sidebar-store'

/**
 * The ledger rail's open/closed state, persisted.
 *
 * Same factory the dispatch board's sidebar uses — the ledger's rail is a
 * `ModuleSidebar` too, and a third hand-rolled copy of `open` would drift from
 * both. The toolbar's `PanelLeft` button is the only writer.
 *
 * ⚠️ The factory's `groupOpen` and `hidden` come along unused, and now trivially
 * so: the rail is a header and two nav rows (`ledger-sidebar.tsx`), so there is
 * nothing in it to collapse or hide.
 *
 * Read with selectors (`useLedgerSidebarStore((s) => s.open)`), never by
 * destructuring the whole store.
 */
export const useLedgerSidebarStore = createCalendarSidebarStore('ledger-sidebar')

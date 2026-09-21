// apps/web/src/components/accounting/stores/accounting-sidebar-store.ts

import { create } from 'zustand'

interface AccountingSidebarState {
  open: boolean
  setOpen: (open: boolean) => void
}

/**
 * The accounting rail's desktop open/closed state, written only by
 * `AccountingToolbar`'s `PanelLeft` button.
 *
 * ⚠️ NOT persisted, unlike the ledger rail store it replaces. The server renders the
 * default and a persisted `false` only arrives on the client, so the rail would
 * paint and then disappear on every cold load of an accounting route.
 *
 * Read with selectors (`useAccountingSidebarStore((s) => s.open)`), never by
 * destructuring the whole store.
 */
export const useAccountingSidebarStore = create<AccountingSidebarState>()((set) => ({
  open: true,
  setOpen: (open) => set({ open }),
}))

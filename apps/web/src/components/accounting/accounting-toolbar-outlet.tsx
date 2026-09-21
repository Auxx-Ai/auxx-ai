// apps/web/src/components/accounting/accounting-toolbar-outlet.tsx

'use client'

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

/** The two halves of the accounting topbar a page fills in. */
export interface AccountingToolbarContent {
  left?: ReactNode
  right?: ReactNode
}

/**
 * The slot a page publishes its topbar controls into, so the LAYOUT can own one
 * `AccountingToolbar` that never unmounts across a Closeout → Banking → Reports
 * jump (plans/accounting/tasks/81-one-accounting-shell.md §7).
 *
 * ⚠️ Read and write are SEPARATE contexts on purpose, exactly as in
 * `docked-panels-outlet.tsx`. With one context the page that publishes is also a
 * consumer of the value it just wrote, so every publish re-renders it, and a page
 * that builds its controls inline would publish again on that render and never
 * settle. The setter's identity is stable (it is a `useState` setter), so a
 * publisher subscribes to nothing.
 */
const AccountingToolbarStateContext = createContext<AccountingToolbarContent | null>(null)
const AccountingToolbarSetContext = createContext<
  ((content: AccountingToolbarContent) => void) | null
>(null)

/** A stable empty value, so "no controls" never looks like a new value. */
const NO_CONTENT: AccountingToolbarContent = {}

/** Holds the controls a page below has published. Wrap the accounting shell in this. */
export function AccountingToolbarOutletProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<AccountingToolbarContent>(NO_CONTENT)

  return (
    <AccountingToolbarSetContext.Provider value={setContent}>
      <AccountingToolbarStateContext.Provider value={content}>
        {children}
      </AccountingToolbarStateContext.Provider>
    </AccountingToolbarSetContext.Provider>
  )
}

/** The controls currently published by the page below. Render inside `AccountingToolbar`. */
export function useAccountingToolbarOutlet(): AccountingToolbarContent {
  return useContext(AccountingToolbarStateContext) ?? NO_CONTENT
}

/**
 * Publish this page's topbar controls to the enclosing outlet, and clear them on
 * unmount.
 *
 * ⚠️ `content` must be MEMOISED by the caller (`useMemo` over the values that
 * actually decide the controls). A fresh object every render re-runs the effect,
 * which sets state on the provider, and although the page is not a subscriber a
 * parent re-render for any other reason would then publish again.
 */
export function useRegisterAccountingToolbar(content: AccountingToolbarContent): void {
  const setContent = useContext(AccountingToolbarSetContext)

  useEffect(() => {
    if (!setContent) return
    setContent(content)
    return () => setContent(NO_CONTENT)
  }, [content, setContent])
}

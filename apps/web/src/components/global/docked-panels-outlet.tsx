// apps/web/src/components/global/docked-panels-outlet.tsx

'use client'

import type { DockedPanelConfig } from '@auxx/ui/components/main-page'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

/**
 * A slot a page can dock a panel into when the LAYOUT owns `MainPageContent`.
 *
 * `MainPageContent` takes its docked panels as a prop, which works when the page
 * itself renders it (`ledger-page.tsx`). Under a section layout that renders one
 * `MainPageContent` around every page below it, the page has no way to reach
 * that prop, and nesting a second `MainPageContent` inside the first would give
 * the panel the wrong height and a second resize handle.
 *
 * So the layout wraps its tree in `DockedPanelsOutletProvider`, reads the
 * current panels with `useDockedPanelsOutlet()` and feeds them straight to
 * `MainPageContent`; a page publishes its panels with
 * `useRegisterDockedPanels()`. The panels still animate, resize and frame
 * exactly as they do when a page owns the `MainPageContent` itself, because it
 * is the same prop being fed.
 *
 * ⚠️ Read and write are SEPARATE contexts on purpose. With one context the page
 * that publishes panels is also a consumer of the value it just wrote, so every
 * publish re-renders it, and a page that builds its panel array inline would
 * publish again on that render and never settle. The setter's identity is stable
 * (it is a `useState` setter), so a publisher subscribes to nothing.
 */
const DockedPanelsStateContext = createContext<DockedPanelConfig[] | null>(null)
const DockedPanelsSetContext = createContext<((panels: DockedPanelConfig[]) => void) | null>(null)

/** A stable empty array, so "no panels" never looks like a new value. */
const NO_PANELS: DockedPanelConfig[] = []

/**
 * Holds the panels a page below has published. Wrap the part of a layout that
 * renders `MainPageContent` in this.
 */
export function DockedPanelsOutletProvider({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<DockedPanelConfig[]>(NO_PANELS)

  return (
    <DockedPanelsSetContext.Provider value={setPanels}>
      <DockedPanelsStateContext.Provider value={panels}>
        {children}
      </DockedPanelsStateContext.Provider>
    </DockedPanelsSetContext.Provider>
  )
}

/**
 * The panels currently published by the page below. Pass straight to
 * `<MainPageContent dockedPanels={...}>`.
 */
export function useDockedPanelsOutlet(): DockedPanelConfig[] {
  return useContext(DockedPanelsStateContext) ?? NO_PANELS
}

/**
 * Publish this page's docked panels to the enclosing outlet, and clear them on
 * unmount.
 *
 * ⚠️ `panels` must be MEMOISED by the caller (`useMemo` over the values that
 * actually decide the panel). A fresh array every render re-runs the effect,
 * which sets state on the provider, and although the page is not a subscriber a
 * parent re-render for any other reason would then publish again.
 */
export function useRegisterDockedPanels(panels: DockedPanelConfig[]): void {
  const setPanels = useContext(DockedPanelsSetContext)

  useEffect(() => {
    if (!setPanels) return
    setPanels(panels)
    return () => setPanels(NO_PANELS)
  }, [panels, setPanels])
}

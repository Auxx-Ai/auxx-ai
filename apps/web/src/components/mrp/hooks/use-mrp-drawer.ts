// apps/web/src/components/mrp/hooks/use-mrp-drawer.ts

'use client'

import { parseAsArrayOf, parseAsString, useQueryStates } from 'nuqs'
import { type ReactNode, useCallback, useMemo } from 'react'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { useMedia } from '~/hooks/use-media'
import { useDockStore } from '~/stores/dock-store'

/** Not `tab`: a list page may own `?tab=` for its own strip, as the ledger's outbox does. */
export const MRP_RECORD_TAB_PARAM = 'rtab'
/** The part's Planning tab (`part:mrp`), where every row opens. */
export const MRP_PART_TAB = 'mrp'

export interface UseMrpDrawer {
  /** `?part=`, the part the drawer shows. */
  partId: string | null
  /** Opens the part at its Planning tab, dropping any frames pushed on the previous one. */
  openPart: (partId: string) => void
  close: () => void
}

/** The docked drawer's URL state; `MrpDrawerHost` renders it, rows call `openPart`. */
export function useMrpDrawer(): UseMrpDrawer {
  // `peek`/`panel`/`item`/`rtab` are the host's stack, cleared in the same write as `part`.
  const [params, setParams] = useQueryStates({
    part: parseAsString,
    peek: parseAsArrayOf(parseAsString),
    panel: parseAsString,
    item: parseAsString,
    [MRP_RECORD_TAB_PARAM]: parseAsString,
  })

  const openPart = useCallback(
    (partId: string) =>
      void setParams({
        part: partId,
        peek: null,
        panel: null,
        item: null,
        [MRP_RECORD_TAB_PARAM]: MRP_PART_TAB,
      }),
    [setParams]
  )
  const close = useCallback(
    () =>
      void setParams({
        part: null,
        peek: null,
        panel: null,
        item: null,
        [MRP_RECORD_TAB_PARAM]: null,
      }),
    [setParams]
  )

  return { partId: params.part, openPart, close }
}

export interface MrpDrawerDock {
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
}

/** Docked at desktop width, floating below it; width shared with every other docked drawer. */
export function useMrpDrawerDock(): MrpDrawerDock {
  const isDocked = useMedia('(min-width: 1024px)')
  const width = useDockStore((state) => state.dockedWidth)
  const onWidthChange = useDockStore((state) => state.setDockedWidth)
  return useMemo(() => ({ isDocked, width, onWidthChange }), [isDocked, width, onWidthChange])
}

/** Publishes `drawer` into the layout's docked slot while it is docked and open. `drawer` must be memoised. */
export function useRegisterMrpDrawer(drawer: ReactNode, open: boolean, dock: MrpDrawerDock): void {
  const { isDocked, width, onWidthChange } = dock
  const panels = useMemo(
    () =>
      isDocked && open
        ? [
            {
              key: 'mrp-part',
              content: drawer,
              width,
              onWidthChange,
              minWidth: 380,
              maxWidth: 800,
            },
          ]
        : [],
    [drawer, isDocked, open, width, onWidthChange]
  )
  useRegisterDockedPanels(panels)
}

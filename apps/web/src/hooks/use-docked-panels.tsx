// apps/web/src/hooks/use-docked-panels.tsx
'use client'

import type { DockedPanelConfig } from '@auxx/ui/components/main-page'
import { Fragment, type ReactNode, useMemo } from 'react'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'

/**
 * Width override for a single docked panel. Omitting `set` makes the panel
 * non-resizable (no drag handle wired up) — used for fixed-width panels like
 * the kb editor frame.
 */
interface DockedPanelWidth {
  value: number
  set?: (width: number) => void
  min?: number
  max?: number
}

/**
 * One panel entry for {@link useDockedPanels}.
 */
export interface DockedPanelInput {
  /** Unique key for the panel — also drives `MainPageContent`'s enter/exit animation. */
  key: string
  /**
   * Single flag, or split docked/overlay open conditions when they differ (e.g. a
   * config panel that stays open for the whole edit session when docked, but only
   * opens on-select when overlay).
   */
  open: boolean | { docked: boolean; overlay: boolean }
  /**
   * Rendered in the docked slot. `DockableDrawer`-based components branch on their
   * own `isDocked` prop internally, so the same node usually serves both docked and
   * overlay.
   */
  content: ReactNode
  /** Optional distinct overlay node; defaults to `content`. */
  overlay?: ReactNode
  /** Which side of `MainPageContent` the panel docks to. */
  side?: 'left' | 'right'
  /** Width override; default is the global dock store (dockedWidth/setDockedWidth/minWidth/maxWidth). */
  width?: DockedPanelWidth
  /** Optional className for the panel wrapper (e.g. responsive hiding). */
  className?: string
}

/** Return value of {@link useDockedPanels}. */
interface UseDockedPanelsResult {
  /** Right-docked panels — pass to `MainPageContent dockedPanels`. */
  dockedPanels: DockedPanelConfig[]
  /** Left-docked panels — pass to `MainPageContent leftPanels`. */
  leftPanels: DockedPanelConfig[]
  /** Fragment of open overlay nodes when `!isDocked`. Place after `</MainPageContent>`,
   * same as the hand-rolled `{!isDocked && <Drawer/>}` blocks it replaces. */
  overlays: ReactNode
  /** Effective dock state — same value `useEffectiveDockState()` returns. */
  isDocked: boolean
}

function isOpen(open: DockedPanelInput['open'], mode: 'docked' | 'overlay'): boolean {
  return typeof open === 'boolean' ? open : open[mode]
}

/**
 * Packages the docked-panel recipe hand-rolled at every call site: dock-store
 * width wiring + `useEffectiveDockState` + building `DockedPanelConfig[]` + the
 * overlay fallback for narrow screens / undocked mode.
 *
 * When docked, panels whose docked-open flag is true render into
 * `dockedPanels`/`leftPanels` (split by `side`) with dock-store width wiring
 * unless `width` overrides. When not docked, those arrays are empty and
 * `overlays` renders `overlay ?? content` for each overlay-open panel.
 */
export function useDockedPanels(panels: DockedPanelInput[]): UseDockedPanelsResult {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  return useMemo(() => {
    const dockedPanels: DockedPanelConfig[] = []
    const leftPanels: DockedPanelConfig[] = []
    const overlayNodes: ReactNode[] = []

    for (const panel of panels) {
      if (isDocked) {
        if (!isOpen(panel.open, 'docked')) continue
        const width = panel.width
        const config: DockedPanelConfig = {
          key: panel.key,
          content: panel.content,
          width: width?.value ?? dockedWidth,
          onWidthChange: width ? width.set : setDockedWidth,
          minWidth: width?.min ?? minWidth,
          maxWidth: width?.max ?? maxWidth,
          className: panel.className,
        }
        ;(panel.side === 'left' ? leftPanels : dockedPanels).push(config)
      } else if (isOpen(panel.open, 'overlay')) {
        overlayNodes.push(<Fragment key={panel.key}>{panel.overlay ?? panel.content}</Fragment>)
      }
    }

    return {
      dockedPanels,
      leftPanels,
      overlays: <>{overlayNodes}</>,
      isDocked,
    }
  }, [panels, isDocked, dockedWidth, setDockedWidth, minWidth, maxWidth])
}

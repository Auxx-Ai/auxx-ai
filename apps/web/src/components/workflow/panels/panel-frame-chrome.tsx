// apps/web/src/components/workflow/panels/panel-frame-chrome.tsx
'use client'

import { DrawerHeader } from '@auxx/ui/components/drawer'
import { createContext, type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { frameKey, selectTopFrame, usePanelStore } from '~/components/workflow/store/panel-store'

/**
 * Chrome the panel *host* owns on behalf of whichever frame is on top: the
 * header slot itself, plus the back/close affordances that must not slide with
 * the body.
 *
 * The header lives outside the `NavStack` so it swaps instantly instead of
 * animating (same split as `base-entity-drawer`). It can't simply be *built* by
 * the host, though — the node frame's header needs props (app context, node
 * definition, title validation) that only the per-node panel has. So each frame
 * renders its own `DrawerHeader` and portals it into the host's slot, and only
 * the top frame is allowed to do so.
 */
interface PanelFrameChromeValue {
  /** Host-owned element the top frame portals its header into. */
  headerSlot: HTMLElement | null
  /** This frame's stack key, compared against the live top key (see below). */
  frameKey: string
  /** Pops the overlay. Undefined when there is nothing meaningful to go back to. */
  onBack?: () => void
  /** Name of the screen `onBack` returns to (e.g. the node's title). */
  backLabel?: string
  /** Closes the whole drawer. */
  onClose: () => void
}

const PanelFrameChromeContext = createContext<PanelFrameChromeValue | null>(null)

export function PanelFrameChromeProvider({
  value,
  children,
}: {
  value: PanelFrameChromeValue
  children: ReactNode
}) {
  return (
    <PanelFrameChromeContext.Provider value={value}>{children}</PanelFrameChromeContext.Provider>
  )
}

export function usePanelFrameChrome(): PanelFrameChromeValue | null {
  return useContext(PanelFrameChromeContext)
}

interface PanelFrameHeaderProps {
  icon?: ReactNode
  title?: ReactNode
  /** Frame-specific actions. The dock toggle and close button are added by the host. */
  actions?: ReactNode
  /** Rendered below the title row, inside the header (e.g. the node description). */
  children?: ReactNode
}

/**
 * The header for one panel frame, portalled into the host's header slot.
 *
 * "Am I on top?" is read from the store rather than passed down, and that is
 * load-bearing: during a push/pop `AnimatePresence` keeps the *exiting* frame
 * mounted from the previous element tree, so it never receives updated props.
 * A prop-passed flag would stay `true` on the way out and paint a second header
 * over the incoming one for the length of the animation. A store subscription
 * re-renders the retained subtree too, so the outgoing header unmounts on the
 * same commit that starts the transition.
 *
 * Outside a `PanelFrameChromeProvider` (an overlay usage that owns its own
 * chrome) it degrades to rendering the header inline.
 */
export function PanelFrameHeader({ icon, title, actions, children }: PanelFrameHeaderProps) {
  const chrome = usePanelFrameChrome()
  const topFrame = usePanelStore(selectTopFrame)
  const isTop = !!topFrame && !!chrome && frameKey(topFrame) === chrome.frameKey

  const header = (
    <DrawerHeader
      icon={icon}
      title={title}
      onBack={chrome?.onBack}
      backLabel={chrome?.backLabel}
      onClose={chrome?.onClose}
      actions={
        <>
          {actions}
          <DockToggleButton size='icon-sm' />
        </>
      }>
      {children}
    </DrawerHeader>
  )

  if (!chrome) return header
  if (!isTop || !chrome.headerSlot) return null
  return createPortal(header, chrome.headerSlot)
}

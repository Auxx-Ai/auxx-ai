// apps/web/src/components/workflow/panels/workflow-panel-drawer.tsx
'use client'

import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { NavStack, NavStackPanel, NavStackPanels } from '@auxx/ui/components/nav-stack'
import { useStore } from '@xyflow/react'
import { MousePointerClick } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useDockPortal } from '~/components/global/dock-portal-provider'
import {
  frameKey,
  type PanelFrame,
  selectBaseFrame,
  selectCanGoBack,
  selectTopFrame,
  usePanelStore,
} from '~/components/workflow/store/panel-store'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { WorkflowKopilotPanel } from './kopilot/workflow-kopilot-panel'
import { PanelFrameChromeProvider } from './panel-frame-chrome'
import { NodePanelBody } from './property-panel'
import { WorkflowRunPanel } from './run/workflow-run-panel'
import { WorkflowSettingsPanel } from './settings/workflow-settings-panel'

interface WorkflowPanelDrawerProps {
  workflowId?: string
  workflowAppId?: string
}

/** sr-only drawer title for the overlay (undocked) presentation. */
function frameTitle(frame: PanelFrame | undefined): string {
  switch (frame?.kind) {
    case 'run':
      return 'Test Workflow'
    case 'settings':
      return 'Settings'
    case 'kopilot':
      return 'Kopilot'
    case 'node':
      return 'Node Properties'
    default:
      return 'Panel'
  }
}

/** Shown when an overlay is open with nothing selected beneath it. */
function EmptyFrameBody() {
  return (
    <div className='flex-1 flex flex-col items-center justify-center text-muted-foreground'>
      <MousePointerClick className='size-6 mb-2 opacity-50' />
      <p className='text-sm'>Select a node</p>
    </div>
  )
}

/**
 * The editor's single panel drawer.
 *
 * Owns one `DockableDrawer`, one header slot and one `NavStack`; every panel —
 * node properties, Test, Settings — is a *frame* inside it rather than a drawer
 * of its own. That replaces the previous primary/secondary docking model, where
 * four separate derivations of the same `panelStack` decided which of two portal
 * slots each panel rendered into and routinely disagreed.
 *
 * See `plans/workflow/panel-nav-stack.md`.
 */
export const WorkflowPanelDrawer = memo(function WorkflowPanelDrawer({
  workflowId,
  workflowAppId,
}: WorkflowPanelDrawerProps) {
  const frames = usePanelStore((state) => state.frames)
  const popOverlay = usePanelStore((state) => state.popOverlay)
  const closeDrawer = usePanelStore((state) => state.closeDrawer)
  const canGoBack = usePanelStore(selectCanGoBack)
  const topFrame = usePanelStore(selectTopFrame)
  const baseFrame = usePanelStore(selectBaseFrame)
  const panelWidth = usePanelStore((state) => state.panelWidth)
  const setPanelWidth = usePanelStore((state) => state.setPanelWidth)

  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  const { panelRef } = useDockPortal()

  // Host-owned header slot. `useState` (not a ref) so the first frame re-renders
  // once the element exists and its portal can attach.
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null)

  // Label for the back chevron — the node the overlay will return to. Read from
  // React Flow rather than the frame so a rename updates the chevron live.
  const baseNodeId = baseFrame?.kind === 'node' ? baseFrame.nodeId : undefined
  const backLabel = useStore(
    useCallback(
      (s) => {
        if (!baseNodeId) return undefined
        const node = s.nodes.find((n) => n.id === baseNodeId)
        const title = (node?.data as { title?: string } | undefined)?.title
        return title || undefined
      },
      [baseNodeId]
    )
  )

  const handleWidthChange = useCallback(
    (width: number) => {
      if (isDocked) setDockedWidth(width)
      else setPanelWidth(width)
    },
    [isDocked, setDockedWidth, setPanelWidth]
  )

  // Nothing inside drives NavStack's own push/pop — this only keeps the store in
  // step if the stack ever shrinks from underneath us.
  const handleStackChange = useCallback(
    (next: string[]) => {
      if (next.length < frames.length) popOverlay()
    },
    [frames.length, popOverlay]
  )

  if (frames.length === 0) return null

  return (
    <DockableDrawer
      open
      onOpenChange={(open) => !open && closeDrawer()}
      isDocked={isDocked}
      width={isDocked ? dockedWidth : panelWidth}
      onWidthChange={handleWidthChange}
      minWidth={minWidth}
      maxWidth={maxWidth}
      title={frameTitle(topFrame)}
      portalTarget={panelRef}>
      {/* Header slot — the top frame portals its own DrawerHeader here, so the
          header swaps instantly instead of sliding with the body. */}
      <div ref={setHeaderSlot} className='shrink-0' />

      <NavStack
        stack={frames.map(frameKey)}
        onStackChange={handleStackChange}
        className='flex flex-col flex-1 min-h-0'>
        <NavStackPanels className='flex-1 min-h-0'>
          {/* Panels are `flex flex-col`, NOT `overflow-y-auto`: each frame body
              owns its own ScrollArea, and a scrolling wrapper here would collapse
              that height chain and let the sticky tab strip scroll away. */}
          {frames.map((frame) => {
            const key = frameKey(frame)
            return (
              <NavStackPanel key={key} value={key} className='h-full flex flex-col'>
                <PanelFrameChromeProvider
                  value={{
                    headerSlot,
                    frameKey: key,
                    onBack: canGoBack ? popOverlay : undefined,
                    backLabel,
                    onClose: closeDrawer,
                  }}>
                  {frame.kind === 'node' && <NodePanelBody nodeId={frame.nodeId} />}
                  {frame.kind === 'empty' && <EmptyFrameBody />}
                  {frame.kind === 'run' && (
                    <WorkflowRunPanel workflowId={workflowId} workflowAppId={workflowAppId} />
                  )}
                  {frame.kind === 'settings' && (
                    <WorkflowSettingsPanel workflowId={workflowId} workflowAppId={workflowAppId} />
                  )}
                  {frame.kind === 'kopilot' && (
                    <WorkflowKopilotPanel workflowAppId={workflowAppId} />
                  )}
                </PanelFrameChromeProvider>
              </NavStackPanel>
            )
          })}
        </NavStackPanels>
      </NavStack>
    </DockableDrawer>
  )
})

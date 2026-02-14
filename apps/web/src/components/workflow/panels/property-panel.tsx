// apps/web/src/components/workflow/panels/property-panel.tsx

import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { useStore } from '@xyflow/react'
import React, { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useDockPortal } from '~/components/global/dock-portal-provider'
import { NodeType } from '~/components/workflow/types'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { useRegistryVersion } from '../hooks'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import { usePanelStore } from '../store/panel-store'

interface PropertyPanelProps {
  className?: string
}

/**
 * Property panel that displays node configuration.
 * Supports both overlay (drawer) and docked modes via portal.
 * In docked mode, content portals to the DockedPanelTarget while preserving React context.
 */
const PropertyPanel: React.FC<PropertyPanelProps> = React.memo(() => {
  const panelWidth = usePanelStore((state) => state.getPropertyPanelWidth())
  const setPanelWidth = usePanelStore((state) => state.setPanelWidth)
  const closePanel = usePanelStore((state) => state.closePanel)

  // Dock state
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  /** Handle width changes - update appropriate store based on dock state */
  const handleWidthChange = React.useCallback(
    (width: number) => {
      if (isDocked) {
        setDockedWidth(width)
      } else {
        setPanelWidth(width)
      }
    },
    [isDocked, setDockedWidth, setPanelWidth]
  )

  // Portal target for docked mode
  const { primaryPanelRef } = useDockPortal()

  // Subscribe to registry updates to detect when app blocks are loaded
  const registryVersion = useRegistryVersion()

  const selectedNode = useStore(
    useShallow((s) => {
      const currentNode = s.nodes.find((node) => node.selected)
      if (currentNode) {
        return { id: currentNode.id, type: currentNode.data.type, data: currentNode.data }
      }
    })
  )

  const nodeType = selectedNode?.type

  // registryVersion forces re-fetch when registry updates
  const PanelComponent = useMemo(() => {
    if (nodeType && typeof nodeType === 'string' && nodeType !== NodeType.NOTE) {
      const panel = unifiedNodeRegistry.getPanel(nodeType)
      return panel
    }
    return null
  }, [nodeType, registryVersion])

  // Determine if panel should be shown
  const shouldShowPanel = !!(
    selectedNode &&
    nodeType !== NodeType.NOTE &&
    panelWidth !== 0 &&
    PanelComponent
  )
  // Close panel in effect when conditions change (avoids state update during render)
  useEffect(() => {
    if (!shouldShowPanel) {
      closePanel()
    }
  }, [shouldShowPanel, closePanel])

  // Early return without side effects
  if (!shouldShowPanel) {
    return null
  }

  return (
    <DockableDrawer
      open={true}
      onOpenChange={(open) => !open && closePanel()}
      isDocked={isDocked}
      width={isDocked ? dockedWidth : panelWidth}
      onWidthChange={handleWidthChange}
      minWidth={minWidth}
      maxWidth={maxWidth}
      title='Properties'
      portalTarget={primaryPanelRef}
      panelType='property'>
      <PanelComponent
        key={selectedNode.id}
        nodeId={selectedNode.id}
        // @ts-expect-error - panels expect data prop but registry types it as nodeId only
        data={selectedNode.data}
      />
    </DockableDrawer>
  )
})

PropertyPanel.displayName = 'PropertyPanel'

export { PropertyPanel }

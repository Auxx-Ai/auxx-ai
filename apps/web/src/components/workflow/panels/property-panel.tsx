// apps/web/src/components/workflow/panels/property-panel.tsx

import { useStore } from '@xyflow/react'
import React, { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { isWorkflowNode, NodeType } from '~/components/workflow/types'
import { useRegistryVersion } from '../hooks'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import { usePanelStore } from '../store/panel-store'

interface NodePanelBodyProps {
  /** The node this frame is for — supplied by the panel stack, not by selection. */
  nodeId: string
}

/**
 * Body of the `node` panel frame: resolves the node's registered panel component
 * from the unified registry and renders it.
 *
 * The node comes from the frame (`nodeId`), not from React Flow's selection, so
 * the frame stays stable while an overlay is on top of it — the node is still
 * the thing the back chevron returns to even though it isn't selected-and-visible.
 * The header is rendered by the node panel itself via `PanelFrameHeader`.
 */
const NodePanelBody: React.FC<NodePanelBodyProps> = React.memo(({ nodeId }) => {
  const closeDrawer = usePanelStore((state) => state.closeDrawer)

  // Subscribe to registry updates to detect when app blocks are loaded
  const registryVersion = useRegistryVersion()

  const node = useStore(
    useShallow((s) => {
      const current = s.nodes.find((n) => n.id === nodeId)
      // React Flow types every node's data as `Record<string, unknown>`; the
      // guard is what recovers the `BaseNodeData` the panels are written against.
      if (current && isWorkflowNode(current)) {
        return { id: current.id, type: current.data.type, data: current.data }
      }
    })
  )

  const nodeType = node?.type

  // biome-ignore lint/correctness/useExhaustiveDependencies: registryVersion triggers re-fetch when registry updates
  const PanelComponent = useMemo(() => {
    if (nodeType && typeof nodeType === 'string' && nodeType !== NodeType.NOTE) {
      return unifiedNodeRegistry.getPanel(nodeType)
    }
    return null
  }, [nodeType, registryVersion])

  const shouldShowPanel = !!(node && nodeType !== NodeType.NOTE && PanelComponent)

  // A node that vanished (deleted, or a note) has no frame to show — close the
  // drawer in an effect rather than during render.
  useEffect(() => {
    if (!shouldShowPanel) {
      closeDrawer()
    }
  }, [shouldShowPanel, closeDrawer])

  if (!shouldShowPanel) {
    return null
  }

  return <PanelComponent key={node.id} nodeId={node.id} data={node.data} />
})

NodePanelBody.displayName = 'NodePanelBody'

export { NodePanelBody }

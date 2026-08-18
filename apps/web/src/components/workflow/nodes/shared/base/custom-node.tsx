// apps/web/src/components/workflow/nodes/shared/base/custom-node.tsx

import type { Node, NodeProps } from '@xyflow/react'
import { useMemo } from 'react'
import { AppWorkflowNode } from '~/components/workflow/apps/app-workflow-node'
import { useRenderTrace } from '~/components/workflow/debug'
import { useRegistryVersion } from '~/components/workflow/hooks'
import type { BaseNodeData } from '~/components/workflow/types'
import { NoteNode } from '../../core/note'
import { unifiedNodeRegistry } from '../../unified-registry'

const StandardNode = (props: NodeProps<Node<BaseNodeData>>) => {
  useRenderTrace('StandardNode')

  const nodeData = props.data
  const nodeType = nodeData.type

  // Subscribe to registry updates to detect when app blocks are loaded
  const registryVersion = useRegistryVersion()

  // Dynamic lookup from unified registry (supports core + app nodes)
  // registryVersion forces re-fetch when registry updates
  const NodeComponent = useMemo(() => {
    const component = unifiedNodeRegistry.getComponent(nodeType)

    // FALLBACK: If node type not registered but looks like an app node (has colon),
    // use AppWorkflowNode which will parse metadata from the type string
    if (!component && typeof nodeType === 'string' && nodeType.includes(':')) {
      return AppWorkflowNode
    }

    return component
  }, [nodeType])

  if (!NodeComponent) {
    return (
      <div className='p-4 border-2 border-red-500 rounded-lg bg-red-50'>
        <p className='text-sm font-medium text-red-600'>Unknown node type</p>
        <p className='text-xs text-red-500 mt-1'>{nodeType}</p>
      </div>
    )
  }

  return <NodeComponent data={props.data} id={props.id} selected={props.selected} />
}
StandardNode.displayName = 'StandardNode'

export const FLOW_NODE_TYPES = {
  standard: StandardNode,
  note: NoteNode,
}

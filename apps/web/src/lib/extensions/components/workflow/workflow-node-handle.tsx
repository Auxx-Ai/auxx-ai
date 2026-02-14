// apps/web/src/lib/extensions/components/workflow/workflow-node-handle.tsx

import type { HandlePosition } from '~/components/workflow/ui/node-handle/handle-position-utils'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle/source-handle'
import { NodeTargetHandle } from '~/components/workflow/ui/node-handle/target-handle'
import type { NodeHandleProps } from '~/components/workflow/ui/node-handle/types'
import { useWorkflowNodeContextOptional } from './workflow-node-context'

/** Handle type for input or output connections */
type HandleType = 'source' | 'target'

/** Props for WorkflowNodeHandle component */
interface WorkflowNodeHandleProps {
  /** Type of handle - source (output) or target (input) */
  type: HandleType
  /** Unique identifier for this handle */
  id: string
  /** Position of the handle on the node */
  position?: HandlePosition
  /** Additional CSS classes */
  className?: string
}

/**
 * WorkflowNodeHandle component.
 * Connection handle for node inputs/outputs.
 * Delegates to platform NodeSourceHandle or NodeTargetHandle for feature-rich behavior.
 */
export const WorkflowNodeHandle = ({
  type,
  id,
  position = type === 'target' ? 'left' : 'right',
  className,
}: WorkflowNodeHandleProps) => {
  const nodeContext = useWorkflowNodeContextOptional()

  // Context should always be available when used within WorkflowNode
  if (!nodeContext) {
    console.error('[WorkflowNodeHandle] No context found - WorkflowNode must provide context')
    return null
  }

  // Transform SDK props to NodeHandleProps
  const handleProps: NodeHandleProps = {
    id: nodeContext.nodeId,
    handleId: id,
    handleClassName: className,
    data: {
      ...nodeContext.nodeData,
      type: nodeContext.nodeType,
      _connectedSourceHandleIds: nodeContext.nodeData._connectedSourceHandleIds || [],
      _connectedTargetHandleIds: nodeContext.nodeData._connectedTargetHandleIds || [],
    },
    // SDK nodes should show add button by default
    showAdd: true,
  }

  // Delegate to appropriate handle component
  if (type === 'source') {
    return <NodeSourceHandle {...handleProps} handleType='source' position={position} />
  } else {
    return <NodeTargetHandle {...handleProps} position={position} />
  }
}

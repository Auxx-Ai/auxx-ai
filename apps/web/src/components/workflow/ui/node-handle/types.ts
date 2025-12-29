// apps/web/src/components/workflow/ui/node-handle/types.ts

import { Node } from '@xyflow/react'
import { BranchType, NodeRunningStatus } from '~/components/workflow/types'

// Re-export for backward compatibility
export { NodeRunningStatus }

export interface NodeHandleProps {
  handleId: string
  handleClassName?: string
  nodeSelectorClassName?: string
  showExceptionStatus?: boolean
  handleType?: 'source' | 'target' | 'input-output'
  type?: BranchType
  id: string
  data: Node['data'] & {
    _runningStatus?: NodeRunningStatus
    _connectedTargetHandleIds?: string[]
    _connectedSourceHandleIds?: string[]
    selected?: boolean
    type: string
    isInIteration?: boolean
    isInLoop?: boolean
  }
  showAdd?: boolean
  /** 0-based index for positioning multiple handles when collapsed */
  handleIndex?: number
  /** Total number of handles of this type for positioning calculation */
  handleTotal?: number
}

export interface BlockSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (type: string, toolDefaultValue?: any) => void
  asChild?: boolean
  placement?: 'left' | 'right' | 'top' | 'bottom'
  triggerClassName?: ((open: boolean) => string) | string
  availableBlocksTypes: string[]
  customTrigger?: React.ReactNode
  inline?: boolean
}

export interface HandleNodeAddParams {
  nodeType: string
  toolDefaultValue?: any
}

export interface HandleConnectionParams {
  prevNodeId?: string
  prevNodeSourceHandle?: string
  nextNodeId?: string
  nextNodeTargetHandle?: string
}

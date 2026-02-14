// apps/web/src/components/workflow/nodes/base/next-step/types.ts

import type { FlowNode } from '~/components/workflow/store/types'
import type { BranchType } from '../../types'

export interface NextStepBranch {
  id: string
  name: string
}

export interface NextStepItem {
  branch: NextStepBranch
  nextNodes: FlowNode[]
}

export interface NextStepProps {
  data: FlowNode['data']
  nodeId: string
}

export interface ContainerProps {
  nodeId: string
  nodeData: FlowNode['data']
  sourceHandle: string
  nextNodes: FlowNode[]
  branchName?: string
  branchType: BranchType
  // isFailBranch?: boolean
}

export interface ItemProps {
  nodeId: string
  sourceHandle: string
  data: FlowNode['data']
}

export interface AddProps {
  nodeId: string
  nodeData: FlowNode['data']
  sourceHandle: string
  isParallel?: boolean
  branchType: BranchType
  // isFailBranch?: boolean
}

export interface OperatorProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  data: FlowNode['data']
  nodeId: string
  sourceHandle: string
}

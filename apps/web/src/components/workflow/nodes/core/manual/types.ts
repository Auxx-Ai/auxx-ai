// apps/web/src/components/workflow/nodes/core/manual/types.ts

import { NodeType } from '~/components/workflow/types/node-types'
import { BaseNodeData } from '~/components/workflow/types/node-base'

/**
 * Manual trigger node data interface
 */
export interface ManualNodeData extends BaseNodeData {
  type: NodeType.MANUAL
  title: string
  desc?: string
  inputNodes?: string[] // Array of connected input node IDs
}

// apps/web/src/components/workflow/nodes/inputs/text-input/types.ts

import { NodeType } from '~/components/workflow/types/node-types'
import { BaseNodeData } from '~/components/workflow/types/node-base'

/**
 * Text input node data interface
 */
export interface TextInputNodeData extends BaseNodeData {
  type: NodeType.TEXT_INPUT
  title: string
  desc?: string
  label: string
  placeholder?: string
  required?: boolean
  defaultValue?: string
}

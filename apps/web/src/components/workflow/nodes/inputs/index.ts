// apps/web/src/components/workflow/nodes/inputs/index.ts

import type { NodeTypes } from '@xyflow/react'
import type { NodeDefinition } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'

import { FormInputNode, formInputDefinition } from './form-input'

export const INPUT_NODE_DEFINITIONS: NodeDefinition[] = [
  { ...formInputDefinition, component: FormInputNode },
]

export const INPUT_NODE_TYPES: NodeTypes = {
  [NodeType.FORM_INPUT]: FormInputNode,
}

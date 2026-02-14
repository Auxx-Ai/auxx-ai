// apps/web/src/components/workflow/nodes/inputs/index.ts

import type { NodeProps } from '@xyflow/react'
import type { ComponentType } from 'react'
import type { NodeDefinition } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'

import { FormInputNode, formInputDefinition } from './form-input'

export const INPUT_NODE_DEFINITIONS: NodeDefinition[] = [
  { ...formInputDefinition, component: FormInputNode },
]

export const INPUT_NODE_TYPES: Record<string, ComponentType<NodeProps>> = {
  [NodeType.FORM_INPUT]: FormInputNode as ComponentType<NodeProps>,
}

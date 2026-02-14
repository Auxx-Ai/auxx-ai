// apps/web/src/components/workflow/nodes/inputs/form-input/node.tsx

import { type FC, memo } from 'react'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { FormInputNodeData } from './types'

/**
 * Props for FormInputNode component
 */
export interface FormInputNodeProps {
  id: string
  data: FormInputNodeData
  selected?: boolean
}

/**
 * Form input node component
 * A universal input node that supports multiple data types (text, number, date, file, etc.)
 */
export const FormInputNode: FC<FormInputNodeProps> = memo((props) => {
  const { id, data, selected } = props

  return (
    <BaseNode id={id} data={data} selected={selected} nodeType='input'>
      {/* Source handle using input-output handle for input nodes */}
      <NodeSourceHandle
        id={id}
        handleType='input-output'
        data={{ ...data, selected }}
        handleId='input-output'
        showAdd={false}
      />
    </BaseNode>
  )
})

FormInputNode.displayName = 'FormInputNode'

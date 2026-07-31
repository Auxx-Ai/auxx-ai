// apps/web/src/components/workflow/nodes/inputs/form-input/node.tsx

import { type FC, memo } from 'react'
import type { NodeProps } from '~/components/workflow/types'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { FormInputNodeData } from './types'

/**
 * Form input node component
 * A universal input node that supports multiple data types (text, number, date, file, etc.)
 */
export const FormInputNode: FC<NodeProps<FormInputNodeData>> = memo((props) => {
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

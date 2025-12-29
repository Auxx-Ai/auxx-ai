// apps/web/src/components/workflow/nodes/inputs/text-input/node.tsx

import { type FC, memo } from 'react'
import { TextInputNodeData } from './types'
import { BaseNode } from '../../shared/base/base-node'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle'

export interface TextInputNode {
  id: string
  data: TextInputNodeData
  selected?: boolean
}

/**
 * Text input node component
 */
export const TextInputNode: FC<TextInputNode> = memo((props) => {
  const { id, data, selected } = props

  return (
    <BaseNode id={id} data={data} selected={selected} nodeType="input">
      {/* Source handle using input-output handle for input nodes */}
      <NodeSourceHandle
        id={id}
        handleType="input-output"
        data={{ ...data, selected }}
        handleId="input-output"
        showAdd={false}
      />
    </BaseNode>
  )
})

TextInputNode.displayName = 'TextInputNode'

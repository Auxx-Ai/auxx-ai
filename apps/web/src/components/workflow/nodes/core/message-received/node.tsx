// apps/web/src/components/workflow/nodes/core/message-received/node.tsx

import { memo } from 'react'
import { NodeSourceHandle } from '../../../ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { MessageReceivedNode as MessageReceivedNodeType } from './types'

export const MessageReceivedNode = memo<MessageReceivedNodeType>((props) => {
  return (
    <BaseNode id={props.id} data={props.data} selected={props.selected} className='rounded-tl-none'>
      <NodeSourceHandle
        id={props.id}
        data={{ ...props.data, selected: props.selected }}
        handleId='source'
      />
      <div className='z-3 absolute top-[-24px] left-[-1px] rounded-t-md border-t border-x text-xs text-muted-foreground bg-secondary px-2 py-1'>
        Trigger
      </div>
    </BaseNode>
  )
})

MessageReceivedNode.displayName = 'MessageReceivedNode'

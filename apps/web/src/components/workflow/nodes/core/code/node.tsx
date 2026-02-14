// apps/web/src/components/workflow/nodes/core/code/node.tsx

import { memo } from 'react'
import { NodeSourceHandle, NodeTargetHandle } from '../../../ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { CodeNode as CodeNodeType } from './types'

export const CodeNode = memo<CodeNodeType>(({ id, data, selected }) => {
  const language = data?.code_language === 'python3' ? 'Python' : 'JavaScript'

  return (
    <BaseNode id={id} data={data} selected={selected}>
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />
      <div className='px-3 pb-2'>
        <div className='group flex h-6 items-center gap-0.5 rounded-md bg-primary-100 px-2'>
          <div className='text-xs text-gray-400'>{language}</div>
        </div>
      </div>
      <NodeSourceHandle id={id} data={{ ...data, selected }} handleId='source' />
    </BaseNode>
  )
})

CodeNode.displayName = 'CodeNode'

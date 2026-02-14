// apps/web/src/components/workflow/nodes/core/var-assign/node.tsx

import { type FC, memo } from 'react'
import { VarTypeIcon } from '~/components/workflow/utils/icon-helper'
import { NodeSourceHandle, NodeTargetHandle } from '../../../ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import { VAR_TYPE_LABELS } from './constants'
import type { VarAssignNode as VarAssignNodeType } from './types'

/**
 * Variable assignment node component
 */
export const VarAssignNode: FC<VarAssignNodeType> = memo((props) => {
  const { data, id, selected, width } = props

  const validVariables = data.variables || []

  return (
    <BaseNode
      {...props}
      // handles={{ target: ['input'], source: ['output'] }}
    >
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />
      <div className='relative'>
        {/* Display variables list */}
        {validVariables.length > 0 && (
          <div className='px-3 py-2 space-y-1'>
            {validVariables.slice(0, 3).map((variable) => (
              <div
                key={variable.id}
                className='group flex h-6 items-center gap-0.5 rounded-md bg-primary-100 p-1'>
                <div className='flex flex-row justify-between w-full'>
                  <div className='text-sm overflow-hidden text-ellipsis text-foreground'>
                    {variable.name.trim() === '' ? (
                      <span className='text-primary-400 italic'>Unnamed Variable</span>
                    ) : (
                      variable.name
                    )}
                  </div>
                  <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                    <VarTypeIcon type={variable.type} className='h-3 w-3' />
                    <span>{VAR_TYPE_LABELS[variable.type]}</span>
                  </div>
                </div>
              </div>
            ))}
            {validVariables.length > 3 && (
              <div className='text-xs text-muted-foreground text-center'>
                +{validVariables.length - 3} more
              </div>
            )}
          </div>
        )}

        <NodeSourceHandle
          id={id}
          data={{ ...data, selected }}
          handleId='source'
          handleClassName='!top-1/2 !-right-[0px]'
        />
      </div>
    </BaseNode>
  )
})

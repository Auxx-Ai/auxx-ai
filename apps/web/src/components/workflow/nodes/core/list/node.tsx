// apps/web/src/components/workflow/nodes/core/list/node.tsx

import type { ResourceFieldId } from '@auxx/types/field'
import { type FC, memo, useMemo } from 'react'
import { useFields } from '~/components/resources/hooks/use-field'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { getIcon } from '~/components/workflow/utils/icon-helper'
import { NodeSourceHandle, NodeTargetHandle } from '../../../ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import { type ListNode as ListNodeType, OPERATION_METADATA } from './types'

/**
 * List operations node component
 */
export const ListNode: FC<ListNodeType> = memo((props) => {
  const { data, id, selected } = props
  const operation = data.operation
  const operationMeta = OPERATION_METADATA[operation]

  // Collect ResourceFieldIds that need label resolution
  const fieldIdsToResolve = useMemo((): (ResourceFieldId | null)[] => {
    const uniqueField = data.uniqueConfig?.field
    if (operation === 'unique' && uniqueField) {
      if (Array.isArray(uniqueField)) return uniqueField as ResourceFieldId[]
      if (typeof uniqueField === 'string' && uniqueField.includes(':'))
        return [uniqueField as ResourceFieldId]
    }
    return []
  }, [operation, data.uniqueConfig?.field])

  const resolvedFields = useFields(fieldIdsToResolve)

  // Get operation summary based on configuration
  const getOperationSummary = () => {
    switch (operation) {
      case 'filter': {
        const filterConditions = data.filterConfig?.conditions.length || 0
        return `${filterConditions} condition${filterConditions !== 1 ? 's' : ''}`
      }
      case 'sort':
        return data.sortConfig?.field ? `by ${data.sortConfig.field}` : 'no sort'
      case 'slice': {
        const sliceMode = data.sliceConfig?.mode
        if (sliceMode === 'first' || sliceMode === 'last') {
          return `${sliceMode} ${data.sliceConfig?.count || 0} items`
        }
        return sliceMode || ''
      }
      case 'unique': {
        if (data.uniqueConfig?.by !== 'field') return 'whole items'
        const labels = resolvedFields.filter(Boolean).map((f) => f!.label)
        if (labels.length > 0) return `by ${labels.join(' → ')}`
        return 'by field'
      }
      case 'join':
        return data.joinConfig?.type || ''
      case 'pluck': {
        const pluckField = data.pluckConfig?.field
        const flatten = data.pluckConfig?.flatten
        if (!pluckField) return 'no field selected'
        return `${pluckField}${flatten ? ' (flattened)' : ''}`
      }
      default:
        return ''
    }
  }

  const operationSummary = getOperationSummary()

  return (
    <BaseNode {...props} data={data} id={id} selected={selected}>
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />
      <div className='relative'>
        {/* Operation display */}
        <div className='px-3 py-2 space-y-2'>
          {/* Operation type */}
          <div className='flex items-center gap-2'>
            {getIcon(operationMeta?.icon ?? 'List', 'h-4 w-4 text-indigo-500')}
            <span className='text-sm font-medium'>{operationMeta?.label ?? 'Unknown'}</span>
          </div>

          {/* Operation summary */}
          {operationSummary && (
            <div className='text-xs text-muted-foreground bg-primary-100 rounded-md px-2 py-1'>
              {operationSummary}
            </div>
          )}

          {/* Input indicator */}
          {data.inputList && (
            <div className='flex items-center gap-1 text-xs text-muted-foreground'>
              <span>List:</span>
              <span className='font-mono bg-primary-100 px-1 rounded'>
                <VariableTag variableId={data.inputList} nodeId={id} />
              </span>
            </div>
          )}
        </div>

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

ListNode.displayName = 'ListNode'

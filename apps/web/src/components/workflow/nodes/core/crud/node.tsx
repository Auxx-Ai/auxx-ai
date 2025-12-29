// apps/web/src/components/workflow/nodes/core/crud/node.tsx

'use client'

import React from 'react'
import { BaseNode } from '../../shared/base/base-node'
import { type CrudNodeData, CrudErrorStrategy } from './types'
import { NodeTargetHandle } from '~/components/workflow/ui/node-handle/target-handle'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle'
import { useWorkflowResources } from '../../../providers'

interface CrudNodeProps {
  id: string
  data: CrudNodeData
  selected: boolean
}

/**
 * CRUD workflow node component
 */
export const CrudNode: React.FC<CrudNodeProps> = ({ id, data, selected }) => {
  const { resourceType, mode, error_strategy } = data
  const { getResourceById } = useWorkflowResources()
  const resource = getResourceById(resourceType)

  // Calculate total source handles based on error strategy
  const hasFailBranch = error_strategy === CrudErrorStrategy.fail
  const totalSourceHandles = hasFailBranch ? 2 : 1

  // Augment data with handle count for collapsed height calculation
  const augmentedData = { ...data, _sourceHandleCount: totalSourceHandles }

  const getOperationColor = () => {
    switch (mode) {
      case 'create':
        return 'bg-green-500/15 text-green-700 hover:bg-green-500/25 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20'
      case 'update':
        return 'bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 dark:text-blue-400 dark:hover:bg-blue-500/25'
      case 'delete':
        return 'bg-red-500/15 text-red-700 hover:bg-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20'
      default:
        return 'bg-gray-100 text-gray-500'
    }
  }

  return (
    <BaseNode id={id} data={augmentedData} selected={selected} width={244} height="auto">
      <NodeTargetHandle id={id} data={{ ...augmentedData, selected }} handleId="target" />

      <div className="space-y-1 pb-2">
        {/* Main operation display */}
        <div className="relative px-2">
          <div className="flex items-start justify-start rounded-md bg-primary-100 p-1">
            <div
              className={`flex h-4 shrink-0 items-center rounded-md px-1 text-xs font-semibold uppercase ${getOperationColor()}`}>
              {mode?.toUpperCase()}
            </div>
            <div className="pl-1 text-xs break-all whitespace-pre-line">{resource?.label || resourceType}</div>
          </div>
          <NodeSourceHandle
            handleId="source"
            id={id}
            data={{ ...augmentedData, selected }}
            handleClassName="!bottom-5"
            handleIndex={0}
            handleTotal={totalSourceHandles}
          />
        </div>

        {/* Fail branch display - conditional on error strategy */}
        {hasFailBranch && (
          <div className="relative px-2">
            <div className="flex items-center justify-between rounded-md bg-primary-100 p-1 text-xs">
              <div className="h-4 rounded-md px-1 font-semibold uppercase bg-bad-100 text-bad-500 whitespace-pre-line">
                On Failure
              </div>
              <div className="text-primary-500">Fail Branch</div>
            </div>
            <NodeSourceHandle
              id={id}
              handleId="fail"
              type="fail"
              data={{ ...augmentedData, selected }}
              handleClassName="!bottom-5"
              handleIndex={1}
              handleTotal={totalSourceHandles}
            />
          </div>
        )}
      </div>
    </BaseNode>
  )
}

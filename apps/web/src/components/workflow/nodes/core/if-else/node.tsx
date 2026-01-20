// apps/web/src/components/workflow/nodes/core/if-else/node.tsx

import React, { memo, useMemo } from 'react'
import { BaseNode } from '../../shared/base/base-node'
import { type IfElseNode as IfElseNodeType } from './types'
import { NodeTargetHandle, NodeSourceHandle } from '../../../ui/node-handle'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { OPERATOR_DEFINITIONS, operatorRequiresValue, type Operator } from '@auxx/lib/workflow-engine/client'
import type { TiptapJSON } from '~/components/workflow/ui/input-editor'

/**
 * Simple condition value display for node view (doesn't require context)
 */
const ConditionValueDisplay = memo(({
  variableId,
  operator,
  value,
  nodeId,
}: {
  variableId?: string
  operator: Operator
  value: string | string[] | TiptapJSON | number | boolean
  nodeId?: string
}) => {
  const operatorDef = OPERATOR_DEFINITIONS[operator]
  const operatorName = operatorDef?.label || operator
  const notHasValue = !operatorRequiresValue(operator)

  const formatValue = useMemo(() => {
    if (notHasValue) return ''
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'string') {
      return value.replace(/{{([^}]+)}}/g, (_match, variablePath) => variablePath)
    }
    return String(value)
  }, [notHasValue, value])

  return (
    <div className="flex h-6 items-center gap-1 rounded-md bg-muted px-1">
      {variableId && <VariableTag variableId={variableId} nodeId={nodeId} isShort />}
      <div className="shrink-0 text-xs font-medium text-primary-500" title={operatorName}>
        {operatorName}
      </div>
      {!notHasValue && (
        <div className="shrink-[3] truncate text-xs text-primary-500" title={formatValue}>
          {formatValue}
        </div>
      )}
    </div>
  )
})
ConditionValueDisplay.displayName = 'ConditionValueDisplay'

export const IfElseNode = memo<IfElseNodeType>(({ id, data, selected }) => {
  // Use flattened data structure
  const casesLength = data?.cases?.length || 0
  const cases = data?.cases || []

  // Total source handles: one per case + one for else
  const totalSourceHandles = cases.length + 1

  // Augment data with handle count for collapsed height calculation
  const augmentedData = { ...data, _sourceHandleCount: totalSourceHandles }

  return (
    <BaseNode id={id} data={augmentedData} selected={selected}>
      <NodeTargetHandle id={id} data={{ ...augmentedData, selected }} handleId="target" />

      <div className="">
        {cases.map((caseItem, index) => (
          <div key={caseItem.case_id}>
            <div className="relative flex h-6 items-center px-3">
              <div className="flex w-full items-center justify-between">
                <div className="text-[10px] font-semibold text-primary-500">
                  {casesLength > 1 && `CASE ${index + 1}`}
                </div>
                <div className="text-[12px] font-semibold text-primary-500">
                  {index === 0 ? 'IF' : 'ELIF'}
                </div>
              </div>
              <NodeSourceHandle
                key={caseItem.case_id}
                id={id}
                data={{ ...augmentedData, selected }}
                handleId={caseItem.case_id}
                handleClassName="!top-1/2 "
                handleIndex={index}
                handleTotal={totalSourceHandles}
              />
            </div>
            <div className="space-y-0.5">
              {caseItem.conditions.map((condition, i) => (
                <div key={condition.id} className="relative">
                  <ConditionValueDisplay
                    variableId={condition.variableId}
                    operator={condition.comparison_operator || 'is'}
                    value={condition.value || ''}
                    nodeId={id}
                  />
                  {i !== caseItem.conditions.length - 1 && (
                    <div className="absolute bottom-[-10px] right-1 z-10 text-[10px] bg-secondary uppercase leading-4 text-accent-500 rounded-md border border-accent-300 px-1 font-semibold shadow-xs">
                      {caseItem.logical_operator}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="relative flex h-6 items-center px-3">
        <div className="w-full text-right text-xs font-semibold text-primary-500">ELSE</div>
        <NodeSourceHandle
          id={id}
          data={{ ...augmentedData, selected }}
          handleId="false"
          handleClassName="!bottom-5"
          handleIndex={cases.length}
          handleTotal={totalSourceHandles}
        />
      </div>
    </BaseNode>
  )
})

IfElseNode.displayName = 'IfElseNode'

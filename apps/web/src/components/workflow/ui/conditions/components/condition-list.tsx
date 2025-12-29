// apps/web/src/components/workflow/ui/conditions/components/condition-list.tsx

'use client'

import { RefreshCw } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { useConditionContext } from '../condition-context'
import ConditionItem from './condition-item'
import type { GenericCondition } from '../types'

type ConditionListProps = {
  conditions: GenericCondition[]
  groupId?: string
  isSubVariable?: boolean
  className?: string
}

/**
 * Generic condition list component that displays conditions with logical operators
 * Maintains the same styling as the original if-else condition-list
 */
const ConditionList = ({
  conditions,
  groupId,
  isSubVariable = false,
  className,
}: ConditionListProps) => {
  const { readOnly, config, updateCondition, groups, toggleGroupLogicalOperator } =
    useConditionContext()

  // Determine if we're using groups (either this list is in a group, or grouping is enabled)
  const isInGroup = Boolean(groupId || (config.showGrouping && groups.length > 0))

  // Get the logical operator for this group
  const logicalOperator = useMemo(() => {
    if (groupId) {
      const group = groups.find((g) => g.id === groupId)
      return group?.logicalOperator || 'AND'
    }

    // For flat conditions, use the first condition's logical operator
    return conditions.length > 1 ? conditions[1]?.logicalOperator || 'AND' : 'AND'
  }, [groupId, groups, conditions])

  const toggleLogicalOperator = useCallback(() => {
    if (groupId && config.showGrouping && toggleGroupLogicalOperator) {
      // Toggle group logical operator using context function
      toggleGroupLogicalOperator(groupId)
      return
    }

    // Toggle individual condition logical operators
    const newOperator = logicalOperator === 'AND' ? 'OR' : 'AND'

    conditions.forEach((condition, index) => {
      if (index > 0) {
        updateCondition(condition.id, { logicalOperator: newOperator }, groupId)
      }
    })
  }, [
    groupId,
    config.showGrouping,
    logicalOperator,
    conditions,
    updateCondition,
    toggleGroupLogicalOperator,
  ])

  const isValueFieldShort = useMemo(() => {
    if (isSubVariable && conditions.length > 1) return true
    return false
  }, [conditions.length, isSubVariable])

  const conditionItemClassName = useMemo(() => {
    if (!isSubVariable) return ''
    if (conditions.length < 2) return ''
    return logicalOperator === 'AND' ? 'pl-[51px]' : 'pl-[42px]'
  }, [conditions.length, isSubVariable, logicalOperator])

  if (conditions.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        'relative',
        isInGroup ? 'pl-[70px]' : 'pl-[30px]',
        // (isSubVariable || conditions.length > 1) && 'pl-[60px]',
        className
      )}>
      {/* Logical operator controls */}
      {conditions.length > 1 && config.showLogicalOperators && (
        <div
          className={cn(
            'absolute bottom-0 left-0 top-0 ',
            isInGroup ? 'w-[70px]' : 'w-[30px]',
            isSubVariable && logicalOperator === 'AND' && 'left-[-10px]',
            isSubVariable && logicalOperator === 'OR' && 'left-[-18px]'
          )}>
          <div
            className={cn(
              'absolute bottom-4  top-4 w-2.5 rounded-l-[8px] border border-r-0 border-border',
              isInGroup ? 'left-[56px]' : 'left-[16px]'
            )}></div>
          {/* <div className="absolute right-0 top-1/2 h-[29px] w-4 -translate-y-1/2 bg-background"></div> */}
          {!readOnly && (
            <div
              className="absolute right-1 top-1/2 flex h-[21px] -translate-y-1/2 cursor-pointer select-none items-center rounded-md border-[0.5px] border-border bg-secondary px-1 text-[10px] font-semibold text-secondary-foreground shadow-xs"
              onClick={toggleLogicalOperator}>
              {logicalOperator.toUpperCase()}
              <RefreshCw className="ml-0.5 h-3 w-3" />
            </div>
          )}
          {readOnly && (
            <div className="absolute right-1 top-1/2 flex h-[21px] -translate-y-1/2 select-none items-center rounded-md border-[0.5px] bg-secondary px-1 text-[10px] font-semibold text-secondary-foreground shadow-xs">
              {logicalOperator.toUpperCase()}
            </div>
          )}
        </div>
      )}

      {/* Condition items */}
      {conditions.map((condition) => (
        <ConditionItem
          key={condition.id}
          condition={condition}
          groupId={groupId}
          className={conditionItemClassName}
          compactMode={isValueFieldShort}
          showRemoveButton={!readOnly}
        />
      ))}
    </div>
  )
}

export default ConditionList

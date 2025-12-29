// apps/web/src/components/workflow/nodes/if-else/components/condition-list/index.tsx

import { RefreshCw } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { LogicalOperator, type IfElseCase } from '../../types'
import ConditionItem from './condition-item'
import { cn } from '@auxx/ui/lib/utils'
import { useIfElseActions } from '../../if-else-context'
// import { useIfElseActions } from '../../if-else-context'

type ConditionListProps = {
  isSubVariable?: boolean
  caseId: string
  conditionId?: string
  caseItem: IfElseCase
}
const ConditionList = ({ isSubVariable, caseId, conditionId, caseItem }: ConditionListProps) => {
  const { toggleConditionLogicalOperator } = useIfElseActions()

  const { conditions, logical_operator } = caseItem

  const doToggleConditionLogicalOperator = useCallback(() => {
    toggleConditionLogicalOperator(caseId)
  }, [caseId, conditionId, isSubVariable, toggleConditionLogicalOperator])

  const isValueFieldShort = useMemo(() => {
    if (isSubVariable && conditions.length > 1) return true

    return false
  }, [conditions.length, isSubVariable])
  const conditionItemClassName = useMemo(() => {
    if (!isSubVariable) return ''
    if (conditions.length < 2) return ''
    return logical_operator === LogicalOperator.and ? 'pl-[51px]' : 'pl-[42px]'
  }, [conditions.length, isSubVariable, logical_operator])

  return (
    <div className={cn('relative', !isSubVariable && 'pl-[60px]')}>
      {conditions.length > 1 && (
        <div
          className={cn(
            'absolute bottom-0 left-0 top-0 w-[60px]',
            isSubVariable && logical_operator === LogicalOperator.and && 'left-[-10px]',
            isSubVariable && logical_operator === LogicalOperator.or && 'left-[-18px]'
          )}>
          <div className="absolute bottom-4 left-[46px] top-4 w-2.5 rounded-l-[8px] border border-r-0 border-border"></div>
          <div className="absolute right-0 top-1/2 h-[29px] w-4 -translate-y-1/2 bg-background"></div>
          <div
            className="absolute right-1 top-1/2 flex h-[21px] -translate-y-1/2 cursor-pointer select-none items-center rounded-md border-[0.5px] border-border bg-secondary px-1 text-[10px] font-semibold text-secondary-foreground shadow-xs"
            onClick={doToggleConditionLogicalOperator}>
            {logical_operator.toUpperCase()}
            <RefreshCw className="ml-0.5 h-3 w-3" />
          </div>
        </div>
      )}
      {caseItem.conditions.map((condition) => (
        <ConditionItem
          key={condition.id}
          className={conditionItemClassName}
          caseId={caseId}
          conditionId={isSubVariable ? conditionId! : condition.id}
          condition={condition}
          isValueFieldShort={isValueFieldShort}
        />
      ))}
    </div>
  )
}

export default ConditionList

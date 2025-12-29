// apps/web/src/components/workflow/nodes/if-else/components/condition-list/condition-item.tsx

import { useCallback, useMemo, useState } from 'react'
import { Trash2, Variable, Info } from 'lucide-react'
import { produce } from 'immer'
import ConditionNumberInput from '../condition-number-input'
import { FILE_TYPE_OPTIONS, TRANSFER_METHOD } from '../../constants'
// SUB_VARIABLES removed - file properties are now navigable through variable picker
import ConditionOperator from './condition-operator'
import VariableInput from '~/components/workflow/ui/variables/variable-input'
import { ReferenceValueInput } from '../reference-value-input'
import { cn } from '@auxx/ui/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { useIfElseActions } from '../../if-else-context'
import {
  type IfElseCondition,
  type UnifiedVariable,
  BaseType,
  type ComparisonOperator,
} from '../../types'
import { comparisonOperatorNotRequireValue, getOperators } from '../../utils'
import { useVariable } from '~/components/workflow/hooks/use-var-store-sync'
import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'

type ConditionItemProps = {
  className?: string
  caseId: string
  conditionId: string
  condition: IfElseCondition
  isValueFieldShort?: boolean
}

/**
 * One condition containing variable selector, operator, value input and sub conditions
 */
const ConditionItem = ({
  className,
  caseId,
  conditionId,
  condition,
  isValueFieldShort,
}: ConditionItemProps) => {
  const { nodeId, readOnly, updateCondition, removeCondition } = useIfElseActions()
  const [isHovered, setIsHovered] = useState(false)

  // Legacy sub-variable detection - deprecated in favor of structured file variables
  const isSubVariable = false // Sub-variables no longer needed with structured file properties

  // Get the current variable directly from store
  const { variable: currentVariable } = useVariable(condition.variableId || '', nodeId)

  const fileAttr = useMemo(() => {
    if (currentVariable?.type === BaseType.FILE && condition.key) {
      // Only set fileAttr when we have an actual sub-property key
      return { key: condition.key }
    }
    return undefined
  }, [currentVariable?.type, condition.key])

  const canChooseOperator = useMemo(() => {
    return !!currentVariable
  }, [condition.key, currentVariable])

  const doUpdateCondition = useCallback(
    (newCondition: IfElseCondition) => {
      updateCondition(caseId, conditionId, newCondition)
    },
    [caseId, conditionId, updateCondition]
  )

  const handleUpdateConditionOperator = useCallback(
    (value: ComparisonOperator) => {
      const newCondition = produce(condition, (draft) => {
        draft.comparison_operator = value
      })
      doUpdateCondition(newCondition)
    },
    [condition, doUpdateCondition]
  )

  const handleRemove = useCallback(() => {
    removeCondition(caseId, conditionId)
  }, [caseId, conditionId])

  const handleUpdateConditionValue = useCallback(
    (value: string | string[]) => {
      let newCondition: IfElseCondition
      if (condition.comparison_operator === 'in' || condition.comparison_operator === 'not in') {
        const newValue = Array.isArray(value) ? value : [value]
        newCondition = produce(condition, (draft) => {
          draft.value = newValue
        })
      } else {
        const newValue = Array.isArray(value) ? value[0] : value
        newCondition = produce(condition, (draft) => {
          draft.value = newValue
        })
      }
      doUpdateCondition(newCondition)
    },
    [condition, doUpdateCondition]
  )

  // Handler for InputEditor which returns Tiptap JSON object
  const handleInputEditorChange = useCallback(
    (value: string) => {
      const newCondition = produce(condition, (draft) => {
        draft.value = value
      })
      updateCondition(caseId, conditionId, newCondition)
    },
    [condition, doUpdateCondition]
  )

  const handleUpdateConditionNumberVarType = useCallback(
    (isConstant: boolean) => {
      const newCondition = produce(condition, (draft) => {
        draft.numberVarType = isConstant ? BaseType.NUMBER : BaseType.STRING
      })
      doUpdateCondition(newCondition)
    },
    [condition, doUpdateCondition]
  )

  const handleSubVarKeyChange = useCallback(
    (value: string) => {
      const newCondition = produce(condition, (draft) => {
        draft.key = value
      })
      doUpdateCondition(newCondition)
    },
    [condition, doUpdateCondition]
  )

  // Legacy sub-variable options - deprecated in favor of structured file variables
  const subVarOptions = useMemo(() => {
    // File properties are now navigable directly through the variable picker
    return []
  }, [])

  const isSelect =
    condition.comparison_operator === 'in' || condition.comparison_operator === 'not in'
  const isArrayValue = !!fileAttr?.key && isSelect

  const selectOptions = useMemo(() => {
    if (!isSelect) return []

    if (fileAttr?.key === 'type') return FILE_TYPE_OPTIONS
    if (fileAttr?.key === 'transfer_method') return TRANSFER_METHOD

    return []
  }, [fileAttr?.key, isSelect])

  const isNotInput =
    condition.comparison_operator === 'empty' ||
    condition.comparison_operator === 'not empty' ||
    condition.comparison_operator === 'exists' ||
    condition.comparison_operator === 'not exists'

  const handleVarChange = useCallback(
    (variable: UnifiedVariable) => {
      const newCondition = produce(condition, (draft) => {
        draft.variableId = variable.id
        // draft.variable = variable
        // draft.varType = variable.type
        draft.value = ''
        draft.comparison_operator = getOperators(variable.type)[0]
      })
      doUpdateCondition(newCondition)
    },
    [condition, doUpdateCondition]
  )

  return (
    <div className={cn('mb-1 flex last-of-type:mb-0', className)}>
      <div
        className={cn(
          'grow rounded-lg bg-primary-100 border',
          isHovered && 'bg-destructive/10 border-destructive/20'
        )}>
        <div className="flex items-center p-1">
          <div className="w-0 grow">
            <VariableInput
              variableId={condition.variableId}
              onVariableSelect={handleVarChange}
              disabled={readOnly}
              nodeId={nodeId}
              placeholder="Select variable"
              className="h-6 text-xs"
              popoverWidth={400}
              popoverHeight={500}
            />
          </div>
          <div className="mx-1 h-3 w-[1px] bg-divider"></div>
          <ConditionOperator
            disabled={!canChooseOperator || readOnly}
            varType={currentVariable?.type}
            value={condition.comparison_operator}
            onSelect={handleUpdateConditionOperator}
            file={fileAttr}
          />
        </div>
        {!comparisonOperatorNotRequireValue(condition.comparison_operator) &&
          !isNotInput &&
          currentVariable?.type !== BaseType.NUMBER &&
          currentVariable?.type !== BaseType.REFERENCE && (
            <div
              className={cn(
                'max-h-[100px] overflow-y-auto border-t border-t-divider px-2 py-1',
                isHovered && ' border-destructive/20'
              )}>
              <VarEditor
                value={condition.value}
                onChange={handleInputEditorChange}
                onBlur={handleInputEditorChange}
                nodeId={nodeId}
                placeholder="Enter value or select variable"
                disabled={readOnly}
                varType={BaseType.ANY}
              />
            </div>
          )}
        {!comparisonOperatorNotRequireValue(condition.comparison_operator) &&
          !isNotInput &&
          currentVariable?.type === BaseType.REFERENCE && (
            <div className="border-t border-t-divider px-2 py-1">
              <ReferenceValueInput
                referenceTarget={currentVariable.reference}
                value={condition.value as string}
                onChange={(value) => {
                  const newCondition = produce(condition, (draft) => {
                    draft.value = value
                  })
                  doUpdateCondition(newCondition)
                }}
                disabled={readOnly}
              />
            </div>
          )}
        {!comparisonOperatorNotRequireValue(condition.comparison_operator) &&
          !isNotInput &&
          currentVariable?.type === BaseType.NUMBER && (
            <div className="border-t border-t-divider px-2 py-1 pt-[3px]">
              <ConditionNumberInput
                isConstant={condition.numberVarType === BaseType.NUMBER}
                onConstantChange={handleUpdateConditionNumberVarType}
                value={condition.value as string}
                onValueChange={handleUpdateConditionValue}
                // variables={availableVariables}
                variableId={condition.variableId}
                nodeId={nodeId}
                onVariableSelect={(variable) => {
                  const newCondition = produce(condition, (draft) => {
                    draft.variableId = variable.id
                    draft.variable = variable
                    draft.value = variable.fullPath
                  })
                  doUpdateCondition(newCondition)
                }}
                isShort={isValueFieldShort}
                unit={fileAttr?.key === 'size' ? 'Byte' : undefined}
              />
            </div>
          )}
        {!comparisonOperatorNotRequireValue(condition.comparison_operator) && isSelect && (
          <div className="border-t border-t-divider">
            <Select
              value={
                isArrayValue ? (condition.value as string[])?.[0] : (condition.value as string)
              }
              onValueChange={(value) => handleUpdateConditionValue(value)}>
              <SelectTrigger className="h-8 rounded-t-none px-2 text-xs" disabled={readOnly}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selectOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label || option.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Enhanced File Operator Value Inputs */}
        {!comparisonOperatorNotRequireValue(condition.comparison_operator) &&
          condition.comparison_operator === 'matches_pattern' && (
            <div className="border-t border-t-divider px-2 py-1">
              <div className="space-y-2">
                <Input
                  placeholder="Enter regex pattern (e.g., ^invoice.*\.pdf$)"
                  value={(condition.value as string) || ''}
                  onChange={(e) => handleUpdateConditionValue(e.target.value)}
                  disabled={readOnly}
                  className="text-xs"
                />
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Info className="h-3 w-3" />
                  <span>
                    Example: ^invoice.*\.pdf$ matches files starting with "invoice" and ending with
                    ".pdf"
                  </span>
                </div>
              </div>
            </div>
          )}

        {!comparisonOperatorNotRequireValue(condition.comparison_operator) &&
          ['uploaded_within_days', 'within_days', 'older_than_days'].includes(
            condition.comparison_operator || ''
          ) && (
            <div className="border-t border-t-divider px-2 py-1">
              <div className="flex items-center space-x-2">
                <Input
                  type="number"
                  min="0"
                  placeholder="Enter number of days"
                  value={(condition.value as string) || ''}
                  onChange={(e) => handleUpdateConditionValue(e.target.value)}
                  disabled={readOnly}
                  className="text-xs"
                />
                <span className="text-xs text-muted-foreground">days</span>
              </div>
            </div>
          )}

        {!comparisonOperatorNotRequireValue(condition.comparison_operator) &&
          ['within_size_limit', 'exceeds_limit'].includes(condition.comparison_operator || '') && (
            <div className="border-t border-t-divider px-2 py-1">
              <div className="flex items-center space-x-2">
                <Input
                  type="number"
                  min="0"
                  placeholder="Enter size in MB"
                  value={(condition.value as string) || ''}
                  onChange={(e) => handleUpdateConditionValue(e.target.value)}
                  disabled={readOnly}
                  className="text-xs"
                />
                <span className="text-xs text-muted-foreground">MB</span>
              </div>
            </div>
          )}

        {!comparisonOperatorNotRequireValue(condition.comparison_operator) &&
          ['before', 'after', 'on'].includes(condition.comparison_operator || '') && (
            <div className="border-t border-t-divider px-2 py-1">
              <Input
                type="date"
                value={(condition.value as string) || ''}
                onChange={(e) => handleUpdateConditionValue(e.target.value)}
                disabled={readOnly}
                className="text-xs"
              />
            </div>
          )}
      </div>
      {!readOnly && (
        <Button
          className="ml-1"
          onClick={handleRemove}
          variant="destructive-hover"
          size="xs"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}>
          <Trash2 className="size-6 shrink-0" />
        </Button>
      )}
    </div>
  )
}

export default ConditionItem

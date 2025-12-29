// apps/web/src/components/workflow/nodes/if-else/components/condition-number-input.tsx

import { memo, useCallback, useState } from 'react'
import { ChevronDown, Variable } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { BaseType, UnifiedVariable } from '../types'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'

type ConditionNumberInputProps = {
  isConstant?: boolean
  onConstantChange: (isConstant: boolean) => void
  value: string
  onValueChange: (v: string) => void
  // variables: UnifiedVariable[]
  isShort?: boolean
  unit?: string
  onVariableSelect?: (variable: UnifiedVariable) => void
  variableId?: string
  nodeId: string
}

const ConditionNumberInput = ({
  isConstant = true,
  onConstantChange,
  value,
  onValueChange,
  // variables,
  isShort,
  unit,
  onVariableSelect,
  variableId,
  nodeId,
}: ConditionNumberInputProps) => {
  const [typePickerOpen, setTypePickerOpen] = useState(false)
  const [variableSelectorOpen, setVariableSelectorOpen] = useState(false)
  const [isFocus, setIsFocus] = useState(false)

  const handleSelectVariable = useCallback(
    (variable: UnifiedVariable) => {
      onValueChange(variable.id)
      setVariableSelectorOpen(false)
      onVariableSelect?.(variable)
      onConstantChange(false)
    },
    [onValueChange, onVariableSelect, onConstantChange]
  )

  const isValueBgWhite = isConstant && (isFocus || value)

  // Filter for number variables
  // const numberVariables = variables.filter((v) => v.type === BaseType.NUMBER)

  return (
    <div
      className={cn(
        'flex overflow-hidden rounded-lg border-[0.5px] border-divider bg-secondary/50',
        isFocus && 'bg-background'
      )}>
      <Popover open={typePickerOpen} onOpenChange={setTypePickerOpen}>
        <PopoverTrigger asChild>
          <div
            className={cn(
              'inline-flex h-8 shrink-0 cursor-pointer items-center gap-0.5 rounded-l-md border-r-[0.5px] border-divider px-2 text-xs',
              isConstant && 'bg-muted',
              !isConstant && 'bg-violet-50',
              !isShort && 'w-[100px]'
            )}>
            {!isConstant && <Variable className="h-3 w-3" />}
            <div className="text-xs font-medium">{isConstant ? 'Constant' : 'Variable'}</div>
            <ChevronDown className="ml-0.5 h-3 w-3" />
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-32 p-0">
          <div
            className="flex h-8 cursor-pointer items-center gap-1 px-2 hover:bg-accent"
            onClick={() => {
              onConstantChange(true)
              setTypePickerOpen(false)
            }}>
            <div className="text-xs font-medium">Constant</div>
          </div>
          <div
            className="flex h-8 cursor-pointer items-center gap-1 px-2 hover:bg-accent"
            onClick={() => {
              onConstantChange(false)
              setTypePickerOpen(false)
            }}>
            <Variable className="h-3 w-3" />
            <div className="text-xs font-medium">Variable</div>
          </div>
        </PopoverContent>
      </Popover>

      <div className="relative flex h-8 grow items-center gap-1 overflow-hidden">
        {isConstant && (
          <>
            <input
              type="number"
              value={value || ''}
              onChange={(e) => onValueChange(e.target.value)}
              onFocus={() => setIsFocus(true)}
              onBlur={() => setIsFocus(false)}
              placeholder="0"
              className={cn(
                'h-full grow border-0 bg-transparent px-2 text-xs outline-none appearance-none',
                isValueBgWhite && 'bg-background'
              )}
            />
            {unit && (
              <div className="shrink-0 pr-2 text-[10px] uppercase text-muted-foreground">
                {unit}
              </div>
            )}
          </>
        )}
        {!isConstant && (
          // <PopoverTrigger asChild>
          <VariablePicker
            nodeId={nodeId}
            open={variableSelectorOpen}
            onOpenChange={setVariableSelectorOpen}
            allowedTypes={[BaseType.NUMBER]}
            onVariableSelect={handleSelectVariable}>
            <div
              className={cn(
                'flex grow cursor-pointer items-center justify-between px-2',
                !isShort && 'w-[170px]'
              )}>
              {variableId && <VariableTag variableId={variableId} nodeId={nodeId} isShort />}
              {!variableId && <div className="text-xs text-muted-foreground">Select variable</div>}
            </div>
          </VariablePicker>
        )}
      </div>
    </div>
  )
}

export default memo(ConditionNumberInput)

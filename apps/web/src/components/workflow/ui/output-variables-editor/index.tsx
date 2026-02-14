// apps/web/src/components/workflow/ui/output-variables/index.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { cn } from '@auxx/ui/lib/utils'
import { produce } from 'immer'
import { Plus, Trash2 } from 'lucide-react'
import type React from 'react'
import { useCallback } from 'react'
import VariableInput from '~/components/workflow/ui/variables/variable-input'
import type { OutputVariablesProps } from './types'
import { generateDefaultVariableName, getVariableNameError } from './utils'

/**
 * Reusable component for managing output variable configurations
 */
export const OutputVariablesEditor: React.FC<OutputVariablesProps> = ({
  outputs,
  onChange,
  groups,
  variables,
  nodes,
  isReadOnly = false,
  label = 'Output Variables',
  placeholder = 'Variable Name',
  emptyStateMessage = 'No output variables defined. Click "Add Output Variable" to define outputs.',
  addButtonLabel = 'Add Output Variable',
  onVariableNameValidation,
  maxOutputs,
}) => {
  /**
   * Handle variable name change
   */
  const handleVarNameChange = useCallback(
    (index: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isReadOnly) return

      const newName = e.target.value
      const newOutputs = produce(outputs, (draft) => {
        draft[index].variable = newName
      })

      onChange(newOutputs)
    },
    [outputs, onChange, isReadOnly]
  )

  /**
   * Handle value selector change
   */
  const handleVarSelectorChange = useCallback(
    (index: number) => (valueSelector: string[]) => {
      if (isReadOnly) return
      console.log('handleVarSelectorChange', index, valueSelector)
      const newOutputs = produce(outputs, (draft) => {
        draft[index].value_selector = valueSelector
      })

      onChange(newOutputs)
    },
    [outputs, onChange, isReadOnly]
  )

  /**
   * Handle removing an output variable
   */
  const handleVarRemove = useCallback(
    (index: number) => () => {
      if (isReadOnly) return

      const newOutputs = produce(outputs, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newOutputs)
    },
    [outputs, onChange, isReadOnly]
  )

  /**
   * Handle adding a new output variable
   */
  const handleAddOutput = useCallback(() => {
    if (isReadOnly || (maxOutputs && outputs.length >= maxOutputs)) return

    // Generate a unique default name
    let newVarName = ''
    let counter = outputs.length
    do {
      newVarName = generateDefaultVariableName(counter)
      counter++
    } while (outputs.some((o) => o.variable === newVarName))

    const newOutputs = produce(outputs, (draft) => {
      draft.push({ variable: newVarName, value_selector: [] })
    })
    onChange(newOutputs)
  }, [outputs, onChange, isReadOnly, maxOutputs])

  /**
   * Validate variable name
   */
  const validateVariable = useCallback(
    (name: string, index: number): string | null => {
      if (onVariableNameValidation) {
        const result = onVariableNameValidation(name)
        if (result !== true) {
          return typeof result === 'string' ? result : 'Invalid variable name'
        }
      }

      return getVariableNameError(name, outputs, index)
    },
    [outputs, onVariableNameValidation]
  )

  // Check if we can add more outputs
  const canAddMore = !maxOutputs || outputs.length < maxOutputs

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        {outputs.map((item, index) => {
          const error = validateVariable(item.variable, index)

          return (
            <div key={index}>
              <div className='flex items-center gap-2'>
                <Input
                  className={cn('w-[120px]', error && 'border-red-500')}
                  disabled={isReadOnly}
                  value={item.variable}
                  onChange={handleVarNameChange(index)}
                  placeholder={placeholder}
                />
                <div className='flex-1'>
                  {isReadOnly ? (
                    <Input
                      value={item.value_selector.join('.')}
                      disabled
                      placeholder='Select value'
                    />
                  ) : (
                    <VariableInput
                      value={item.value_selector}
                      availableNodes={nodes}
                      placeholder='Select value'
                      variables={variables}
                      groups={groups}
                      onChange={handleVarSelectorChange(index)}
                      showFavorites={true}
                      showRecent={true}
                    />
                  )}
                </div>
                {!isReadOnly && (
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={handleVarRemove(index)}
                    className='h-8 w-8 p-0'>
                    <Trash2 className='h-4 w-4' />
                  </Button>
                )}
              </div>
              {error && <p className='text-xs text-red-500 mt-1 ml-1'>{error}</p>}
            </div>
          )
        })}
      </div>

      {!isReadOnly && canAddMore && (
        <Button size='sm' variant='outline' onClick={handleAddOutput} className='w-full'>
          <Plus className='h-4 w-4 mr-2' />
          {addButtonLabel}
        </Button>
      )}

      {outputs.length === 0 && (
        <div className='text-sm text-muted-foreground text-center py-4'>{emptyStateMessage}</div>
      )}
    </div>
  )
}

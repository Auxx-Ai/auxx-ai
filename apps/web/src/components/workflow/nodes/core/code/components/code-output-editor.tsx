// apps/web/src/components/workflow/nodes/core/code/components/code-output-editor.tsx

import { Button } from '@auxx/ui/components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'
import { cloneDeep, debounce } from '@auxx/utils'
import { produce } from 'immer'
import { Plus, Trash2 } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { BaseType } from '~/components/workflow/types/unified-types'
import Section from '~/components/workflow/ui/section'
import {
  formatTypeString,
  parseTypeString,
  VariableTypePicker,
} from '~/components/workflow/ui/variable-type-picker'
import type { CodeNodeOutput } from '../types'

interface CodeOutputEditorProps {
  outputs: CodeNodeOutput[]
  onChange: (outputs: CodeNodeOutput[]) => void
  isReadOnly?: boolean
}

/**
 * Simple editor for code node output variables
 * Only manages variable names - values come from code execution
 */
export const CodeOutputEditor: React.FC<CodeOutputEditorProps> = ({
  outputs: initialOutputs,
  onChange: onChangeImmediate,
  isReadOnly = false,
}) => {
  // const [outputs, setOutputs] = React.useState<CodeNodeOutput[]>(initialOutputs)
  const [outputs, setOutputs] = useState<CodeNodeOutput[]>(() => cloneDeep(initialOutputs))
  const [isOpen, setIsOpen] = useState(true)

  useEffect(() => {
    setOutputs(cloneDeep(initialOutputs))
  }, [initialOutputs])

  // Debounced onChange handler to avoid excessive updates
  const onChange = React.useMemo(() => debounce(onChangeImmediate, 300), [onChangeImmediate])
  const updateOutputs = (updater: (draft: CodeNodeOutput[]) => void) => {
    const newOutputs = produce(outputs, updater)
    setOutputs(newOutputs)
    onChange(newOutputs)
  }

  const handleNameChange = (index: number, newName: string) => {
    if (isReadOnly) return
    updateOutputs((draft) => {
      draft[index].name = newName
    })
  }

  const handleTypeChange = (index: number, value: string) => {
    if (isReadOnly) return
    updateOutputs((draft) => {
      draft[index].type = value as BaseType
    })
  }

  const handleRemove = (index: number) => {
    if (isReadOnly) return
    updateOutputs((draft) => {
      draft.splice(index, 1)
    })
  }

  const handleAdd = () => {
    if (isReadOnly) return

    // Open section if it's closed
    if (!isOpen) setIsOpen(true)

    // Generate unique name
    let counter = outputs.length + 1
    let newName = `output${counter}`
    while (outputs.some((o) => o.name === newName)) {
      counter++
      newName = `output${counter}`
    }
    updateOutputs((draft) => {
      draft.push({
        name: newName,
        type: BaseType.STRING,
        description: `Output variable: ${newName}`,
      })
    })
  }

  // Validate variable names
  const getNameError = (name: string, index: number): string | null => {
    if (!name || name.trim() === '') {
      return 'Variable name is required'
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return 'Variable name must start with a letter or underscore and contain only letters, numbers, and underscores'
    }

    // Check for duplicates
    const duplicate = outputs.findIndex((o, i) => i !== index && o.name === name)
    if (duplicate !== -1) {
      return 'Variable name must be unique'
    }

    return null
  }

  return (
    <Section
      title='Output Variables'
      description='Define the variables that will be output from your code execution.'
      open={isOpen}
      onOpenChange={setIsOpen}
      actions={
        !isReadOnly && (
          <Button variant='ghost' size='xs' onClick={handleAdd}>
            <Plus /> Add
          </Button>
        )
      }>
      <div className='space-y-4'>
        {outputs.length > 0 && (
          <div className='space-y-2'>
            {outputs.map((output, index) => {
              const error = getNameError(output.name, index)

              const currentTypeValue = output.type || BaseType.STRING
              const typeValue = parseTypeString(currentTypeValue)

              return (
                <div key={index}>
                  <InputGroup>
                    <InputGroupInput
                      className={cn('flex-1', error && 'border-red-500')}
                      disabled={isReadOnly}
                      value={output.name}
                      onChange={(e) => handleNameChange(index, e.target.value)}
                      placeholder='Variable name'
                    />
                    <InputGroupAddon align='inline-end'>
                      <VariableTypePicker
                        value={typeValue}
                        onChange={(newValue) => handleTypeChange(index, formatTypeString(newValue))}
                        disabled={isReadOnly}
                        compact
                        popoverWidth={320}
                        popoverHeight={500}
                        align='end'
                      />
                    </InputGroupAddon>
                    {!isReadOnly && (
                      <InputGroupAddon align='inline-end'>
                        <Button
                          size='icon-xs'
                          variant='destructive-hover'
                          onClick={() => handleRemove(index)}>
                          <Trash2 />
                        </Button>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                  {error && <p className='text-xs text-red-500 mt-1'>{error}</p>}
                </div>
              )
            })}
          </div>
        )}

        {outputs.length === 0 && (
          <div className='text-sm text-muted-foreground text-center py-4'>
            No output variables defined. Click the + button to define outputs from your code.
          </div>
        )}
      </div>
    </Section>
  )
}

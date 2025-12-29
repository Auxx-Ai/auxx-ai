// apps/web/src/components/workflow/nodes/core/code/components/code-input-editor.tsx

import React from 'react'
import { Button } from '@auxx/ui/components/button'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { produce } from 'immer'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import Section from '~/components/workflow/ui/section'

export interface CodeInput {
  name: string
  variableId: string
}

interface CodeInputEditorProps {
  inputs: CodeInput[]
  onChange: (inputs: CodeInput[]) => void
  isReadOnly?: boolean
  nodeId?: string // Optional, only needed for VariablePicker and VariableTag
}

/**
 * Editor for code node input variables
 * Manages variable names and their connections to workflow variables
 */
export const CodeInputEditor: React.FC<CodeInputEditorProps> = ({
  inputs,
  onChange,
  isReadOnly = false,
  nodeId = '',
}) => {
  const handleNameChange = (index: number, newName: string) => {
    if (isReadOnly) return

    const newInputs = produce(inputs, (draft) => {
      if (draft[index]) {
        draft[index].name = newName
      }
    })
    onChange(newInputs)
  }

  const handleVariableChange = (index: number, variableId: string) => {
    if (isReadOnly) return

    const newInputs = produce(inputs, (draft) => {
      if (draft[index]) {
        draft[index].variableId = variableId
      }
    })
    onChange(newInputs)
  }

  const handleRemove = (index: number) => {
    if (isReadOnly) return

    const newInputs = produce(inputs, (draft) => {
      draft.splice(index, 1)
    })
    onChange(newInputs)
  }

  const handleAdd = () => {
    if (isReadOnly) return

    // Generate unique name
    let counter = inputs.length + 1
    let newName = `input${counter}`
    while (inputs.some((i) => i.name === newName)) {
      counter++
      newName = `input${counter}`
    }

    const newInputs = produce(inputs, (draft) => {
      draft.push({ name: newName, variableId: '' })
    })
    onChange(newInputs)
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
    const duplicate = inputs.findIndex((i, idx) => idx !== index && i.name === name)
    if (duplicate !== -1) {
      return 'Variable name must be unique'
    }

    return null
  }

  return (
    <Section
      title="Input Variables"
      description="Connect workflow variables to use as direct variables in your main() function."
      initialOpen={true}
      actions={
        !isReadOnly && (
          <Button variant="ghost" size="xs" onClick={handleAdd}>
            <Plus /> Add
          </Button>
        )
      }>
      <div className="space-y-4">
        {inputs.length > 0 && (
          <div className="space-y-2">
            {inputs.map((input, index) => {
              const error = getNameError(input.name, index)
              const variableSelector = input.variableId // ? input.variableId.split('.') : null

              return (
                <div key={index}>
                  <InputGroup className="flex items-center gap-2">
                    <InputGroupInput
                      className={cn('flex-1', error && 'border-red-500')}
                      disabled={isReadOnly}
                      value={input.name}
                      onChange={(e) => handleNameChange(index, e.target.value)}
                      placeholder="Variable name"
                    />
                    <InputGroupAddon align="inline-end">
                      <VariablePicker
                        value={variableSelector}
                        onChange={(value) =>
                          handleVariableChange(
                            index,
                            typeof value === 'string' ? value : value[0] || ''
                          )
                        }
                        nodeId={nodeId}
                        placeholder="Select variable">
                        {input.variableId ? (
                          <span>
                            <span className="cursor-pointer pointer-events-none">
                              <VariableTag variableId={input.variableId} nodeId={nodeId} />
                            </span>
                          </span>
                        ) : (
                          <Button size="xs" variant="outline" className="py-0 text-xs">
                            Select Variable
                          </Button>
                        )}
                      </VariablePicker>
                    </InputGroupAddon>
                    {!isReadOnly && (
                      <InputGroupAddon align="inline-end">
                        <Button
                          size="icon-xs"
                          variant="destructive-hover"
                          onClick={() => handleRemove(index)}>
                          <Trash2 />
                        </Button>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                  {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                </div>
              )
            })}
          </div>
        )}

        {inputs.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-4">
            No input variables defined. Click the + button to connect workflow variables to your
            code.
          </div>
        )}
      </div>
    </Section>
  )
}

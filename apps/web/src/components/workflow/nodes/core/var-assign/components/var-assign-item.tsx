// apps/web/src/components/workflow/nodes/core/var-assign/components/var-assign-item.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { cn } from '@auxx/ui/lib/utils'
import { Trash2 } from 'lucide-react'
import type React from 'react'
import { useCallback, useState } from 'react'
import { BaseType } from '~/components/workflow/types/unified-types'
import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'
import { VarEditorArray } from '~/components/workflow/ui/input-editor/var-editor-array'
import type { VariableAssignment } from '../types'
import { VarTypeSelector } from './var-type-selector'

interface VarAssignItemProps {
  assignment: VariableAssignment
  onRemove: () => void
  onChange: (assignment: VariableAssignment) => void
  // availableVariables: UnifiedVariable[]
  // variableGroups: VariableGroup[]
  nodeId: string
  readOnly?: boolean
  canDelete?: boolean
  className?: string
}

/**
 * Get placeholder text for constant mode based on type
 */
function getConstantPlaceholder(type: BaseType): string {
  switch (type) {
    case BaseType.STRING:
      return 'Enter text'
    case BaseType.NUMBER:
      return 'Enter number'
    case BaseType.BOOLEAN:
      return 'true or false'
    case BaseType.DATE:
      return 'Select date'
    case BaseType.DATETIME:
      return 'Select date and time'
    case BaseType.OBJECT:
      return 'Enter JSON'
    default:
      return 'Enter value'
  }
}

/**
 * Individual variable assignment item
 */
export const VarAssignItem: React.FC<VarAssignItemProps> = ({
  assignment,
  onRemove,
  onChange,
  // availableVariables,
  // variableGroups,
  nodeId,
  readOnly,
  canDelete = true,
  className,
}) => {
  const [isHovered, setIsHovered] = useState(false)

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('Name changed:', e.target.value)
    onChange({ ...assignment, name: e.target.value })
  }

  const handleTypeChange = useCallback(
    (newType: BaseType, isArray: boolean) => {
      // Initialize appropriate default value based on type and isArray
      let defaultValue: string | string[] = ''
      let updates: Partial<VariableAssignment> = {}

      if (isArray) {
        defaultValue = ['']
        // Preserve constant mode when switching to array
        const preservedMode = assignment.isArray
          ? (assignment.itemConstantModes?.[0] ?? false) // Keep first item's mode if already array
          : (assignment.isConstantMode ?? false) // Use single mode if switching from single
        updates = {
          itemConstantModes: [preservedMode],
          isConstantMode: undefined, // Clear single mode
        }
      } else {
        // Initialize type-specific default values
        if (newType === BaseType.DATE || newType === BaseType.DATETIME) {
          defaultValue = new Date().toISOString()
        } else if (newType === BaseType.BOOLEAN) {
          defaultValue = 'false'
        } else if (newType === BaseType.NUMBER) {
          defaultValue = '0'
        } else if (newType === BaseType.OBJECT) {
          defaultValue = '{}'
        }

        // Preserve constant mode when switching to single value
        const preservedMode = assignment.isArray
          ? (assignment.itemConstantModes?.[0] ?? false) // Use first item's mode if switching from array
          : (assignment.isConstantMode ?? false) // Keep mode if already single
        updates = {
          isConstantMode: preservedMode,
          itemConstantModes: undefined, // Clear array modes
        }
      }

      onChange({
        ...assignment,
        type: newType,
        isArray,
        value: defaultValue,
        ...updates,
      })
    },
    [assignment, onChange]
  )

  const handleValueChange = useCallback(
    (value: string | string[], modes: boolean | boolean[]) => {
      // Determine which field to update based on isArray
      const updates = assignment.isArray
        ? {
            value,
            itemConstantModes: modes as boolean[], // Array modes
            isConstantMode: undefined, // Clear single mode
          }
        : {
            value,
            isConstantMode: modes as boolean, // Single mode
            itemConstantModes: undefined, // Clear array modes
          }

      onChange({
        ...assignment,
        ...updates,
      })
    },
    [assignment, onChange]
  )

  return (
    <div className={cn('mb-2 flex last-of-type:mb-0', className)}>
      <div
        className={cn(
          'grow rounded-xl bg-primary-100 border',
          isHovered && 'bg-destructive/10 border-destructive/20'
        )}>
        <div className='flex items-center p-1 gap-1'>
          <div className='w-0 grow'>
            <Input
              value={assignment.name || ''}
              onChange={handleNameChange}
              placeholder='Variable name'
              disabled={readOnly}
              variant='transparent'
              className='h-6.5 text-sm px-1'
            />
          </div>
          <div className='mx-1 h-4 w-[1px] bg-divider' />
          <div>
            <VarTypeSelector
              value={assignment.type || BaseType.STRING}
              isArray={assignment.isArray}
              onChange={handleTypeChange}
              disabled={readOnly}
            />
          </div>
        </div>
        <div className='border-t border-t-divider p-0.5'>
          {!assignment.isArray ? (
            // Single value: Use VarEditor directly
            <VarEditor
              value={typeof assignment.value === 'string' ? assignment.value : ''}
              onChange={(newValue, isConstant) => handleValueChange(newValue, isConstant)}
              varType={assignment.type}
              nodeId={nodeId}
              disabled={readOnly}
              allowConstant={true}
              isConstantMode={assignment.isConstantMode ?? false}
              onConstantModeChange={(isConstant) => {
                onChange({
                  ...assignment,
                  isConstantMode: isConstant,
                })
              }}
              placeholder='Enter value or use variables'
              placeholderConstant={getConstantPlaceholder(assignment.type)}
            />
          ) : (
            // Array value: Use VarEditorArray
            <VarEditorArray
              value={
                Array.isArray(assignment.value) ? assignment.value : [assignment.value as string]
              }
              onChange={(newValues, newModes) => handleValueChange(newValues, newModes)}
              varType={assignment.type}
              nodeId={nodeId}
              disabled={readOnly}
              allowConstant={true}
              modes={assignment.itemConstantModes}
              placeholder='Enter value or use variables'
              placeholderConstant={getConstantPlaceholder(assignment.type)}
            />
          )}
        </div>
      </div>
      {!readOnly && (
        <Button
          className='ml-1'
          onClick={onRemove}
          variant='destructive-hover'
          size='icon'
          disabled={!canDelete}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}>
          <Trash2 className='size-4' />
        </Button>
      )}
    </div>
  )
}

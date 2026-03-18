// apps/web/src/components/workflow/ui/input-editor/var-editor-array.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ChevronDown, Plus, Trash2, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { BaseType } from '~/components/workflow/types/unified-types'
import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'
import {
  containsVariableReference,
  VARIABLE_PATTERN,
} from '~/components/workflow/utils/variable-utils'
import VariableTag from '../variables/variable-tag'

/**
 * Props for VarEditorArray component
 */
interface VarEditorArrayProps {
  /** Array of string values */
  value: string[]
  /** Callback when values or modes change */
  onChange: (value: string[], modes: boolean[]) => void
  /** Variable type for type-specific inputs */
  varType?: BaseType
  /** Node ID for variable picker context */
  nodeId: string
  /** Disable editing */
  disabled?: boolean
  /** Allow constant mode toggle */
  allowConstant?: boolean
  /** Whether variable mode is available. When false, hides toggle and forces constant mode. */
  allowVariable?: boolean
  /** Placeholder for variable mode */
  placeholder?: string
  /** Placeholder for constant mode */
  placeholderConstant?: string
  /** Current constant modes for each item */
  modes?: boolean[]
}

/**
 * Extract variable ID from a value string like "{{nodeId.path}}"
 */
function extractVariableId(value: string): string | null {
  const match = value.trim().match(/^\{\{([^}]+)\}\}$/)
  return match ? match[1]! : null
}

/**
 * Badge displaying a single array item value in the trigger area
 */
function ArrayItemBadge({
  value,
  isConstant,
  nodeId,
  disabled,
  onRemove,
}: {
  value: string
  isConstant: boolean
  nodeId: string
  disabled?: boolean
  onRemove: () => void
}) {
  // For variable mode, check if this is a pure variable reference
  const variableId = !isConstant ? extractVariableId(value) : null

  // Display content
  const displayContent = useMemo(() => {
    if (variableId) {
      return <VariableTag variableId={variableId} nodeId={nodeId} isShort />
    }
    if (isConstant && value) {
      return <span className='truncate max-w-[120px] text-xs font-medium'>{value}</span>
    }
    // Mixed variable content or non-empty variable mode value
    if (!isConstant && containsVariableReference(value)) {
      // Extract first variable for display
      VARIABLE_PATTERN.lastIndex = 0
      const match = VARIABLE_PATTERN.exec(value)
      if (match?.[1]) {
        return <VariableTag variableId={match[1]} nodeId={nodeId} isShort />
      }
    }
    // Fallback: show raw value truncated
    return (
      <span className='truncate max-w-[120px] text-xs text-muted-foreground'>
        {value || '(empty)'}
      </span>
    )
  }, [variableId, isConstant, value, nodeId])

  return (
    <div className='inline-flex items-center gap-0.5 rounded-md border border-border bg-background px-1 py-0.5 text-xs shadow-xs'>
      {displayContent}
      {!disabled && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className='ml-0.5 hover:text-destructive text-muted-foreground'>
          <X className='size-3' />
        </button>
      )}
    </div>
  )
}

/**
 * A single array item row inside the popover
 */
function ArrayItemRow({
  value,
  mode,
  varType,
  nodeId,
  disabled,
  allowConstant,
  allowVariable,
  placeholder,
  placeholderConstant,
  onChange,
  onRemove,
}: {
  value: string
  mode: boolean
  varType?: BaseType
  nodeId: string
  disabled?: boolean
  allowConstant?: boolean
  allowVariable?: boolean
  placeholder?: string
  placeholderConstant?: string
  onChange: (value: string, isConstant: boolean) => void
  onRemove: () => void
}) {
  return (
    <div className='flex items-start gap-1.5 group px-1'>
      <div className='flex-1'>
        <VarEditor
          value={value}
          onChange={onChange}
          varType={varType}
          nodeId={nodeId}
          disabled={disabled}
          allowConstant={allowConstant}
          allowVariable={allowVariable}
          isConstantMode={mode}
          placeholder={placeholder}
          placeholderConstant={placeholderConstant}
        />
      </div>

      <Button
        size='icon-xs'
        variant='destructive-hover'
        onClick={onRemove}
        disabled={disabled}
        className='mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity'>
        <Trash2 />
      </Button>
    </div>
  )
}

/**
 * VarEditorArray - Manages an array of values with VarEditor in a popover
 *
 * Features:
 * - Compact trigger showing value badges with inline remove
 * - Popover for editing: add/remove items
 * - Each item has independent constant mode
 * - Local state with commit-on-close
 */
export const VarEditorArray: React.FC<VarEditorArrayProps> = ({
  value,
  onChange,
  varType,
  nodeId,
  disabled = false,
  allowConstant = true,
  allowVariable,
  placeholder = 'Enter value or use variables',
  placeholderConstant = 'Enter value',
  modes: externalModes,
}) => {
  const [open, setOpen] = useState(false)

  // Compute resolved modes from external props
  // biome-ignore lint/correctness/useExhaustiveDependencies: value.map is stable; using value.length as trigger
  const resolvedModes = useMemo(() => {
    if (externalModes && externalModes.length === value.length) {
      return externalModes
    }
    return value.map(() => false)
  }, [externalModes, value.length])

  // Local state for popover editing — decoupled from props, committed on close
  const [localValues, setLocalValues] = useState<string[]>(value)
  const [localModes, setLocalModes] = useState<boolean[]>(resolvedModes)
  const localValuesRef = useRef(localValues)
  const localModesRef = useRef(localModes)
  localValuesRef.current = localValues
  localModesRef.current = localModes

  // Sync local state when props change externally (only while closed)
  const prevValueRef = useRef(value)
  const prevModesRef = useRef(resolvedModes)
  if (!open) {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value
      setLocalValues(value)
    }
    if (prevModesRef.current !== resolvedModes) {
      prevModesRef.current = resolvedModes
      setLocalModes(resolvedModes)
    }
  }

  // Handle popover open/close — commit on close
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        onChange(localValuesRef.current, localModesRef.current)
      }
      setOpen(isOpen)
    },
    [onChange]
  )

  // Handle item value change (local only)
  const handleItemChange = useCallback((index: number, newValue: string, isConstant: boolean) => {
    setLocalValues((prev) => {
      const next = [...prev]
      next[index] = newValue
      return next
    })
    setLocalModes((prev) => {
      const next = [...prev]
      next[index] = isConstant
      return next
    })
  }, [])

  // Handle item removal inside popover (local only)
  const handleRemoveItem = useCallback((index: number) => {
    setLocalValues((prev) => prev.filter((_, i) => i !== index))
    setLocalModes((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // Handle adding new item (local only)
  const handleAddItem = useCallback(() => {
    setLocalValues((prev) => [...prev, ''])
    setLocalModes((prev) => [...prev, false])
  }, [])

  // Handle removing a badge from the trigger (immediate commit)
  const handleTriggerRemove = useCallback(
    (index: number) => {
      const newValues = value.filter((_, i) => i !== index)
      const newModes = resolvedModes.filter((_, i) => i !== index)
      // Update local state too
      setLocalValues(newValues)
      setLocalModes(newModes)
      // Commit immediately
      onChange(newValues, newModes)
    },
    [value, resolvedModes, onChange]
  )

  return (
    <div className='flex flex-col gap-1 flex-1'>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild disabled={disabled}>
          <div className='cursor-pointer'>
            {value.length > 0 ? (
              <div className='min-h-7 flex flex-row flex-wrap items-center gap-1 py-1'>
                {value.map((val, index) => (
                  <ArrayItemBadge
                    key={`badge-${index}`}
                    value={val}
                    isConstant={resolvedModes[index] ?? false}
                    nodeId={nodeId}
                    disabled={disabled}
                    onRemove={() => handleTriggerRemove(index)}
                  />
                ))}
              </div>
            ) : (
              <div className='h-7 flex items-center justify-between pe-1'>
                <span className='cursor-default text-sm text-primary-400 font-normal pt-0.5 truncate pointer-events-none'>
                  {placeholder}
                </span>
                <ChevronDown className='size-4 text-foreground opacity-50' />
              </div>
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent className='p-0 w-[320px]' align='start'>
          <div className='flex flex-col'>
            {/* Header */}
            <div className='flex items-center justify-between px-3 py-1.5 border-b'>
              <span className='text-xs font-medium text-muted-foreground'>
                Items ({localValues.length})
              </span>
              <Button size='xs' variant='ghost' onClick={handleAddItem} disabled={disabled}>
                <Plus />
                Add
              </Button>
            </div>

            {/* Item list */}
            <div className='max-h-[300px] overflow-y-auto divide-y'>
              {localValues.map((val, index) => (
                <ArrayItemRow
                  key={`item-${index}`}
                  value={val}
                  mode={localModes[index] ?? false}
                  varType={varType}
                  nodeId={nodeId}
                  disabled={disabled}
                  allowConstant={allowConstant}
                  allowVariable={allowVariable}
                  placeholder={placeholder}
                  placeholderConstant={placeholderConstant}
                  onChange={(v, isConstant) => handleItemChange(index, v, isConstant)}
                  onRemove={() => handleRemoveItem(index)}
                />
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

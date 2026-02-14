// apps/web/src/components/workflow/ui/variables/variable-input.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Variable } from 'lucide-react'
import React, { useCallback, useMemo } from 'react'
import { useVariable } from '~/components/workflow/hooks/use-var-store-sync'
import type { BaseType, UnifiedVariable } from '~/components/workflow/types/variable-types'
import { VariablePicker } from './variable-picker'
import VariableTag from './variable-tag'

/**
 * Props for the VariableInput component
 */
interface VariableInputProps {
  /** The current variable ID */
  variableId: string
  /** Placeholder text when no value is selected */
  placeholder?: string
  /** Additional CSS classes */
  className?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Callback fired when a variable is selected */
  onVariableSelect?: (variable: UnifiedVariable) => void
  /** Node ID to calculate upstream variables for validation */
  nodeId: string
  /** Popover width */
  popoverWidth?: number
  /** Popover height */
  popoverHeight?: number
  /** Show favorites in variable explorer */
  showFavorites?: boolean
  /** Show recent variables in explorer */
  showRecent?: boolean
  /** Search placeholder for variable explorer */
  searchPlaceholder?: string

  allowedTypes?: BaseType[] // Array of allowed BaseType values (e.g., [BaseType.STRING])
}

/**
 * Reusable variable input component that displays a selected variable or placeholder
 * Uses the unified VariablePicker component for variable selection
 */
const VariableInput = React.memo<VariableInputProps>(
  ({
    variableId,
    placeholder = 'Select value',
    className,
    disabled = false,
    onVariableSelect,
    nodeId,
    popoverWidth = 420,
    popoverHeight = 600,
    showFavorites = true,
    showRecent = true,
    searchPlaceholder = 'Search variables...',
    allowedTypes = [],
  }) => {
    // Track the selected variable ID internally if not controlled
    // const [internalVariableId, setInternalVariableId] = useState(variableId)
    // const effectiveVariableId = variableId !== undefined ? variableId : internalVariableId
    // Get the variable from store
    const { variable: selectedVariable, isValid } = useVariable(variableId || '', nodeId)
    // Handle variable selection
    const handleVariableSelect = useCallback(
      (variable: UnifiedVariable) => {
        // Variables are now managed by node updates, not manually added

        // Update internal state if not controlled
        // if (variableId === undefined) {
        //   setInternalVariableId(variable.id)
        // }

        // Call the callback
        if (onVariableSelect) {
          onVariableSelect(variable)
        }
      },
      [onVariableSelect]
    )

    // Memoize the trigger className to avoid recalculation
    const triggerClassName = useMemo(
      () =>
        cn(
          'flex h-9 w-full items-center justify-between text-sm',
          !disabled &&
            'cursor-pointer focus-within:outline-none focus-within:ring-1 focus-within:ring-ring',
          disabled && 'cursor-not-allowed opacity-50',
          className
        ),
      [disabled, className]
    )

    // Memoize the render trigger function
    const renderTrigger = useCallback(
      ({ isOpen, onClick }: { isOpen: boolean; onClick: () => void }) => (
        <div className={triggerClassName} onClick={onClick}>
          {selectedVariable ? (
            <VariableTag variableId={variableId} nodeId={nodeId} isShort />
          ) : (
            <span className='text-muted-foreground'>{placeholder}</span>
          )}
          <Variable className='h-4 w-4 text-muted-foreground' />
        </div>
      ),
      [triggerClassName, selectedVariable, variableId, nodeId, placeholder]
    )

    // If disabled, render as simple display
    if (disabled) {
      return renderTrigger({ isOpen: false, onClick: () => {} })
    }

    // Render with variable picker functionality
    return (
      <VariablePicker
        nodeId={nodeId}
        value={variableId}
        onVariableSelect={handleVariableSelect}
        popoverWidth={popoverWidth}
        popoverHeight={popoverHeight}
        placeholder={searchPlaceholder}
        showFavorites={showFavorites}
        showRecent={showRecent}
        allowedTypes={allowedTypes}
        showFooter={false}
        renderTrigger={renderTrigger}
      />
    )
  }
)

export default VariableInput

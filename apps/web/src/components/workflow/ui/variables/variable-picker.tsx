// apps/web/src/components/workflow/ui/variables/variable-picker.tsx

'use client'

import React, { useState, useCallback, useMemo } from 'react'
import { Popover, PopoverContentDialogAware, PopoverTrigger } from '@auxx/ui/components/popover'
import { VariableExplorerEnhanced } from './variable-explorer-enhanced'
import type { BaseType, UnifiedVariable } from '~/components/workflow/types'
import type { TableId } from '@auxx/lib/workflow-engine/client'
// import { useAvailableVariables } from '~/components/workflow/hooks/use-available-variables'

/**
 * Props for the VariablePicker component
 */
interface VariablePickerProps {
  // Core props
  /** Trigger element for the popover - can be ReactNode or render function */
  children?: React.ReactNode
  /** Render function for trigger - provides isOpen state */
  renderTrigger?: (props: { isOpen: boolean; onClick: () => void }) => React.ReactNode
  /** Controlled open state */
  open?: boolean
  /** Controlled open handler */
  onOpenChange?: (open: boolean) => void

  // Variable selection
  /** Raw variables from useAvailableVariables hook */
  nodeId: string
  /** Callback when a variable is selected */
  onVariableSelect?: (variable: UnifiedVariable) => void

  // Value handling (supports multiple interfaces)
  /** Current value - can be string ({{variable}}) or array (valueSelector) */
  value?: string | string[]
  /** Callback when value changes */
  onChange?: (value: string | string[]) => void

  // UI customization
  /** Popover content width in pixels */
  popoverWidth?: number
  /** Popover content max height in pixels */
  popoverHeight?: number
  /** Placeholder text for variable explorer search */
  placeholder?: string
  /** Popover alignment */
  align?: 'start' | 'center' | 'end'
  /** Popover side */
  side?: 'top' | 'right' | 'bottom' | 'left'

  // Variable explorer options
  /** Show favorites section in variable explorer */
  showFavorites?: boolean
  /** Show recent variables section */
  showRecent?: boolean
  /** Show footer with variable count */
  showFooter?: boolean

  allowedTypes?: (BaseType | TableId)[] // Array of allowed BaseType values (e.g., [BaseType.STRING])
}

/**
 * Unified variable picker component that provides a consistent interface
 * for variable selection across the application.
 *
 * Supports both string value format ({{variable.path}}) and array format
 * (valueSelector) for backward compatibility with existing components.
 *
 * @example
 * ```tsx
 * // Basic usage with string value
 * <VariablePicker
 *   nodeId='node-123'
 *   value={selectedVariable}
 *   onChange={setSelectedVariable}
 * >
 *   <Button variant="outline">Select Variable</Button>
 * </VariablePicker>
 *
 * // Usage with valueSelector array format
 * <VariablePicker
 *   nodeId='node-123'
 *   value={valueSelector}
 *   onChange={(value) => handleValueSelectorChange(value as string[])}
 * >
 * </VariablePicker>
 * ```
 */
export const VariablePicker = React.memo<VariablePickerProps>(
  ({
    children,
    renderTrigger,
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
    nodeId,
    onVariableSelect,
    value,
    onChange,
    popoverWidth = 380,
    popoverHeight = 600,
    placeholder = 'Search variables...',
    align = 'start',
    side = 'bottom',
    showFooter = true,
    allowedTypes = [],
  }) => {
    // Handle controlled/uncontrolled state
    const [internalOpen, setInternalOpen] = useState(false)
    const open = controlledOpen !== undefined ? controlledOpen : internalOpen
    const onOpenChange = useMemo(
      () => controlledOnOpenChange || setInternalOpen,
      [controlledOnOpenChange]
    )
    /**
     * Handle variable selection from the explorer
     */
    const handleVariableSelect = useCallback(
      (variable: UnifiedVariable) => {
        if (value !== undefined && onChange) {
          onChange(variable.id)
        }

        // Call the onVariableSelect callback if provided
        if (onVariableSelect) {
          onVariableSelect(variable)
        }

        // Close the popover
        onOpenChange(false)
      },
      [value, onChange, onVariableSelect, onOpenChange]
    )

    // Memoize trigger click handler
    const handleTriggerClick = useCallback(() => {
      onOpenChange(!open)
    }, [open, onOpenChange])

    // Determine trigger element - memoize to prevent recreation
    const triggerElement = useMemo(() => {
      return renderTrigger ? renderTrigger({ isOpen: open, onClick: handleTriggerClick }) : children
    }, [renderTrigger, open, handleTriggerClick, children])

    // Memoize popover content style to prevent recreating object
    const popoverStyle = useMemo(
      () => ({ width: `${popoverWidth}px`, maxHeight: `${popoverHeight}px` }),
      [popoverWidth, popoverHeight]
    )
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{triggerElement}</PopoverTrigger>
        <PopoverContentDialogAware
          className="w-[420px] max-h-[600px] p-0 overflow-y-auto"
          align={align}
          side={side}
          style={popoverStyle}>
          <VariableExplorerEnhanced
            nodeId={nodeId}
            selected={value}
            onVariableSelect={handleVariableSelect}
            className="h-full relative flex flex-1"
            placeholder={placeholder}
            maxHeight={popoverHeight}
            allowedTypes={allowedTypes}
            onClose={() => onOpenChange(false)}
          />
        </PopoverContentDialogAware>
      </Popover>
    )
  }
)

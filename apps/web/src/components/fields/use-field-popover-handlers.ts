// apps/web/src/components/fields/use-field-popover-handlers.ts

import { useCallback } from 'react'
import { usePropertyContext } from './property-provider'

interface UseFieldPopoverHandlersOptions {
  /** Called after save/cancel completes */
  onClose?: () => void
}

/**
 * Shared handlers for field editor popovers.
 * Used by both FieldInput (drawer) and CellFieldEditor (table).
 */
export function useFieldPopoverHandlers(options?: UseFieldPopoverHandlersOptions) {
  const { cancel, commitAndClose, onBeforeClose, isOutsideClick } = usePropertyContext()

  /**
   * Handle clicking outside the popover - save changes and close
   */
  const handleOutsideEvent = useCallback(() => {
    isOutsideClick.current = false

    // Call onBeforeClose hook if registered (e.g., RelationshipInputField)
    if (onBeforeClose?.current) {
      onBeforeClose.current()
    }

    // Save dirty changes when clicking outside
    commitAndClose()
    options?.onClose?.()
  }, [isOutsideClick, onBeforeClose, commitAndClose, options])

  /**
   * Handle Escape key - cancel changes
   */
  const handleEscapeKey = useCallback(() => {
    cancel()
    options?.onClose?.()
  }, [cancel, options])

  return {
    handleOutsideEvent,
    handleEscapeKey,
  }
}

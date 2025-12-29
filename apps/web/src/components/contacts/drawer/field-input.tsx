// apps/web/src/components/contacts/drawer/field-input.tsx
import { PopoverContent } from '@auxx/ui/components/popover'
import { useCallback, type ReactNode } from 'react'
import { usePropertyContext } from './property-provider'
import { useFieldNavigationOptional } from './field-navigation-context'
import { useFieldPopoverHandlers } from './use-field-popover-handlers'
import { getInputComponentForFieldType } from '../input/get-input-component'
import { getFieldTypeMinWidth, getFieldTypeMaxWidth } from '@auxx/lib/custom-fields/types'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { Popover } from '@auxx/ui/components/popover'

/**
 * field-input.tsx
 * Popover field editor for contact property rows
 *
 * Keyboard behavior:
 * - Enter: Save and close (handled by input components)
 * - Escape: Cancel changes and close
 * - Arrow Up/Down: If popover not capturing, save + close + navigate rows
 */
interface FieldInputProps {
  children: ReactNode
}

export function FieldInput({ children }: FieldInputProps) {
  const { field, isOpen, commitAndClose, onBeforeClose } = usePropertyContext()

  // Optional navigation context (may not be in a navigation provider)
  const nav = useFieldNavigationOptional()

  // Use shared handlers
  const { handleOutsideEvent: baseHandleOutsideEvent, handleEscapeKey } = useFieldPopoverHandlers()

  // Get input component from shared function
  const InputComponent = getInputComponentForFieldType(field.type)

  /**
   * Handle clicking outside - extends base handler with deprecated requestClose
   */
  const handleOutsideEvent = useCallback(() => {
    // Also call deprecated requestClose for backward compat
    // if (requestClose?.current) {
    //   requestClose.current({})
    // }
    baseHandleOutsideEvent()
  }, [baseHandleOutsideEvent])

  /**
   * Handle arrow keys when popover is open
   * If not capturing (text input), close and navigate rows
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // If a popover is capturing keys (Tags, Select, Date), let it handle
      if (nav?.isPopoverCapturing) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()

        // Call onBeforeClose hook if registered (fire-and-forget)
        if (onBeforeClose?.current) {
          onBeforeClose.current()
        }

        // Save and close
        commitAndClose()

        // Navigate to next/prev row
        nav?.moveFocus(e.key === 'ArrowDown' ? 'down' : 'up')
      }
    },
    [nav, onBeforeClose, commitAndClose]
  )

  return (
    <Popover open={isOpen}>
      <PopoverPrimitive.Trigger className="w-full focus:outline-none" asChild>
        <div tabIndex={-1} aria-hidden="true">
          {children}
        </div>
      </PopoverPrimitive.Trigger>

      <PopoverContent
        align="start"
        side="bottom"
        className="p-0 duration-0 rounded-lg"
        style={{
          width: 'var(--radix-popover-trigger-width)',
          minWidth: getFieldTypeMinWidth(field.type),
          maxWidth: getFieldTypeMaxWidth(field.type),
        }}
        sideOffset={-28}
        alignOffset={-5}
        onPointerDownOutside={handleOutsideEvent}
        onEscapeKeyDown={handleEscapeKey}
        onKeyDown={handleKeyDown}>
        <div className="flex flex-col">{InputComponent}</div>
      </PopoverContent>
    </Popover>
  )
}

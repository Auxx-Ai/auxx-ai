// apps/web/src/components/fields/field-input.tsx

import { getFieldTypeMaxWidth, getFieldTypeMinWidth } from '@auxx/lib/custom-fields/types'
import { Popover, PopoverContent } from '@auxx/ui/components/popover'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useFieldNavigationOptional } from './field-navigation-context'
import { getInputComponentForFieldType } from './inputs/get-input-component'
import { usePropertyContext } from './property-provider'
import { useFieldPopoverHandlers } from './use-field-popover-handlers'

/**
 * Height of a standard single-line value row. Used until the trigger has been
 * measured — see `sideOffset` below for why the popover needs the height at all.
 */
const DEFAULT_ROW_HEIGHT = 28

/**
 * Extra lift for wrapped (multiline) values so the *text* lines up, not just the
 * boxes: the editor insets its text by 4px (`py-1`) against the display's 2px
 * (`py-[2px]`), plus ~1px from the popover wrapper — a visible 3px drop on click.
 *
 * Single-line values don't need it. Their display is vertically centered in the
 * 28px row (`items-center`) rather than top-aligned, which already lands the text
 * where the editor puts it; adding the lift there makes the row look raised.
 */
const WRAPPED_TEXT_ALIGN_OFFSET = 3

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
  const InputComponent = getInputComponentForFieldType(field.fieldType)

  // The popover opens `side='bottom'`, so a negative `sideOffset` equal to the
  // trigger's own height lifts it back up to sit exactly ON the row — the editor
  // replaces the value in place rather than dropping below it. This was a fixed
  // -28 (one single-line row); wrapped multiline values are taller, so measure
  // instead or the popover lands near the bottom of the field.
  // Radix exposes `--radix-popover-trigger-width` but no height equivalent.
  const triggerRef = useRef<HTMLDivElement>(null)
  const [triggerHeight, setTriggerHeight] = useState(DEFAULT_ROW_HEIGHT)

  // Same gate `DisplayText` uses to turn on wrapping.
  const wrapsValue = field?.options?.multiline === true

  // Layout effect so the measurement lands before paint — no first-frame jump.
  useLayoutEffect(() => {
    if (!isOpen) return
    const height = triggerRef.current?.offsetHeight
    if (height) setTriggerHeight(height)
  }, [isOpen])

  /**
   * Handle clicking outside - extends base handler with deprecated requestClose
   */
  const handleOutsideEvent = useCallback(() => {
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
      <PopoverPrimitive.Trigger className='w-full focus:outline-none' asChild>
        <div ref={triggerRef} tabIndex={-1} aria-hidden='true'>
          {children}
        </div>
      </PopoverPrimitive.Trigger>

      <PopoverContent
        align='start'
        side='bottom'
        className='p-0 duration-0 rounded-lg'
        style={{
          width: 'var(--radix-popover-trigger-width)',
          minWidth: getFieldTypeMinWidth(field.fieldType),
          maxWidth: getFieldTypeMaxWidth(field.fieldType),
        }}
        sideOffset={-(triggerHeight + (wrapsValue ? WRAPPED_TEXT_ALIGN_OFFSET : 0))}
        alignOffset={-5}
        onPointerDownOutside={handleOutsideEvent}
        // Close (and save) when focus leaves for a layer outside this popover's
        // Radix branch — e.g. the root-level record editor opened from a related
        // record's hover card. Nested layers (inline-create dialog, a select /
        // date sub-popover) register as branches, so Radix skips them here and
        // the field stays open behind them.
        onFocusOutside={handleOutsideEvent}
        onEscapeKeyDown={handleEscapeKey}
        onKeyDown={handleKeyDown}>
        <div className='flex flex-col'>{InputComponent}</div>
      </PopoverContent>
    </Popover>
  )
}

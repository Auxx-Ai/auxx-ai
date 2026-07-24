'use client'

// /Users/mklooth/Sites/auxx-ai/apps/web/src/components/contacts/displays/display-wrapper.tsx

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Copy } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDisplayOnlyContext } from '../display-only-provider'
import { usePropertyContext } from '../property-provider'
import { FieldOptionButton } from './field-option-button'

/**
 * Height cap for wrapped values: 5 lines at `text-sm`'s 20px line-height.
 * Beyond this the value scrolls inside the row instead of growing the panel.
 */
const WRAP_MAX_HEIGHT = 'max-h-[6.25rem]'

/**
 * Right-edge fade that signals horizontally clipped content. Only meaningful in
 * single-line mode — wrapped content has no horizontal overflow, so applying it
 * there paints a phantom fade across the last line.
 */
const HORIZONTAL_FADE_MASK =
  'mask-[linear-gradient(to_right,black_0%,black_calc(100%-40px),transparent_calc(100%-20px),transparent_100%)] mask-size-[160%_100%] mask-position-[60%_0%] group-hover/property-row:mask-position-[100%_0%] transition-[mask-position] duration-200 ease'

/**
 * Helper hook that tries PropertyContext first (editable fields),
 * then falls back to DisplayOnlyContext (read-only display).
 */
function useFieldContext() {
  try {
    return usePropertyContext()
  } catch {
    return useDisplayOnlyContext()
  }
}

/**
 * DisplayWrapperProps interface
 * Defines the props accepted by DisplayWrapper
 */
interface DisplayWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  className?: string
  innerClassName?: string
  buttons?: ReactNode[]
  copyValue?: string | null
  /**
   * Let the value wrap onto multiple lines instead of clipping to one, capped at
   * {@link WRAP_MAX_HEIGHT} with an internal scroll. Opt-in per field type —
   * everything else stays single-line.
   */
  wrap?: boolean
}

/**
 * DisplayWrapper component
 * A container component for display fields that provides consistent styling while hosting optional action buttons
 */
function DisplayWrapper({
  children,
  className,
  innerClassName,
  buttons,
  copyValue,
  wrap = false,
  ...props
}: DisplayWrapperProps) {
  const { value } = useFieldContext()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return

    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const resolvedCopyValue = useMemo(() => {
    if (typeof copyValue === 'string') return copyValue
    if (copyValue === null) return null
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    return null
  }, [copyValue, value])

  const handleCopy = useCallback(
    async (event?: MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation?.()
      if (!resolvedCopyValue) return

      try {
        await navigator.clipboard.writeText(resolvedCopyValue)
        setCopied(true)
      } catch (error) {
        console.error('Failed to copy field value', error)
      }
    },
    [resolvedCopyValue]
  )

  const renderedButtons = useMemo(() => {
    const extraButtons = buttons ?? []
    const copyButton = resolvedCopyValue ? (
      <FieldOptionButton key='copy' label={copied ? 'Copied' : 'Copy'} onClick={handleCopy}>
        {copied ? <Check className='size-2.5' /> : <Copy className='size-2.5' />}
      </FieldOptionButton>
    ) : null

    return copyButton ? [...extraButtons, copyButton] : extraButtons
  }, [buttons, copied, handleCopy, resolvedCopyValue])

  const valueSlot = (
    <div
      data-slot='field-display-value'
      className={cn(
        'h-fit py-[2px] text-neutral-900 dark:text-neutral-50',
        // Block (not flex) when wrapping: a raw string child of a flex container
        // becomes an anonymous item that won't shrink below its content width.
        wrap
          ? 'block w-full min-w-0 whitespace-pre-wrap break-words'
          : 'content-center items-center flex whitespace-nowrap text-ellipsis',
        innerClassName
      )}>
      {children}
    </div>
  )

  return (
    <div data-slot='field-display' className='relative flex-1 overflow-hidden '>
      <div className='group-hover/property-row:dark:bg-foreground/8 group-hover/property-row:bg-neutral-100 rounded-md flex items-start w-full gap-2 '>
        <div
          data-slot='field-display-content'
          className={cn(
            'rounded-md px-1 w-full overflow-hidden h-auto min-h-[28px] flex', // group-hover:bg-neutral-200 group-hover:dark:bg-foreground/8
            wrap ? 'items-start' : cn('items-center', HORIZONTAL_FADE_MASK),
            className
          )}
          {...props}>
          {wrap ? (
            // `max-h` belongs on the viewport, not the root — otherwise the root
            // clips without ever scrolling (see ScrollArea's own doc comment).
            // `allowScrollChaining` keeps the record panel scrolling once this
            // field bottoms out instead of trapping the wheel.
            <ScrollArea
              className='w-full'
              viewportClassName={WRAP_MAX_HEIGHT}
              scrollbarClassName='w-1.5'
              allowScrollChaining>
              {valueSlot}
            </ScrollArea>
          ) : (
            valueSlot
          )}
        </div>
      </div>
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0.5 flex pr-2',
          wrap ? 'items-start pt-1' : 'items-center'
        )}>
        {renderedButtons.length > 0 && (
          <div className='pointer-events-auto flex items-center gap-0.5 shrink-0 absolute right-0 opacity-0 group-hover/property-row:opacity-100 transition-opacity duration-600 ease-out'>
            {renderedButtons.map((button, index) => (
              <div key={index}>{button}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DisplayWrapper

'use client'
// /Users/mklooth/Sites/auxx-ai/apps/web/src/components/contacts/displays/display-wrapper.tsx

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { usePropertyContext } from '../property-provider'
import { FieldOptionButton } from './field-option-button'
import { cn } from '@auxx/ui/lib/utils'

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
  ...props
}: DisplayWrapperProps) {
  const { value } = usePropertyContext()
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
      <FieldOptionButton key="copy" label={copied ? 'Copied' : 'Copy'} onClick={handleCopy}>
        {copied ? <Check className="size-2.5" /> : <Copy className="size-2.5" />}
      </FieldOptionButton>
    ) : null

    return copyButton ? [...extraButtons, copyButton] : extraButtons
  }, [buttons, copied, handleCopy, resolvedCopyValue])

  return (
    <div className="relative flex-1 overflow-hidden ">
      <div className="group-hover/property-row:dark:bg-foreground/8 group-hover/property-row:bg-neutral-100 rounded-md flex items-start w-full gap-2 ">
        <div
          className={cn(
            'rounded-md px-1 w-full overflow-hidden h-auto min-h-[28px] flex items-center mask-[linear-gradient(to_right,black_0%,black_calc(100%-40px),transparent_calc(100%-20px),transparent_100%)] mask-size-[160%_100%] mask-position-[60%_0%] group-hover/property-row:mask-position-[100%_0%] transition-[mask-position] duration-200 ease', // group-hover:bg-neutral-200 group-hover:dark:bg-foreground/8
            className
          )}
          {...props}>
          <div
            className={cn(
              'content-center items-center h-fit flex  whitespace-nowrap py-[2px] text-ellipsis text-neutral-900 dark:text-neutral-50',
              innerClassName
            )}>
            {children}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0.5 flex items-center pr-2">
        {renderedButtons.length > 0 && (
          <div className="pointer-events-auto flex items-center gap-0.5 shrink-0 absolute right-0 opacity-0 group-hover/property-row:opacity-100 transition-opacity duration-600 ease-out">
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

// apps/web/src/components/shared/mode-badge.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { ComponentPropsWithRef } from 'react'

interface ModeBadgeProps extends ComponentPropsWithRef<'button'> {
  /** Full text, e.g. "Required". Collapses to its first letter until hovered. */
  label: string
  /**
   * Collapse only at the `@sm` container breakpoint (full label below it).
   * Requires an `@container` ancestor. Defaults to always-collapse.
   */
  responsive?: boolean
}

/**
 * Inline pill that shows only its first letter and expands to the full label on
 * hover — the shared form of the `RelationUpdateModeButton` / `AutoResolveBadge`
 * idiom. Pure presentation: callers supply the tint (via `className`) and
 * behavior (`onClick` / `onContextMenu`). Forwards its ref + extra button props
 * so it can act as a Radix `asChild` trigger.
 *
 * The first letter is always rendered; the remainder lives in its own span that
 * collapses to zero width and expands on hover (`max-w-0 → max-w-20`). Splitting
 * the first letter out means the collapsed width is exactly "first letter +
 * padding" — no magic px, no second-letter sliver. See plans/chat/v6 phase-4
 * redesign.
 */
export function ModeBadge({
  label,
  responsive = false,
  className,
  disabled,
  ref,
  ...props
}: ModeBadgeProps) {
  return (
    <button
      ref={ref}
      type='button'
      disabled={disabled}
      aria-label={label}
      className={cn(
        'group/mode flex h-5 shrink-0 items-center rounded-md px-1',
        'text-[10px] font-semibold uppercase leading-none',
        'select-none whitespace-nowrap',
        disabled ? 'cursor-default' : 'cursor-pointer',
        className
      )}
      {...props}>
      <span>{label.charAt(0)}</span>
      <span
        className={cn(
          'overflow-hidden whitespace-nowrap transition-[max-width] duration-200 ease-out',
          responsive
            ? '@sm:max-w-0 @sm:group-hover/mode:max-w-20'
            : 'max-w-0 group-hover/mode:max-w-20'
        )}>
        {label.slice(1)}
      </span>
    </button>
  )
}

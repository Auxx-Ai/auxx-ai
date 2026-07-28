// packages/ui/src/components/row-slide-actions.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type * as React from 'react'

/**
 * Tailwind group names a row may declare for {@link RowSlideActions}.
 *
 * Closed union because Tailwind's JIT cannot generate `group-hover/${dynamic}`
 * from a runtime value — every class has to exist literally in source. The union
 * doubles as the registry of rows that opt into the slide affordance; adding a
 * consumer is a one-line edit here plus an entry in `slideClassNames`.
 */
export type RowSlideActionsGroup = 'cmd-item' | 'row' | 'tag' | 'file' | 'link'

const slideClassNames: Record<RowSlideActionsGroup, string> = {
  'cmd-item': 'group-hover/cmd-item:translate-x-0 group-focus-within/cmd-item:translate-x-0',
  row: 'group-hover/row:translate-x-0 group-focus-within/row:translate-x-0',
  tag: 'group-hover/tag:translate-x-0 group-focus-within/tag:translate-x-0',
  file: 'group-hover/file:translate-x-0 group-focus-within/file:translate-x-0',
  link: 'group-hover/link:translate-x-0 group-focus-within/link:translate-x-0',
}

/**
 * Props for {@link RowSlideActions}.
 */
export interface RowSlideActionsProps {
  /**
   * Tailwind group name the parent row declared, WITHOUT the `group/` prefix —
   * e.g. `'cmd-item'` for a row marked `group/cmd-item`.
   */
  group: RowSlideActionsGroup
  /** Render in normal flow instead of sliding — for rows that always show their actions. */
  static?: boolean
  children: React.ReactNode
  className?: string
}

/**
 * Hover/focus-revealed action cluster that slides in from a row's right edge.
 *
 * The cluster is absolutely positioned against the row's padding box and parked
 * at `translate-x-full`, so it sizes itself to whatever actions it holds — no
 * fixed width, any button count. The parent row must declare the matching
 * `group/<name>` plus `relative overflow-hidden`; the 4px gradient lets the row
 * label slide cleanly underneath.
 *
 * @example
 * ```tsx
 * <div className='group/row relative overflow-hidden'>
 *   <span>{name}</span>
 *   <RowSlideActions group='row'>
 *     <Button variant='ghost' size='icon-xs'><Pencil /></Button>
 *   </RowSlideActions>
 * </div>
 * ```
 */
export function RowSlideActions({
  group,
  static: isStatic = false,
  children,
  className,
}: RowSlideActionsProps) {
  if (isStatic) {
    return <div className={cn('ml-auto flex items-center gap-0.5', className)}>{children}</div>
  }

  return (
    <div
      className={cn(
        'absolute inset-y-0 right-0 flex translate-x-full items-center transition-transform duration-200 ease-out',
        slideClassNames[group],
        className
      )}>
      <div className='h-full w-4 bg-gradient-to-r from-transparent to-accent/50 dark:to-[#404754]/50' />
      {/* pr-1 matches the inline-end padding a row gives its own static trailing
          content, so the last action lands on the same right edge as whatever it
          slides over (e.g. a selection check). */}
      <div className='flex items-center gap-0.5 bg-accent/50 pr-1 dark:bg-[#404754]/50'>
        {children}
      </div>
    </div>
  )
}

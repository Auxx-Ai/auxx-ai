// packages/ui/src/components/list-toolbar.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'

interface ListToolbarProps extends React.ComponentProps<'div'> {
  /** Stick to the top of the scroll container with backdrop blur. Default true. */
  sticky?: boolean
}

/**
 * Canonical view-settings row for list pages. Folds the sticky `backdrop-blur`
 * wrapper and the bordered bar into one component. Compose its content with
 * `ListToolbarGroup` (left/right clusters) and a raw `InputSearch` (center,
 * already `flex-1`) in source order:
 *
 * ```tsx
 * <ListToolbar>
 *   <ListToolbarGroup>{filters}</ListToolbarGroup>
 *   <InputSearch … />
 *   <ListToolbarGroup align='end'>{toggles}</ListToolbarGroup>
 * </ListToolbar>
 * ```
 */
export function ListToolbar({ sticky = true, className, children, ...props }: ListToolbarProps) {
  return (
    <div
      data-slot='list-toolbar'
      className={cn(sticky && 'sticky top-0 z-10 shrink-0 backdrop-blur-sm', className)}
      {...props}>
      <div className='flex w-full items-center gap-1.5 overflow-x-auto border-b bg-background/80 px-3 py-2 no-scrollbar'>
        {children}
      </div>
    </div>
  )
}

/**
 * A cluster of controls inside a `ListToolbar`. `align='end'` self-pins the group
 * (and everything after it) to the right via `ml-auto` — works with or without a
 * center search field.
 */
export function ListToolbarGroup({
  align = 'start',
  className,
  ...props
}: React.ComponentProps<'div'> & { align?: 'start' | 'end' }) {
  return (
    <div
      data-slot='list-toolbar-group'
      data-align={align}
      className={cn('flex items-center gap-1.5 data-[align=end]:ml-auto', className)}
      {...props}
    />
  )
}

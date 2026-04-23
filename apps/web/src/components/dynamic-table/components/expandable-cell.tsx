// apps/web/src/components/dynamic-table/components/expandable-cell.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'

/**
 * Expansion behavior when this cell becomes the active (single-cell) selection.
 * - text:       single-line ellipsis collapsed; wraps + grows down when active.
 * - horizontal: single-line ellipsis collapsed; grows right (no wrap) when active.
 * - items:      horizontal flex with right-edge fade collapsed; flex-wrap when active.
 * - static:     no expansion. Same padding baseline only.
 *
 * Multi-cell selection automatically suppresses expansion via `:has(.cell-in-range)`
 * on the cell container in `table.css` — pure CSS, zero per-cell JS.
 */
export type ExpandMode = 'text' | 'horizontal' | 'items' | 'static'

interface ExpandableCellProps {
  children: React.ReactNode
  mode?: ExpandMode
  className?: string
}

/**
 * Collapsed (default) layout for each mode. The expanded layout is owned by
 * the `[data-expand=...]` rules in `table.css`, which key off `.cell-active`
 * on the parent `SelectableTableCell`.
 */
const COLLAPSED: Record<ExpandMode, string> = {
  text: 'flex items-center w-full overflow-hidden text-ellipsis whitespace-nowrap pl-3 pr-2',
  horizontal: 'flex items-center w-full overflow-hidden text-ellipsis whitespace-nowrap pl-3 pr-2',
  items:
    'flex items-center gap-1 w-full overflow-hidden ps-3 py-0.5 mask-r-from-[calc(100%-32px)] mask-r-to-[100%]',
  static: 'flex items-center w-full pl-3 pr-2',
}

/**
 * Single-subtree wrapper used by every cell renderer. Owns row height, padding,
 * and signals the desired expansion mode via `data-expand`. Renders `{children}`
 * exactly once — there is no separate "expanded" subtree.
 */
export function ExpandableCell({ children, mode = 'text', className }: ExpandableCellProps) {
  return (
    <div data-slot='expandable-cell' className='relative flex w-full min-h-9 text-sm'>
      <div data-expand={mode} className={cn(COLLAPSED[mode], className)}>
        {children}
      </div>
    </div>
  )
}

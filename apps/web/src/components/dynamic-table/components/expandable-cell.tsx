// apps/web/src/components/dynamic-table/components/expandable-cell.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useCellActive } from '../context/cell-active-context'
import { FillHandle } from './fill-handle'

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
  // Truncation rules for collapsed text/horizontal modes are in `table.css`
  // (target `[data-expand=text/horizontal] > *`) — they need to compose with
  // the expansion rules without Tailwind specificity surprises.
  text: 'flex items-center w-full pl-3 pr-2 min-w-0',
  horizontal: 'flex items-center w-full pl-3 pr-2 min-w-0',
  items:
    'flex items-center gap-1 w-full overflow-hidden ps-3 py-0.5 mask-r-from-[calc(100%-32px)] mask-r-to-[100%]',
  static: 'flex items-center w-full pl-3 pr-2',
}

/**
 * Single-subtree wrapper used by every cell renderer. Owns row height, padding,
 * and signals the desired expansion mode via `data-expand`. Renders `{children}`
 * exactly once — there is no separate "expanded" subtree.
 *
 * Raw string/number children are wrapped in a span so the truncate CSS rule
 * (`[data-expand=text/horizontal] > *`) — which only matches element children,
 * not text nodes — still applies.
 */
export function ExpandableCell({ children, mode = 'text', className }: ExpandableCellProps) {
  const { isActive, isEditing } = useCellActive()

  const needsSpanWrap =
    (mode === 'text' || mode === 'horizontal') &&
    (typeof children === 'string' || typeof children === 'number')

  // FillHandle lives inside the data-expand element so its `absolute` positioning
  // resolves against whichever element is the nearest positioned ancestor:
  // - Collapsed: data-expand is `position: static`, fill handle falls back to
  //   the ExpandableCell wrapper (`position: relative`) — bottom-right of cell.
  // - Expanded: data-expand becomes `position: absolute`, fill handle resolves
  //   against it — bottom-right of the expanded element.
  // CSS in `table.css` further suppresses the handle in multi-cell range or
  // during fill-drag (matching the same `:has(...)` chain as expansion).
  const showFillHandle = isActive && !isEditing && mode !== 'static'

  return (
    <div data-slot='expandable-cell' className='relative flex w-full min-h-9 text-sm'>
      <div data-expand={mode} className={cn(COLLAPSED[mode], className)}>
        {needsSpanWrap ? <span>{children}</span> : children}
        {showFillHandle && <FillHandle />}
      </div>
    </div>
  )
}

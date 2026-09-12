// apps/web/src/components/line-grid/ui/line-row-menu.tsx
'use client'

// The row-level `⋯` menu SHELL, generalized out of money's `LineRowMenu`
// (line-builder/line-rows.tsx) - the item set is money-specific (description,
// category, images, ...), but the shell around it (the trigger, the focus
// handling, the destructive delete item) is not, and money/tasks/56 needs the
// same shell for the return lines card's own, smaller item set.
//
// 🔑 The rule the intake screen learned the hard way (money/tasks/38) stays
// documented here: ONE `⋯` per row. A screen with its own vocabulary adds
// items as `children`, never a second menu button beside this one.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Ellipsis, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

export interface LineRowMenuProps {
  /** The row's own items, rendered above the delete separator. */
  children: ReactNode
  onDelete: () => void
  /** Defaults to `'Delete line'`. */
  deleteLabel?: string
}

/**
 * Row-level `⋯` actions menu shell. Every behaviour below is load-bearing and
 * must survive a consumer's own item set unchanged:
 *
 * - The trigger is a `TreeRowButton` with `persistent` (visible even without
 *   row hover - the row's only entry point back into its own menu) and
 *   `tabIndex={-1}` (mouse/touch only, never in the spreadsheet Tab order).
 * - `onMouseDown` preventDefault on the trigger: opening the menu must not
 *   blur (and collapse) a focused cell input. Radix opens on pointerdown,
 *   which fires before mousedown, so the menu still opens.
 * - `align='end'` so the menu hangs off the row's trailing edge.
 * - `onCloseAutoFocus` prevented on the content: the trigger is mouse-only
 *   (`tabIndex={-1}`), and restoring focus to it on close would steal focus
 *   from an editor the menu itself just opened (e.g. "Add description"
 *   autofocusing its textarea).
 * - The destructive delete item, with its `⌫` shortcut, always last, after a
 *   separator from the caller's own items.
 */
export function LineRowMenu({ children, onDelete, deleteLabel = 'Delete line' }: LineRowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TreeRowButton
          persistent
          tabIndex={-1}
          tooltipText='Line actions'
          className='ml-auto'
          onMouseDown={(e) => e.preventDefault()}>
          <Ellipsis />
        </TreeRowButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' onCloseAutoFocus={(e) => e.preventDefault()}>
        {children}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant='destructive' onSelect={onDelete}>
          <Trash2 />
          {deleteLabel}
          <MenuShortcut keys={['⌫']} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Right-aligned shortcut hint in a `⋯` menu item - the platform modifier + literal keys. */
export function MenuShortcut({ keys }: { keys: string[] }) {
  return (
    <KbdGroup variant='outline' size='sm' className='ml-auto'>
      <Kbd shortcut='meta' />
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}

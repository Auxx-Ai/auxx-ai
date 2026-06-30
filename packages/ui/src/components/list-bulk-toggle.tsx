// packages/ui/src/components/list-bulk-toggle.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { CheckSquare } from 'lucide-react'

interface ListBulkToggleProps {
  /** Whether bulk-select mode is active. */
  active: boolean
  /** Called with the next active state when the button is pressed. */
  onActiveChange: (active: boolean) => void
  className?: string
}

/**
 * The list-toolbar "Select" toggle — flips a list page into bulk-select mode.
 * Drop into a `ListToolbarGroup align='end'`. Pairs with `ListCard`'s
 * `selectable`/`selecting` props and a floating `ActionBar` for the actions.
 */
export function ListBulkToggle({ active, onActiveChange, className }: ListBulkToggleProps) {
  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size='xs'
      className={cn('shrink-0', className)}
      onClick={() => onActiveChange(!active)}>
      <CheckSquare />
      {active ? 'Done' : 'Select'}
    </Button>
  )
}

// apps/web/src/components/apps/ui/connection-list.tsx

'use client'

import { Card, CardContent } from '@auxx/ui/components/card'
import type { ReactNode } from 'react'

interface ConnectionListProps {
  isLoading?: boolean
  emptyMessage?: ReactNode
  /** Pre-rendered `<ConnectionRow/>` children. */
  children: ReactNode
}

/**
 * Card + divider wrapper for a list of connections. Used by both
 * `AppConnections` and `AppAccountPicker`.
 * See plans/kopilot/apps/app-settings-dialog-refactor.md §5.3.
 */
export function ConnectionList({ isLoading, emptyMessage, children }: ConnectionListProps) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <Card>
      <CardContent className='space-y-3 pt-3'>
        {isLoading ? (
          <div className='text-sm text-muted-foreground py-4 text-center'>Loading…</div>
        ) : hasChildren ? (
          <div className='divide-y'>{children}</div>
        ) : (
          <div className='text-sm text-muted-foreground py-4 text-center'>{emptyMessage}</div>
        )}
      </CardContent>
    </Card>
  )
}

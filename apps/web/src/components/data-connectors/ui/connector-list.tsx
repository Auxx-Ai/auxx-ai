// apps/web/src/components/data-connectors/ui/connector-list.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { ConnectorCard, ConnectorFallbackIcon } from './connector-card'

interface ConnectorListProps {
  /** Opens the "Connect a source" picker (owned by the page; also in the header). */
  onConnect: () => void
}

/**
 * Connectors list — a card grid (status dot, last-synced, item count, per-stream
 * counts; Open / Sync now / Pause·Resume / Delete menu). The list is the index of
 * `/app/connectors`; each card links to the detail view. The "Connect a source"
 * action lives in the page header; `onConnect` opens its picker.
 * See plans/data-connectors/claude/05-frontend.md §1.
 */
export function ConnectorList({ onConnect }: ConnectorListProps) {
  const connectors = api.dataConnector.list.useQuery()

  const rows = connectors.data ?? []

  return (
    <div className='flex flex-1 flex-col gap-4 p-4'>
      {connectors.isLoading ? (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {[0, 1, 2].map((i) => (
            <div key={i} className='h-28 animate-pulse rounded-2xl border bg-muted/30' />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ConnectorFallbackIcon}
          title='No connectors yet'
          description='Connect a source to sync external structured records into your entity system.'
          button={
            <Button size='sm' onClick={onConnect}>
              <Plus />
              Connect a source
            </Button>
          }
        />
      ) : (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {rows.map((connector) => (
            <ConnectorCard key={connector.id} connector={connector} />
          ))}
        </div>
      )}
    </div>
  )
}

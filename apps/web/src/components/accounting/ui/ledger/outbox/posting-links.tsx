// apps/web/src/components/accounting/ui/ledger/outbox/posting-links.tsx

'use client'

import { RecordBadge } from '~/components/resources/ui/record-badge'
import { api } from '~/trpc/react'
import { MovementBadge } from '../../movement-badge'
import { LedgerSourceLink } from '../ledger-source-link'

/**
 * One row of badges, one badge row tall: a badge that does not fit wraps onto a
 * hidden second line and disappears whole rather than clipped. `box-content
 * p-px` keeps a badge's 1px ring inside the clip box.
 */
export const BADGE_ROW_CLASS =
  'box-content flex h-4 min-w-0 flex-wrap items-center gap-1 overflow-hidden p-px'

/** The records a posting is about, as badges: its subject, its `parent` and `counterparty` links. */
export function PostingLinks({ glPostingId }: { glPostingId: string }) {
  const sourcesQuery = api.ledger.postingSources.useQuery({ glPostingId })
  const sources = sourcesQuery.data ?? []
  if (sources.length === 0) return null
  return (
    <span className={BADGE_ROW_CLASS}>
      {sources.map((source) =>
        source.recordId ? (
          <RecordBadge
            key={source.id}
            recordId={source.recordId}
            size='sm'
            showResourceLabel={source.sourceKind === 'stock_movement'}
          />
        ) : source.movement ? (
          <MovementBadge key={source.id} movement={source.movement} size='sm' detail='compact' />
        ) : (
          <LedgerSourceLink
            key={source.id}
            sourceKind={source.sourceKind}
            sourceId={source.sourceId}
          />
        )
      )}
    </span>
  )
}

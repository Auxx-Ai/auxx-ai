// apps/web/src/components/money/ui/credit-memo/credit-memo-ledger-card.tsx
'use client'

// `credit_memo:ledger`. Batch posting is gone (accounting migration step 1b):
// a credit memo posts its own entry at issue, subject-linked to the memo on
// `GlPostingSource` (TARGET §1), so this reads through the same
// `listPostingsForSource` mechanism the generic `LedgerCard` does.
//
// Kept as its own component rather than collapsed into `LedgerCard` because
// step 1c is where that collapse happens across every registration at once
// (`ledger-card-registrations.tsx`); this file's fallback below already
// renders the generic card when there is nothing to show.
//
// ⚠️ A REVERSED posting is kept and shown, never hidden - reversing is the
// documented way to undo an issue, and a memo whose entry was reversed is
// unposted again. A card that dropped the reversed row would make that look
// like the entry was never made.

import { CREDIT_MEMO_SOURCE_TYPE } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { BookOpenCheck } from 'lucide-react'
import { useState } from 'react'
import { LedgerCard, PostingLinesDialog } from '~/components/accounting/ui/ledger-card'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'

export function CreditMemoLedgerCard(props: DrawerTabProps) {
  const { entityInstanceId } = props
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const [openPostingId, setOpenPostingId] = useState<string | null>(null)

  const postingsQuery = api.money.creditMemoPostings.useQuery(
    { creditMemoId: entityInstanceId },
    { enabled: !!entityInstanceId }
  )
  const postings = postingsQuery.data ?? []
  const loading = postingsQuery.isPending

  if (!loading && postings.length === 0) {
    return <LedgerCard {...props} sourceKind={CREDIT_MEMO_SOURCE_TYPE} />
  }

  return (
    <>
      <TreeRowList
        items={postings}
        loading={loading}
        skeletonCount={1}
        getKey={(posting) => posting.id}
        renderRow={(posting) => (
          <TreeRow
            className={TREE_SECONDARY_NOTRUNCATE}
            icon={<BookOpenCheck className='size-4' />}
            title={
              <span className='truncate font-mono text-sm'>
                {posting.docNumber || 'Not numbered'}
              </span>
            }
            secondary={
              posting.status === 'reversed' ? (
                <Badge variant='amber' size='xs'>
                  Reversed
                </Badge>
              ) : undefined
            }
            onToggleOpen={() => setOpenPostingId(posting.id)}
          />
        )}
      />

      <PostingLinesDialog
        postingId={openPostingId}
        onOpenChange={(open) => !open && setOpenPostingId(null)}
        currencyCode={currencyCode}
      />
    </>
  )
}

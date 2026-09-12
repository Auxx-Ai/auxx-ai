// apps/web/src/components/money/ui/credit-memo/credit-memo-ledger-card.tsx
'use client'

// `credit_memo:ledger`, read by STAMP rather than by source line
// (plans/accounting/tasks/25-batch-posting-and-credit-memos.md §3.3, §4).
//
// 🛑 **Why this card cannot just be `<LedgerCard sourceType='credit_memo' />`.**
// That card asks "which postings have a line naming this record as their
// source?", which was the right question while one memo produced one entry. A
// bulk credit memo posting summarises a whole month into one entry whose
// contra-revenue and tax lines carry `credit_memo_batch` with the PERIOD KEY as
// their source, and whose receivable legs carry `contact` (the A/R leg stays per
// counterparty, §3.1 item 2). No line in that entry names the memo, so the source
// lookup finds nothing for a memo that is perfectly well posted.
//
// The stamp is the memo's own end of the link: `credit_memo_gl_posting` holds the
// `GlPosting` id the memo was recognised in, whether that entry covers one memo
// or four hundred. `order-fulfillment-ledger-card.tsx` is the same read for the
// same reason.
//
// ⚠️ A REVERSED stamp is kept and shown, never hidden. Reversing the batch is the
// documented way to undo it (§2.1), and a memo whose entry was reversed is
// unposted - it re-enters the next preview by construction (§4.2). A card that
// dropped the reversed row would make that look like the entry was never made.
//
// ## The fallback, and what it is for
//
// A memo with no stamp falls back to the source-line card. Data migration 152
// backfills the stamp from the existing per-memo postings, so this is not about
// history - it is about the single-memo door, which posts its own entry and does
// not stamp. For those memos the generic card is strictly better anyway: it lists
// the issue entry AND its reversal after a void, and carries the Retry export
// action. Nothing is lost, and neither path can leave a posted memo looking
// unposted.

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

  const stampsQuery = api.money.creditMemoPostings.useQuery(
    { creditMemoId: entityInstanceId },
    { enabled: !!entityInstanceId }
  )
  const stamps = stampsQuery.data ?? []
  const loading = stampsQuery.isPending

  // 🛑 `CREDIT_MEMO_SOURCE_TYPE` from the builder that files the lines, not the
  // string `'credit_memo'` this file used to hold: §3.3 asked for the match to be
  // by construction rather than by convention, and this is where it is made.
  if (!loading && stamps.length === 0) {
    return <LedgerCard {...props} sourceType={CREDIT_MEMO_SOURCE_TYPE} />
  }

  return (
    <>
      <TreeRowList
        items={stamps}
        loading={loading}
        skeletonCount={1}
        getKey={(stamp) => stamp.glPostingId}
        renderRow={(stamp) => (
          <TreeRow
            className={TREE_SECONDARY_NOTRUNCATE}
            icon={<BookOpenCheck className='size-4' />}
            title={
              <span className='truncate font-mono text-sm'>
                {stamp.docNumber ?? 'Not numbered'}
              </span>
            }
            secondary={
              stamp.status === 'reversed' ? (
                <Badge variant='amber' size='xs'>
                  Reversed
                </Badge>
              ) : undefined
            }
            onToggleOpen={() => setOpenPostingId(stamp.glPostingId)}
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

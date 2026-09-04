// apps/web/src/components/accounting/ui/banking/review/match-panel.tsx

'use client'

import {
  type BankTransactionRow,
  MATCH_RECORD_TYPE_LABELS,
  type MatchCandidate,
} from '@auxx/lib/banking/review/client'
import { Badge } from '@auxx/ui/components/badge'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { FileCheck2, Link2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'
import { formatMinor } from '../../ledger/format'

interface MatchPanelProps {
  line: BankTransactionRow
  currencyCode: string
  onDone: () => void
}

/**
 * The default treatment, and the one that posts NOTHING
 * (plans/bank-connection/03-categorization-and-gl.md §3.1, decision **B5**).
 *
 * 🛑 This is where the plan most obviously diverges from QuickBooks, and it is
 * the right divergence. In QuickBooks the bank feed is often the only source, so
 * accepting a line CREATES the expense. Here the subledger is the system of
 * record and the bank feed is corroboration: a bank line that creates a fresh
 * expense when a vendor payment already exists credits cash twice, and both
 * entries balance, so nothing downstream detects it.
 *
 * So matching links the two, dates the movement, and marks the document
 * confirmed by a bank line. It writes no `GlPosting` at all.
 *
 * The list is `role-map-editor.tsx`'s idiom - `InputSearch` over a `ScrollArea`
 * of `TreeRow`s with a `TreeRowButton` per row - because it is the same shape of
 * decision: a searchable list where the action lives on the row.
 */
export function MatchPanel({ line, currencyCode, onDone }: MatchPanelProps) {
  const utils = api.useUtils()
  const [search, setSearch] = useState('')
  const [blockers, setBlockers] = useState<LedgerBlocker[]>([])

  const candidates = api.bankingReview.candidates.useQuery({
    id: line.id,
    search: search.trim() || undefined,
  })

  const match = api.bankingReview.match.useMutation({
    onSuccess: async () => {
      setBlockers([])
      await Promise.all([
        utils.bankingReview.list.invalidate(),
        utils.bankingReview.stats.invalidate(),
        utils.bankingReview.get.invalidate({ id: line.id }),
        utils.bankingReview.history.invalidate({ id: line.id }),
      ])
      onDone()
    },
    onError: (error) => setBlockers([{ status: 'error', error: error.message }]),
  })

  const rows = candidates.data ?? []

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-muted-foreground text-sm'>
        Matching links this bank line to something you already recorded. It posts nothing - the
        document&apos;s own entry already moved the money, and a second one would move it twice.
      </p>

      <InputSearch
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder='Search for anything else'
      />

      <ScrollArea className='max-h-96'>
        <TreeRowList
          items={rows}
          loading={candidates.isPending}
          skeletonCount={3}
          getKey={(row: MatchCandidate) => `${row.recordType}:${row.recordId}`}
          renderRow={(row: MatchCandidate) => {
            const takenBy = row.matchedToBankTransactionId
            const taken = !!takenBy && takenBy !== line.id
            return (
              <TreeRow
                className={TREE_SECONDARY_NOTRUNCATE}
                icon={<FileCheck2 className='size-4' />}
                title={<span className='truncate text-sm'>{row.label}</span>}
                secondary={
                  <span className='flex flex-wrap items-center gap-1.5'>
                    <Badge variant='outline' size='xs'>
                      {MATCH_RECORD_TYPE_LABELS[row.recordType]}
                    </Badge>
                    <span className='font-mono text-xs tabular-nums'>
                      {formatMinor(row.amountMinor, currencyCode)}
                    </span>
                    {row.dateKey && (
                      <span className='text-muted-foreground text-xs'>{row.dateKey}</span>
                    )}
                    {row.secondary && (
                      <span className='text-muted-foreground text-xs'>{row.secondary}</span>
                    )}
                    {/* 🛑 A candidate already matched to another bank line is
                        shown, disabled, with the line named - never hidden. The
                        reader has to be able to see that the payment exists and
                        why it is off limits, or they raise a duplicate. */}
                    {taken && (
                      <Badge variant='outline' size='xs'>
                        Matched to {takenBy}
                      </Badge>
                    )}
                  </span>
                }
                actions={
                  <TreeRowButton
                    persistent
                    tooltipText={taken ? 'Already matched to another bank line' : 'Match this line'}
                    disabled={taken || match.isPending}
                    onClick={() =>
                      match.mutate({
                        id: line.id,
                        recordType: row.recordType as
                          | 'vendor_payment'
                          | 'payment_transaction'
                          | 'bank_deposit'
                          | 'vendor_bill',
                        recordId: row.recordId,
                      })
                    }>
                    <Link2 className='size-3.5' />
                  </TreeRowButton>
                }
              />
            )
          }}
        />
        {!candidates.isPending && rows.length === 0 && (
          <p className='px-1 py-3 text-muted-foreground text-sm'>
            Nothing within three days and one percent of this amount. Search above for a document
            that cleared later, or code the line instead.
          </p>
        )}
      </ScrollArea>

      <EntryBlockers blockers={blockers} />
    </div>
  )
}

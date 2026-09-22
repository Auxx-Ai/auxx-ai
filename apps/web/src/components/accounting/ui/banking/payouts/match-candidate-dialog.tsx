// apps/web/src/components/accounting/ui/banking/payouts/match-candidate-dialog.tsx

'use client'

// "Match to receipt" (§10.4): the customer movements a person may vouch for
// against one processor item. The server does the filtering — rail, currency,
// purpose, already-claimed — and sorts by amount closeness, so this dialog
// renders the answer rather than narrowing it again.

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { InputSearch } from '@auxx/ui/components/input-search'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Receipt } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { formatMinor } from '../../ledger/format'
import { formatEvidenceDate } from './evidence-format'
import { RecordChipLink } from './record-chip-link'

export interface MatchCandidateDialogProps {
  /** The `ProcessorBalanceEntry.id` being matched. `null` keeps the dialog closed. */
  entryId: string | null
  onOpenChange: (open: boolean) => void
  onPick: (moneyTransactionId: string) => void
  /** Whether the pick is still in flight, so the list can say so. */
  saving: boolean
}

export function MatchCandidateDialog({
  entryId,
  onOpenChange,
  onPick,
  saving,
}: MatchCandidateDialogProps) {
  const [search, setSearch] = useState('')
  const query = api.payoutEvidence.matchCandidates.useQuery(
    { entryId: entryId ?? '', query: search.trim() || undefined },
    { enabled: !!entryId }
  )
  const candidates = query.data ?? []

  return (
    <Dialog
      open={!!entryId}
      onOpenChange={(open) => {
        if (!open) setSearch('')
        onOpenChange(open)
      }}>
      <DialogContent size='lg'>
        <DialogHeader>
          <DialogTitle>Match to a customer payment</DialogTitle>
          <DialogDescription>
            Payments on this item's gateway and currency that no other item has claimed, closest
            amount first. Picking one records that you vouched for the pair; it moves no money.
          </DialogDescription>
        </DialogHeader>

        <InputSearch
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder='Search order number, invoice number or amount'
        />

        {query.error && (
          <Alert variant='destructive'>
            <AlertTitle>Could not load candidates</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        )}

        {!query.isPending && !query.error && candidates.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title='No candidate payments'
            description='No unclaimed customer payment on this gateway and currency matches. Widen the search, or import the payment evidence first.'
          />
        ) : (
          <TreeRowList
            items={candidates}
            loading={query.isPending}
            skeletonCount={4}
            className={TREE_SECONDARY_NOTRUNCATE}
            getKey={(candidate) => candidate.moneyTransactionId}
            renderRow={(candidate) => (
              <TreeRow
                icon={<Receipt className='size-4' />}
                title={
                  <span className='font-mono text-sm tabular-nums'>
                    {formatMinor(Number(candidate.amountMinor), candidate.currency)}
                  </span>
                }
                description={formatEvidenceDate(candidate.occurredOn ?? candidate.occurredAt)}
                secondary={
                  <span className='flex flex-wrap items-center gap-1.5'>
                    <Badge
                      variant={candidate.differenceMinor === '0' ? 'green' : 'amber'}
                      size='xs'>
                      {candidate.differenceMinor === '0'
                        ? 'Exact amount'
                        : `Differs ${formatMinor(Number(candidate.differenceMinor), candidate.currency)}`}
                    </Badge>
                    {candidate.documents.map((document) => (
                      <RecordChipLink key={document.instanceId} document={document} />
                    ))}
                    {candidate.reference && (
                      <span className='truncate text-muted-foreground text-xs'>
                        {candidate.reference}
                      </span>
                    )}
                  </span>
                }
                rowClassName={saving ? 'pointer-events-none opacity-60' : undefined}
                onToggleOpen={() => onPick(candidate.moneyTransactionId)}
              />
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

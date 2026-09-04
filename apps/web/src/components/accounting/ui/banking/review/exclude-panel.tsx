// apps/web/src/components/accounting/ui/banking/review/exclude-panel.tsx

'use client'

import type { BankTransactionRow } from '@auxx/lib/banking/review/client'
import { Button } from '@auxx/ui/components/button'
import { Textarea } from '@auxx/ui/components/textarea'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'

interface ExcludePanelProps {
  line: BankTransactionRow
  onDone: () => void
}

/**
 * Take a line out of the queue without posting or linking anything.
 *
 * 🛑 The reason is required, and the server refuses a blank one. An unexplained
 * exclusion is indistinguishable from an unreviewed line six months later, which
 * is how a 2,390-item backlog gets built: everything somebody dismissed without
 * saying why has to be looked at again by the next person.
 *
 * ⚠️ Neutral tone, no destructive box. Excluding is an ordinary bookkeeping act
 * - a personal charge on a business card, a duplicate the bank showed twice -
 * and it is a STATUS write, never a delete. The row stays as the evidence that
 * the bank showed something and a person decided it was not ours.
 */
export function ExcludePanel({ line, onDone }: ExcludePanelProps) {
  const utils = api.useUtils()
  const [reason, setReason] = useState(line.excludeReason ?? '')
  const [blockers, setBlockers] = useState<LedgerBlocker[]>([])

  const exclude = api.bankingReview.exclude.useMutation({
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

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-muted-foreground text-sm'>
        Excluding keeps the line and records that it is not the business&apos;s. Say why - an
        exclusion with no reason reads exactly like an unreviewed line to the next person.
      </p>
      <Textarea
        value={reason}
        rows={3}
        placeholder='Personal charge, reimbursed separately'
        onChange={(event) => setReason(event.target.value)}
      />
      <EntryBlockers blockers={blockers} />
      <Button
        variant='outline'
        disabled={!reason.trim() || exclude.isPending}
        loading={exclude.isPending}
        onClick={() => exclude.mutate({ id: line.id, reason: reason.trim() })}>
        Exclude
      </Button>
    </div>
  )
}

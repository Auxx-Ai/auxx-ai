// apps/web/src/components/accounting/ui/banking/review/transfer-panel.tsx

'use client'

import type { BankAccountRow } from '@auxx/lib/banking/client'
import type { BankTransactionRow } from '@auxx/lib/banking/review/client'
import type { PostResultStatus } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { Combobox } from '@auxx/ui/components/combobox'
import { Input } from '@auxx/ui/components/input'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { api } from '~/trpc/react'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'

interface TransferPanelProps {
  line: BankTransactionRow
  accounts: BankAccountRow[]
  onDone: () => void
}

/**
 * Both legs are ours (plans/bank-connection/03-categorization-and-gl.md §3.3).
 *
 * 🛑 A move from checking to a card appears as TWO bank lines, one on each
 * account. Coded as ordinary transactions the business records an expense and
 * an income that never happened; posted from both legs, cash moves twice. So the
 * pair produces exactly one cash-to-cash entry and never touches a revenue or
 * expense account.
 *
 * ⚠️ **A card payment is a transfer, not an expense.** It is the case that bites
 * first, because any business with both a chequing feed and a card feed sees one
 * every month.
 *
 * The server finds the opposite leg on the chosen account - same absolute
 * amount, opposite sign, within three days - and links the two. When it cannot
 * find one it still posts, against the counterpart account's GL code, and says
 * so in a warning: refusing until the slower bank catches up would leave a month
 * that cannot be closed.
 */
export function TransferPanel({ line, accounts, onDone }: TransferPanelProps) {
  const utils = api.useUtils()
  const [counterpart, setCounterpart] = useState<string | null>(null)
  const [memo, setMemo] = useState('')
  const [blockers, setBlockers] = useState<LedgerBlocker[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

  const transfer = api.bankingReview.transfer.useMutation({
    onSuccess: async (result) => {
      if (
        result.post &&
        result.post.status !== 'posted' &&
        result.post.status !== 'not_connected'
      ) {
        setBlockers([
          {
            status: result.post.status as PostResultStatus,
            error: result.post.error ?? 'The ledger refused this transfer.',
          },
        ])
        return
      }
      setBlockers([])
      setWarnings(result.warnings)
      await Promise.all([
        utils.bankingReview.list.invalidate(),
        utils.bankingReview.stats.invalidate(),
        utils.bankingReview.get.invalidate({ id: line.id }),
        utils.bankingReview.history.invalidate({ id: line.id }),
      ])
      // Held open when there is something to read; a silent success closes.
      if (result.warnings.length === 0) onDone()
    },
    onError: (error) => setBlockers([{ status: 'error', error: error.message }]),
  })

  const options = accounts
    .filter((account) => account.id !== line.bankAccountId)
    .map((account) => ({
      value: account.id,
      label: [account.institution, account.name, account.last4 && `···${account.last4}`]
        .filter(Boolean)
        .join(' · '),
    }))

  return (
    <div className='flex flex-col gap-4'>
      <FieldPanel>
        <FieldPanelRow
          title='Other account'
          isRequired
          description='Where the money went, or came from. The matching line on that account is found automatically.'>
          <Combobox
            options={options}
            value={counterpart ?? ''}
            onChangeValue={setCounterpart}
            placeholder='Choose the other account…'
            emptyText='You only have one bank account'
          />
        </FieldPanelRow>
        <FieldPanelRow title='Memo' isLastRow>
          <Input
            value={memo}
            placeholder='Transfer'
            onChange={(event) => setMemo(event.target.value)}
          />
        </FieldPanelRow>
      </FieldPanel>

      {warnings.map((warning) => (
        <div
          key={warning}
          className='flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
          <span>{warning}</span>
        </div>
      ))}

      <EntryBlockers blockers={blockers} />

      <Button
        disabled={!counterpart || transfer.isPending}
        loading={transfer.isPending}
        onClick={() =>
          transfer.mutate({
            id: line.id,
            counterpartBankAccountId: counterpart ?? '',
            memo: memo.trim() || undefined,
          })
        }>
        Record transfer
      </Button>
    </div>
  )
}

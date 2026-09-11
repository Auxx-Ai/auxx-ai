// apps/web/src/components/accounting/ui/banking/review/transfer-panel.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { BankTransactionRow } from '@auxx/lib/banking/review/client'
import type { PostResultStatus } from '@auxx/lib/postings/client'
import { Alert } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { BankAccountPicker } from '~/components/accounting/ui/bank-account-picker'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'

interface TransferPanelProps {
  line: BankTransactionRow
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
export function TransferPanel({ line, onDone }: TransferPanelProps) {
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

  return (
    <div className='flex flex-col gap-4'>
      <FieldPanel>
        <FieldPanelRow
          title='Other account'
          type={BaseType.RELATION}
          showIcon
          isRequired
          description='Where the money went, or came from. The matching line on that account is found automatically.'>
          {/* `excludeId` is what stops a line naming its own account as the
              counterpart - a transfer to yourself is not a transfer. */}
          <BankAccountPicker
            value={counterpart}
            onChange={setCounterpart}
            excludeId={line.bankAccountId}
            placeholder='Choose the other account…'
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
          />
        </FieldPanelRow>
        <FieldPanelRow title='Memo' type={BaseType.STRING} showIcon isLastRow>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={memo}
            onChange={(value) => setMemo((value as string | null) ?? '')}
            placeholder='Transfer'
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
          />
        </FieldPanelRow>
      </FieldPanel>

      {warnings.map((warning) => (
        <Alert key={warning} variant='neutral'>
          <TriangleAlert />
          <span>{warning}</span>
        </Alert>
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

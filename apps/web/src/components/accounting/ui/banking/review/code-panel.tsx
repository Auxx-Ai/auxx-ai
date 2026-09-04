// apps/web/src/components/accounting/ui/banking/review/code-panel.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { BankTransactionRow } from '@auxx/lib/banking/review/client'
import type { PostResultStatus, ResolvedPostingLine } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import { Lightbulb } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { GlAccountPicker, useChartAccounts } from '../../gl-account-picker'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'
import { EntryJournal } from '../../ledger/entry-journal'

interface CodePanelProps {
  line: BankTransactionRow
  currencyCode: string
  onDone: () => void
}

/**
 * The one treatment that creates a posting
 * (plans/bank-connection/03-categorization-and-gl.md §3.2).
 *
 * A bank fee, an interest charge, a card charge nobody raised a bill for, an
 * owner draw. Everything that corresponds to a document auxx already holds goes
 * through Match instead and posts nothing, because a second entry for one event
 * credits cash twice and still balances (decision **B5**).
 *
 * 🛑 The two-line entry is shown BEFORE Post, not after. A bookkeeper coding a
 * backlog is deciding on a direction as much as on an account, and "debit 6100,
 * credit 1000" read back in the accountant's own layout is the check that
 * catches a sign the picker cannot.
 *
 * ⚠️ The preview is composed in the browser from the picked code and the
 * account's mapped code - it is not a `previewEntry` round trip. The lines are
 * arithmetic (`|amount|`, one debit, one credit) and the server refuses an
 * unmapped or archived account at Post time with a sentence naming it, which is
 * the message worth waiting for. A preview procedure here would be a second
 * authority on the same two rows.
 */
export function CodePanel({ line, currencyCode, onDone }: CodePanelProps) {
  const utils = api.useUtils()
  const { accounts } = useChartAccounts()
  const [code, setCode] = useState<string | null>(line.glAccountCode ?? line.suggestedGlAccount)
  const [memo, setMemo] = useState('')
  const [createRule, setCreateRule] = useState(false)
  const [blockers, setBlockers] = useState<LedgerBlocker[]>([])

  // 🛑 `bankingRules.createFromTransaction` is slot 3C's. Until it exists the
  // toggle is hidden rather than rendered inert - an affordance that silently
  // does nothing is worse than one that is absent.
  const rulesRouter = (api as unknown as Record<string, Record<string, unknown>>).bankingRules
  const canCreateRule = !!rulesRouter && 'createFromTransaction' in rulesRouter

  const codeTransaction = api.bankingReview.code.useMutation({
    onSuccess: async (result) => {
      // `postEntry` never throws, so a refusal arrives HERE, on the success
      // path, as a status. Treating only `onError` as failure would report a
      // locked period as a posted entry.
      if (
        result.post &&
        result.post.status !== 'posted' &&
        result.post.status !== 'not_connected'
      ) {
        setBlockers([
          {
            status: result.post.status as PostResultStatus,
            error: result.post.error ?? 'The ledger refused this entry.',
          },
        ])
        return
      }
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

  const preview = useMemo<ResolvedPostingLine[]>(() => {
    if (!code || !line.bankAccountCode || line.amountMinor === 0) return []
    const name = (accountCode: string) =>
      accounts.find((account) => account.code === accountCode)?.name
    const amount = Math.abs(line.amountMinor)
    const outbound = line.amountMinor < 0
    const debitCode = outbound ? code : line.bankAccountCode
    const creditCode = outbound ? line.bankAccountCode : code
    return [
      {
        accountCode: debitCode,
        accountName: name(debitCode),
        direction: 'debit',
        amount,
        memo: memo || (line.description ?? undefined),
        sourceType: 'bank_transaction',
        sourceId: line.id,
        sortOrder: 0,
      },
      {
        accountCode: creditCode,
        accountName: name(creditCode),
        direction: 'credit',
        amount,
        memo: memo || (line.description ?? undefined),
        sourceType: 'bank_transaction',
        sourceId: line.id,
        sortOrder: 1,
      },
    ]
  }, [accounts, code, line.amountMinor, line.bankAccountCode, line.description, line.id, memo])

  const unmapped = !line.bankAccountCode

  return (
    <div className='flex flex-col gap-4'>
      <FieldPanel>
        <FieldPanelRow
          title='Account'
          type={BaseType.STRING}
          showIcon
          isRequired
          description={
            line.suggestionReason ??
            'The account this money belongs in. The bank side of the entry comes from the account mapping.'
          }>
          <div className='flex flex-col gap-1.5'>
            <GlAccountPicker
              value={code}
              onChange={setCode}
              placeholder='Choose an account…'
              triggerProps={{ variant: 'transparent', className: 'w-full ps-0 pe-1' }}
            />
            {line.suggestedGlAccount && line.suggestedGlAccount !== code && (
              <button
                type='button'
                className='flex w-fit items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground'
                onClick={() => setCode(line.suggestedGlAccount)}>
                <Lightbulb className='size-3' />
                Use the suggestion, {line.suggestedGlAccount}
              </button>
            )}
            {canCreateRule && (
              <div className='flex items-center gap-2 pt-1'>
                <Switch id='create-rule' checked={createRule} onCheckedChange={setCreateRule} />
                <Label htmlFor='create-rule' className='text-muted-foreground text-xs'>
                  Create a rule from this line
                </Label>
              </div>
            )}
          </div>
        </FieldPanelRow>
        <FieldPanelRow title='Memo' type={BaseType.STRING} showIcon isLastRow>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={memo}
            onChange={(value) => setMemo((value as string | null) ?? '')}
            placeholder={line.description ?? 'What this was for'}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
          />
        </FieldPanelRow>
      </FieldPanel>

      {unmapped ? (
        <EntryBlockers
          blockers={[
            {
              status: 'account_unmapped',
              error:
                `${line.bankAccountName ?? 'This bank account'} is not mapped to a GL account, so ` +
                'there is nothing to credit. Map it on Accounting > Settings > Bank accounts first.',
            },
          ]}
        />
      ) : (
        preview.length > 0 && <EntryJournal lines={preview} currencyCode={currencyCode} />
      )}

      <EntryBlockers blockers={blockers} />

      <Button
        disabled={!code || unmapped || codeTransaction.isPending}
        loading={codeTransaction.isPending}
        onClick={() =>
          codeTransaction.mutate({
            id: line.id,
            glAccountCode: code ?? '',
            memo: memo.trim() || undefined,
          })
        }>
        Post
      </Button>
    </div>
  )
}

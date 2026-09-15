// apps/web/src/components/accounting/ui/banking/review/code-panel.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import {
  type BankTransactionRow,
  type SettlementOffer,
  settlementLabel,
  settlementOffers,
} from '@auxx/lib/banking/review/client'
import { didLedgerAccept, type ResolvedPostingLine } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import { Check, Landmark, Lightbulb } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { AccountLabel, formatAccountLabel } from '../../account-label'
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
 * ## The settlement door (brief 27 §8.1)
 *
 * A deposit line also offers **"Settlement of <rail>"** for every active rail
 * whose clearing account is set. Choosing one fills the account picker with
 * that rail's clearing account and posts through the SAME code path -
 * `Dr bank / Cr clearing`, one entry, B5 intact, no payout record and no fee
 * split. On a `billed` rail the deposit already equals the gross the shipments
 * debited, so coding the line relieves clearing exactly; the fee is the monthly
 * true-up from the acquirer's statement (27 §8.3). After the first such coding
 * the panel offers to write the bank rule on the payee descriptor - 26 §13
 * decision 3's "prompt on first manual categorisation" - with `autoApply` off,
 * so it suggests and a person accepts.
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
  const [accountId, setAccountId] = useState<string | null>(
    line.glAccountId ?? line.suggestedGlAccountId
  )
  const [memo, setMemo] = useState('')
  const [createRule, setCreateRule] = useState(false)
  const [settlementRailId, setSettlementRailId] = useState<string | null>(null)
  const [ruleOffer, setRuleOffer] = useState<SettlementOffer | null>(null)
  const [blockers, setBlockers] = useState<LedgerBlocker[]>([])

  // Only a deposit can be a settlement, so the gateways are not even fetched
  // for money leaving the account. The offer itself is pure and shared with
  // the lib's tests (`settlementOffers`).
  const inbound = line.amountMinor > 0
  const gatewaysQuery = api.paymentGateway.list.useQuery(undefined, { enabled: inbound })
  const offers = useMemo(
    () => settlementOffers(gatewaysQuery.data ?? [], line),
    [gatewaysQuery.data, line]
  )
  const chosenOffer = offers.find((offer) => offer.paymentGatewayId === settlementRailId) ?? null

  const codeTransaction = api.bankingReview.code.useMutation()
  const createRuleFromLine = api.bankingRules.createFromTransaction.useMutation()
  const isPending = codeTransaction.isPending || createRuleFromLine.isPending

  const invalidateLine = () =>
    Promise.all([
      utils.bankingReview.list.invalidate(),
      utils.bankingReview.stats.invalidate(),
      utils.bankingReview.get.invalidate({ id: line.id }),
      utils.bankingReview.history.invalidate({ id: line.id }),
    ])

  const fail = (error: unknown) =>
    setBlockers([
      { status: 'error', error: error instanceof Error ? error.message : String(error) },
    ])

  /** Pick a rail, or un-pick the one already chosen. The account follows. */
  const pickOffer = (offer: SettlementOffer) => {
    if (chosenOffer?.paymentGatewayId === offer.paymentGatewayId) {
      setSettlementRailId(null)
      return
    }
    setSettlementRailId(offer.paymentGatewayId)
    setAccountId(offer.clearingGlAccountId)
  }

  const post = async () => {
    if (!accountId) return
    setBlockers([])
    try {
      const result = await codeTransaction.mutateAsync({
        id: line.id,
        glAccountId: accountId,
        memo: memo.trim() || undefined,
      })
      // `postEntry` never throws, so a refusal arrives HERE, on the success
      // path, as a status. Treating only the catch as failure would report a
      // locked period as a posted entry.
      if (result.post && !didLedgerAccept(result.post)) {
        setBlockers([
          {
            status: result.post.status,
            error: result.post.error ?? 'The ledger refused this entry.',
          },
        ])
        return
      }
      await invalidateLine()

      // 27 §8.1: after the first settlement coding, the queue offers the rule.
      // The offer needs a descriptor to write against; a line with no match
      // key has nothing a rule could match the next deposit on.
      if (chosenOffer) {
        if (line.matchKey) {
          setRuleOffer(chosenOffer)
          return
        }
        onDone()
        return
      }

      if (createRule) {
        await createRuleFromLine.mutateAsync({ transactionId: line.id, glAccountId: accountId })
        await utils.bankingRules.list.invalidate()
      }
      onDone()
    } catch (error) {
      fail(error)
    }
  }

  const writeSettlementRule = async (offer: SettlementOffer) => {
    setBlockers([])
    try {
      await createRuleFromLine.mutateAsync({
        transactionId: line.id,
        glAccountId: offer.clearingGlAccountId,
        name: settlementLabel(offer.railName),
        // Deposits only. The same descriptor can appear on a chargeback or a
        // fee debit, and coding those to clearing would relieve it of money
        // that never arrived.
        direction: 'in',
      })
      await utils.bankingRules.list.invalidate()
      onDone()
    } catch (error) {
      fail(error)
    }
  }

  const preview = useMemo<ResolvedPostingLine[]>(() => {
    if (!accountId || !line.bankAccountGlAccountId || line.amountMinor === 0) return []
    const find = (id: string) => accounts.find((account) => account.id === id)
    const amount = Math.abs(line.amountMinor)
    const outbound = line.amountMinor < 0
    const debitId = outbound ? accountId : line.bankAccountGlAccountId
    const creditId = outbound ? line.bankAccountGlAccountId : accountId
    // A browser-composed preview, not a server resolution - see the file
    // header. Both accounts come from the same chart the picker offered, so
    // a miss means the chart is still loading; render nothing rather than a
    // line whose identity is a guess.
    const debit = find(debitId)
    const credit = find(creditId)
    if (!debit || !credit) return []
    return [
      {
        glAccountId: debit.id,
        accountCode: debit.code,
        accountName: debit.name,
        direction: 'debit',
        amount,
        memo: memo || (line.description ?? undefined),
        sourceType: 'bank_transaction',
        sourceId: line.id,
        sortOrder: 0,
      },
      {
        glAccountId: credit.id,
        accountCode: credit.code,
        accountName: credit.name,
        direction: 'credit',
        amount,
        memo: memo || (line.description ?? undefined),
        sourceType: 'bank_transaction',
        sourceId: line.id,
        sortOrder: 1,
      },
    ]
  }, [
    accounts,
    accountId,
    line.amountMinor,
    line.bankAccountGlAccountId,
    line.description,
    line.id,
    memo,
  ])

  const unmapped = !line.bankAccountGlAccountId
  const suggestedAccount = line.suggestedGlAccountId
    ? accounts.find((account) => account.id === line.suggestedGlAccountId)
    : null

  if (ruleOffer) {
    const label = settlementLabel(ruleOffer.railName)
    return (
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-3 rounded-xl border bg-muted/40 p-4'>
          <div className='flex items-center gap-2 font-medium text-sm'>
            <Check className='size-4 text-good-500' />
            Posted as {label}
          </div>
          <p className='text-muted-foreground text-xs'>
            Every deposit whose descriptor contains{' '}
            <span className='font-mono text-foreground'>{line.matchKey}</span> can be suggested as{' '}
            {label} from now on, coded to{' '}
            <AccountLabel
              glAccountId={ruleOffer.clearingGlAccountId}
              density='compact'
              className='text-foreground'
            />
            . The rule suggests; a person still accepts each line.
          </p>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              loading={createRuleFromLine.isPending}
              loadingText='Creating...'
              onClick={() => void writeSettlementRule(ruleOffer)}>
              Create rule
            </Button>
            <Button
              variant='ghost'
              size='sm'
              disabled={createRuleFromLine.isPending}
              onClick={onDone}>
              Not now
            </Button>
          </div>
        </div>
        <EntryBlockers blockers={blockers} />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <FieldPanel>
        {offers.length > 0 && (
          <FieldPanelRow
            title='Settlement of'
            type={BaseType.STRING}
            showIcon
            description={
              "Money a payment rail paid into the bank. Codes the deposit to that rail's " +
              'clearing account, debit bank and credit clearing, as one entry. No fee is split ' +
              "off the line; a billed rail's fee is booked monthly from its statement."
            }>
            <div className='flex flex-col gap-1.5'>
              <div className='flex flex-wrap gap-1.5'>
                {offers.map((offer) => {
                  const active = chosenOffer?.paymentGatewayId === offer.paymentGatewayId
                  return (
                    <Button
                      key={offer.paymentGatewayId}
                      type='button'
                      variant={active ? 'default' : 'outline'}
                      size='sm'
                      onClick={() => pickOffer(offer)}>
                      <Landmark />
                      {offer.railName}
                    </Button>
                  )
                })}
              </div>
              {chosenOffer && (
                <span className='flex items-center gap-1 text-muted-foreground text-xs'>
                  Codes to
                  <AccountLabel
                    glAccountId={chosenOffer.clearingGlAccountId}
                    className='text-foreground'
                  />
                </span>
              )}
            </div>
          </FieldPanelRow>
        )}
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
              value={accountId}
              selectBy='id'
              onChange={(value) => {
                setAccountId(value)
                // A hand-picked account that is not the rail's clearing account
                // is an ordinary coding, so the settlement label comes off.
                if (chosenOffer && value !== chosenOffer.clearingGlAccountId) {
                  setSettlementRailId(null)
                }
              }}
              placeholder='Choose an account…'
            />
            {line.suggestedGlAccountId && line.suggestedGlAccountId !== accountId && (
              <button
                type='button'
                className='flex w-fit items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground'
                onClick={() => setAccountId(line.suggestedGlAccountId)}>
                <Lightbulb className='size-3' />
                Use the suggestion
                {suggestedAccount ? `, ${formatAccountLabel(suggestedAccount)}` : ''}
              </button>
            )}
            {/* The settlement path offers its rule AFTER the post (27 §8.1),
                so the toggle is for an ordinary coding only. */}
            {!chosenOffer && (
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
        disabled={!accountId || unmapped || isPending}
        loading={isPending}
        onClick={() => void post()}>
        Post
      </Button>
    </div>
  )
}

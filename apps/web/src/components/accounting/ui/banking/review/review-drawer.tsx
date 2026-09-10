// apps/web/src/components/accounting/ui/banking/review/review-drawer.tsx

'use client'

import {
  type BankTransactionRow,
  MATCHED_RECORD_TYPE_LABELS,
  REVIEW_STATUS_LABELS,
} from '@auxx/lib/banking/review/client'
import { isRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Ban, Landmark, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { api } from '~/trpc/react'
import { BankAccountBadge } from '../../bank-account-badge'
import { useChartAccounts } from '../../gl-account-picker'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'
import { EMPTY_CELL, formatMinor } from '../../ledger/format'
import { AnalyzePanel } from './analyze-panel'
import { CodePanel } from './code-panel'
import { ExcludePanel } from './exclude-panel'
import { HistoryPanel } from './history-panel'
import { MatchPanel } from './match-panel'
import { TransferPanel } from './transfer-panel'

/** The reviewer's FIRST decision, per bank plan 03 §3. */
type Treatment = 'match' | 'code' | 'transfer'

const TREATMENTS: { value: Treatment; label: string }[] = [
  { value: 'match', label: 'Match' },
  { value: 'code', label: 'Code' },
  { value: 'transfer', label: 'Transfer' },
]

/**
 * What a matched line is linked TO, in words.
 *
 * 🛑 Never the bare `matchedRecordId`. A settled row can point at any of five
 * things, and one of them, `bank_account`, is not a document at all: it is the
 * counterpart account a transfer stamped while it waits for the other leg to
 * arrive. Rendering the raw id showed a cuid for every one of them.
 */
function matchedLabel(line: Pick<BankTransactionRow, 'matchedRecordType' | 'matchedRecordId'>) {
  const type = line.matchedRecordType
  if (!type) return `Linked to ${line.matchedRecordId ?? ''}`
  return MATCHED_RECORD_TYPE_LABELS[type]
}

interface ReviewDrawerProps {
  transactionId: string | null
  onOpenChange: (open: boolean) => void
  /** Docked into the Banking layout's `MainPageContent`, or a floating overlay. */
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
  currencyCode: string
  onOpenPosting?: (glPostingId: string) => void
}

/**
 * One bank line, deep-linked on `?txn=<id>` (plans/accounting/ui-plan.md §2.8).
 *
 * 🛑 **The treatment is the FIRST control**, not a consequence of picking a
 * category. Bank plan 03 §3 is explicit that classifying a line - is this a
 * document I already have, a fresh expense, or my own money moving - is the
 * reviewer's real decision, and a UI that leads with an account picker has
 * already assumed the answer is "code".
 *
 * Docked on desktop, exactly as `posting-drawer.tsx` is. The Banking layout owns
 * the `MainPageContent`, so the page reaches its `dockedPanels` slot through
 * `docked-panels-outlet.tsx` rather than by rendering a second one.
 */
export function ReviewDrawer({
  transactionId,
  onOpenChange,
  isDocked,
  width,
  onWidthChange,
  currencyCode,
  onOpenPosting,
}: ReviewDrawerProps) {
  const utils = api.useUtils()
  const [treatment, setTreatment] = useState<Treatment>('match')
  const [blockers, setBlockers] = useState<LedgerBlocker[]>([])

  /**
   * Close, and forget.
   *
   * ⚠️ The treatment is reset on CLOSE rather than on a new line, deliberately.
   * Somebody working down a backlog often codes ten fees in a row, so keeping
   * the choice while the drawer stays open is right; carrying it into a session
   * they come back to an hour later is not. The panels themselves are keyed on
   * the line id, so their pickers and memos never survive a row change.
   */
  const close = (open: boolean) => {
    if (!open) {
      setTreatment('match')
      setBlockers([])
    }
    onOpenChange(open)
  }

  const query = api.bankingReview.get.useQuery(
    { id: transactionId ?? '' },
    { enabled: !!transactionId }
  )
  const line = query.data ?? null

  const undo = api.bankingReview.undo.useMutation({
    onSuccess: async (result) => {
      if (
        result.post &&
        result.post.status !== 'posted' &&
        result.post.status !== 'not_connected'
      ) {
        setBlockers([
          {
            status: result.post.status as LedgerBlocker['status'],
            error: result.post.error ?? 'The reversal was refused.',
          },
        ])
        return
      }
      setBlockers([])
      await Promise.all([
        utils.bankingReview.list.invalidate(),
        utils.bankingReview.stats.invalidate(),
        utils.bankingReview.get.invalidate(),
        utils.bankingReview.history.invalidate(),
      ])
    },
    onError: (error) => setBlockers([{ status: 'error', error: error.message }]),
  })

  const settled =
    !!line &&
    (line.reviewStatus === 'matched' ||
      line.reviewStatus === 'coded' ||
      line.reviewStatus === 'excluded')

  // `glAccountId` is the `gl_account` id (task 15 §4), never a code - resolve
  // it against the one chart fetch every picker on this page already shares.
  const { accounts: chartAccounts } = useChartAccounts()
  const codedAccount = useMemo(
    () =>
      line?.glAccountId
        ? (chartAccounts.find((account) => account.id === line.glAccountId) ?? null)
        : null,
    [chartAccounts, line?.glAccountId]
  )

  return (
    <DockableDrawer
      open={!!transactionId}
      onOpenChange={close}
      isDocked={isDocked}
      width={width}
      onWidthChange={onWidthChange}
      minWidth={380}
      maxWidth={800}
      title={line ? (line.description ?? 'Bank line') : 'Bank line'}>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={<Landmark className='size-5 text-muted-foreground' />}
          title={
            <div className='flex min-w-0 flex-col gap-1'>
              <span className='truncate font-medium'>{line?.description ?? 'Bank line'}</span>
              {line && (
                <span className='flex flex-wrap items-center gap-1.5'>
                  <span className='font-mono text-xs tabular-nums'>
                    {formatMinor(Math.abs(line.amountMinor), currencyCode)}
                  </span>
                  <Badge variant={line.amountMinor < 0 ? 'outline' : 'green'} size='xs'>
                    {line.amountMinor < 0 ? 'Out' : 'In'}
                  </Badge>
                  <span className='text-muted-foreground text-xs'>
                    {line.postedAt ?? EMPTY_CELL}
                  </span>
                  <BankAccountBadge
                    bankAccountId={line.bankAccountId}
                    size='sm'
                    fallbackLabel='Unassigned account'
                  />
                  <Badge variant='outline' size='xs'>
                    {REVIEW_STATUS_LABELS[line.reviewStatus]}
                  </Badge>
                </span>
              )}
            </div>
          }
          onClose={() => close(false)}
        />

        {/* 🛑 The panels are PADDED and the Sections are not. `Section` draws its
            own `p-3` and a full-width `border-b`, exactly as the record drawer's
            cards do, so wrapping it in the treatment block's `p-4` inset that
            rule 16px from each edge and it read as a floating line rather than a
            divider. The padded stack ends where the sections begin. */}
        <ScrollArea className='min-h-0 flex-1'>
          <div className='flex flex-col'>
            <div className='flex flex-col gap-4 p-4'>
              {query.isPending ? (
                <>
                  <Skeleton className='h-9 w-full' />
                  <Skeleton className='h-40 w-full' />
                </>
              ) : !line ? (
                <p className='text-muted-foreground text-sm'>That bank line has gone.</p>
              ) : (
                <>
                  {/* 🛑 A void line is a destructive banner, not a disabled
                    button with no explanation. The bank withdrew the
                    transaction, so nothing may be coded or matched against it -
                    and if it already posted, that posting has to come out. */}
                  {line.bankStatus === 'void' && (
                    <div className='flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4'>
                      <Ban className='mt-0.5 size-5 shrink-0 text-destructive' />
                      <div className='flex min-w-0 flex-1 flex-col gap-1'>
                        <span className='font-medium'>The bank voided this line</span>
                        <p className='text-muted-foreground text-xs'>
                          No money moved, so it cannot be coded or matched. The row is kept as the
                          record that the bank showed it and withdrew it.
                        </p>
                      </div>
                      {line.glPostingId && (
                        <Button
                          variant='outline'
                          size='sm'
                          className='shrink-0'
                          loading={undo.isPending}
                          onClick={() => undo.mutate({ id: line.id })}>
                          <Undo2 />
                          Reverse posting
                        </Button>
                      )}
                    </div>
                  )}

                  {settled ? (
                    <div className='flex items-center gap-3 rounded-xl border bg-muted/40 p-4'>
                      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                        <span className='font-medium text-sm'>
                          {REVIEW_STATUS_LABELS[line.reviewStatus]}
                        </span>
                        <span className='truncate text-muted-foreground text-xs'>
                          {line.reviewStatus === 'coded'
                            ? `Coded to ${codedAccount ? `${codedAccount.code} ${codedAccount.name}` : (line.glAccountId ?? '')}`
                            : line.reviewStatus === 'excluded'
                              ? (line.excludeReason ?? '')
                              : matchedLabel(line)}
                        </span>
                      </div>
                      <Button
                        variant='outline'
                        size='sm'
                        loading={undo.isPending}
                        onClick={() => undo.mutate({ id: line.id })}>
                        <Undo2 />
                        {line.glPostingId ? 'Reverse and undo' : 'Undo'}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <RadioTab
                        value={treatment}
                        onValueChange={(value) => setTreatment(value as Treatment)}
                        size='sm'>
                        {TREATMENTS.map((item) => (
                          <RadioTabItem key={item.value} value={item.value}>
                            {item.label}
                          </RadioTabItem>
                        ))}
                      </RadioTab>

                      {/* 🛑 Keyed on the line, so a new row is a NEW form. React
                        would otherwise keep the previous row's picked account,
                        typed memo and chosen counterpart, which is exactly the
                        state that produces a run of confidently wrong postings
                        when somebody works down a backlog. */}
                      {treatment === 'match' && (
                        <MatchPanel
                          key={line.id}
                          line={line}
                          currencyCode={currencyCode}
                          onDone={() => close(false)}
                        />
                      )}
                      {treatment === 'code' && (
                        <CodePanel
                          key={line.id}
                          line={line}
                          currencyCode={currencyCode}
                          onDone={() => close(false)}
                        />
                      )}
                      {treatment === 'transfer' && (
                        <TransferPanel key={line.id} line={line} onDone={() => close(false)} />
                      )}
                    </>
                  )}

                  <EntryBlockers blockers={blockers} />
                </>
              )}
            </div>

            {line && (
              <>
                {!settled && (
                  <Section title='Exclude' collapsible initialOpen={false}>
                    <ExcludePanel key={line.id} line={line} onDone={() => close(false)} />
                  </Section>
                )}
                {/* Reading the line, and finding every other line like it. Below
                    the treatment because it answers "what IS this", which is the
                    question you have when the treatment is not obvious - not a
                    step on the way to a decision you have already made. */}
                <Section title='Analyze' collapsible initialOpen={false}>
                  <AnalyzePanel key={line.id} line={line} currencyCode={currencyCode} />
                </Section>
                {/* 🛑 Notes on a bank line are COMMENTS, not a field. A bank
                    transaction is an `EntityInstance` and already carries a
                    `recordId`, so the org's one comment thread works here with
                    no new column - and unlike a field it keeps who wrote it and
                    when, which is the whole point of "remind ourselves what this
                    was" eighteen months later.
                    ⚠️ A note here is about THIS line. Knowledge about the payee
                    belongs in a rule, or it gets retyped on all 42 of them. */}
                {isRecordId(line.recordId) && (
                  <Section title='Notes' collapsible initialOpen={false}>
                    <DrawerComments
                      recordId={line.recordId}
                      emptyTitle='No notes on this line'
                      emptyDescription='Leave a note about what this transaction was.'
                      headerTitle='Notes'
                      composerPlaceholder='What was this?'
                    />
                  </Section>
                )}
                <Section title='History' collapsible initialOpen={false}>
                  <HistoryPanel transactionId={line.id} onOpenPosting={onOpenPosting} />
                </Section>
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </DockableDrawer>
  )
}

// apps/web/src/components/accounting/ui/banking/deposits/deposits-page.tsx

'use client'

// Accounting > Banking > Deposits (plans/accounting/ui-plan.md §2.6,
// plans/accounting/tasks/06-deposit-grouping.md).
//
// ## What this screen is for
//
// Five cheques banked together arrive at the bank as ONE line. Five separate
// cash postings can never match it, so without this screen the bank feed's
// review queue can only ever CODE a receipt and never MATCH it - which is the
// QuickBooks failure the whole accounting pass exists to escape.
//
// ⚠️ A BANK deposit. `money/payments/deposit.ts` is a CUSTOMER deposit - money
// taken before delivery, a liability. Same English word, nothing else shared.
//
// ## Shape
//
// `SettingsPage` with a `ResponsiveTabs` subHeader (Undeposited · Deposits) in
// `?s=`, exactly the `accounts-settings-page.tsx` shape. Both tabs render inside
// ONE framed box, sized to the room left under the sticky header, so the split
// fills the page without the page itself scrolling. The Undeposited tab is a
// `MasterDetailSplit`: the left column is a `TreeRow` list of what is waiting to
// be banked, one parent row per day it was received with its payments nested at
// depth 1, and a selection strip on the column's floor; the right pane is the
// deposit being built. The Deposits tab is a `RecordsView` over the
// `bank-deposits` slug, so past deposits get columns, filters and the record
// drawer for free.
//
// 🛑 Every refusal is an `EntryBlockers` card, never a toast (HANDOFF ground
// rule 9). A locked period, an unmapped `cash` role and a mixed-currency
// selection each name what to go and fix, and a toast that disappears in four
// seconds cannot.

import { FieldType } from '@auxx/database/enums'
import { groupByDay } from '@auxx/lib/money/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import type { PostResultStatus } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { Banknote, FileDown, Landmark } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { MasterDetailSplit } from '~/components/global/master-detail-split'
import SettingsPage from '~/components/global/settings-page'
import { useDocumentSendActions } from '~/components/money/ui/use-document-send-actions'
import { RecordsView } from '~/components/records/records-view'
import { BaseType } from '~/components/workflow/types'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { GlAccountPicker } from '../../gl-account-picker'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'
import { EMPTY_CELL, formatMinor } from '../../ledger/format'

type DepositsTab = 'undeposited' | 'deposits'

const TABS = [
  { value: 'undeposited', label: 'Undeposited', icon: Banknote },
  { value: 'deposits', label: 'Deposits', icon: Landmark },
]

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Banking' },
  { title: 'Deposits' },
]

const PAGE_DESCRIPTION =
  'Money you have received but not yet banked, and the deposits that bank it. One deposit is one line on the statement, which is what makes a bank feed able to match rather than merely code.'

/**
 * The ledger is pinned to USD for the cutover (`LEDGER_CURRENCY`), and
 * `createBankDeposit` refuses anything else rather than posting at an implied
 * 1.0 rate - so the display currency is the same constant rather than a read.
 */
const DISPLAY_CURRENCY = 'USD'

/** Today as `YYYY-MM-DD` in the viewer's own zone - the default deposit date. */
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** `2026-09-01` to `Tue, 1 Sep 2026`, or the raw value when there is no date. */
function formatDay(day: string): string {
  if (day === 'unknown') return 'No date recorded'
  // `payment_date` reaches the client as a full timestamp on some rows and as a
  // bare `YYYY-MM-DD` on others, so the day part is taken by position rather
  // than by parsing the whole string - `new Date('2026-09-04 00:00:00+00T00:00:00')`
  // is `Invalid Date`, which is why this header used to read as a raw timestamp.
  const isoDay = /^\d{4}-\d{2}-\d{2}/.exec(day)?.[0]
  if (!isoDay) return day
  const parsed = new Date(`${isoDay}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return day
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Below this the framed split is not worth filling - it just scrolls with the page. */
const MIN_FRAME_HEIGHT = 320

/**
 * The height that makes this element end exactly where `SettingsPage`'s scroll
 * viewport does, so the split fills the page without adding a scrollbar.
 *
 * ⚠️ `--settings-sticky-top` is NOT the whole story. It measures the sticky
 * title/tabs block only; the breadcrumb bar above it is a separate, non-sticky
 * sibling, so `viewport - stickyTop` overshoots by the breadcrumb's height and
 * the page gains a scrollbar exactly that tall. What is honest is the element's
 * own offset inside the scroll content: everything above it, sticky or not, has
 * already been laid out, so `viewportHeight - offsetTop` is the room that is
 * actually left. Re-measured when the viewport or anything above it resizes -
 * the header grows a line when the description wraps at narrow widths.
 */
function useFillViewportHeight() {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const viewport = el.closest('[data-slot="scroll-area-viewport"]')
    if (!(viewport instanceof HTMLElement)) return

    const measure = () => {
      const offsetTop =
        el.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
      setHeight(Math.max(MIN_FRAME_HEIGHT, viewport.clientHeight - offsetTop))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    // Everything above this element inside the scroll content - the breadcrumb
    // bar and the sticky header. Not `el` itself: observing what this effect
    // resizes is a loop.
    for (const sibling of viewport.children) {
      if (sibling !== el) observer.observe(sibling)
    }
    return () => observer.disconnect()
  }, [])

  return { ref, height }
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  bank: 'Bank transfer',
  other: 'Other',
}

export function DepositsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const utils = api.useUtils()

  const [tab, setTab] = useQueryState('s', { defaultValue: 'undeposited' as string })
  const activeTab: DepositsTab = tab === 'deposits' ? 'deposits' : 'undeposited'

  const undeposited = api.money.bankDeposit.listUndeposited.useQuery(undefined, {
    enabled: activeTab === 'undeposited',
  })

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bankAccountCode, setBankAccountCode] = useState<string | null>(null)
  const [depositDate, setDepositDate] = useState(today)
  const [reference, setReference] = useState('')
  const [blockers, setBlockers] = useState<LedgerBlocker[]>([])
  const [recordedId, setRecordedId] = useState<string | null>(null)

  const rows = useMemo(() => undeposited.data ?? [], [undeposited.data])
  const days = useMemo(() => groupByDay(rows), [rows])
  const selected = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.paymentId)),
    [rows, selectedIds]
  )
  const selectedTotal = useMemo(
    () => selected.reduce((sum, row) => sum + row.amountMinor, 0),
    [selected]
  )

  const createDeposit = api.money.bankDeposit.create.useMutation({
    onSuccess: async (result) => {
      // 🛑 `postEntry` never throws, so a refusal arrives HERE, on the success
      // path, as a status. Treating only `onError` as failure would report a
      // locked period as a recorded deposit.
      if (result.post.status !== 'posted' && result.post.status !== 'not_connected') {
        setBlockers([
          {
            status: result.post.status as PostResultStatus,
            error: result.post.error ?? 'The ledger refused this deposit.',
          },
        ])
        setRecordedId(null)
      } else {
        setBlockers([])
        setRecordedId(result.deposit.depositId)
        setSelectedIds([])
        setReference('')
      }
      await utils.money.bankDeposit.listUndeposited.invalidate()
      await utils.money.bankDeposit.list.invalidate()
    },
    onError: (error) => {
      // Every lib refusal is an AuxxError with a sentence that names the row,
      // the method or the currency. It belongs in a blocker card, not a toast.
      setBlockers([{ status: 'error', error: error.message }])
      setRecordedId(null)
    },
  })

  const toggle = useCallback((paymentId: string) => {
    setSelectedIds((current) =>
      current.includes(paymentId)
        ? current.filter((id) => id !== paymentId)
        : [...current, paymentId]
    )
  }, [])

  const toggleDay = useCallback((dayIds: string[], allSelected: boolean) => {
    setSelectedIds((current) =>
      allSelected
        ? current.filter((id) => !dayIds.includes(id))
        : [...new Set([...current, ...dayIds])]
    )
  }, [])

  const canRecord = selectedIds.length > 0 && !!bankAccountCode && !!depositDate

  const { ref: frameRef, height: frameHeight } = useFillViewportHeight()

  return (
    <SettingsPage
      title='Deposits'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      subHeader={
        <ResponsiveTabs
          value={activeTab}
          onValueChange={(next) => setTab(next)}
          items={TABS}
          size='sm'
        />
      }>
      {/* The split is FRAMED rather than bled to the page edges: sized to the
          room left under the header, padded away from the panel border, and
          clipped so each column scrolls inside the frame instead of the page
          scrolling past it. */}
      <div
        ref={frameRef}
        className='p-4'
        style={frameHeight ? { height: `${frameHeight}px` } : undefined}>
        <div className='flex h-full flex-col overflow-hidden rounded-xl border bg-background'>
          {activeTab === 'deposits' ? (
            // Past deposits are records, so the list is a one-liner and the drawer,
            // the columns and the filters all come from the registry.
            <div className='flex min-h-0 flex-1 flex-col'>
              <RecordsView slug='bank-deposits' basePath='/app/accounting/banking/deposits' />
            </div>
          ) : (
            <MasterDetailSplit
              id='bank-deposits'
              scroll='columns'
              paneOpen
              paneTitle='Deposit'
              pane={
                <DepositPane
                  selectedCount={selected.length}
                  selectedTotal={selectedTotal}
                  selected={selected}
                  bankAccountCode={bankAccountCode}
                  onBankAccountChange={setBankAccountCode}
                  depositDate={depositDate}
                  onDepositDateChange={setDepositDate}
                  reference={reference}
                  onReferenceChange={setReference}
                  blockers={blockers}
                  recordedId={recordedId}
                  canRecord={canRecord}
                  isRecording={createDeposit.isPending}
                  onRecord={() =>
                    createDeposit.mutate({
                      paymentIds: selectedIds,
                      depositDate,
                      bankAccountCode: bankAccountCode ?? '',
                      reference: reference.trim() || undefined,
                    })
                  }
                />
              }>
              {/* The column is a full-height flex stack so the selection strip
                  can sit on its floor: `min-h-full` on a short list, taller
                  than the column on a long one, strip pinned either way. */}
              <div className={cn('flex min-h-full flex-col', TREE_SECONDARY_NOTRUNCATE)}>
                <div className='flex flex-1 flex-col gap-4 p-4'>
                  {undeposited.isLoading ? (
                    <div className='flex flex-col gap-2'>
                      <Skeleton className='h-6 w-40' />
                      <Skeleton className='h-12 w-full' />
                      <Skeleton className='h-12 w-full' />
                    </div>
                  ) : days.length === 0 ? (
                    <EmptyState
                      icon={Banknote}
                      title='Nothing waiting to be banked'
                      description={
                        // Not "no payments": undeposited funds is meant to BE zero once
                        // everything has cleared, so an empty list is the healthy state
                        // and must not read as a failure.
                        <span>
                          Every payment routed through undeposited funds has been banked. Cash and
                          cheques land here as they are received; ACH and card receipts never do,
                          because each arrives at the bank on its own line.
                        </span>
                      }
                    />
                  ) : (
                    days.map((day) => {
                      const dayIds = day.rows.map((row) => row.paymentId)
                      const allSelected = dayIds.every((id) => selectedIds.includes(id))
                      return (
                        // One day is one parent row with its payments nested at depth
                        // 1, so the connector line does the grouping a bordered card
                        // used to do - and the day's own checkbox banks the whole day.
                        <TreeRow
                          key={day.day}
                          icon={
                            <Checkbox
                              checked={allSelected}
                              onClick={(event) => event.stopPropagation()}
                              onCheckedChange={() => toggleDay(dayIds, allSelected)}
                              aria-label={`Select every payment received on ${formatDay(day.day)}`}
                            />
                          }
                          title={
                            <span className='truncate font-medium text-sm'>
                              {formatDay(day.day)}
                            </span>
                          }
                          secondary={
                            <span className='text-muted-foreground text-xs'>
                              {day.rows.length} payment{day.rows.length === 1 ? '' : 's'} ·{' '}
                              <span className='font-mono tabular-nums'>
                                {formatMinor(day.totalMinor, DISPLAY_CURRENCY)}
                              </span>
                            </span>
                          }
                          onToggleOpen={() => toggleDay(dayIds, allSelected)}>
                          <TreeRowList
                            items={day.rows}
                            getKey={(row) => row.paymentId}
                            renderRow={(row) => (
                              <TreeRow
                                depth={1}
                                icon={
                                  <Checkbox
                                    checked={selectedIds.includes(row.paymentId)}
                                    onClick={(event) => event.stopPropagation()}
                                    onCheckedChange={() => toggle(row.paymentId)}
                                    aria-label={`Select ${row.invoiceName || 'unapplied payment'}`}
                                  />
                                }
                                title={
                                  <span className='truncate text-sm'>
                                    {row.invoiceName || 'Unapplied payment'}
                                  </span>
                                }
                                secondary={
                                  <span className='flex items-center gap-1.5'>
                                    <Badge variant='outline' size='xs'>
                                      {METHOD_LABELS[row.method ?? ''] ?? row.method ?? EMPTY_CELL}
                                    </Badge>
                                    {row.reference ? (
                                      <span className='text-muted-foreground text-xs'>
                                        {row.reference}
                                      </span>
                                    ) : null}
                                  </span>
                                }
                                trailing={
                                  <span className='px-1 font-mono text-sm tabular-nums'>
                                    {formatMinor(row.amountMinor, DISPLAY_CURRENCY)}
                                  </span>
                                }
                                onToggleOpen={() => toggle(row.paymentId)}
                              />
                            )}
                          />
                        </TreeRow>
                      )
                    })
                  )}
                </div>

                {selectedIds.length > 0 && (
                  // The sticky selection strip, copied from `billing-summary-strip.tsx`:
                  // the count and the total have to stay visible while the list is
                  // scrolled, because the number a person is checking is the SUM.
                  <div className='sticky bottom-0 z-10 mt-auto flex items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur'>
                    <span className='text-sm'>
                      {selectedIds.length} selected ·{' '}
                      <span className='font-mono tabular-nums'>
                        {formatMinor(selectedTotal, DISPLAY_CURRENCY)}
                      </span>
                    </span>
                    <Button
                      size='sm'
                      className='ml-auto'
                      disabled={!canRecord || createDeposit.isPending}
                      onClick={() =>
                        createDeposit.mutate({
                          paymentIds: selectedIds,
                          depositDate,
                          bankAccountCode: bankAccountCode ?? '',
                          reference: reference.trim() || undefined,
                        })
                      }>
                      Group into deposit
                    </Button>
                  </div>
                )}
              </div>
            </MasterDetailSplit>
          )}
        </div>
      </div>
    </SettingsPage>
  )
}

/** The right-hand pane: what is being banked, where, and on what date. */
function DepositPane(props: {
  selectedCount: number
  selectedTotal: number
  selected: Array<{
    paymentId: string
    invoiceName: string | null
    reference: string | null
    method: string | null
    amountMinor: number
  }>
  bankAccountCode: string | null
  onBankAccountChange: (code: string | null) => void
  depositDate: string
  onDepositDateChange: (date: string) => void
  reference: string
  onReferenceChange: (reference: string) => void
  blockers: LedgerBlocker[]
  recordedId: string | null
  canRecord: boolean
  isRecording: boolean
  onRecord: () => void
}) {
  const {
    selectedCount,
    selectedTotal,
    selected,
    bankAccountCode,
    onBankAccountChange,
    depositDate,
    onDepositDateChange,
    reference,
    onReferenceChange,
    blockers,
    recordedId,
    canRecord,
    isRecording,
    onRecord,
  } = props

  return (
    <div className='flex flex-col gap-4 p-4'>
      <FieldPanel>
        <FieldPanelRow title='Bank account' type={BaseType.STRING} showIcon isRequired>
          {/* Filtered to assets: a deposit debits `cash`, and offering a
              liability or a revenue account here would produce an entry that
              balances and means nothing. */}
          <GlAccountPicker
            value={bankAccountCode}
            onChange={onBankAccountChange}
            filterTypes={['asset']}
            placeholder='Select bank account…'
            triggerProps={{ variant: 'transparent', className: 'w-full ps-0 pe-1' }}
          />
        </FieldPanelRow>
        <FieldPanelRow
          title='Deposit date'
          type={BaseType.DATE}
          showIcon
          isRequired
          description='The date it hits the bank. This is the posting date, not the date the payments were received.'>
          {/* The date is held as `YYYY-MM-DD` (that is what `createBankDeposit`
              takes), so it is widened to an instant on the way in and sliced
              back on the way out - the same round trip the JE drawer does. */}
          <FieldInputAdapter
            fieldType={FieldType.DATE}
            value={depositDate ? `${depositDate}T00:00:00.000Z` : null}
            onChange={(value) => {
              const iso = value as string | null
              if (iso) onDepositDateChange(iso.slice(0, 10))
            }}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
          />
        </FieldPanelRow>
        <FieldPanelRow title='Reference' type={BaseType.STRING} showIcon isLastRow>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={reference}
            onChange={(value) => onReferenceChange((value as string | null) ?? '')}
            placeholder='Deposit slip number'
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
          />
        </FieldPanelRow>
      </FieldPanel>

      <div className='flex flex-col rounded-lg border'>
        <div className='flex items-center justify-between px-3 py-2 text-muted-foreground text-xs uppercase tracking-wide'>
          <span>Selected</span>
          <span>{selectedCount}</span>
        </div>
        <Separator />
        {selected.length === 0 ? (
          <p className='px-3 py-4 text-muted-foreground text-sm'>
            Tick the payments on the left that went into this bank run.
          </p>
        ) : (
          selected.map((row, index) => (
            <div key={row.paymentId}>
              {index > 0 && <Separator />}
              <div className='flex items-center gap-2 px-3 py-2 text-sm'>
                <span className='min-w-0 flex-1 truncate'>
                  {row.invoiceName || 'Unapplied payment'}
                </span>
                {row.reference ? (
                  <span className='text-muted-foreground text-xs'>{row.reference}</span>
                ) : null}
                <span className='font-mono tabular-nums'>
                  {formatMinor(row.amountMinor, DISPLAY_CURRENCY)}
                </span>
              </div>
            </div>
          ))
        )}
        <Separator />
        <div className='flex items-center justify-between px-3 py-2 font-medium text-sm'>
          <span>Deposit total</span>
          <span className='font-mono tabular-nums'>
            {formatMinor(selectedTotal, DISPLAY_CURRENCY)}
          </span>
        </div>
      </div>

      <Button disabled={!canRecord || isRecording} loading={isRecording} onClick={onRecord}>
        Record deposit
      </Button>

      <EntryBlockers blockers={blockers} />

      {recordedId ? <RecordedDeposit depositId={recordedId} /> : null}
    </div>
  )
}

/**
 * The just-recorded deposit, with its slip.
 *
 * The download goes through `useDocumentSendActions`, the same hook the quote,
 * invoice and purchase-order tabs use, so the slip is rendered once, cached as a
 * `MediaAsset` against `bank_deposit_pdf_asset` and versioned rather than
 * re-minted on every click.
 */
function RecordedDeposit({ depositId }: { depositId: string }) {
  const deposit = api.money.bankDeposit.get.useQuery({ depositId })
  const record = deposit.data

  if (!record) return null

  return (
    <div className='flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2'>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='font-medium text-sm'>Recorded {record.number ?? ''}</span>
        <span className='text-muted-foreground text-xs'>
          {record.payments.length} payment{record.payments.length === 1 ? '' : 's'} ·{' '}
          <span className='font-mono tabular-nums'>
            {formatMinor(record.totalMinor, DISPLAY_CURRENCY)}
          </span>
        </span>
      </div>
      <DepositSlipButton recordId={record.recordId} />
    </div>
  )
}

function DepositSlipButton({ recordId }: { recordId: string }) {
  const { handleDownload, isDownloading } = useDocumentSendActions(
    recordId as Parameters<typeof useDocumentSendActions>[0],
    'deposit slip'
  )
  return (
    <Button variant='outline' size='sm' loading={isDownloading} onClick={handleDownload}>
      <FileDown />
      Deposit slip
    </Button>
  )
}

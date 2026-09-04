// apps/web/src/components/accounting/ui/banking/review-queue-page.tsx

'use client'

// Accounting > Banking > Review queue (plans/accounting/ui-plan.md §2.8,
// plans/bank-connection/03-categorization-and-gl.md, HANDOFF slot 3B).
//
// ## What this screen is for
//
// Every bank line is exactly one of four things, and deciding which is the
// reviewer's real work: a document auxx already holds (MATCH, posts nothing), a
// direct expense or receipt (CODE, one entry), our own money moving between two
// of our accounts (TRANSFER, one cash-to-cash entry), or not ours at all
// (EXCLUDE). The real book this was designed against had 2,390 unreviewed items
// reaching back eighteen months, so the surface is built to clear a pile: state
// tabs, bulk selection, and a drawer that opens on the treatment rather than on
// an account picker.
//
// 🛑 **A matched line posts NOTHING** (decision B5). The document's own entry
// already credited cash; a second entry from the feed credits it twice, both
// balance, and nothing detects it until a cash account will not tie.
//
// ## ⚠️ Departure: a TreeRowList, not `RecordsView`
//
// `ui-plan.md` §2.8 calls for `RecordsView` in embedded mode with a
// `baselineFilter` on `reviewStatus` and a `primaryCellRender`. **`RecordsView`
// exposes none of those** - its props are `{ slug, basePath, pageActions }` and
// the baseline filter it does build is its own saved-view search group, private
// to the component. Adding three props to a component every records page in the
// app renders is not this slot's to do, and the queue needs filters
// (`RecordsView` has no date or amount range) that would need three more.
//
// So the list is a `TreeRowList` over `bankingReview.list`, which is the shape
// `entries-list.tsx` already uses on the ledger page. What is lost is saved
// views, column configuration and CSV export; what is gained is the amount
// range, the signed in/out colouring and the suggestion badge, none of which the
// registry can express. Reported in HANDOFF §5 for the coordinator.

import type { BankTransactionRow } from '@auxx/lib/banking/review/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { Inbox, Landmark } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useMedia } from '~/hooks/use-media'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { EMPTY_CELL, formatMinor } from '../ledger/format'
import { ReviewBulkBar } from './review/review-bulk-bar'
import { ReviewDrawer } from './review/review-drawer'
import { ReviewStats } from './review/review-stats'
import { EMPTY_REVIEW_FILTERS, type ReviewFilters, ReviewToolbar } from './review/review-toolbar'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Banking' },
  { title: 'Review queue' },
]

const PAGE_DESCRIPTION =
  'Bank lines waiting for a decision. Match one to something you already recorded, code it to an account, mark it a transfer between your own accounts, or exclude it.'

/**
 * The ledger is pinned to USD for the cutover (`LEDGER_CURRENCY`), so the
 * display currency is that constant rather than a read.
 */
const DISPLAY_CURRENCY = 'USD'

/** The status dot vocabulary, matching `ledger-toolbar.tsx`'s `STATE_DOT`. */
const STATUS_DOT: Record<string, string> = {
  for_review: 'bg-amber-500',
  suggested: 'bg-blue-500',
  matched: 'bg-green-500',
  coded: 'bg-teal-500',
  excluded: 'bg-muted-foreground',
}

/**
 * Dollars as typed to integer minor units, or `undefined` for a blank box.
 *
 * 🛑 `Math.round` at the LAST step, not `Math.trunc` and not a `toFixed` round
 * trip - both have shipped in this repo's history and both are wrong on the
 * doubles a currency input actually produces. Same rule as `toMinorUnits`.
 */
function toMinor(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return undefined
  return Math.round(parsed * 100)
}

export function BankingReviewQueuePage() {
  useRequireCapability(PermissionKey.ledgerView)

  const [filters, setFilters] = useState<ReviewFilters>(EMPTY_REVIEW_FILTERS)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [txn, setTxn] = useQueryState('txn')

  /**
   * ⚠️ `1280px`, not the `1024px` `ledger-page.tsx` docks at. This page sits
   * behind the Banking layout's `SidebarSecondary`, so the shell eats ~255px
   * more than the ledger's does: at 1100 the app rail plus that sidebar plus a
   * 450px panel leave the queue about 100px, which is not a list any more.
   * 1280 is the first width where the queue keeps a readable column.
   */
  const isDesktop = useMedia('(min-width: 1280px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  const accountsQuery = api.banking.bankAccount.list.useQuery()
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data])

  const listInput = useMemo(
    () => ({
      bankAccountId: filters.bankAccountId ?? undefined,
      state: filters.state,
      search: filters.search.trim() || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      amountMin: toMinor(filters.amountMin),
      amountMax: toMinor(filters.amountMax),
    }),
    [filters]
  )

  const list = api.bankingReview.list.useQuery(listInput)
  const stats = api.bankingReview.stats.useQuery({
    bankAccountId: filters.bankAccountId ?? undefined,
  })

  const rows = list.data ?? []

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    )
  }, [])

  const hasAccounts = accounts.length > 0

  /**
   * ⚠️ Built ONCE and memoised. The panel array below is published to the
   * Banking layout's docked slot through an effect, so a drawer element with a
   * fresh identity every render would re-publish on every render.
   */
  const drawer = useMemo(
    () => (
      <ReviewDrawer
        transactionId={txn}
        onOpenChange={(open) => {
          if (!open) void setTxn(null)
        }}
        isDocked={isDesktop}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        accounts={accounts}
        currencyCode={DISPLAY_CURRENCY}
      />
    ),
    [txn, setTxn, isDesktop, dockedWidth, setDockedWidth, accounts]
  )

  // The Banking LAYOUT owns the `MainPageContent`, so the docked panel is
  // published to it rather than passed as a prop (`docked-panels-outlet.tsx`).
  const dockedPanels = useMemo(
    () =>
      isDesktop && txn
        ? [
            {
              key: 'txn',
              content: drawer,
              width: dockedWidth,
              onWidthChange: setDockedWidth,
              minWidth: 380,
              maxWidth: 800,
            },
          ]
        : [],
    [isDesktop, txn, drawer, dockedWidth, setDockedWidth]
  )
  useRegisterDockedPanels(dockedPanels)

  return (
    <SettingsPage title='Review queue' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
      <div className='flex min-h-0 flex-1 flex-col'>
        <ReviewStats
          stats={stats.data}
          loading={stats.isPending}
          currencyCode={DISPLAY_CURRENCY}
          accountSelected={!!filters.bankAccountId}
        />

        <ReviewToolbar
          filters={filters}
          onChange={(next) => {
            setFilters(next)
            setSelectedIds([])
          }}
          accounts={accounts}
          accountsLoading={accountsQuery.isPending}
        />

        <ScrollArea className='min-h-0 flex-1'>
          <div className='flex flex-col gap-1 p-4 pb-24'>
            {!list.isPending && rows.length === 0 ? (
              <EmptyState
                icon={hasAccounts ? Inbox : Landmark}
                title={hasAccounts ? 'Nothing in this view' : 'No bank account yet'}
                description={
                  hasAccounts ? (
                    <span>
                      No bank lines match these filters. An empty For review tab is the healthy
                      state - it means every line the bank showed has been decided on.
                    </span>
                  ) : (
                    <span>
                      Add a bank account and map it to a GL account, then import a statement or
                      connect a feed. Until an account is mapped there is nothing to credit, so
                      nothing can be coded.
                    </span>
                  )
                }
                button={
                  hasAccounts ? undefined : (
                    <Button asChild variant='outline'>
                      <a href='/app/accounting/settings/bank-accounts'>Add a bank account</a>
                    </Button>
                  )
                }
              />
            ) : (
              <TreeRowList
                items={rows}
                loading={list.isPending}
                skeletonCount={6}
                getKey={(row: BankTransactionRow) => row.id}
                renderRow={(row: BankTransactionRow) => (
                  <TreeRow
                    className={TREE_SECONDARY_NOTRUNCATE}
                    icon={
                      <Checkbox
                        checked={selectedIds.includes(row.id)}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={() => toggle(row.id)}
                        aria-label={`Select ${row.description ?? row.id}`}
                      />
                    }
                    title={
                      <span className='truncate text-sm' title={row.matchKey ?? undefined}>
                        {row.description || EMPTY_CELL}
                      </span>
                    }
                    secondary={
                      <span className='flex flex-wrap items-center gap-1.5'>
                        <span className='font-mono text-xs tabular-nums text-muted-foreground'>
                          {row.postedAt ?? EMPTY_CELL}
                        </span>
                        {/* Amounts are unsigned with the direction in its own
                            badge, the same rule the ledger's own tables keep. */}
                        <span
                          className={cn(
                            'font-mono text-xs tabular-nums',
                            row.amountMinor < 0
                              ? 'text-foreground'
                              : 'text-green-700 dark:text-green-400'
                          )}>
                          {formatMinor(Math.abs(row.amountMinor), DISPLAY_CURRENCY)}
                        </span>
                        <Badge variant='outline' size='xs'>
                          {row.amountMinor < 0 ? 'Out' : 'In'}
                        </Badge>
                        {row.bankAccountName && (
                          <span className='text-muted-foreground text-xs'>
                            {row.bankAccountName}
                          </span>
                        )}
                        {row.bankStatus === 'void' && (
                          <Badge variant='outline' size='xs'>
                            Void
                          </Badge>
                        )}
                        {row.suggestedGlAccount && row.reviewStatus !== 'coded' && (
                          <Badge variant='blue' size='xs'>
                            Code: {row.suggestedGlAccount}
                          </Badge>
                        )}
                        {row.glAccountCode && (
                          <Badge variant='outline' size='xs' className='font-mono'>
                            {row.glAccountCode}
                          </Badge>
                        )}
                        <span className='flex items-center gap-1 text-muted-foreground text-xs'>
                          <span
                            className={cn(
                              'size-1.5 rounded-full',
                              STATUS_DOT[row.reviewStatus] ?? 'bg-muted-foreground'
                            )}
                            aria-hidden
                          />
                          {row.reviewStatus.replace('_', ' ')}
                        </span>
                      </span>
                    }
                    onToggleOpen={() => void setTxn(row.id)}
                  />
                )}
              />
            )}
          </div>
        </ScrollArea>
      </div>

      <ReviewBulkBar
        selectedIds={selectedIds}
        onClear={() => setSelectedIds([])}
        onDone={() => setSelectedIds([])}
      />

      {/* Below the dock breakpoint the same drawer renders as a floating
          overlay, the way every other docked panel's fallback does. */}
      {!isDesktop && drawer}
    </SettingsPage>
  )
}

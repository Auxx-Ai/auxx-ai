// apps/web/src/components/accounting/ui/ledger/sidebar/ledger-sidebar.tsx

'use client'

import type {
  BooksBalanceReport,
  DuplicateMovementFinding,
  RailFeeStatus,
  SyncQueueRow,
} from '@auxx/lib/postings/client'
import { ModuleSidebar } from '@auxx/ui/components/module-sidebar'
import { useLedgerSidebarStore } from '~/components/accounting/stores/ledger-sidebar-store'
import { BooksGroup } from './books-group'
import { CloseMonthGroup } from './close-month-group'
import { RailFeesGroup } from './rail-fees-group'
import { SyncQueueGroup } from './sync-queue-group'
import { ThisMonthGroup } from './this-month-group'

interface LedgerSidebarProps {
  periodLabel: string
  isLocked: boolean
  lockBlockedReason: string | null
  lockedThrough: string | null
  canControlLedger: boolean
  onToggleLock: () => void
  canReverse: boolean
  onReverse: () => void

  balanceReport: BooksBalanceReport | undefined
  balanceError: string | null
  duplicates: DuplicateMovementFinding[] | undefined
  currencyCode: string
  bookTimeZone: string

  /** Every ACTIVE payment rail and what the ledger says about its fees (brief 26 §6). */
  rails: RailFeeStatus[] | undefined
  railsError: string | null
  /** `YYYY-MM`, or `''` when no month resolved. The rail sentences are relative to it. */
  periodKey: string

  /** Setup is not finalized, or no month resolved: the Close group has nothing to act on. */
  hasPeriod: boolean

  // ── The sync queue (53 §7.2.4, D17) ──────────────────────────────────────
  /** Everything in the books and not in the provider's, ALL periods. */
  syncQueue: SyncQueueRow[] | undefined
  syncQueueError: string | null
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  /** The queue panel is what the main column is showing. */
  isSyncQueueOpen: boolean
  onOpenSyncQueue: () => void
  onCloseSyncQueue: () => void
}

/**
 * The ledger's module rail — the same shape the dispatch board uses
 * (`dispatch-sidebar.tsx`): a `ModuleSidebar` sitting under the toolbar as a
 * flex sibling of the content, holding stacked collapsible groups.
 *
 * 🛑 What is in here is everything that is true ABOUT the month rather than the
 * work ON it: declaring it shut, and anything the balance sweep found. As
 * full-width `Section`s in the main scroll these had the same weight as the
 * month-end entry, and the screen had nine of them. The entry, its refusals and
 * the period's other entries stay in the main column, which is what somebody
 * opened this page for.
 *
 * 🛑 CHOOSING the month is not in here. That is the toolbar's dropdown, and it
 * is the only one - one value with two pickers on one screen is two things to
 * keep in step for no gain.
 *
 * ⚠️ `BooksGroup` renders nothing when the sweep found nothing, so on a clean
 * set of books this rail is the lock and its closed-through line. That is the
 * intent: it carries what needs looking at, not a fixed set of headings.
 */
export function LedgerSidebar({
  periodLabel,
  isLocked,
  lockBlockedReason,
  lockedThrough,
  canControlLedger,
  onToggleLock,
  canReverse,
  onReverse,
  balanceReport,
  balanceError,
  duplicates,
  currencyCode,
  bookTimeZone,
  rails,
  railsError,
  periodKey,
  hasPeriod,
  syncQueue,
  syncQueueError,
  providerLabel,
  isSyncQueueOpen,
  onOpenSyncQueue,
  onCloseSyncQueue,
}: LedgerSidebarProps) {
  const open = useLedgerSidebarStore((state) => state.open)
  const setOpen = useLedgerSidebarStore((state) => state.setOpen)

  return (
    <ModuleSidebar open={open} onOpenChange={setOpen}>
      {hasPeriod && (
        <CloseMonthGroup
          periodLabel={periodLabel}
          isLocked={isLocked}
          lockBlockedReason={lockBlockedReason}
          lockedThrough={lockedThrough}
          canControlLedger={canControlLedger}
          onToggleLock={onToggleLock}
          canReverse={canReverse}
          onReverse={onReverse}
        />
      )}

      {/* 🛑 Gated on a month, unlike `BooksGroup`: two of the three things §6
          says are knowable about a rail's fees are about a specific month, so
          with no month resolved there is nothing here to say. */}
      {hasPeriod && (
        <RailFeesGroup
          rails={rails}
          error={railsError}
          monthKey={periodKey}
          bookTimeZone={bookTimeZone}
        />
      )}

      {/* 🛑 NOT gated on a month, and this is the point of it. The queue is a
          backlog that spans months (§7.2.4), so gating the only door to it on
          the month the toolbar resolved would hide every entry held from an
          earlier one. */}
      <SyncQueueGroup
        rows={syncQueue}
        error={syncQueueError}
        providerLabel={providerLabel}
        isOpen={isSyncQueueOpen}
        onOpen={onOpenSyncQueue}
        onClose={onCloseSyncQueue}
      />

      {/* ⚠️ NOT gated on a month. Balance is a WHOLE-LEDGER fact; the month only
          adds the completeness half. */}
      <BooksGroup
        report={balanceReport}
        error={balanceError}
        duplicates={duplicates}
        currencyCode={currencyCode}
        bookTimeZone={bookTimeZone}
      />

      {/* The fourth group: what posted this month, per type, as a fact (brief
          28 §6). Gated on a month like the rails, since every number in it is
          about one month. It runs its own read; the month key is its only
          input. */}
      {hasPeriod && <ThisMonthGroup monthKey={periodKey} />}
    </ModuleSidebar>
  )
}

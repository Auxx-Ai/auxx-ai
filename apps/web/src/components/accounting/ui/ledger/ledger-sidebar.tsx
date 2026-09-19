// apps/web/src/components/accounting/ui/ledger/ledger-sidebar.tsx

'use client'

import type { ExportBatchRow } from '@auxx/lib/accounting/export'
import { ModuleSidebar } from '@auxx/ui/components/module-sidebar'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@auxx/ui/components/sidebar'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { BookOpenCheck, Send } from 'lucide-react'
import { useLedgerSidebarStore } from '~/components/accounting/stores/ledger-sidebar-store'

interface ExportQueueTally {
  ready: number
  sending: number
  failed: number
  total: number
}

/** 🛑 `sent` is not counted: the rail is about what is OUTSTANDING. */
function tallyExportBatches(rows: ExportBatchRow[] | undefined): ExportQueueTally {
  const tally = { ready: 0, sending: 0, failed: 0, total: 0 }
  for (const row of rows ?? []) {
    if (row.state === 'ready') tally.ready++
    else if (row.state === 'sending') tally.sending++
    else if (row.state === 'failed') tally.failed++
    else continue
    tally.total++
  }
  return tally
}

/** Null when nothing is outstanding - a figure that reads the same every day is one nobody reads. */
function outboxRailSentence(
  tally: ExportQueueTally,
  draftCount: number,
  blockedCount: number,
  providerLabel: string
): string | null {
  if (tally.total === 0 && draftCount === 0 && blockedCount === 0) return null
  const parts: string[] = []
  if (draftCount > 0) parts.push(`${draftCount} waiting for approval`)
  if (blockedCount > 0) parts.push(`${blockedCount} refused by the ledger`)
  if (tally.ready > 0) parts.push(`${tally.ready} ready to send`)
  if (tally.sending > 0) parts.push(`${tally.sending} sending`)
  if (tally.failed > 0) parts.push(`${tally.failed} refused`)
  return `${parts.join(', ')}. Sends to ${providerLabel}.`
}

/** Which of the two things the ledger's content column is showing. */
export type LedgerView = 'closeout' | 'outbox'

/**
 * The surface `SidebarSecondary` sits on, applied to this rail so the ledger
 * matches Banking, Reports and Settings instead of being visibly darker than
 * all three in light mode.
 *
 * 🛑 It has to be a CHILD selector, and that is not a flourish. `Sidebar`
 * (non-fixed branch) paints `bg-sidebar` on an INNER `[data-sidebar=sidebar]`
 * panel and hands `className` to the OUTER element, so a plain `bg-neutral-50`
 * here is painted over and does nothing. The two tokens are exactly the pair
 * `sidebar-secondary.tsx` uses on its own wrapper (`bg-neutral-50
 * dark:bg-sidebar`), so a theme change moves both surfaces together - this is
 * not a colour matched by hand.
 *
 * ⚠️ Why the ledger and not `ModuleSidebar` itself: the dispatch board and the
 * schedule calendar are module rails with nothing beside them to match, and
 * `bg-sidebar` is right for them. This rail is a secondary NAV sitting in a
 * module whose other three tabs all render `SidebarSecondary`, which is also
 * why its rows are `variant='secondary'` - a variant whose muted text and
 * `hover:bg-black/5` wash were tuned for `bg-neutral-50` in the first place.
 *
 * ⚠️ Not applied to the mobile Sheet: `Sidebar`'s mobile branch drops
 * `className` entirely. Nothing renders beside the sheet to compare it to.
 */
const SECONDARY_SURFACE =
  '[&>[data-sidebar=sidebar]]:bg-neutral-50 dark:[&>[data-sidebar=sidebar]]:bg-sidebar'

interface LedgerSidebarProps {
  view: LedgerView
  onSelectView: (view: LedgerView) => void
  /** Everything in the books and not in the provider's, ALL periods. */
  syncQueue: ExportBatchRow[] | undefined
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  /** Drafts awaiting approval, ALL periods - `ledger.listDrafts`' own count, not `syncQueue`'s. */
  draftCount: number
  /** Movements the ledger refused, ALL periods - `ledger.listBlockedMovements`' SQL count. */
  blockedCount: number
}

/**
 * The ledger's navigation column: a header and two destinations, in the
 * shape `SidebarSecondary` gives Banking, Reports and Accounting settings.
 *
 * ```
 * Ledger
 *   Closeout          <- the month: its entry, its refusals, its other entries
 *   Outbox        15  <- everything on its way out, all periods: drafts awaiting
 *                        approval, then the export batches (`outbox-panel.tsx`)
 * ```
 *
 * 🛑 **It is NAVIGATION now, not a dashboard.** It used to hold five groups of
 * live data - the lock, the balance sweep and its duplicates, processor fees per
 * rail, and what posted this month. Four of those five were numbers nobody
 * clicks, and a rail whose content reads the same every day teaches people to
 * stop reading the rail. The figures did not vanish: they are Kopilot's to
 * answer on the `accounting.ledger` page (`get_ledger_status`), and the lock
 * moved into the Closeout column beside the entry it closes over.
 *
 * 🛑 TWO items, one route. `SidebarSecondary` itself is not reused here even
 * though this copies its metrics, because every row it renders is a `<Link>` to
 * `${baseUrl}/${slug}` - and the ledger is one URL whose state rides in the
 * query string (`?month=`, `?queue=`, `?posting=`). Routing these rows as links
 * would drop the month on every click. They are buttons over the same nuqs
 * setters the rest of the page uses, so the deep links keep working.
 *
 * 🛑 CHOOSING the month is still not in here - that is the toolbar's dropdown,
 * and it is the only one. Only Closeout is scoped to it; every Outbox tab
 * spans every period.
 */
export function LedgerSidebar({
  view,
  onSelectView,
  syncQueue,
  providerLabel,
  draftCount,
  blockedCount,
}: LedgerSidebarProps) {
  const open = useLedgerSidebarStore((state) => state.open)
  const setOpen = useLedgerSidebarStore((state) => state.setOpen)

  const tally = tallyExportBatches(syncQueue)
  const outboxSentence = outboxRailSentence(tally, draftCount, blockedCount, providerLabel)
  const outboxCount = tally.total + draftCount + blockedCount

  return (
    <ModuleSidebar open={open} onOpenChange={setOpen} className={SECONDARY_SURFACE}>
      {/* `py-2` on the group and `h-8` on the label, because `SidebarGroup` pads
          HORIZONTALLY only and `SidebarGroupLabel` is `h-6` by default. Those
          two overrides are what `SidebarNavGroup` in `sidebar-secondary.tsx`
          gives every group under /app/accounting/banking, /reports and
          /settings (`p-2` around an `h-8` label), and matching it is the whole
          point of using the plain label. */}
      <SidebarGroup className='py-2'>
        <SidebarGroupLabel className='h-8'>Ledger</SidebarGroupLabel>

        <SidebarMenu className='gap-1'>
          <SidebarMenuItem>
            <SidebarMenuButton
              variant='secondary'
              size='compact'
              isActive={view === 'closeout'}
              onClick={() => onSelectView('closeout')}>
              <BookOpenCheck />
              <span>Closeout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            {/* ⚠️ The count is the WHOLE backlog, every period - not the month
                the toolbar resolved. Held batches are the hold working, so the
                badge carries no colour; only the sentence on hover
                distinguishes a refusal from an ordinary wait. */}
            <SimpleTooltip
              content={
                outboxSentence ??
                `Nothing is waiting to be approved or copied to ${providerLabel}. Every period, not only the month on screen.`
              }>
              <SidebarMenuButton
                variant='secondary'
                size='compact'
                isActive={view === 'outbox'}
                onClick={() => onSelectView('outbox')}>
                <Send />
                {/* Both spans carry their own `truncate`: the cva's
                    `[&>span:last-child]:truncate` only reaches the LAST direct
                    child, which is the count once there is one. */}
                <span className='truncate'>Outbox</span>
                {outboxCount > 0 && (
                  <span className='ml-auto text-muted-foreground text-xs tabular-nums'>
                    {outboxCount}
                  </span>
                )}
              </SidebarMenuButton>
            </SimpleTooltip>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </ModuleSidebar>
  )
}

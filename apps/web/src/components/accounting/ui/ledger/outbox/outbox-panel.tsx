// apps/web/src/components/accounting/ui/ledger/outbox/outbox-panel.tsx

'use client'

// Accounting > Ledger > the OUTBOX (TARGET §3, §4 gate 1 and 2, step 3 part C).
//
// One strip over the whole pipeline of work leaving the books: Drafts (posted
// with `autoPost` off), Blocked (the ledger refused the movement), then the
// export-batch states. This is the shell - the strip, its counts and the
// build control; each tab's rows live in its own panel beside this file.
//
// 🛑 All periods, EVERY tab. The outbox is a backlog that can span months, so
// every tab reads with no `month` bound. "Build batches for this month" is the
// one control that DOES take the month on screen - building freezes a payload
// out of POSTED entries, which is inherently a month's worth of work at a time.

import {
  type ExportBatchTab,
  isExportBatchTab,
  OUTBOX_TABS,
  type OutboxTab,
} from '@auxx/lib/accounting/export/client'
import { EXPORT_AVENUES } from '@auxx/lib/accounting/ledger/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { toastError } from '@auxx/ui/components/toast'
import { Hammer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  ListSelectionProvider,
  SelectAllCheckbox,
  useListSelection,
} from '~/components/list-selection'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { BatchesPanel } from './batches-panel'
import { BlockedPanel } from './blocked-panel'
import { DraftsPanel } from './drafts-panel'
import { OUTBOX_LIST_PADDING, TAB_ICON, TAB_LABEL } from './outbox-tabs'

interface OutboxPanelProps {
  tab: OutboxTab
  onTabChange: (tab: OutboxTab) => void
  /** The month on screen, for "Build batches for this month". `''` resolves none. */
  periodKey: string
  periodLabel: string
  bookTimeZone: string
  currencyCode: string
  /** 🔌 The provider's own tenant, for a `PostResultCallout` deep link. */
  connectedTenantId: string | null
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  /** So an open row reads as "the one you are looking at" the same as the rail strip does. */
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
  activeMovementId: string | null
  onSelectMovement: (moneyTransactionId: string) => void
}

/**
 * The outbox. One `ListSelectionProvider` per mount, same as the banking review
 * queue - leaving the outbox disposes the selection.
 */
export function OutboxPanel(props: OutboxPanelProps) {
  return (
    <ListSelectionProvider>
      <OutboxBody {...props} />
    </ListSelectionProvider>
  )
}

function OutboxBody({
  tab,
  onTabChange,
  periodKey,
  periodLabel,
  bookTimeZone,
  currencyCode,
  connectedTenantId,
  providerLabel,
  activePostingId,
  onSelectPosting,
  activeMovementId,
  onSelectMovement,
}: OutboxPanelProps) {
  const utils = api.useUtils()
  const { can } = useAccess()
  const canRelease = can(PermissionKey.ledgerPost)
  const canRollback = can(PermissionKey.ledgerControl)

  // 🛑 Drafts and Blocked are `ledgerPost`-gated on the server, so the tabs are
  // absent, not disabled, for a read-only member - a tab that 403s on click is
  // worse than one never offered. `effectiveTab` catches a pasted link.
  const effectiveTab: OutboxTab =
    (tab === 'drafts' || tab === 'blocked') && !canRelease ? 'ready' : tab
  const tabs = useMemo(
    () => OUTBOX_TABS.filter((value) => canRelease || isExportBatchTab(value)),
    [canRelease]
  )

  // One SQL read for every badge - no tab's count rides on its rows.
  const countsQuery = api.ledger.outboxCounts.useQuery()
  const counts = countsQuery.data
  const tally: Record<OutboxTab, number> = {
    drafts: counts?.drafts ?? 0,
    blocked: counts?.blocked ?? 0,
    // Ready holds `sending` too (75-D6).
    ready: (counts?.ready ?? 0) + (counts?.sending ?? 0),
    sent: counts?.sent ?? 0,
    failed: counts?.failed ?? 0,
  }

  // ⚠️ Free: `useSettings` rides the org cache the provider already hydrated.
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const heldForRelease = EXPORT_AVENUES.every(
    (avenue) =>
      getSetting(`accounting.autoSend.${avenue}` as Parameters<typeof getSetting>[0]) !== true
  )
  const monthLabel = periodLabel || 'this month'

  const exitSelection = useListSelection((state) => state.exit)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tab is the trigger
  useEffect(() => {
    exitSelection()
  }, [effectiveTab])

  const build = api.ledger.exportBatches.build.useMutation({
    onSuccess: () => {
      void utils.ledger.exportBatches.list.invalidate()
      void utils.ledger.outboxCounts.invalidate()
    },
    onError: (error) => toastError({ title: 'Error building batches', description: error.message }),
  })
  const [buildResult, setBuildResult] = useState<Awaited<
    ReturnType<typeof build.mutateAsync>
  > | null>(null)

  function handleBuild() {
    if (!periodKey) return
    setBuildResult(null)
    build.mutate({ periodKey }, { onSuccess: (result) => setBuildResult(result) })
  }

  const emptyCopy = (value: OutboxTab) =>
    emptyDescription(value, providerLabel, monthLabel, heldForRelease)

  return (
    <div className='flex flex-1 flex-col'>
      <ListToolbar>
        <SelectAllCheckbox listPadding={OUTBOX_LIST_PADDING} />
        <ListToolbarGroup className='shrink-0'>
          <RadioTab
            value={effectiveTab}
            onValueChange={(value) => onTabChange(value as OutboxTab)}
            size='sm'>
            {tabs.map((value) => {
              const Icon = TAB_ICON[value]
              const count = tally[value]
              return (
                <RadioTabItem key={value} value={value}>
                  <Icon />
                  {TAB_LABEL[value]}
                  {count > 0 && <span className='tabular-nums opacity-60'>{count}</span>}
                </RadioTabItem>
              )
            })}
          </RadioTab>
        </ListToolbarGroup>
        {canRelease && (
          <ListToolbarGroup align='end'>
            <Button
              variant='outline'
              size='sm'
              disabled={!periodKey}
              loading={build.isPending}
              loadingText='Building…'
              onClick={handleBuild}>
              <Hammer />
              Build batches for {monthLabel}
            </Button>
          </ListToolbarGroup>
        )}
      </ListToolbar>

      {buildResult && (
        <p className='px-3 pt-3 text-muted-foreground text-xs'>
          {buildResultSentence(buildResult, monthLabel)}
        </p>
      )}

      {effectiveTab === 'blocked' ? (
        <BlockedPanel
          emptyDescription={emptyCopy('blocked')}
          bookTimeZone={bookTimeZone}
          activeMovementId={activeMovementId}
          onSelectMovement={onSelectMovement}
        />
      ) : effectiveTab === 'drafts' ? (
        <DraftsPanel
          emptyDescription={emptyCopy('drafts')}
          currencyCode={currencyCode}
          bookTimeZone={bookTimeZone}
          providerLabel={providerLabel}
          connectedTenantId={connectedTenantId}
          activePostingId={activePostingId}
          onSelectPosting={onSelectPosting}
        />
      ) : (
        <BatchesPanel
          // Remounts per tab, so one tab's open rows and selection never leak into the next.
          key={effectiveTab}
          tab={effectiveTab}
          emptyTitle={emptyTitle(effectiveTab)}
          emptyDescription={emptyCopy(effectiveTab)}
          bookTimeZone={bookTimeZone}
          providerLabel={providerLabel}
          canRelease={canRelease}
          canRollback={canRollback}
          activePostingId={activePostingId}
          onSelectPosting={onSelectPosting}
        />
      )}
    </div>
  )
}

function buildResultSentence(
  result: {
    built: number
    batchIds: string[]
    skippedBeforeCutover: number
    connected: boolean
  },
  monthLabel: string
): string {
  if (!result.connected) return 'No accounting system is connected, so nothing was built.'
  const skipped = result.skippedBeforeCutover
  const postings = `${skipped} posting${skipped === 1 ? '' : 's'}`
  if (result.built === 0) {
    return skipped > 0
      ? `Nothing built for ${monthLabel}: ${postings} dated before the export cutover.`
      : `${monthLabel} has no posted entry that is not already in a batch.`
  }
  const tail = skipped > 0 ? ` ${postings} skipped, dated before the cutover.` : ''
  return `Built ${result.built} batch${result.built === 1 ? '' : 'es'} for ${monthLabel}.${tail}`
}

/** ⚠️ An empty Ready tab is the HEALTHY state and has to read like one. */
function emptyTitle(tab: ExportBatchTab): string {
  switch (tab) {
    case 'ready':
      return 'Nothing is waiting to be sent'
    case 'sent':
      return 'Nothing has been sent yet'
    case 'failed':
      return 'Nothing has been refused'
  }
}

/** ⚠️ Names WHICH month Build would take, and why a tab is empty (75-D7) - it used to read as a fault. */
function emptyDescription(
  tab: OutboxTab,
  providerLabel: string,
  monthLabel: string,
  heldForRelease: boolean
): string {
  const held = heldForRelease
    ? ' No avenue has auto-send switched on, so a batch that is built is held for release rather than sent.'
    : ''
  switch (tab) {
    case 'blocked':
      return 'Nothing the ledger refused is waiting. A movement lands here when its entry could not be built - an account role nothing is mapped to, a period that is shut - and leaves it the moment a retry is accepted.'
    case 'drafts':
      return `A draft is left here when its avenue posts with autoPost switched off (Settings › Posting). Approving one posts its entry; it does not build an export batch - "Build batches for ${monthLabel}" does, for that month alone.${held}`
    case 'ready':
      return `These tabs list every period, so nothing anywhere is waiting to be sent. "Build batches for ${monthLabel}" freezes that month's posted entries into batches, and nothing is built until somebody asks.${held}`
    case 'sent':
      return `Nothing has settled in ${providerLabel} yet, in any period. A batch is built one month at a time - ${monthLabel} is the one the button above takes - and then released.${held}`
    case 'failed':
      return `${providerLabel} has not refused a batch, in any period. A refusal shows the reason it gave, on the row.`
  }
}

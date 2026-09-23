// apps/web/src/components/accounting/ui/ledger/use-ledger-drawers.tsx

'use client'

import type { ExportBatchTab } from '@auxx/lib/accounting/export/client'
import { parseAsArrayOf, parseAsString, useQueryStates } from 'nuqs'
import { type ReactNode, useCallback, useMemo } from 'react'
import { JournalEntryDrawer } from '~/components/accounting/ui/journal/journal-entry-drawer'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { type DrawerFrame, toFrame } from '~/components/records/record-drill-panels'
import { useMedia } from '~/hooks/use-media'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { LEDGER_RECORD_TAB_PARAM, LedgerDrawerHost } from './ledger-drawer-host'

interface LedgerDrawersOptions {
  /** `''` when no month resolved; `useLedgerEntryActions` clears its result per month. */
  periodKey: string
  currencyCode: string
  bookTimeZone: string
  providerLabel: string
  /** Seeds a new journal entry's Date. */
  defaultEntryDate: string
  /** A posting's export-batch row wants the Outbox at that tab. Omit on the Outbox itself. */
  onOpenOutbox?: (tab: ExportBatchTab) => void
}

export interface LedgerDrawers {
  postingId: string | null
  movementId: string | null
  /** A refused shipment from the Outbox's Blocked tab. */
  shipmentId: string | null
  /** A Summary row's key, `unbuiltGroupKeyString`. */
  summaryKey: string | null
  journalEntryParam: string | null
  openPosting: (glPostingId: string) => void
  openMovement: (moneyTransactionId: string) => void
  openShipment: (fulfillmentId: string) => void
  openSummary: (key: string) => void
  openJournalEntry: (id: string) => void
  /** Clears every drawer param. The way out of a route that is leaving. */
  closeDrawers: () => void
  /** Below the dock breakpoint the same drawers render as floating overlays. Render last. */
  overlays: ReactNode
}

/**
 * The ledger drawers — `?posting=`, `?movement=`, `?shipment=`, `?summary=`, `?je=` — for
 * Closeout and Outbox alike, published into the layout's docked outlet.
 *
 * 🛑 They share ONE dock slot (ui-plan.md §2.1), so opening one closes the
 * others rather than letting the params coexist unrendered. A posting and a
 * movement are two frames of ONE host (83 §2.4); only `?je=` is its own drawer.
 */
export function useLedgerDrawers({
  periodKey,
  currencyCode,
  bookTimeZone,
  providerLabel,
  defaultEntryDate,
  onOpenOutbox,
}: LedgerDrawersOptions): LedgerDrawers {
  const utils = api.useUtils()
  const isDesktop = useMedia('(min-width: 1024px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  // 🛑 The deep link. A ledger entry is the thing somebody pastes into Slack.
  // `je`/`movement` are the other two; `peek`/`panel`/`item`/`rtab` are the host's
  // stack, cleared in the SAME write so a new base never inherits a stale frame.
  // The page's own `tab` is deliberately absent: on the Outbox it is the tab strip.
  const [params, setParams] = useQueryStates({
    posting: parseAsString,
    je: parseAsString,
    movement: parseAsString,
    shipment: parseAsString,
    summary: parseAsString,
    peek: parseAsArrayOf(parseAsString),
    panel: parseAsString,
    item: parseAsString,
    [LEDGER_RECORD_TAB_PARAM]: parseAsString,
  })
  const { posting: postingId, je: journalEntryParam, movement: movementId } = params
  const shipmentId = params.shipment
  const summaryKey = params.summary

  const setBase = useCallback(
    (next: {
      posting?: string | null
      je?: string | null
      movement?: string | null
      shipment?: string | null
      summary?: string | null
    }) => {
      void setParams({
        posting: next.posting ?? null,
        je: next.je ?? null,
        movement: next.movement ?? null,
        shipment: next.shipment ?? null,
        summary: next.summary ?? null,
        peek: null,
        panel: null,
        item: null,
        [LEDGER_RECORD_TAB_PARAM]: null,
      })
    },
    [setParams]
  )

  const openPosting = useCallback((id: string) => setBase({ posting: id }), [setBase])
  const openJournalEntry = useCallback((id: string) => setBase({ je: id }), [setBase])
  const openMovement = useCallback((id: string) => setBase({ movement: id }), [setBase])
  const openShipment = useCallback((id: string) => setBase({ shipment: id }), [setBase])
  const openSummary = useCallback((key: string) => setBase({ summary: key }), [setBase])
  const closeDrawers = useCallback(() => setBase({}), [setBase])

  // `je` wins, then `movement`, `posting`, `shipment`, `summary` — the params are mutually
  // exclusive by construction, so this only decides a hand-written URL.
  const baseFrame: DrawerFrame | null = journalEntryParam
    ? null
    : movementId
      ? toFrame('movement', movementId)
      : postingId
        ? toFrame('posting', postingId)
        : shipmentId
          ? toFrame('shipment', shipmentId)
          : summaryKey
            ? toFrame('summary', summaryKey)
            : null

  const ledgerDrawer = useMemo(
    () => (
      <LedgerDrawerHost
        baseFrame={baseFrame}
        onOpenChange={(open) => {
          if (!open) setBase({})
        }}
        isDocked={isDesktop}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        periodKey={periodKey}
        currencyCode={currencyCode}
        bookTimeZone={bookTimeZone}
        providerLabel={providerLabel}
        onOpenOutbox={
          onOpenOutbox
            ? (tab) => {
                setBase({})
                onOpenOutbox(tab)
              }
            : undefined
        }
      />
    ),
    [
      baseFrame,
      bookTimeZone,
      currencyCode,
      dockedWidth,
      isDesktop,
      onOpenOutbox,
      periodKey,
      providerLabel,
      setBase,
      setDockedWidth,
    ]
  )

  const journalEntryDrawer = useMemo(
    () => (
      <JournalEntryDrawer
        journalEntryId={journalEntryParam === 'new' ? null : journalEntryParam}
        isNew={journalEntryParam === 'new'}
        open={!!journalEntryParam}
        onOpenChange={(open) => {
          if (!open) setBase({})
        }}
        isDocked={isDesktop}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        currencyCode={currencyCode}
        defaultDate={defaultEntryDate}
        onCreated={(id) => openJournalEntry(id)}
        onPosted={(glPostingId) => {
          void utils.ledger.listPostings.invalidate()
          void utils.ledger.journalEntry.list.invalidate()
          void utils.ledger.periods.invalidate()
          openPosting(glPostingId)
        }}
        onOpenPosting={openPosting}
        onDiscarded={() => {
          // The record and its lines are deleted; close the drawer over it.
          setBase({})
          void utils.ledger.journalEntry.list.invalidate()
        }}
      />
    ),
    [
      currencyCode,
      defaultEntryDate,
      dockedWidth,
      isDesktop,
      journalEntryParam,
      openJournalEntry,
      openPosting,
      setBase,
      setDockedWidth,
      utils,
    ]
  )

  const panels = useMemo(() => {
    if (!isDesktop || !(baseFrame || journalEntryParam)) return []
    return [
      {
        key: journalEntryParam ? 'je' : 'ledger',
        content: journalEntryParam ? journalEntryDrawer : ledgerDrawer,
        width: dockedWidth,
        onWidthChange: setDockedWidth,
        minWidth: 380,
        maxWidth: 800,
      },
    ]
  }, [
    baseFrame,
    dockedWidth,
    isDesktop,
    journalEntryDrawer,
    journalEntryParam,
    ledgerDrawer,
    setDockedWidth,
  ])

  useRegisterDockedPanels(panels)

  /**
   * 🛑 Gated on the PARAM, not just the breakpoint. Rendered unconditionally the
   * JE drawer never unmounted, so its draft hook kept the closed entry's lines
   * and the next `?je=new` opened onto the previous entry with every button
   * disabled. The dock above is gated the same way.
   */
  const overlays = (
    <>
      {!isDesktop && !!baseFrame && ledgerDrawer}
      {!isDesktop && !!journalEntryParam && journalEntryDrawer}
    </>
  )

  return {
    postingId,
    movementId,
    shipmentId,
    summaryKey,
    journalEntryParam,
    openPosting,
    openMovement,
    openShipment,
    openSummary,
    openJournalEntry,
    closeDrawers,
    overlays,
  }
}

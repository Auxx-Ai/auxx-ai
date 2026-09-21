// apps/web/src/components/accounting/ui/ledger/use-ledger-drawers.tsx

'use client'

import type { ExportBatchTab } from '@auxx/lib/accounting/export/client'
import { useQueryState } from 'nuqs'
import { type ReactNode, useCallback, useMemo } from 'react'
import { useLedgerEntryActions } from '~/components/accounting/hooks/use-ledger-entry-actions'
import { JournalEntryDrawer } from '~/components/accounting/ui/journal/journal-entry-drawer'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { useMedia } from '~/hooks/use-media'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { MovementDrawer } from './movement-drawer'
import { PostingDrawer } from './posting-drawer'

interface LedgerDrawersOptions {
  /** `''` when no month resolved; `useLedgerEntryActions` clears its result per month. */
  periodKey: string
  currencyCode: string
  bookTimeZone: string
  providerLabel: string
  /** Seeds a new journal entry's Date. */
  defaultEntryDate: string
  /** A posting's export-batch row wants the Outbox at that tab. */
  onOpenOutbox: (tab: ExportBatchTab) => void
}

export interface LedgerDrawers {
  postingId: string | null
  movementId: string | null
  journalEntryParam: string | null
  openPosting: (glPostingId: string) => void
  openMovement: (moneyTransactionId: string) => void
  openJournalEntry: (id: string) => void
  /** Clears every drawer param. The way out of a route that is leaving. */
  closeDrawers: () => void
  /** Below the dock breakpoint the same drawers render as floating overlays. Render last. */
  overlays: ReactNode
}

/**
 * The three ledger drawers — `?posting=`, `?movement=`, `?je=` — for Closeout
 * and Outbox alike, published into the layout's docked outlet.
 *
 * 🛑 They share ONE dock slot (ui-plan.md §2.1), so opening one closes the
 * others rather than letting the params coexist unrendered.
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
  const [postingId, setPostingId] = useQueryState('posting')
  // `?je=new` or `?je=<journalEntryId>` - the JE drawer (HANDOFF slot 1B).
  const [journalEntryParam, setJournalEntryParam] = useQueryState('je')
  // `?movement=<moneyTransactionId>` - a movement the ledger refused (75-D1).
  const [movementId, setMovementId] = useQueryState('movement')

  const openPosting = useCallback(
    (id: string) => {
      void setJournalEntryParam(null)
      void setMovementId(null)
      void setPostingId(id)
    },
    [setJournalEntryParam, setMovementId, setPostingId]
  )
  const openJournalEntry = useCallback(
    (id: string) => {
      void setPostingId(null)
      void setMovementId(null)
      void setJournalEntryParam(id)
    },
    [setJournalEntryParam, setMovementId, setPostingId]
  )
  const openMovement = useCallback(
    (id: string) => {
      void setPostingId(null)
      void setJournalEntryParam(null)
      void setMovementId(id)
    },
    [setJournalEntryParam, setMovementId, setPostingId]
  )
  const closeDrawers = useCallback(() => {
    void setPostingId(null)
    void setJournalEntryParam(null)
    void setMovementId(null)
  }, [setJournalEntryParam, setMovementId, setPostingId])

  const actions = useLedgerEntryActions({
    periodKey,
    // Reverse acts on whichever posting is open in the drawer.
    glPostingId: postingId ?? null,
  })
  const { runReverse, isReversing } = actions

  const postingDrawer = useMemo(
    () => (
      <PostingDrawer
        postingId={postingId}
        onOpenChange={(open) => {
          if (!open) void setPostingId(null)
        }}
        onSelectPosting={openPosting}
        isDocked={isDesktop}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        currencyCode={currencyCode}
        bookTimeZone={bookTimeZone}
        providerLabel={providerLabel}
        onOpenOutbox={(tab) => {
          void setPostingId(null)
          onOpenOutbox(tab)
        }}
        onReverse={runReverse}
        isReversing={isReversing}
      />
    ),
    [
      bookTimeZone,
      currencyCode,
      dockedWidth,
      isDesktop,
      isReversing,
      onOpenOutbox,
      openPosting,
      postingId,
      providerLabel,
      runReverse,
      setDockedWidth,
      setPostingId,
    ]
  )

  const movementDrawer = useMemo(
    () => (
      <MovementDrawer
        movementId={movementId}
        onOpenChange={(open) => {
          if (!open) void setMovementId(null)
        }}
        onSelectPosting={openPosting}
        isDocked={isDesktop}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        bookTimeZone={bookTimeZone}
      />
    ),
    [bookTimeZone, dockedWidth, isDesktop, movementId, openPosting, setDockedWidth, setMovementId]
  )

  const journalEntryDrawer = useMemo(
    () => (
      <JournalEntryDrawer
        journalEntryId={journalEntryParam === 'new' ? null : journalEntryParam}
        isNew={journalEntryParam === 'new'}
        open={!!journalEntryParam}
        onOpenChange={(open) => {
          if (!open) void setJournalEntryParam(null)
        }}
        isDocked={isDesktop}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        currencyCode={currencyCode}
        defaultDate={defaultEntryDate}
        onCreated={(id) => void setJournalEntryParam(id)}
        onPosted={(glPostingId) => {
          void utils.ledger.listPostings.invalidate()
          void utils.ledger.journalEntry.list.invalidate()
          void utils.ledger.periods.invalidate()
          openPosting(glPostingId)
        }}
        onOpenPosting={openPosting}
        onDiscarded={() => {
          // The record is archived, so every read that could still be showing it
          // is stale - and the drawer itself is now open over a record no read
          // path returns. Close it.
          void setJournalEntryParam(null)
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
      openPosting,
      setDockedWidth,
      setJournalEntryParam,
      utils,
    ]
  )

  const panels = useMemo(() => {
    if (!isDesktop || !(postingId || journalEntryParam || movementId)) return []
    return [
      {
        key: journalEntryParam ? 'je' : movementId ? 'movement' : 'posting',
        content: journalEntryParam
          ? journalEntryDrawer
          : movementId
            ? movementDrawer
            : postingDrawer,
        width: dockedWidth,
        onWidthChange: setDockedWidth,
        minWidth: 380,
        maxWidth: 800,
      },
    ]
  }, [
    dockedWidth,
    isDesktop,
    journalEntryDrawer,
    journalEntryParam,
    movementDrawer,
    movementId,
    postingDrawer,
    postingId,
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
      {!isDesktop && !!postingId && postingDrawer}
      {!isDesktop && !!journalEntryParam && journalEntryDrawer}
      {!isDesktop && !!movementId && movementDrawer}
    </>
  )

  return {
    postingId,
    movementId,
    journalEntryParam,
    openPosting,
    openMovement,
    openJournalEntry,
    closeDrawers,
    overlays,
  }
}

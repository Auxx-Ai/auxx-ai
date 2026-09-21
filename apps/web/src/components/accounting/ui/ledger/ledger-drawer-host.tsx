// apps/web/src/components/accounting/ui/ledger/ledger-drawer-host.tsx

'use client'

import type { ExportBatchTab } from '@auxx/lib/accounting/export/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { EntityIcon } from '@auxx/ui/components/icons'
import { NavStack, NavStackPanel, NavStackPanels } from '@auxx/ui/components/nav-stack'
import { ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { useLedgerEntryActions } from '~/components/accounting/hooks/use-ledger-entry-actions'
import { DrawerRecordFrame } from '~/components/drawers/base-entity-drawer'
import { Tooltip } from '~/components/global/tooltip'
import {
  type DrawerFrame,
  DrawerTabParamProvider,
  frameKind,
  RecordStackProvider,
  toFrame,
  useRecordPeekStack,
} from '~/components/records/record-drill-panels'
import { useRecordDrawerReadOnly } from '~/components/records/use-record-drawer-read-only'
import { useResource } from '~/components/resources'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { MovementFrame, useMovementFrameHeader } from './movement-frame'
import { type FrameHeader, PostingFrame, usePostingFrameHeader } from './posting-frame'

/** 🛑 Not `tab`: on the Outbox that is the page's own tab strip, and a record
 * frame's tab bar would bounce the list from Drafts back to Ready behind the drawer. */
export const LEDGER_RECORD_TAB_PARAM = 'rtab'

interface LedgerDrawerHostProps {
  /** `~posting:<id>` / `~movement:<id>` from `?posting=` / `?movement=`; `null` closes. */
  baseFrame: DrawerFrame | null
  onOpenChange: (open: boolean) => void
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
  /** `''` when no month resolved; `useLedgerEntryActions` clears its result per month. */
  periodKey: string
  currencyCode: string
  bookTimeZone: string
  providerLabel: string
  /** Close this drawer and open the outbox on the batch's own tab. */
  onOpenOutbox: (tab: ExportBatchTab) => void
}

/**
 * The ledger's one docked drawer, and the stack inside it (83 §2.4): a posting
 * drills to its movement, a movement to its postings, and either to any record
 * it links, without leaving the slot.
 *
 * The stack is `useRecordPeekStack` — the record drawer's own hook, widened to
 * `DrawerFrame` — so every push clears `panel`/`item` in the same write and a
 * pushed `DrawerRecordFrame` can never inherit the previous frame's drill.
 */
export function LedgerDrawerHost(props: LedgerDrawerHostProps) {
  return (
    <DrawerTabParamProvider value={LEDGER_RECORD_TAB_PARAM}>
      <LedgerDrawerFrames {...props} />
    </DrawerTabParamProvider>
  )
}

function LedgerDrawerFrames({
  baseFrame,
  onOpenChange,
  isDocked,
  width,
  onWidthChange,
  periodKey,
  currencyCode,
  bookTimeZone,
  providerLabel,
  onOpenOutbox,
}: LedgerDrawerHostProps) {
  const peek = useRecordPeekStack<DrawerFrame>(baseFrame)
  const { frames, top, depth, push } = peek
  const isBaseTop = depth <= 1
  const router = useRouter()

  const openPosting = useCallback((id: string) => push(toFrame('posting', id)), [push])

  const topKind = top ? frameKind(top) : null
  const topRecordId = topKind?.kind === 'record' ? topKind.recordId : null

  // Every header hook runs unconditionally (hooks rule); the two that are not on
  // top get a `null` id, which disables their reads.
  const actions = useLedgerEntryActions({
    periodKey,
    glPostingId: topKind?.kind === 'posting' ? topKind.id : null,
  })
  const postingHeader = usePostingFrameHeader(topKind?.kind === 'posting' ? topKind.id : null, {
    onReverse: actions.runReverse,
    isReversing: actions.isReversing,
  })
  const movementHeader = useMovementFrameHeader(topKind?.kind === 'movement' ? topKind.id : null, {
    onOpenPosting: openPosting,
  })
  const { resource: recordResource } = useResource(
    topRecordId ? parseRecordId(topRecordId).entityDefinitionId : null
  )
  const recordLink = useRecordLink(topRecordId)

  const recordHeader: FrameHeader = {
    drawerTitle: recordResource?.label ?? 'Record',
    icon: (
      <EntityIcon
        iconId={recordResource?.icon || 'circle'}
        color={recordResource?.color || 'gray'}
        className='size-6'
      />
    ),
    title: <span className='font-medium'>{recordResource?.label ?? 'Record'}</span>,
    actions: recordLink && (
      <Tooltip content='Open full page'>
        <Button variant='ghost' size='icon-xs' onClick={() => router.push(recordLink)}>
          <ExternalLink />
        </Button>
      </Tooltip>
    ),
  }

  const header =
    topKind?.kind === 'posting'
      ? postingHeader
      : topKind?.kind === 'movement'
        ? movementHeader
        : recordHeader

  const handleClose = useCallback(() => {
    peek.clear()
    onOpenChange(false)
  }, [onOpenChange, peek.clear])

  // `DockableDrawer`'s own close paths (outside click, swipe, Escape) bypass
  // `handleClose` — clear the stack there too.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) peek.clear()
      onOpenChange(nextOpen)
    },
    [onOpenChange, peek.clear]
  )

  // Guards against the NavStack shrinking out from under the URL, keeping
  // `peek` truncated to match.
  const handleFrameStackChange = useCallback(
    (next: string[]) => {
      if (next.length < frames.length) peek.pop()
    },
    [frames.length, peek.pop]
  )

  const stackCtx = useMemo(() => ({ push, depth }), [push, depth])

  return (
    <DockableDrawer
      open={!!baseFrame}
      onOpenChange={handleOpenChange}
      isDocked={isDocked}
      width={width}
      onWidthChange={onWidthChange}
      minWidth={380}
      maxWidth={720}
      title={header.drawerTitle}>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={header.icon}
          title={header.title}
          actions={header.actions}
          onBack={isBaseTop ? undefined : peek.pop}
          onClose={handleClose}
        />

        {/* The base panel is keyed by position only, so a row click swaps its id
            in place (one fetch, no crossfade remount); pushed frames carry their
            id so truncating back to a visited frame cannot reuse a stale panel. */}
        <RecordStackProvider value={stackCtx}>
          <NavStack
            stack={frames.map((frame, i) => (i === 0 ? '0:base' : `${i}:${frame}`))}
            onStackChange={handleFrameStackChange}
            className='flex flex-col flex-1 min-h-0'>
            <NavStackPanels className='flex-1 min-h-0'>
              {frames.map((frame, i) => {
                const kind = frameKind(frame)
                const value = i === 0 ? '0:base' : `${i}:${frame}`
                return (
                  <NavStackPanel key={value} value={value} className='h-full flex flex-col'>
                    {kind.kind === 'record' ? (
                      <LedgerRecordFrame recordId={kind.recordId} />
                    ) : kind.kind === 'movement' ? (
                      <MovementFrame movementId={kind.id} bookTimeZone={bookTimeZone} />
                    ) : (
                      <PostingFrame
                        postingId={kind.id}
                        currencyCode={currencyCode}
                        bookTimeZone={bookTimeZone}
                        providerLabel={providerLabel}
                        onOpenOutbox={onOpenOutbox}
                        onReverse={actions.runReverse}
                        isReversing={actions.isReversing}
                      />
                    )}
                  </NavStackPanel>
                )
              })}
            </NavStackPanels>
          </NavStack>
        </RecordStackProvider>

        {header.overlay}
      </div>
    </DockableDrawer>
  )
}

/** `DrawerRecordFrame` with its own read-only verdict — per frame, not per host. */
function LedgerRecordFrame({ recordId }: { recordId: RecordId }) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const readOnly = useRecordDrawerReadOnly(entityDefinitionId, entityInstanceId)
  return <DrawerRecordFrame recordId={recordId} isBase={false} readOnly={readOnly} />
}

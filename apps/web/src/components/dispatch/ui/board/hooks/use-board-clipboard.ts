// apps/web/src/components/dispatch/ui/board/hooks/use-board-clipboard.ts

'use client'

import type { HoveredSlot } from '@auxx/ui/components/event-calendar'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useCallback, useRef, useState } from 'react'
import {
  type CopiedVisitItem,
  useClipboardCopy,
  useClipboardItems,
} from '~/components/calendar/core/clipboard-store'
import { toRecordId } from '~/components/resources'
import type { DispatchVisitEvent } from '../types'

/** Where a paste lands — the board-local mirror of `HoveredSlot` (day + fractional hours +
 * resource column), built either from the live hover ref (Cmd+V) or a right-click snapshot
 * (context menu "Paste here"). `time`/`resourceId` are absent for a day-only target (month
 * view, or no cell ever hovered — falls back to the board's current anchor date). */
export interface PasteAnchor {
  day: Date
  time?: number
  resourceId?: string
}

interface UseBoardClipboardOptions {
  events: DispatchVisitEvent[]
  selectedVisitIds: string[]
  /** Board's current anchor date (`useBoardData().date`) — the Cmd+V fallback target when
   * nothing's been hovered yet (plan 37c §5, item 5). */
  boardDate: Date
  /** `work-orders` resource's entityDefinitionId — needed to turn a
   * `DispatchVisitEvent.workOrderId` (an `EntityInstance` id) into the `RecordId`
   * `dispatch.pasteVisits` wants. `undefined` while resources are still loading; copy/paste
   * stay inert until it resolves. */
  workOrderDefId: string | undefined
  canEdit: boolean
}

/**
 * Board clipboard state machine (plan 37c §4, board-only per Phase 3's scope): owns the
 * hovered-slot ref `board-calendar-grid.tsx` feeds into `EventCalendar`, the Cmd+C/Cmd+V
 * keybindings, and the paste-options dialog's open/target state. Copy/context-menu targeting
 * stay in `board-calendar-grid.tsx` (it already owns selection + chip DOM); this hook only
 * exposes the primitives (`copyIds`, `openPasteDialogAt`) they call into.
 */
export function useBoardClipboard({
  events,
  selectedVisitIds,
  boardDate,
  workOrderDefId,
  canEdit,
}: UseBoardClipboardOptions) {
  const clipboardItems = useClipboardItems()
  const copyToClipboard = useClipboardCopy()
  const hoveredSlotRef = useRef<HoveredSlot | null>(null)
  const [pasteTarget, setPasteTarget] = useState<PasteAnchor | null>(null)

  const copyIds = useCallback(
    (ids: string[]) => {
      if (!canEdit || !workOrderDefId || ids.length === 0) return
      const idSet = new Set(ids)
      const picked = events.filter((e) => idSet.has(e.id))
      if (picked.length === 0) return
      const items: CopiedVisitItem[] = picked.map((e) => ({
        kind: 'visit',
        visitId: e.id,
        workOrderRecordId: toRecordId(workOrderDefId, e.workOrderId),
        title: e.title,
        start: e.start,
        end: e.end,
        assigneeUserId: e.assigneeUserId,
      }))
      copyToClipboard(items)
    },
    [events, copyToClipboard, workOrderDefId, canEdit]
  )

  const copySelection = useCallback(() => copyIds(selectedVisitIds), [copyIds, selectedVisitIds])

  const openPasteDialogAt = useCallback(
    (target: PasteAnchor | null) => {
      if (!canEdit || !clipboardItems) return
      setPasteTarget(target ?? { day: boardDate })
    },
    [canEdit, clipboardItems, boardDate]
  )

  const openPasteDialogAtHoveredSlot = useCallback(() => {
    const slot = hoveredSlotRef.current
    openPasteDialogAt(
      slot ? { day: slot.date, time: slot.time, resourceId: slot.resourceId } : null
    )
  }, [openPasteDialogAt])

  const closePasteDialog = useCallback(() => setPasteTarget(null), [])

  // Cmd/Ctrl+C — copies the current selection. `ignoreInputs: true` mirrors the workflow
  // canvas's own Mod+V precedent (`use-workflow-shortcuts.ts`): Ctrl/Meta combos default to
  // FIRING inside text inputs (`@tanstack/hotkeys`'s per-key default), which would hijack a
  // dispatcher's native copy while editing a title/note field. A non-empty text selection is
  // also left alone — the user is copying text, not events.
  useHotkey(
    'Mod+C',
    () => {
      if (!canEdit || selectedVisitIds.length === 0) return
      if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
      copySelection()
    },
    { ignoreInputs: true, enabled: canEdit }
  )

  // Cmd/Ctrl+V — opens the paste-options dialog anchored at the hovered slot (plan 37c §5, H).
  useHotkey(
    'Mod+V',
    () => {
      if (!canEdit || !clipboardItems) return
      openPasteDialogAtHoveredSlot()
    },
    { ignoreInputs: true, enabled: canEdit }
  )

  return {
    hoveredSlotRef,
    clipboardItems,
    hasClipboard: clipboardItems !== null,
    copyIds,
    copySelection,
    pasteTarget,
    openPasteDialogAt,
    openPasteDialogAtHoveredSlot,
    closePasteDialog,
  }
}

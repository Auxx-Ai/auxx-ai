// apps/web/src/components/calendar/core/use-calendar-clipboard.ts
//
// Generic clipboard state machine shared by every `EventCalendar` consumer that offers visit
// copy/paste (plan `37c-calendar-create-copy-paste.md` §4/§8) — extracted in Phase 6 from the
// dispatch board's `use-board-clipboard.ts` (the board now wraps this) so the schedule surface
// gets the same hovered-slot ref, Cmd+C/Cmd+V keybindings, and paste-dialog target state without
// duplicating them. `canCopy`/`canPaste` are separate gates (not one `canEdit`) because the
// schedule surface's copy is open to everyone while paste stays admin/owner-only (every dispatch
// write is `dispatchAdminProcedure`) — the board happens to gate both the same way.

'use client'

import type { HoveredSlot } from '@auxx/ui/components/event-calendar'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useCallback, useRef, useState } from 'react'
import { toRecordId } from '~/components/resources'
import { type CopiedVisitItem, useClipboardCopy, useClipboardItems } from './clipboard-store'

/** Where a paste lands — the consumer-local mirror of `HoveredSlot` (day + fractional hours +
 * resource column), built either from the live hover ref (Cmd+V) or a right-click snapshot
 * (context menu "Paste here"). `time`/`resourceId` are absent for a day-only target (month view,
 * or no cell ever hovered — falls back to the consumer's current anchor date). */
export interface PasteAnchor {
  day: Date
  time?: number
  resourceId?: string
}

/** The minimal shape `useCalendarClipboard` needs off a consumer's own event type to build a
 * `CopiedVisitItem` — every visit-backed calendar event (the board's `DispatchVisitEvent`,
 * schedule's `VisitEvent` once it carries `workOrderId`) satisfies this structurally; no adapter
 * type is needed at the call site. */
export interface ClipboardVisitEvent {
  id: string
  workOrderId: string
  title: string
  start: Date
  end: Date
  assigneeWorkerId: string | null
}

export interface UseCalendarClipboardOptions<E extends ClipboardVisitEvent> {
  /** The consumer's own pastable (visit) events, already narrowed to whatever subset is
   * copy-eligible — schedule pre-filters `sourceId === 'visits'` out of its mixed
   * visits/meetings/tasks feed before calling in; the board's events are all visits already. */
  events: E[]
  selectedIds: string[]
  /** The consumer's current anchor date — the Cmd+V fallback target when nothing's been
   * hovered yet (plan 37c §5, item 5 / board's `boardDate`). */
  anchorDate: Date
  /** `work-orders` resource's entityDefinitionId — needed to turn an event's `workOrderId` (an
   * `EntityInstance` id) into the `RecordId` `dispatch.pasteVisits` wants. `undefined` while
   * resources are still loading; copy/paste stay inert until it resolves. */
  workOrderDefId: string | undefined
  /** Whether this user may copy — everyone on schedule, admin/owner-gated (same as `canPaste`)
   * on the board. */
  canCopy: boolean
  /** Whether this user may paste — admin/owner only wherever visit writes are gated. */
  canPaste: boolean
}

/**
 * Owns the hovered-slot ref a grid feeds via `EventCalendar`'s `hoveredSlotRef` prop, the
 * Cmd+C/Cmd+V keybindings, and the paste-options dialog's open/target state. Copy/context-menu
 * targeting (WHICH ids to copy) stays with the caller — this hook only exposes the primitives
 * (`copyIds`, `openPasteDialogAt`) they call into.
 */
export function useCalendarClipboard<E extends ClipboardVisitEvent>({
  events,
  selectedIds,
  anchorDate,
  workOrderDefId,
  canCopy,
  canPaste,
}: UseCalendarClipboardOptions<E>) {
  const clipboardItems = useClipboardItems()
  const copyToClipboard = useClipboardCopy()
  const hoveredSlotRef = useRef<HoveredSlot | null>(null)
  const [pasteTarget, setPasteTarget] = useState<PasteAnchor | null>(null)

  const copyIds = useCallback(
    (ids: string[]) => {
      if (!canCopy || !workOrderDefId || ids.length === 0) return
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
        assigneeWorkerId: e.assigneeWorkerId,
      }))
      copyToClipboard(items)
    },
    [events, copyToClipboard, workOrderDefId, canCopy]
  )

  const copySelection = useCallback(() => copyIds(selectedIds), [copyIds, selectedIds])

  const openPasteDialogAt = useCallback(
    (target: PasteAnchor | null) => {
      if (!canPaste || !clipboardItems) return
      setPasteTarget(target ?? { day: anchorDate })
    },
    [canPaste, clipboardItems, anchorDate]
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
      if (!canCopy || selectedIds.length === 0) return
      if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
      copySelection()
    },
    { ignoreInputs: true, enabled: canCopy }
  )

  // Cmd/Ctrl+V — opens the paste-options dialog anchored at the hovered slot (plan 37c §5, H).
  useHotkey(
    'Mod+V',
    () => {
      if (!canPaste || !clipboardItems) return
      openPasteDialogAtHoveredSlot()
    },
    { ignoreInputs: true, enabled: canPaste }
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

// apps/web/src/components/dispatch/ui/board/hooks/use-board-clipboard.ts

'use client'

import {
  type PasteAnchor,
  useCalendarClipboard,
} from '~/components/calendar/core/use-calendar-clipboard'
import type { DispatchVisitEvent } from '../types'

/** Re-exported so board files keep importing the anchor type from this hook (the generic
 * primitive it wraps lives in `~/components/calendar/core/use-calendar-clipboard`, plan 37c §8's
 * Phase 6 extraction — schedule's clipboard hook consumes the same type). */
export type { PasteAnchor }

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
 * Board clipboard state machine (plan 37c §4, board-only per Phase 3's scope): a thin wrapper
 * over the generic `useCalendarClipboard` (Phase 6 extraction) — the board gates copy AND paste
 * on the same `canEdit` (schedule's Phase 6 hook gates them separately). Copy/context-menu
 * targeting stay in `board-calendar-grid.tsx` (it already owns selection + chip DOM); this hook
 * only exposes the primitives (`copyIds`, `openPasteDialogAt`) they call into.
 */
export function useBoardClipboard({
  events,
  selectedVisitIds,
  boardDate,
  workOrderDefId,
  canEdit,
}: UseBoardClipboardOptions) {
  return useCalendarClipboard({
    events,
    selectedIds: selectedVisitIds,
    anchorDate: boardDate,
    workOrderDefId,
    canCopy: canEdit,
    canPaste: canEdit,
  })
}

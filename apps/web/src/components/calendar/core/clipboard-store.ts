// apps/web/src/components/calendar/core/clipboard-store.ts

import { create } from 'zustand'

/** One copied visit (plan `37c-calendar-create-copy-paste.md` §4.1) — a kind-discriminated
 * union when more clipboard kinds land (schedule's meetings/tasks stay non-pastable v1, so
 * `'visit'` is the only member today). */
export interface CopiedVisitItem {
  kind: 'visit'
  visitId: string
  /** Full `RecordId` (def + instance) of the work order this visit belongs to — what
   * `dispatch.pasteVisits` wants on the wire. Resolve from a `DispatchVisitEvent.workOrderId`
   * (an `EntityInstance` id, `board/types.ts`) via `toRecordId(workOrderDefId, workOrderId)`
   * at copy time, not paste time — the clipboard is source-agnostic once filled. */
  workOrderRecordId: string
  title: string
  start: Date
  end: Date
  assigneeWorkerId: string | null
}

interface CalendarClipboard {
  /** `null` = empty clipboard (nothing copied yet this session). */
  items: CopiedVisitItem[] | null
  copy: (items: CopiedVisitItem[]) => void
  clear: () => void
}

/**
 * One global, unpersisted clipboard (plan 37c §4.1) — a plain module-level zustand store (not
 * `localStorage`-backed, cleared on page reload) so copy-on-one-surface → paste-on-another
 * works for free (board today; the schedule surface lands in Phase 6). Consumers must read via
 * the selector hooks below, never destructure the whole store (repo Zustand convention).
 */
const useCalendarClipboardStore = create<CalendarClipboard>((set) => ({
  items: null,
  copy: (items) => set({ items }),
  clear: () => set({ items: null }),
}))

/** The current clipboard contents, or `null` if nothing's copied. */
export function useClipboardItems(): CopiedVisitItem[] | null {
  return useCalendarClipboardStore((s) => s.items)
}

/** Replace the clipboard wholesale — a fresh copy always overwrites, never appends. */
export function useClipboardCopy(): (items: CopiedVisitItem[]) => void {
  return useCalendarClipboardStore((s) => s.copy)
}

/** Not called by the paste flow itself (repeat pastes are allowed, plan 37c §4.3) — available
 * for a future explicit "clear clipboard" affordance. */
export function useClipboardClear(): () => void {
  return useCalendarClipboardStore((s) => s.clear)
}

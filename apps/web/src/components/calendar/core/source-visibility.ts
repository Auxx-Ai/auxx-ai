// apps/web/src/components/calendar/core/source-visibility.ts

/**
 * Module-level stable empty array — returned by `hiddenIdsForGroup` when a group has no
 * hidden entries, so a zustand selector reading it doesn't create a new reference (and churn
 * re-renders) every call.
 */
const EMPTY_HIDDEN: string[] = []

/**
 * A group's hidden-id list out of the sidebar store's `hidden` map, or the stable empty array
 * when the group has no entries yet. Safe to call with a zustand-selected `hidden` object —
 * the stable empty avoids re-render churn.
 */
export function hiddenIdsForGroup(hidden: Record<string, string[]>, group: string): string[] {
  return hidden[group] ?? EMPTY_HIDDEN
}

/** Whether `id` is in a group's already-resolved hidden-id list. */
export function isSourceHidden(hiddenIds: string[], id: string): boolean {
  return hiddenIds.includes(id)
}

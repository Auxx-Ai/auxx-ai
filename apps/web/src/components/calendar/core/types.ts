// apps/web/src/components/calendar/core/types.ts

import type { EventCalendarItem, RenderEventContext } from '@auxx/ui/components/event-calendar'
import type { ReactNode } from 'react'

/**
 * One toggleable row in the sidebar. `group` buckets rows into sidebar groups
 * ('kinds' | 'accounts' on the calendar page; dispatch defines its own).
 */
export interface CalendarSourceDescriptor {
  id: string // 'visits' | 'meetings' | `account:<credentialId>`
  label: string
  group: string
  /** Resolved hex — toggle-row dot + default event color. */
  color?: string
}

/** What a source's data hook returns for the shell's visible range. */
export interface CalendarSourceData<E extends EventCalendarItem = EventCalendarItem> {
  events: E[]
  isLoading: boolean
}

/**
 * A composed source: descriptor + range-scoped events hook + chip renderer.
 * Hook rules apply — a page's source list must be static per mount.
 *
 * - `enabled` lets the shell skip the query entirely for hidden sources (not just filter the
 *   result) — a hidden Google account shouldn't fetch.
 * - Color stays per-surface (decision D, plan §1): the contract carries `descriptor.color` as
 *   a default; `useEvents` may stamp per-event colors (dispatch's worker axis does; the
 *   meetings source won't). No color logic in the shell.
 * - Deliberately NOT in the contract (dispatch keeps these page-level, the calendar page
 *   doesn't need them v1): resources/columns, backlog, DnD payloads, background events /
 *   availability shading, popovers. If a second consumer needs one later, promote it then.
 */
export interface CalendarSource<E extends EventCalendarItem = EventCalendarItem> {
  descriptor: CalendarSourceDescriptor
  useEvents: (range: { from: Date; to: Date }, enabled: boolean) => CalendarSourceData<E>
  renderEvent: (event: E, ctx: RenderEventContext) => ReactNode
}

/**
 * Every event a source contributes carries the id of the source that produced it, so a
 * page-level `renderEvent` can dispatch to the right source renderer. Deliberately NOT added
 * to `EventCalendarItem` in `@auxx/ui` — the grid itself doesn't care which source an event
 * came from.
 */
export type SourcedEvent = EventCalendarItem & { sourceId: string }

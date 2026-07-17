// packages/ui/src/components/event-calendar/event-popover/types.ts

import type * as React from 'react'
import type { NavigationItem } from '../../command'

/** Which occurrences of a recurring event a commit should apply to. */
export type SeriesScope = 'this' | 'following' | 'all'

/**
 * Base config enabling the commit-time series-scope chooser (`useSeriesScope`). Non-members
 * (`isMember: false`) skip the chooser and commit immediately with `scope: 'this'`.
 */
export interface EventSeriesConfig {
  isMember: boolean
  labels?: { this?: string; following?: string; all?: string }
  /** Hide the "All visits" option — the past-occurrence scope-chooser collapse (a past pick's
   * "all" would behave identically to "following", which is dishonest). Consumers relabel
   * `labels.following` (e.g. "Future visits") to match when this is set. */
  hideAll?: boolean
}

/**
 * A drill-in page pushed onto the event popover's `CommandNavigation` stack. Content is supplied
 * by the OWNING section via `EventDrillPage` (a portal into the chrome's outlet), which keeps the
 * page in the consumer's live subtree — so it re-renders with fresh props/state. The optional
 * `render` is a chrome-invoked fallback for static pages only; it is captured at push-time and
 * never re-invoked on consumer re-renders, so anything stateful must NOT use it.
 */
export interface EventDrillItem extends NavigationItem {
  render?: () => React.ReactNode
}

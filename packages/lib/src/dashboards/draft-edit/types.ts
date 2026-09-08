// packages/lib/src/dashboards/draft-edit/types.ts

/**
 * The model-facing type surface of the dashboard draft-edit module
 * (`plans/dashboard/v3/01-draft-edit-module.md` §3). Pure types, no runtime,
 * so this file is safe to import from anywhere in the module.
 *
 * The one rule that shapes every projection here: **grid coordinates are
 * stripped**. A widget reaches the model as a title, a kind and a one-line
 * config summary, never as a `{ column, row, columnSpan, rowSpan }`. Placement
 * is automatic on the way in and settled by the grid compactor on the way out,
 * exactly as `projectNode` strips `position` in the workflow capability.
 *
 * No permission checks live in this module (house rule): callers assert
 * `assertEditInstance('dashboard', id)` before calling in.
 */

import type { WidgetKind } from '../client'

/** Where an edit applies. The org id is never taken from the doc. */
export interface DashboardEditScope {
  dashboardId: string
  organizationId: string
}

/** A mutation additionally needs the turn it belongs to (snapshot + lock). */
export interface DashboardMutationScope extends DashboardEditScope {
  turnId: string
}

/** How badly an {@link Issue} bites: an error blocks publish, a warning does not. */
export type IssueSeverity = 'error' | 'warning'

/** One problem found in a layout doc. */
export interface Issue {
  severity: IssueSeverity
  message: string
  /** The widget the issue belongs to, as a ref the caller can echo back. */
  widgetRef?: string
  /**
   * Already in the draft before this edit. A refused edit reports the whole
   * doc, and without this split the caller reads damage it did not do as the
   * reason it was refused, then "fixes" a widget it never touched.
   */
  preExisting?: boolean
}

/** A widget for the model: everything but grid coordinates. */
export interface WidgetSummary {
  /** Title. Unique per doc (enforced by the add/update ops). */
  ref: string
  id: string
  /** Title of the tab the widget lives on. */
  tab: string
  kind: WidgetKind
  /** One-line config summary; bodies stay behind the read-one path. */
  config: string
  configured: boolean
}

/** A tab for the model: title, id, and how much is on it. */
export interface TabSummary {
  ref: string
  id: string
  widgetCount: number
}

/** The whole doc at a glance, cheap enough to ride every mutation result. */
export interface LayoutSummary {
  tabCount: number
  widgetCount: number
  unconfiguredCount: number
  tabs: TabSummary[]
}

/** What every mutation returns. */
export interface LayoutMutationResult {
  applied: boolean
  /** The edit resolved to a no-op: reported rather than written as a phantom edit. */
  unchanged?: boolean
  widget?: WidgetSummary
  widgets?: WidgetSummary[]
  layoutSummary: LayoutSummary
  issues: Issue[]
  /** The issues that ACTUALLY refused this write. Severity is not causality. */
  blockedBy?: Issue[]
}

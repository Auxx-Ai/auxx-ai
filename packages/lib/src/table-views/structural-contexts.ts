// packages/lib/src/table-views/structural-contexts.ts

import { type ViewContextType, viewContextTypes } from '../conditions/field-view-config'

/**
 * View contexts that are **definition configuration**, not user-authored artifacts.
 *
 * A `panel` / `dialog_create` / `dialog_edit` `TableView` is the field layout of an
 * entity definition: which fields show in the Details panel and in the create/edit
 * dialogs. There is at most one per definition per context, it is written by a def
 * admin through a gate of its own (`isStructural` → `assertStructuralAccess`), and
 * nobody names it or picks it from a list.
 *
 * A `table` / `kanban` view is the opposite: a member makes it, names it, and
 * chooses it. That is the artifact the `savedViews` plan limit is meant to meter.
 *
 * The distinction has two consumers and they MUST agree:
 * 1. the def-admin gate on structural writes (`table-view-structural.ts`), and
 * 2. {@link countSavedViewsUsed}, which excludes these rows from the plan limit.
 *
 * Keeping one set here is the point. The counter's own history is the argument:
 * three independent counters for one billing invariant is exactly how they drifted
 * apart before.
 */
export const STRUCTURAL_CONTEXT_TYPES = [
  'panel',
  'dialog_create',
  'dialog_edit',
] as const satisfies readonly ViewContextType[]

/** Set form for membership checks. */
export const STRUCTURAL_CONTEXT_TYPE_SET: ReadonlySet<string> = new Set(STRUCTURAL_CONTEXT_TYPES)

/**
 * Contexts whose shared rows DO consume the `savedViews` plan limit — the
 * complement of {@link STRUCTURAL_CONTEXT_TYPES}, derived rather than typed out so
 * a new context type cannot be silently omitted from both lists.
 */
export const BILLABLE_VIEW_CONTEXT_TYPES: readonly ViewContextType[] = viewContextTypes.filter(
  (contextType) => !STRUCTURAL_CONTEXT_TYPE_SET.has(contextType)
)

/**
 * Whether a view's context makes it definition configuration rather than a saved view.
 * Tolerates the free-form `string | null` the DB column and router inputs carry.
 */
export function isStructuralContextType(contextType: string | null | undefined): boolean {
  return contextType != null && STRUCTURAL_CONTEXT_TYPE_SET.has(contextType)
}

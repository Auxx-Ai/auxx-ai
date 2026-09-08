// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/dashboard-tool-helpers.ts

import type { Result } from 'neverthrow'
import type { Issue, LayoutMutationResult } from '../../../../../dashboards/draft-edit'
import type { AuxxError } from '../../../../../errors'
import type { AgentToolPermission } from '../../../../agent-framework/tool-permission'
import type { AgentToolResult } from '../../../../agent-framework/types'

// See `../client.ts` for why no tool in this capability carries a
// `toolsetSlug`, and why `surfaces: ['builder']` stays a literal in every
// factory rather than a shared spread.

/**
 * Shared `permission` declaration for the dashboard-builder tools. Every one
 * routes through `resolveDashboardAuthoring` before doing anything else;
 * `level` narrows per tool (view for reads and discovery, edit for every draft
 * mutation), matching the tRPC ladder.
 */
export function dashboardToolPermission(level: 'view' | 'edit' | 'admin'): AgentToolPermission {
  return {
    target: 'instance',
    keys: ['dashboard'],
    level,
    enforcement: 'enforced',
    note:
      'resolveDashboardAuthoring - fail-closed on absent capabilities, PermissionKey.dashboardsView ' +
      'area rung, org-scope + archived check on the session dashboard ref, ' +
      `${
        level === 'view'
          ? 'canViewInstance (silent read filter)'
          : level === 'edit'
            ? 'assertEditInstance'
            : 'assertAdminInstance'
      } ` +
      'per dashboard, then the dirty gate and the canvas turn lock. Proven behaviourally by ' +
      'dashboard-builder/tools/__tests__/dashboard-authoring-guard.test.ts.',
  }
}

/** The projected success output every dashboard mutation tool returns. */
export interface ProjectedMutation {
  applied: boolean
  /** Nothing was written because the requested state already held. */
  unchanged?: boolean
  /** Human line for the status pill, and what `buildDigest` picks up. */
  summary: string
  widget?: LayoutMutationResult['widget']
  widgets?: LayoutMutationResult['widgets']
  issues: Issue[]
  layoutSummary: LayoutMutationResult['layoutSummary']
}

/** Render one issue as a line the model can act on. */
function renderIssue(issue: Issue): string {
  return `- ${issue.widgetRef ? `${issue.widgetRef}: ` : ''}${issue.message}`
}

/**
 * Convert a draft-edit mutation `Result` into an `AgentToolResult`. The touched
 * widget, the layout summary and the issues ride every write, so a caller never
 * needs a follow-up read to learn what its own edit did.
 *
 * - `err(AuxxError)` becomes a tool error carrying the actionable message
 *   (`ConflictError`'s re-read-and-retry text included). Returned, not thrown,
 *   so the model can recover in-turn.
 * - `applied: false` becomes a tool error naming what BLOCKED the write; the
 *   draft is untouched.
 * - `applied: true` is a success.
 *
 * `summarize` names the completed action for the status pill, e.g.
 * "Added KPI: Open tickets".
 */
export function mutationToToolResult<T extends LayoutMutationResult>(
  result: Result<T, AuxxError>,
  summarize: (value: T) => string,
  extra?: (value: T) => Record<string, unknown>
): AgentToolResult {
  if (result.isErr()) {
    return { success: false, output: null, error: result.error.message }
  }
  const value = result.value
  const projected: ProjectedMutation & Record<string, unknown> = {
    applied: value.applied,
    ...(value.unchanged ? { unchanged: true } : {}),
    // Say plainly that nothing moved. `summarize` would otherwise report
    // "Updated X" for a write that wrote nothing, which is what lets a model
    // re-issue the same edit without ever learning it was already applied.
    summary: value.unchanged
      ? `No change - ${value.widget?.ref ?? 'the target'} already had these values.`
      : summarize(value),
    ...(value.widget ? { widget: value.widget } : {}),
    ...(value.widgets ? { widgets: value.widgets } : {}),
    issues: value.issues,
    layoutSummary: value.layoutSummary,
    ...(extra ? extra(value) : {}),
  }
  if (!value.applied) {
    // `blockedBy` names the issues that ACTUALLY refused the write. Severity is
    // not causality: a refused edit reports the whole doc, and a long-standing
    // error on an untouched widget blocks nothing. Printing those under
    // "blocking issues" is a lie the caller acts on - it then "fixes" a widget
    // it never touched. Fall back to severity only when the mutation did not
    // say.
    const errors = value.issues.filter((issue) => issue.severity === 'error')
    const blocking = value.blockedBy?.length
      ? value.blockedBy
      : errors.length
        ? errors
        : value.issues
    const shown = blocking
      .slice()
      .sort((a, b) => Number(a.preExisting ?? false) - Number(b.preExisting ?? false))
    const alsoPresent = value.blockedBy?.length
      ? value.issues.filter(
          (issue) => issue.severity === 'error' && !value.blockedBy?.includes(issue)
        )
      : []
    return {
      success: false,
      output: projected,
      error:
        'The edit was NOT applied. This is what blocked it:\n' +
        shown
          .map(
            (issue) =>
              renderIssue(issue) +
              (issue.preExisting
                ? ' (pre-existing - already in the draft, not what blocked this edit)'
                : '')
          )
          .join('\n') +
        (alsoPresent.length > 0
          ? '\n\nAlso present, but NOT what blocked this edit - fixing these will not make the ' +
            'edit apply:\n' +
            alsoPresent.map(renderIssue).join('\n')
          : ''),
    }
  }
  return { success: true, output: projected }
}

/** The `summary` string off a projected mutation output, for `buildDigest`. */
export function digestLabelFromOutput(output: unknown, fallback: string): string {
  const summary = (output as { summary?: unknown } | null)?.summary
  return typeof summary === 'string' && summary.length > 0 ? summary : fallback
}

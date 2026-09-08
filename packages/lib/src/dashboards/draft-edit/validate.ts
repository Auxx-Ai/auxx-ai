// packages/lib/src/dashboards/draft-edit/validate.ts

/**
 * Layout-doc validation for the draft-edit module
 * (`plans/dashboard/v3/01-draft-edit-module.md` §6). Pure: no db, no Redis, no
 * permission checks.
 *
 * TWO sources, deliberately, and neither is a restatement of the other:
 *
 * 1. **Per-widget issues** built from the EXISTING client-safe guards.
 *    {@link isChartConfigured} already encodes "has enough config to run its
 *    aggregate query", so this file only adds the cases those guards do not
 *    cover: a gauge with no `rangeMax`, a `recordList` with no `columns`, an
 *    `iframe` with a null `url` (all errors), and a `richText` with no content
 *    (a WARNING, because an empty note is a legitimate placeholder rather than
 *    a broken widget). These are what a model can act on: they name the widget
 *    and the missing thing.
 * 2. **Doc-level issues** from running the real publish schema,
 *    {@link dashboardLayoutDocSchema}, and mapping each zod issue at its path.
 *
 * SEVERITY AND `publishable` ANSWER DIFFERENT QUESTIONS, and they do not always
 * agree. Severity says whether the widget will RENDER something useful; a
 * `recordList` with no columns and an `iframe` with a null url are both errors
 * by that measure, and the strict publish schema accepts both (`columns` has no
 * minimum, `url` is nullable). So an error-severity issue does NOT imply
 * `publishable === false`, and a caller that wants "can I publish" must read
 * `publishable` rather than counting errors.
 *
 * `publishable` is `dashboardLayoutDocSchema.safeParse(doc).success` and
 * nothing else. It is deliberately NOT re-derived from the issue list: this is
 * the value the model quotes when it tells a user "ready to publish", so it has
 * to be the same answer `publishDashboard` will give, and a hand-maintained
 * rule set would drift from it the first time either side changed.
 */

import {
  type DashboardLayoutDoc,
  isChartConfigured,
  isChartWidget,
  type LayoutWidget,
  WIDGET_KIND_LABELS,
} from '../client'
import { dashboardLayoutDocSchema } from '../config-schemas'
import { formatWidgetRef } from './refs'
import type { Issue } from './types'

/** True when any issue in the list blocks a publish. */
export function hasBlockingIssues(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

/**
 * Per-widget issues for one widget: the guards in `client.ts` plus the four
 * kinds they do not cover. `ref` is the caller-facing widget reference (pass
 * `formatWidgetRef(doc, widget.id)`), so a model can echo it straight back.
 */
export function widgetIssues(widget: LayoutWidget, ref: string): Issue[] {
  const issues: Issue[] = []
  const config = widget.configuration
  const label = WIDGET_KIND_LABELS[widget.type] ?? widget.type
  const error = (message: string) =>
    issues.push({ severity: 'error', message: `${label} "${ref}" ${message}`, widgetRef: ref })

  if (isChartWidget(config)) {
    if (!isChartConfigured(config)) {
      if (!config.source) error('has no data source.')
      if (!config.metric?.op) error('has no metric.')
      else if (config.metric.op !== 'count' && !config.metric.fieldRef) {
        error(`uses the "${config.metric.op}" metric but names no field to aggregate.`)
      }
      if (
        (config.kind === 'barChart' || config.kind === 'lineChart' || config.kind === 'pieChart') &&
        !config.groupBy?.fieldRef
      ) {
        error('has no group-by field, so it has nothing to plot along its axis.')
      }
    }
    // Not covered by `isChartConfigured`: a gauge renders a needle against a
    // target, and without one there is no scale to draw.
    if (config.kind === 'gauge' && config.rangeMax == null) {
      error('has no maximum value, so its scale is undefined.')
    }
  }

  if (config.kind === 'recordList') {
    if (!config.source) error('has no data source.')
    if (!config.columns || config.columns.length === 0) error('shows no columns.')
  }

  if (config.kind === 'iframe' && config.url == null) error('has no URL to embed.')

  if (config.kind === 'richText' && config.content == null) {
    issues.push({
      severity: 'warning',
      // A warning on purpose: an empty note is what a placeholder looks like,
      // and a dashboard with one is perfectly publishable.
      message: `${label} "${ref}" is empty.`,
      widgetRef: ref,
    })
  }

  return issues
}

/** Render a zod path as the dotted string a caller can read. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.map((segment) => String(segment)).join('.')
}

/**
 * The widget a zod issue belongs to, if any. Publish-schema paths are shaped
 * `tabs.<i>.widgets.<j>....`, so the two indices are all it takes.
 */
function widgetAtPath(
  doc: DashboardLayoutDoc,
  path: ReadonlyArray<PropertyKey>
): LayoutWidget | undefined {
  if (path[0] !== 'tabs' || path[2] !== 'widgets') return undefined
  const tab = doc.tabs[Number(path[1])]
  return tab?.widgets[Number(path[3])]
}

/**
 * Validate a layout doc. `publishable` is the strict publish schema's own
 * verdict; `issues` combines the per-widget guards with the schema's own
 * complaints so a model has something specific to fix.
 *
 * Side-effect free. This function IS the publish gate without the publish,
 * matching `validate_workflow`.
 */
export function validateDashboard(doc: DashboardLayoutDoc): {
  issues: Issue[]
  publishable: boolean
} {
  const issues: Issue[] = []

  for (const tab of doc.tabs) {
    for (const widget of tab.widgets) {
      issues.push(...widgetIssues(widget, formatWidgetRef(doc, widget.id)))
    }
  }

  const parsed = dashboardLayoutDocSchema.safeParse(doc)
  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      const widget = widgetAtPath(doc, zodIssue.path)
      const ref = widget ? formatWidgetRef(doc, widget.id) : undefined
      const where = formatPath(zodIssue.path)
      issues.push({
        severity: 'error',
        message: where ? `${where}: ${zodIssue.message}` : zodIssue.message,
        ...(ref ? { widgetRef: ref } : {}),
      })
    }
  }

  return { issues, publishable: parsed.success }
}

// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/preview-widget.ts

import type {
  ChartWidgetConfig,
  WidgetConfiguration,
  WidgetKind,
} from '../../../../../dashboards/client'
import { isChartWidget, toChartQueryInput, WIDGET_KINDS } from '../../../../../dashboards/client'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveDashboardAuthoring } from './dashboard-authoring-guard'
import { dashboardToolPermission } from './dashboard-tool-helpers'
import {
  optionalString,
  parseWidgetConfigArgs,
  WIDGET_CONFIG_PROPERTIES,
} from './write-tool-helpers'

/**
 * Rows returned to the model. `MAX_GROUP_LIMIT` is 100 and a full group table
 * is a token sink: the model needs the SHAPE of the answer, not the census, so
 * the rest is reported as a count.
 */
const MAX_PREVIEW_ROWS = 20

/**
 * Run a widget's real query and return the actual rows.
 *
 * This is the most valuable tool in the set and the least obvious. A
 * misconfigured chart does NOT error: it renders, with wrong or empty numbers,
 * and looks fine to an agent that only ever saw a successful write. One bucket,
 * all-empty, fifty groups of one - none of those raise anything. Letting the
 * model read its own output before telling the user it is done is what turns
 * this capability from a config writer into something trustworthy.
 *
 * Accepts either a SAVED widget by title or an INLINE config, so a chart can be
 * checked BEFORE it is added.
 *
 * `capabilities` is threaded into the aggregate call, and that is not optional
 * plumbing. `article` is the one aggregate source with a per-row policy (it
 * inherits its knowledge base's instance grants), and the engine's convention is
 * `capabilities: undefined` implies UNRESTRICTED for headless callers. Dropping
 * it here would silently restore the org-wide count and, worse, collapse the
 * result-cache fork that keeps one viewer's numbers off another's dashboard.
 */
export function createPreviewWidgetTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'preview_widget',
    permission: dashboardToolPermission('view'),
    displayName: 'Preview widget',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'Run a widget query for real and see the rows it returns, WITHOUT saving anything. Pass `widget` (a saved widget title) or an inline `kind` + `source` + config to check a chart before you add it. Always preview before telling the user a chart is done: a misconfigured chart returns wrong or empty numbers rather than an error.',
    parameters: {
      type: 'object',
      properties: {
        widget: {
          type: 'string',
          description: 'Title of a saved widget to run. Omit when passing an inline config.',
        },
        kind: {
          type: 'string',
          enum: [...WIDGET_KINDS],
          description: 'Kind for an inline config. Ignored when `widget` is given.',
        },
        ...WIDGET_CONFIG_PROPERTIES,
      },
      additionalProperties: false,
    },
    summary: (args) =>
      `Preview widget: ${optionalString(args.widget) ?? optionalString(args.kind) ?? 'widget'}`,
    buildDigest: (output) => {
      const out = (output ?? {}) as { rows?: unknown[]; value?: unknown }
      return {
        label: 'Widget previewed',
        ...(Array.isArray(out.rows) ? { resultCount: out.rows.length } : {}),
        ...(typeof out.value === 'number' ? { value: out.value } : {}),
      }
    },
    execute: async (args, agentDeps) => {
      const auth = await resolveDashboardAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }

      const { db, capabilities } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const { loadDraftContext, resolveWidgetRef } = await import(
        '../../../../../dashboards/draft-edit'
      )

      let config: WidgetConfiguration | undefined
      const widgetRef = optionalString(args.widget)
      if (widgetRef) {
        const loaded = await loadDraftContext(db, {
          dashboardId: auth.dashboardId,
          organizationId: agentDeps.organizationId,
        })
        if (loaded.isErr()) return { success: false, output: null, error: loaded.error.message }
        const found = resolveWidgetRef(loaded.value.doc, widgetRef)
        if (found.isErr()) return { success: false, output: null, error: found.error.message }
        config = found.value.widget.configuration
      } else {
        // Inline: build the same shape a write would, through the same
        // resolvers, so a preview can never succeed on input a write refuses.
        const kind = typeof args.kind === 'string' ? (args.kind as WidgetKind) : undefined
        if (!kind) {
          return {
            success: false,
            output: null,
            error: 'Pass either `widget` (a saved widget title) or an inline `kind` plus config.',
          }
        }
        const built = await buildInlineConfig(kind, args, agentDeps.organizationId)
        if (!built.ok) return { success: false, output: null, error: built.error }
        config = built.config
      }

      if (!config || !isChartWidget(config)) {
        return {
          success: false,
          output: null,
          error:
            'Only chart, KPI and gauge widgets run a query. Record lists, notes and embeds have nothing to preview.',
        }
      }
      // A half-built widget is a legitimate draft state, so say what is missing
      // rather than letting the aggregate engine answer with its own error
      // about a query it was handed no metric for.
      if (!config.source) {
        return { success: false, output: null, error: 'Set the widget source before previewing.' }
      }
      if (!config.metric?.op) {
        return { success: false, output: null, error: 'Set the widget metric before previewing.' }
      }

      const { buildAggregateQueryForWidget, runAggregate, runKpi, trendSpecForWidget } =
        await import('../../../../../resources/aggregate')
      const queryInput = toChartQueryInput(config as ChartWidgetConfig)
      // The dashboard's stored DEFAULTS are deliberately not applied here: a
      // preview answers "what does this widget's own configuration return", and
      // the viewer's live picks are URL state the server cannot see anyway.
      const query = buildAggregateQueryForWidget(queryInput, { timezone: 'UTC' })

      if (config.kind === 'kpi' || config.kind === 'gauge') {
        const result = await runKpi(
          db,
          agentDeps.organizationId,
          agentDeps.userId,
          {
            base: query,
            ...(trendSpecForWidget(queryInput) ? { trend: trendSpecForWidget(queryInput) } : {}),
          },
          { capabilities }
        )
        if (result.isErr()) return { success: false, output: null, error: result.error.message }
        return {
          success: true,
          output: {
            kind: config.kind,
            value: result.value.value,
            ...(result.value.previousValue !== undefined
              ? { previousValue: result.value.previousValue }
              : {}),
            ...droppedNotice(result.value),
          },
        }
      }

      const result = await runAggregate(db, agentDeps.organizationId, agentDeps.userId, query, {
        capabilities,
      })
      if (result.isErr()) return { success: false, output: null, error: result.error.message }
      const groups = result.value.groups
      return {
        success: true,
        output: {
          kind: config.kind,
          total: result.value.totalValue,
          rowCount: groups.length,
          rows: groups.slice(0, MAX_PREVIEW_ROWS).map((group) => ({
            label: group.label,
            value: group.value,
            ...(group.series
              ? { series: group.series.map((s) => ({ label: s.label, value: s.value })) }
              : {}),
          })),
          ...(groups.length > MAX_PREVIEW_ROWS
            ? { moreRows: groups.length - MAX_PREVIEW_ROWS }
            : {}),
          ...(result.value.hasMoreGroups ? { hasMoreGroups: true } : {}),
          ...droppedNotice(result.value),
        },
      }
    },
  }
}

/** Surface filters the query builder could not compile: they INFLATE a number. */
function droppedNotice(value: {
  droppedConditions?: unknown[]
  droppedConditionCount?: number
}): Record<string, unknown> {
  if (!value.droppedConditions?.length) return {}
  return {
    droppedFilterWarning:
      'Some filter conditions could not be compiled and were NOT applied, so these numbers are too high. Fix the filter before saving.',
    droppedConditions: value.droppedConditions,
    ...(value.droppedConditionCount !== undefined
      ? { droppedConditionCount: value.droppedConditionCount }
      : {}),
  }
}

/**
 * Assemble an inline chart config from friendly arguments, resolving the source
 * and every field name through the SAME resolvers a write uses. Nothing here
 * accepts an id.
 */
async function buildInlineConfig(
  kind: WidgetKind,
  args: Record<string, unknown>,
  organizationId: string
): Promise<{ ok: true; config: WidgetConfiguration } | { ok: false; error: string }> {
  const input = parseWidgetConfigArgs(args)
  if (!input.source) {
    return { ok: false, error: 'An inline preview needs a `source` name.' }
  }
  // Lazy import - see get-dashboard.ts. Every name goes through the SAME
  // resolvers a write uses, so a preview can never succeed on input a write
  // would refuse (`resolveWidgetConfig` itself is internal to `ops.ts`, so the
  // exported primitives are composed here rather than its logic duplicated).
  const { describeSourceForOrg, normalizeFilters, resolveFieldRef, resolveWidgetSource } =
    await import('../../../../../dashboards/draft-edit')

  const resolved = await resolveWidgetSource(organizationId, input.source)
  if (resolved.isErr()) return { ok: false, error: resolved.error.message }
  const source = resolved.value
  const label = await describeSourceForOrg(organizationId, source)
  const ref = async (name: string): Promise<string> => {
    const result = await resolveFieldRef(organizationId, source, name, label)
    if (result.isErr()) throw result.error
    return result.value as unknown as string
  }

  try {
    const config: Record<string, unknown> = { kind, source }
    if (input.metric) {
      config.metric = {
        op: input.metric.op,
        ...(input.metric.field ? { fieldRef: await ref(input.metric.field) } : {}),
      }
    } else {
      config.metric = { op: 'count' }
    }
    if (input.groupBy) {
      const { field, ...rest } = input.groupBy
      config.groupBy = { fieldRef: await ref(field), ...rest }
    }
    if (input.secondaryGroupBy) {
      const { field, ...rest } = input.secondaryGroupBy
      config.secondaryGroupBy = { fieldRef: await ref(field), ...rest }
    }
    if (input.trend) {
      config.trend = {
        dateFieldRef: await ref(input.trend.dateField),
        compare: input.trend.compare,
      }
    }
    if (input.filters) {
      const normalized = await normalizeFilters(organizationId, source, input.filters, label)
      if (normalized.isErr()) return { ok: false, error: normalized.error.message }
      config.filters = normalized.value
    }
    return { ok: true, config: config as WidgetConfiguration }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

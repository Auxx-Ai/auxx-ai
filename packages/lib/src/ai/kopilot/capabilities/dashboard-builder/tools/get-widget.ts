// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/get-widget.ts

import type { ConditionGroup } from '../../../../../conditions'
import type {
  WidgetConfiguration,
  WidgetFieldRef,
  WidgetSource,
} from '../../../../../dashboards/client'
import type { ResourceField } from '../../../../../resources/registry/field-types'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveDashboardAuthoring } from './dashboard-authoring-guard'
import { dashboardToolPermission } from './dashboard-tool-helpers'

/** The renderers this tool borrows from the draft-edit module. */
interface Describers {
  describeFieldRef: (ref: WidgetFieldRef, fields?: ResourceField[]) => string
  fields: ResourceField[] | undefined
  sourceLabel: string | undefined
}

/** Render one condition group with its field refs replaced by field NAMES. */
function describeFilters(groups: ConditionGroup[], describers: Describers): unknown {
  return groups.map((group) => ({
    match: group.logicalOperator === 'OR' ? 'any' : 'all',
    conditions: group.conditions.map((condition) => ({
      field: describers.describeFieldRef(condition.fieldId as WidgetFieldRef, describers.fields),
      operator: condition.operator,
      ...(condition.value !== undefined ? { value: condition.value } : {}),
    })),
  }))
}

/**
 * A widget's stored configuration rendered back in the SAME friendly vocabulary
 * the write tools take: sources and fields by name, filters as flat condition
 * lists.
 *
 * This is the render-back half of the normalization contract, and it is the
 * half that makes the write half safe: a model that has never seen a raw id
 * cannot invent one, so nothing that leaves this capability may carry a per-org
 * cuid or a branded `defId:fieldId`.
 */
function describeConfig(
  config: WidgetConfiguration,
  describers: Describers
): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: config.kind }
  const anyConfig = config as Record<string, unknown>
  const name = (ref: unknown) =>
    describers.describeFieldRef(ref as WidgetFieldRef, describers.fields)

  for (const [key, value] of Object.entries(anyConfig)) {
    if (key === 'kind') continue
    switch (key) {
      case 'source':
        out.source = describers.sourceLabel ?? value
        break
      case 'metric': {
        const metric = value as { op: string; fieldRef?: WidgetFieldRef }
        out.metric = { op: metric.op, ...(metric.fieldRef ? { field: name(metric.fieldRef) } : {}) }
        break
      }
      case 'groupBy':
      case 'secondaryGroupBy': {
        const group = value as { fieldRef: WidgetFieldRef } & Record<string, unknown>
        const { fieldRef: _ref, ...rest } = group
        out[key] = { field: name(group.fieldRef), ...rest }
        break
      }
      case 'columns':
        out.columns = (value as WidgetFieldRef[]).map(name)
        break
      case 'sort': {
        const sort = value as { fieldRef: WidgetFieldRef; desc?: boolean }
        out.sort = { field: name(sort.fieldRef), desc: sort.desc === true }
        break
      }
      case 'globalDateFieldRef':
        out.globalDateField = value === null ? null : name(value)
        break
      case 'trend': {
        const trend = value as { dateFieldRef: WidgetFieldRef; compare: string }
        out.trend = { dateField: name(trend.dateFieldRef), compare: trend.compare }
        break
      }
      case 'filters':
        out.filters = describeFilters(value as ConditionGroup[], describers)
        break
      default:
        // Display-only settings pass through: they carry no refs, and they are
        // written back through `options` under exactly these key names.
        out[key] = value
    }
  }
  return out
}

/**
 * One widget in full: its configuration in the friendly, name-based shape the
 * write tools accept, plus that widget's own issues. Address it by title.
 */
export function createGetWidgetTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_widget',
    permission: dashboardToolPermission('view'),
    displayName: 'Get widget',
    surfaces: ['builder'],
    idempotent: true,
    description:
      "Read one widget's full configuration, rendered with source and field NAMES (never ids) in the same shape update_widget takes, plus that widget's issues. Address the widget by its title.",
    parameters: {
      type: 'object',
      properties: {
        widget: { type: 'string', description: 'Widget title (a unique prefix works).' },
      },
      required: ['widget'],
      additionalProperties: false,
    },
    summary: (args) => `Read widget: ${typeof args.widget === 'string' ? args.widget : 'widget'}`,
    buildDigest: (output) => {
      const out = (output ?? {}) as { widget?: { ref?: unknown } }
      const ref = out.widget?.ref
      return { label: typeof ref === 'string' ? `Read ${ref}` : 'Widget read' }
    },
    execute: async (args, agentDeps) => {
      const auth = await resolveDashboardAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }
      const ref = typeof args.widget === 'string' ? args.widget : ''
      if (!ref) return { success: false, output: null, error: 'widget is required.' }

      const { db } = getDeps()
      // Lazy import - see get-dashboard.ts.
      const {
        buildWidgetSummary,
        describeFieldRef,
        describeSourceForOrg,
        loadDraftContext,
        loadSourceFields,
        resolveWidgetRef,
        widgetIssues,
      } = await import('../../../../../dashboards/draft-edit')
      const loaded = await loadDraftContext(db, {
        dashboardId: auth.dashboardId,
        organizationId: agentDeps.organizationId,
      })
      if (loaded.isErr()) return { success: false, output: null, error: loaded.error.message }

      const doc = loaded.value.doc
      const found = resolveWidgetRef(doc, ref)
      if (found.isErr()) return { success: false, output: null, error: found.error.message }
      const { widget, tab } = found.value

      const source = (widget.configuration as { source?: WidgetSource }).source
      const describers: Describers = {
        describeFieldRef,
        fields: source ? await loadSourceFields(agentDeps.organizationId, source) : undefined,
        sourceLabel: source
          ? await describeSourceForOrg(agentDeps.organizationId, source)
          : undefined,
      }
      const summary = buildWidgetSummary(doc, widget, tab)

      return {
        success: true,
        output: {
          widget: {
            ref: summary.ref,
            tab: summary.tab,
            kind: summary.kind,
            configured: summary.configured,
          },
          config: describeConfig(widget.configuration, describers),
          issues: widgetIssues(widget, summary.ref),
        },
      }
    },
  }
}

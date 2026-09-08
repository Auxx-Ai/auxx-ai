// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/write-tool-helpers.ts

import { generateId } from '@auxx/utils'
import type { Condition, ConditionGroup } from '../../../../../conditions'
import type {
  DashboardMutationScope,
  WidgetConfigInput,
} from '../../../../../dashboards/draft-edit'
import type { AgentDeps } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveDashboardAuthoring } from './dashboard-authoring-guard'

/** What a write tool needs to call a draft-edit mutation. */
export type WriteResolution =
  | { ok: true; scope: DashboardMutationScope }
  | { ok: false; error: string }

/**
 * Shared preamble of every dashboard mutation tool: the edit-tier guard
 * (including the dirty gate and the canvas lock) plus the turn id the snapshot
 * lifecycle keys on.
 *
 * A write without a `turnId` would take no pre-turn snapshot, so a turn that
 * stopped early would leave the user no Undo at all. Refused outright rather
 * than written unrecoverably.
 */
export async function resolveDashboardWrite(
  getDeps: GetToolDeps,
  agentDeps: AgentDeps
): Promise<WriteResolution> {
  const auth = await resolveDashboardAuthoring(getDeps, agentDeps, 'edit', { mutation: true })
  if (!auth.ok) return auth
  const turnId = agentDeps.turnId
  if (!turnId) {
    return {
      ok: false,
      error: 'No turnId on agent deps - cannot scope kopilot dashboard writes.',
    }
  }
  return {
    ok: true,
    scope: {
      dashboardId: auth.dashboardId,
      organizationId: agentDeps.organizationId,
      turnId,
    },
  }
}

/** Optional-string arg helper. Trims; empty becomes undefined. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Optional plain-object arg helper. */
export function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Optional string-array arg helper. Non-strings are dropped. */
export function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * JSON Schema for the flat, friendly filter list every config-taking tool
 * accepts. Shared so the grammar is described identically everywhere; the
 * anti-drift scan only reads `surfaces` out of a factory's `return {` window,
 * so a shared parameter fragment is safe where a shared spread of the tool
 * literal would not be.
 */
export const FILTER_PROPERTIES: Record<string, unknown> = {
  filters: {
    type: 'array',
    description:
      'Filter conditions, ANDed by default. Each is { field, operator, value } where `field` is a field NAME from list_entity_fields (never an id) and `operator` is a query_records operator. Dates: `within_days` takes a number; `before`/`after`/`on_date` take "YYYY-MM-DD"; `today`/`this_week`/`this_month` take no value. Pass null to clear every filter.',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        operator: { type: 'string' },
        value: {},
      },
      required: ['field', 'operator'],
    },
  },
  filterMatch: {
    type: 'string',
    enum: ['all', 'any'],
    description: 'Whether every condition must match (`all`, the default) or any one (`any`).',
  },
}

/**
 * JSON Schema for the friendly widget-configuration arguments. Names
 * throughout: sources by slug or label, fields by label or key, select values
 * by label or option key. Nothing here takes an id.
 */
export const WIDGET_CONFIG_PROPERTIES: Record<string, unknown> = {
  source: {
    type: 'string',
    description:
      "The data source NAME from list_dashboard_sources (e.g. 'tickets'). Required before any field name can be resolved.",
  },
  metric: {
    type: 'object',
    description:
      "What to measure, e.g. { op: 'count' } or { op: 'sum', field: 'Amount' }. `field` is a field NAME; `count` needs none. Pass field: null to drop it.",
    properties: {
      op: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
      field: { type: 'string' },
    },
    required: ['op'],
  },
  groupBy: {
    type: 'object',
    description:
      'The dimension to plot along the axis (bar/line/pie need one). `field` is a field NAME. Add `dateGranularity` for a date field. Pass null to clear.',
    properties: {
      field: { type: 'string' },
      dateGranularity: { type: 'string' },
      sort: { type: 'string', enum: ['labelAsc', 'labelDesc', 'valueAsc', 'valueDesc'] },
      limit: { type: 'number' },
      omitEmpty: { type: 'boolean' },
    },
    required: ['field'],
  },
  secondaryGroupBy: {
    type: 'object',
    description: 'Second series dimension (bar/line only), same shape as groupBy. Null clears it.',
    properties: {
      field: { type: 'string' },
      dateGranularity: { type: 'string' },
      sort: { type: 'string' },
      limit: { type: 'number' },
      omitEmpty: { type: 'boolean' },
    },
    required: ['field'],
  },
  columns: {
    type: 'array',
    description: 'Record-list columns, by field NAME. Null clears them.',
    items: { type: 'string' },
  },
  sort: {
    type: 'object',
    description: 'Record-list sort: { field: <name>, desc?: boolean }. Null clears it.',
    properties: { field: { type: 'string' }, desc: { type: 'boolean' } },
    required: ['field'],
  },
  globalDateField: {
    type: 'string',
    description:
      "The date field NAME the dashboard's global date range binds to. Null opts this widget out of the range.",
  },
  trend: {
    type: 'object',
    description: 'KPI trend: { dateField: <name>, compare }. Null clears it.',
    properties: {
      dateField: { type: 'string' },
      compare: { type: 'string', enum: ['previousPeriod', 'samePeriodLastYear'] },
    },
    required: ['dateField', 'compare'],
  },
  ...FILTER_PROPERTIES,
  options: {
    type: 'object',
    description:
      'Display-only settings merged verbatim: color, rangeMin, rangeMax, prefix, suffix, stacked, donut, area, showLegend, showDataLabels, pageSize, url, content, description. A null value deletes the key. Anything carrying a field, source or filter is refused here - use the named input instead.',
  },
}

/** One friendly filter condition as the tools accept it: a NAME, never a ref. */
export interface FriendlyCondition {
  field: string
  operator: string
  value?: unknown
}

/**
 * Turn the flat, friendly condition list the tools take into the single
 * `ConditionGroup` the draft-edit ops expect.
 *
 * The tools deliberately do NOT expose nested groups. A model that has to
 * author `{ id, conditions: [{ id, fieldId, operator, value }], logicalOperator }`
 * spends tokens on plumbing and gets the ids wrong; one flat list plus
 * `match: 'all' | 'any'` covers every filter a dashboard widget has ever
 * needed. `normalizeFilters` resolves each `field` name against the widget's
 * own source and each select value to its option key.
 */
export function toConditionGroups(
  conditions: FriendlyCondition[],
  match: 'all' | 'any' = 'all'
): ConditionGroup[] {
  if (conditions.length === 0) return []
  return [
    {
      id: generateId(),
      logicalOperator: match === 'any' ? 'OR' : 'AND',
      conditions: conditions.map(
        (condition): Condition => ({
          id: generateId(),
          fieldId: condition.field,
          operator: condition.operator as Condition['operator'],
          value: condition.value as Condition['value'],
        })
      ),
    },
  ]
}

/** Read a friendly condition list off raw tool args, dropping malformed entries. */
export function parseConditions(value: unknown): FriendlyCondition[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      field: String(entry.field ?? ''),
      operator: String(entry.operator ?? ''),
      ...(entry.value !== undefined ? { value: entry.value } : {}),
    }))
    .filter((entry) => entry.field !== '' && entry.operator !== '')
}

/** Read a friendly group-by off raw tool args. `null` clears the key. */
function parseGroupBy(value: unknown): WidgetConfigInput['groupBy'] {
  if (value === null) return null
  const record = optionalRecord(value)
  if (!record) return undefined
  const field = optionalString(record.field)
  if (!field) return undefined
  return {
    field,
    ...(typeof record.dateGranularity === 'string'
      ? { dateGranularity: record.dateGranularity as never }
      : {}),
    ...(typeof record.sort === 'string' ? { sort: record.sort as never } : {}),
    ...(typeof record.limit === 'number' ? { limit: record.limit } : {}),
    ...(typeof record.omitEmpty === 'boolean' ? { omitEmpty: record.omitEmpty } : {}),
  }
}

/**
 * Project the friendly widget-config arguments a tool received onto the
 * {@link WidgetConfigInput} the draft-edit ops take.
 *
 * Every key that would hold a branded ref is a NAME here and is resolved
 * server-side against the widget's own source, which is what makes the
 * "field ref root def must equal the widget source" rule an invariant of the
 * resolver rather than a validation that can fail. `null` clears an optional
 * key; an absent key is left alone (the ops shallow-merge).
 */
export function parseWidgetConfigArgs(args: Record<string, unknown>): WidgetConfigInput {
  const input: WidgetConfigInput = {}

  const source = optionalString(args.source)
  if (source) input.source = source

  if (args.metric !== undefined) {
    const metric = optionalRecord(args.metric)
    if (metric && typeof metric.op === 'string') {
      input.metric = {
        op: metric.op as never,
        ...(metric.field === null
          ? { field: null }
          : optionalString(metric.field)
            ? { field: optionalString(metric.field) as string }
            : {}),
      }
    }
  }

  if (args.groupBy !== undefined) input.groupBy = parseGroupBy(args.groupBy)
  if (args.secondaryGroupBy !== undefined) {
    input.secondaryGroupBy = parseGroupBy(args.secondaryGroupBy)
  }

  if (args.columns !== undefined) {
    input.columns = args.columns === null ? null : (optionalStringArray(args.columns) ?? null)
  }

  if (args.sort !== undefined) {
    if (args.sort === null) input.sort = null
    else {
      const sort = optionalRecord(args.sort)
      const field = sort ? optionalString(sort.field) : undefined
      if (field) input.sort = { field, ...(sort?.desc === true ? { desc: true } : {}) }
    }
  }

  if (args.globalDateField !== undefined) {
    input.globalDateField =
      args.globalDateField === null ? null : (optionalString(args.globalDateField) ?? null)
  }

  if (args.trend !== undefined) {
    if (args.trend === null) input.trend = null
    else {
      const trend = optionalRecord(args.trend)
      const dateField = trend ? optionalString(trend.dateField) : undefined
      const compare = trend ? optionalString(trend.compare) : undefined
      if (dateField && compare) input.trend = { dateField, compare: compare as never }
    }
  }

  if (args.filters !== undefined) {
    if (args.filters === null) input.filters = null
    else {
      const conditions = parseConditions(args.filters)
      const match = args.filterMatch === 'any' ? 'any' : 'all'
      if (conditions) input.filters = toConditionGroups(conditions, match)
    }
  }

  const options = optionalRecord(args.options)
  if (options) input.options = options

  return input
}

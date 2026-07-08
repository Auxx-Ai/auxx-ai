// packages/lib/src/dashboards/config-schemas.ts
//
// Zod schemas mirroring the widget-configuration union and the layout doc. Every
// publish parses the whole doc (version-mutations.ts) so an invalid layout never
// persists; the config panel (plan 07) reuses these for inline validation.
// Client-safe (imports only `@auxx/types/field` + `../conditions/client`).

import {
  type FieldPath,
  getRootEntityId,
  isFieldPath,
  parseResourceFieldId,
  type ResourceFieldId,
  resourceFieldIdSchema,
} from '@auxx/types/field'
import { z } from 'zod'
import { conditionGroupSchema } from '../conditions/client'
import {
  DASHBOARD_GRID_COLUMNS,
  MAX_GROUP_LIMIT,
  MAX_TABS,
  MAX_WIDGETS_PER_TAB,
  type WidgetConfiguration,
  type WidgetFieldRef,
} from './client'

// ── Field refs ──────────────────────────────────────────────────────────────

/** A `ResourceFieldId` or a `FieldPath` (one-hop traversal, ≥1 element). */
export const widgetFieldRefSchema = z.union([
  resourceFieldIdSchema,
  z.array(resourceFieldIdSchema).min(1),
]) as z.ZodType<WidgetFieldRef>

const conditionGroupsSchema = z.array(conditionGroupSchema)

// ── Metric / group-by / source ──────────────────────────────────────────────

const metricSchema = z.object({
  op: z.enum([
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'countUnique',
    'countEmpty',
    'countNotEmpty',
    'countTrue',
    'countFalse',
    'percentEmpty',
    'percentNotEmpty',
  ]),
  fieldRef: widgetFieldRefSchema.optional(),
})

const groupBySchema = z.object({
  fieldRef: widgetFieldRefSchema,
  dateGranularity: z
    .enum(['day', 'week', 'month', 'quarter', 'year', 'dayOfWeek', 'monthOfYear'])
    .optional(),
  sort: z.enum(['labelAsc', 'labelDesc', 'valueAsc', 'valueDesc']).optional(),
  limit: z.number().int().positive().max(MAX_GROUP_LIMIT).optional(),
  omitEmpty: z.boolean().optional(),
})

const widgetSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity'), entityDefinitionId: z.string().min(1) }),
  z.object({ kind: z.literal('system'), tableId: z.string().min(1) }),
])

const baseChartSchema = {
  source: widgetSourceSchema,
  filters: conditionGroupsSchema.optional(),
  globalDateFieldRef: widgetFieldRefSchema.nullable().optional(),
  description: z.string().optional(),
}

// ── Per-kind configuration schemas ──────────────────────────────────────────

const barChartConfigSchema = z.object({
  ...baseChartSchema,
  kind: z.literal('barChart'),
  metric: metricSchema,
  groupBy: groupBySchema,
  secondaryGroupBy: groupBySchema.optional(),
  layout: z.enum(['vertical', 'horizontal']).optional(),
  stacked: z.boolean().optional(),
  cumulative: z.boolean().optional(),
  showDataLabels: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  color: z.string().optional(),
  rangeMin: z.number().optional(),
  rangeMax: z.number().optional(),
})

const lineChartConfigSchema = z.object({
  ...baseChartSchema,
  kind: z.literal('lineChart'),
  metric: metricSchema,
  groupBy: groupBySchema,
  secondaryGroupBy: groupBySchema.optional(),
  stacked: z.boolean().optional(),
  cumulative: z.boolean().optional(),
  area: z.boolean().optional(),
  showDataLabels: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  color: z.string().optional(),
  rangeMin: z.number().optional(),
  rangeMax: z.number().optional(),
})

const pieChartConfigSchema = z.object({
  ...baseChartSchema,
  kind: z.literal('pieChart'),
  metric: metricSchema,
  groupBy: groupBySchema,
  donut: z.boolean().optional(),
  showCenterTotal: z.boolean().optional(),
  showDataLabels: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  color: z.string().optional(),
})

const kpiConfigSchema = z.object({
  ...baseChartSchema,
  kind: z.literal('kpi'),
  metric: metricSchema,
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  format: z.string().optional(),
  trend: z
    .object({
      dateFieldRef: widgetFieldRefSchema,
      compare: z.enum(['previousPeriod', 'samePeriodLastYear']),
    })
    .optional(),
})

const gaugeConfigSchema = z.object({
  ...baseChartSchema,
  kind: z.literal('gauge'),
  metric: metricSchema,
  rangeMin: z.number().optional(),
  rangeMax: z.number(),
  color: z.string().optional(),
  showDataLabels: z.boolean().optional(),
})

const recordListConfigSchema = z.object({
  kind: z.literal('recordList'),
  source: widgetSourceSchema,
  filters: conditionGroupsSchema.optional(),
  globalDateFieldRef: widgetFieldRefSchema.nullable().optional(),
  columns: z.array(widgetFieldRefSchema),
  sort: z.object({ fieldRef: widgetFieldRefSchema, desc: z.boolean() }).optional(),
  pageSize: z.number().int().positive().max(50).optional(),
})

const richTextConfigSchema = z.object({
  kind: z.literal('richText'),
  content: z.unknown().nullable(),
})

const iframeConfigSchema = z.object({
  kind: z.literal('iframe'),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), { message: 'URL must be http(s)' })
    .nullable(),
})

export const widgetConfigurationSchema = z.discriminatedUnion('kind', [
  barChartConfigSchema,
  lineChartConfigSchema,
  pieChartConfigSchema,
  kpiConfigSchema,
  gaugeConfigSchema,
  recordListConfigSchema,
  richTextConfigSchema,
  iframeConfigSchema,
]) as z.ZodType<WidgetConfiguration>

// ── Permissive DRAFT configuration schemas ──────────────────────────────────
//
// Auto-save persists a widget the instant it's added — before it has a source or
// metric — so the draft doc (`Dashboard.draftLayout`) validates STRUCTURE only:
// the content-bearing fields (`source`, `metric`, `groupBy`, `secondaryGroupBy`,
// gauge `rangeMax`, recordList `columns`) are optional here. Publish re-validates
// with the strict `widgetConfigurationSchema` above. richText/iframe are already
// fully persistable, so they're shared verbatim.

const draftBaseChartSchema = {
  source: widgetSourceSchema.optional(),
  filters: conditionGroupsSchema.optional(),
  globalDateFieldRef: widgetFieldRefSchema.nullable().optional(),
  description: z.string().optional(),
}

const draftBarChartConfigSchema = barChartConfigSchema.extend({
  ...draftBaseChartSchema,
  metric: metricSchema.optional(),
  groupBy: groupBySchema.optional(),
})
const draftLineChartConfigSchema = lineChartConfigSchema.extend({
  ...draftBaseChartSchema,
  metric: metricSchema.optional(),
  groupBy: groupBySchema.optional(),
})
const draftPieChartConfigSchema = pieChartConfigSchema.extend({
  ...draftBaseChartSchema,
  metric: metricSchema.optional(),
  groupBy: groupBySchema.optional(),
})
const draftKpiConfigSchema = kpiConfigSchema.extend({
  ...draftBaseChartSchema,
  metric: metricSchema.optional(),
})
const draftGaugeConfigSchema = gaugeConfigSchema.extend({
  ...draftBaseChartSchema,
  metric: metricSchema.optional(),
  rangeMax: z.number().optional(),
})
const draftRecordListConfigSchema = recordListConfigSchema.extend({
  source: widgetSourceSchema.optional(),
  columns: z.array(widgetFieldRefSchema).optional(),
})

/** Permissive union used only for `draftLayout` (auto-save). See note above. */
export const draftWidgetConfigurationSchema = z.discriminatedUnion('kind', [
  draftBarChartConfigSchema,
  draftLineChartConfigSchema,
  draftPieChartConfigSchema,
  draftKpiConfigSchema,
  draftGaugeConfigSchema,
  draftRecordListConfigSchema,
  richTextConfigSchema,
  iframeConfigSchema,
]) as z.ZodType<WidgetConfiguration>

// ── Grid / widget / tab ─────────────────────────────────────────────────────

const gridPositionSchema = z
  .object({
    column: z
      .number()
      .int()
      .min(0)
      .max(DASHBOARD_GRID_COLUMNS - 1),
    row: z.number().int().min(0),
    columnSpan: z.number().int().min(1).max(DASHBOARD_GRID_COLUMNS),
    rowSpan: z.number().int().min(1),
  })
  .refine((p) => p.column + p.columnSpan <= DASHBOARD_GRID_COLUMNS, {
    message: 'Widget exceeds the 12-column grid',
  })

const widgetKindSchema = z.enum([
  'barChart',
  'lineChart',
  'pieChart',
  'kpi',
  'gauge',
  'recordList',
  'richText',
  'iframe',
])

/**
 * Build the widget schema over a given configuration union — shared by the strict
 * (publish) and draft (auto-save) docs so the structural checks (`type` matches
 * `configuration.kind`, grid bounds) live once.
 */
function makeLayoutWidgetSchema(configSchema: z.ZodTypeAny) {
  return z
    .object({
      id: z.string().min(1),
      title: z.string(),
      type: widgetKindSchema,
      gridPosition: gridPositionSchema,
      configuration: configSchema,
    })
    .superRefine((w, ctx) => {
      if (w.type !== (w.configuration as { kind: string }).kind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Widget type "${w.type}" does not match configuration kind "${(w.configuration as { kind: string }).kind}"`,
          path: ['type'],
        })
      }
    })
}

function makeLayoutTabSchema(widgetSchema: z.ZodTypeAny) {
  return z.object({
    id: z.string().min(1),
    title: z.string(),
    icon: z.string().nullable(),
    widgets: z.array(widgetSchema).max(MAX_WIDGETS_PER_TAB),
  })
}

const layoutWidgetSchema = makeLayoutWidgetSchema(widgetConfigurationSchema)
const layoutTabSchema = makeLayoutTabSchema(layoutWidgetSchema)

/**
 * Dashboard-level filter state: per-def condition groups + a date-range preset.
 * Doubles as the `globalOverrides` input schema for chartData/kpiData (the
 * viewer's live picks sent from the URL state).
 */
export const globalFiltersSchema = z.object({
  conditions: z
    .array(z.object({ entityDefinitionId: z.string().min(1), groups: conditionGroupsSchema }))
    .optional(),
  dateRange: z
    .union([
      z.enum([
        'last7d',
        'last30d',
        'last90d',
        'thisWeek',
        'thisMonth',
        'thisQuarter',
        'thisYear',
        'allTime',
      ]),
      z.object({ from: z.string(), to: z.string() }),
    ])
    .optional(),
})

/**
 * The whole layout document. Enforces: 1–20 tabs; ≤60 widgets/tab; each widget's
 * `type` matches its `configuration.kind`; grid positions inside the 12-col grid;
 * tab + widget ids unique across the doc; and every field ref's ROOT def matches
 * the owning widget's entity source (a config can't reference another def's
 * fields). System-sourced widgets skip the root-def check (their refs key a
 * system table, not an entity def).
 */
export const dashboardLayoutDocSchema = z
  .object({
    tabs: z.array(layoutTabSchema).min(1).max(MAX_TABS),
    globalFilters: globalFiltersSchema.optional(),
  })
  .superRefine(layoutDocRefine)

/**
 * The DRAFT layout document — same structure + unique-id / root-def checks as the
 * strict doc, but widget configs may be unconfigured shells (permissive union).
 * This is what `Dashboard.draftLayout` stores and what auto-save (`saveDraft`)
 * validates. Publish re-validates the same doc against {@link dashboardLayoutDocSchema}.
 */
export const draftLayoutDocSchema = z
  .object({
    tabs: z
      .array(makeLayoutTabSchema(makeLayoutWidgetSchema(draftWidgetConfigurationSchema)))
      .min(1)
      .max(MAX_TABS),
    globalFilters: globalFiltersSchema.optional(),
  })
  .superRefine(layoutDocRefine)

/** Doc-wide invariants shared by the strict + draft docs: unique ids, root-def match. */
function layoutDocRefine(
  doc: { tabs: Array<{ id: string; widgets: Array<{ id: string; configuration: unknown }> }> },
  ctx: z.RefinementCtx
): void {
  const tabIds = new Set<string>()
  const widgetIds = new Set<string>()
  doc.tabs.forEach((tab, ti) => {
    if (tabIds.has(tab.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate tab id "${tab.id}"`,
        path: ['tabs', ti, 'id'],
      })
    }
    tabIds.add(tab.id)

    tab.widgets.forEach((widget, wi) => {
      if (widgetIds.has(widget.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate widget id "${widget.id}"`,
          path: ['tabs', ti, 'widgets', wi, 'id'],
        })
      }
      widgetIds.add(widget.id)

      const source = (
        widget.configuration as { source?: { kind: string; entityDefinitionId?: string } }
      ).source
      if (source?.kind === 'entity' && source.entityDefinitionId) {
        for (const ref of collectFieldRefs(widget.configuration as WidgetConfiguration)) {
          const root = fieldRefRootDef(ref)
          if (root && root !== source.entityDefinitionId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Field ref root def "${root}" does not match widget source "${source.entityDefinitionId}"`,
              path: ['tabs', ti, 'widgets', wi, 'configuration'],
            })
          }
        }
      }
    })
  })
}

// ── Field-ref helpers (superRefine) ─────────────────────────────────────────

function fieldRefRootDef(ref: WidgetFieldRef): string | null {
  if (isFieldPath(ref)) return getRootEntityId(ref as FieldPath)
  return parseResourceFieldId(ref as ResourceFieldId).entityDefinitionId || null
}

/** Every `WidgetFieldRef` reachable from a configuration (metric, group-bys, columns, sort). */
function collectFieldRefs(config: WidgetConfiguration): WidgetFieldRef[] {
  const refs: WidgetFieldRef[] = []
  const c = config as Record<string, unknown>
  const metric = c.metric as { fieldRef?: WidgetFieldRef } | undefined
  if (metric?.fieldRef) refs.push(metric.fieldRef)
  const groupBy = c.groupBy as { fieldRef?: WidgetFieldRef } | undefined
  if (groupBy?.fieldRef) refs.push(groupBy.fieldRef)
  const secondary = c.secondaryGroupBy as { fieldRef?: WidgetFieldRef } | undefined
  if (secondary?.fieldRef) refs.push(secondary.fieldRef)
  const columns = c.columns as WidgetFieldRef[] | undefined
  if (Array.isArray(columns)) refs.push(...columns)
  const sort = c.sort as { fieldRef?: WidgetFieldRef } | undefined
  if (sort?.fieldRef) refs.push(sort.fieldRef)
  const trend = c.trend as { dateFieldRef?: WidgetFieldRef } | undefined
  if (trend?.dateFieldRef) refs.push(trend.dateFieldRef)
  const globalDateFieldRef = c.globalDateFieldRef as WidgetFieldRef | null | undefined
  if (globalDateFieldRef) refs.push(globalDateFieldRef)
  return refs
}

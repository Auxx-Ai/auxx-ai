// packages/lib/src/dashboards/client.ts
//
// Client-safe surface for the dashboards feature: every shared type, constant,
// guard, and the drill-down `segmentToConditions` translation. Imported by the
// config panel (plan 07), the widget renderers (plan 05), and the aggregate
// engine (plan 03). MUST NOT import anything server-only — no drizzle, no
// node:crypto (hashing lives in `config-hash.ts`), no bullmq. Conditions types
// come from `@auxx/lib/conditions/client`.

import type { FieldPath, ResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import type { ConditionGroup } from '../conditions/client'
import type { FieldOptions } from '../field-values/client'
import type { TableId } from '../resources/registry/field-registry'
import type { DateLabelFormat } from './date-bucket-labels'

export type { DateLabelFormat } from './date-bucket-labels'
// Client-safe date-bucket label formatting (plan 10) — re-exported here so the
// chart widgets can format the category axis off the raw bucket key.
export { formatBucketLabel, resolveDefaultDateLabelFormat } from './date-bucket-labels'

// ── Primitives ──────────────────────────────────────────────────────────────

export type GridPosition = { column: number; row: number; columnSpan: number; rowSpan: number }

export type WidgetKind =
  | 'barChart'
  | 'lineChart'
  | 'pieChart'
  | 'kpi'
  | 'gauge'
  | 'recordList'
  | 'richText'
  | 'iframe'

/** The system-table id union the `systemConditionBuilder` keys on. */
export type SystemTableId = TableId

/** Data source for chart/KPI/recordList widgets. */
export type WidgetSource =
  | { kind: 'entity'; entityDefinitionId: string }
  | { kind: 'system'; tableId: SystemTableId }

/**
 * BRANDED field reference (`@auxx/types/field`) — a fully scoped
 * `ResourceFieldId` (`defId:fieldId`) or a `FieldPath` for one-hop traversal.
 * Never a bare `FieldId`: dashboards have no ambient record context to
 * auto-resolve against. This is exactly what `FieldPicker` returns and what
 * `Condition.fieldId` accepts, so refs flow picker → config → conditions →
 * server UNPARSED. Nothing unwraps them until the aggregate engine builds SQL
 * (plan 03).
 */
export type WidgetFieldRef = ResourceFieldId | FieldPath

export type MetricOp =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'countUnique'
  | 'countEmpty'
  | 'countNotEmpty'
  | 'countTrue'
  | 'countFalse'
  | 'percentEmpty'
  | 'percentNotEmpty'

/** `fieldRef` absent ⇒ count records. */
export type Metric = { op: MetricOp; fieldRef?: WidgetFieldRef }

export type DateGranularity =
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'dayOfWeek'
  | 'monthOfYear'

export type GroupSort = 'labelAsc' | 'labelDesc' | 'valueAsc' | 'valueDesc'

export type GroupBy = {
  fieldRef: WidgetFieldRef
  /** Only when the resolved field is DATE/DATETIME. */
  dateGranularity?: DateGranularity
  /** Default `'valueDesc'`. */
  sort?: GroupSort
  /** Default {@link DEFAULT_GROUP_LIMIT}, hard cap {@link MAX_GROUP_LIMIT}. */
  limit?: number
  /** Drop the null / no-value bucket. */
  omitEmpty?: boolean
}

export type TrendCompare = 'previousPeriod' | 'samePeriodLastYear'

export type DateRangePreset =
  | 'last7d'
  | 'last30d'
  | 'last90d'
  | 'thisWeek'
  | 'thisMonth'
  | 'thisQuarter'
  | 'thisYear'
  | 'allTime'
  /** ISO dates, custom range. */
  | { from: string; to: string }

/**
 * Dashboard-level filter DEFAULTS — part of the layout doc (versioned).
 * Conditions are authored per source def and merge only into widgets whose
 * source matches. The viewer's live picks are URL state (plan 08).
 */
export type DashboardGlobalFilters = {
  conditions?: Array<{ entityDefinitionId: string; groups: ConditionGroup[] }>
  dateRange?: DateRangePreset
}

// ── Chart color palettes (plan 12) ──────────────────────────────────────────

/**
 * A chart color SCHEME id (not a single color) — the exact set Twenty exposes: a
 * multi-hue `'default'` palette plus 25 single-hue schemes. Each single-hue id is
 * a Radix Colors scale (Twenty renames Radix's `teal` → `turquoise`). The chosen
 * scheme derives EVERY series color: mono schemes fan out a shade ramp, `'default'`
 * spreads distinct hues. Stored in the config's `color` field. See
 * `chart-palettes.ts` for the id → `var(--<scale>-N)` mapping.
 */
export type ChartPaletteId =
  | 'default'
  | 'red'
  | 'ruby'
  | 'crimson'
  | 'tomato'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'grass'
  | 'green'
  | 'jade'
  | 'mint'
  | 'turquoise'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'iris'
  | 'violet'
  | 'purple'
  | 'plum'
  | 'pink'
  | 'bronze'
  | 'gold'
  | 'brown'
  | 'gray'

/** Every valid {@link ChartPaletteId}, `'default'` first — the dropdown order. */
export const CHART_PALETTE_IDS: ChartPaletteId[] = [
  'default',
  'red',
  'ruby',
  'crimson',
  'tomato',
  'orange',
  'amber',
  'yellow',
  'lime',
  'grass',
  'green',
  'jade',
  'mint',
  'turquoise',
  'cyan',
  'sky',
  'blue',
  'iris',
  'violet',
  'purple',
  'plum',
  'pink',
  'bronze',
  'gold',
  'brown',
  'gray',
]

const PALETTE_ID_SET: ReadonlySet<string> = new Set(CHART_PALETTE_IDS)

/**
 * Coerce a stored `color` value to a valid {@link ChartPaletteId}. Legacy values
 * (`'auto'`, `'var(--chart-N)'`) and anything unrecognized normalize to
 * `'default'` — so existing dashboards keep rendering with no DB migration.
 */
export function normalizePaletteId(value: string | undefined | null): ChartPaletteId {
  return value && PALETTE_ID_SET.has(value) ? (value as ChartPaletteId) : 'default'
}

// ── Widget configurations (discriminated union on `kind`) ───────────────────

export type BaseChartConfig = {
  source: WidgetSource
  filters?: ConditionGroup[]
  /** DATE/DATETIME field the dashboard's global date range binds to; null = opt out. */
  globalDateFieldRef?: WidgetFieldRef | null
  description?: string
  /**
   * Per-widget display-format override for the metric VALUE, layered over the
   * metric field's own `FieldOptions` (decimals, currency display, compact…).
   * Display-only — excluded from {@link ChartQueryInput}. Produced by the
   * Number/Currency formatting editors in the config panel.
   */
  valueFormat?: FieldOptions
}

export type BarChartConfig = BaseChartConfig & {
  kind: 'barChart'
  metric: Metric
  groupBy: GroupBy
  /**
   * Display style for a DATE group-by's category-axis labels (plan 10). Applied
   * client-side off the raw bucket key — display-only, never re-queries.
   * `undefined` = the default label style.
   */
  labelFormat?: DateLabelFormat
  /** Stacked/grouped series. */
  secondaryGroupBy?: GroupBy
  /** Default `'vertical'`. */
  layout?: 'vertical' | 'horizontal'
  /** Only meaningful with `secondaryGroupBy`. */
  stacked?: boolean
  cumulative?: boolean
  showDataLabels?: boolean
  showLegend?: boolean
  /** Chart color scheme id; `'default'` when unset. */
  color?: ChartPaletteId
  rangeMin?: number
  rangeMax?: number
}

export type LineChartConfig = BaseChartConfig & {
  kind: 'lineChart'
  metric: Metric
  /** Usually a date field + granularity. */
  groupBy: GroupBy
  /** Category-axis date label style (plan 10); display-only. */
  labelFormat?: DateLabelFormat
  /** Multi-series. */
  secondaryGroupBy?: GroupBy
  stacked?: boolean
  cumulative?: boolean
  area?: boolean
  showDataLabels?: boolean
  showLegend?: boolean
  /** Chart color scheme id; `'default'` when unset. */
  color?: ChartPaletteId
  rangeMin?: number
  rangeMax?: number
}

export type PieChartConfig = BaseChartConfig & {
  kind: 'pieChart'
  metric: Metric
  groupBy: GroupBy
  /** Slice/legend date label style (plan 10); display-only. */
  labelFormat?: DateLabelFormat
  donut?: boolean
  showCenterTotal?: boolean
  showDataLabels?: boolean
  showLegend?: boolean
  /** Chart color scheme id; `'default'` when unset. */
  color?: ChartPaletteId
}

export type KpiConfig = BaseChartConfig & {
  kind: 'kpi'
  metric: Metric
  prefix?: string
  suffix?: string
  trend?: { dateFieldRef: WidgetFieldRef; compare: TrendCompare }
}

export type GaugeConfig = BaseChartConfig & {
  kind: 'gauge'
  metric: Metric
  /** Default 0. */
  rangeMin?: number
  /** Required — a gauge needs a target. */
  rangeMax: number
  /** Chart color scheme id; `'default'` when unset. */
  color?: ChartPaletteId
  showDataLabels?: boolean
}

export type RecordListConfig = {
  kind: 'recordList'
  source: WidgetSource
  filters?: ConditionGroup[]
  globalDateFieldRef?: WidgetFieldRef | null
  /** Shown after the primary display column. */
  columns: WidgetFieldRef[]
  sort?: { fieldRef: WidgetFieldRef; desc: boolean }
  /** Default {@link DEFAULT_RECORD_LIST_PAGE_SIZE}, cap {@link MAX_RECORD_LIST_PAGE_SIZE}. */
  pageSize?: number
}

/** TipTap JSON doc. */
export type RichTextConfig = { kind: 'richText'; content: unknown | null }
export type IframeConfig = { kind: 'iframe'; url: string | null }

export type WidgetConfiguration =
  | BarChartConfig
  | LineChartConfig
  | PieChartConfig
  | KpiConfig
  | GaugeConfig
  | RecordListConfig
  | RichTextConfig
  | IframeConfig

/** Configs that carry a data `source` + `metric` (everything but richText/iframe). */
export type DataWidgetConfig =
  | BarChartConfig
  | LineChartConfig
  | PieChartConfig
  | KpiConfig
  | GaugeConfig
  | RecordListConfig

/** Configs that produce an aggregate query (metric-bearing; excludes recordList). */
export type ChartWidgetConfig =
  | BarChartConfig
  | LineChartConfig
  | PieChartConfig
  | KpiConfig
  | GaugeConfig

/**
 * The **data-determining** projection of a chart config — exactly the fields the
 * aggregate query reads (`buildAggregateQueryForWidget` + `trendSpecForWidget`).
 * Display-only settings (color, ranges, `valueFormat`, `labelFormat`, legend,
 * prefix/suffix…) are deliberately absent, so a display edit produces an
 * identical projection and the widget's data query is NOT re-fetched. This is
 * what the `chartData`/`kpiData` procedures accept as input. See
 * {@link toChartQueryInput}.
 */
export type ChartQueryInput = {
  kind: ChartWidgetConfig['kind']
  source: WidgetSource
  metric: Metric
  filters?: ConditionGroup[]
  globalDateFieldRef?: WidgetFieldRef | null
  /** Only for bar/line/pie. */
  groupBy?: GroupBy
  /** Only for bar/line. */
  secondaryGroupBy?: GroupBy
  /** Only for kpi — the trend date field + comparison drive the previous-window query. */
  trend?: { dateFieldRef: WidgetFieldRef; compare: TrendCompare }
}

// ── Layout doc ──────────────────────────────────────────────────────────────

export type LayoutWidget = {
  id: string
  title: string
  type: WidgetKind
  gridPosition: GridPosition
  configuration: WidgetConfiguration
}
export type LayoutTab = { id: string; title: string; icon: string | null; widgets: LayoutWidget[] }
export type DashboardLayoutDoc = { tabs: LayoutTab[]; globalFilters?: DashboardGlobalFilters }

// ── Client-visible row shapes ───────────────────────────────────────────────

export type DashboardSummary = {
  id: string
  name: string
  description: string | null
  icon: { iconId: string; color: string } | null
  /** True ⇔ the workspace-baseline `ResourceAccess` row is `'none'` (doc 13 §0.4/§3). */
  isPrivate: boolean
  position: number
  createdById: string | null
  activeVersionId: string | null
  /** Set ⇒ THE dashboard for this entity def (list-page badge, plan 02). */
  entityDefinitionId: string | null
  tabCount: number
  widgetCount: number
  createdAt: string
  updatedAt: string
}

export type DashboardWithLayout = {
  id: string
  name: string
  description: string | null
  icon: { iconId: string; color: string } | null
  /** True ⇔ the workspace-baseline `ResourceAccess` row is `'none'` (doc 13 §0.4/§3). */
  isPrivate: boolean
  position: number
  createdById: string | null
  activeVersionId: string | null
  /** Set ⇒ THE dashboard for this entity def — source-picker prefill (plan 02). */
  entityDefinitionId: string | null
  /** The published active version's number — what view mode renders. */
  versionNumber: number
  /** The published active version's layout — what viewers / view mode render. */
  layout: DashboardLayoutDoc
  /**
   * The live editable draft (`Dashboard.draftLayout`) — what edit mode renders.
   * May carry unconfigured widget shells. `null` only for legacy rows with no
   * draft yet (readers fall back to {@link layout}).
   */
  draftLayout: DashboardLayoutDoc | null
  /** `draftLayout` diverges from the active version — drives the "unsaved" pill. */
  hasUnpublishedChanges: boolean
  createdAt: string
  updatedAt: string
}

export type DashboardVersionSummary = {
  id: string
  versionNumber: number
  label: string | null
  editorId: string | null
  createdAt: string
}

// ── Constants ───────────────────────────────────────────────────────────────

export const WIDGET_KINDS: WidgetKind[] = [
  'barChart',
  'lineChart',
  'pieChart',
  'kpi',
  'gauge',
  'recordList',
  'richText',
  'iframe',
]

export const WIDGET_KIND_LABELS: Record<WidgetKind, string> = {
  barChart: 'Bar chart',
  lineChart: 'Line chart',
  pieChart: 'Pie chart',
  kpi: 'KPI',
  gauge: 'Gauge',
  recordList: 'Record list',
  richText: 'Rich text',
  iframe: 'Embed',
}

/** 12-col grid. Default footprint used when a widget is dropped onto the grid. */
export const DEFAULT_WIDGET_SIZE: Record<WidgetKind, { columnSpan: number; rowSpan: number }> = {
  barChart: { columnSpan: 6, rowSpan: 4 },
  lineChart: { columnSpan: 6, rowSpan: 4 },
  pieChart: { columnSpan: 4, rowSpan: 4 },
  kpi: { columnSpan: 3, rowSpan: 2 },
  gauge: { columnSpan: 3, rowSpan: 3 },
  recordList: { columnSpan: 6, rowSpan: 5 },
  richText: { columnSpan: 4, rowSpan: 3 },
  iframe: { columnSpan: 6, rowSpan: 4 },
}

export const MIN_WIDGET_SIZE: Record<WidgetKind, { columnSpan: number; rowSpan: number }> = {
  barChart: { columnSpan: 3, rowSpan: 3 },
  lineChart: { columnSpan: 3, rowSpan: 3 },
  pieChart: { columnSpan: 2, rowSpan: 3 },
  kpi: { columnSpan: 2, rowSpan: 2 },
  gauge: { columnSpan: 2, rowSpan: 2 },
  recordList: { columnSpan: 3, rowSpan: 3 },
  richText: { columnSpan: 2, rowSpan: 2 },
  iframe: { columnSpan: 2, rowSpan: 2 },
}

export const DASHBOARD_GRID_COLUMNS = 12

/** Doc-shape caps — enforced by `dashboardLayoutDocSchema` (config-schemas.ts). */
export const MAX_TABS = 20
export const MAX_WIDGETS_PER_TAB = 60

/** Group-by caps (aggregate engine, plan 03). */
export const DEFAULT_GROUP_LIMIT = 50
export const MAX_GROUP_LIMIT = 100

/** Record-list caps (plan 05). */
export const DEFAULT_RECORD_LIST_PAGE_SIZE = 10
export const MAX_RECORD_LIST_PAGE_SIZE = 50

/** Fallback target when a widget is converted to a gauge (gauge.rangeMax is required). */
export const DEFAULT_GAUGE_MAX = 100

// ── Guards / helpers ────────────────────────────────────────────────────────

/** Configs carrying a data `source` + `metric` (charts, KPI, gauge, recordList). */
export function isDataWidget(config: WidgetConfiguration): config is DataWidgetConfig {
  return config.kind !== 'richText' && config.kind !== 'iframe'
}

/** Metric-bearing chart configs (excludes recordList / richText / iframe). */
export function isChartWidget(config: WidgetConfiguration): config is ChartWidgetConfig {
  return (
    config.kind === 'barChart' ||
    config.kind === 'lineChart' ||
    config.kind === 'pieChart' ||
    config.kind === 'kpi' ||
    config.kind === 'gauge'
  )
}

/**
 * True when a chart widget has enough config to run its aggregate query: a
 * source and a metric, plus a group-by for the grouped chart kinds (bar/line/
 * pie need a dimension; KPI/gauge are single-value).
 */
export function isChartConfigured(config: WidgetConfiguration): boolean {
  if (!isChartWidget(config)) return false
  if (!config.source || !config.metric?.op) return false
  if (config.metric.op !== 'count' && !config.metric.fieldRef) return false
  if (config.kind === 'barChart' || config.kind === 'lineChart' || config.kind === 'pieChart') {
    return Boolean(config.groupBy?.fieldRef)
  }
  return true
}

/**
 * Project a chart config down to its {@link ChartQueryInput} — the subset the
 * aggregate engine actually reads. Display-only fields never cross the wire, so
 * two configs that differ only in appearance produce an IDENTICAL projection and
 * share one cache entry (no re-fetch on a format/color/legend edit). Kept in
 * lockstep with `buildAggregateQueryForWidget` — anything that function reads
 * off `cfg` must be copied here.
 */
export function toChartQueryInput(config: ChartWidgetConfig): ChartQueryInput {
  const input: ChartQueryInput = {
    kind: config.kind,
    source: config.source,
    metric: config.metric,
  }
  if (config.filters !== undefined) input.filters = config.filters
  if (config.globalDateFieldRef !== undefined) input.globalDateFieldRef = config.globalDateFieldRef
  if (config.kind === 'barChart' || config.kind === 'lineChart' || config.kind === 'pieChart') {
    if (config.groupBy !== undefined) input.groupBy = config.groupBy
    if (config.kind !== 'pieChart' && config.secondaryGroupBy !== undefined) {
      input.secondaryGroupBy = config.secondaryGroupBy
    }
  }
  if (config.kind === 'kpi' && config.trend !== undefined) input.trend = config.trend
  return input
}

// ── Change widget type (plan 09) ────────────────────────────────────────────

/** Chart kinds that carry a `groupBy` dimension. */
const GROUP_BY_KINDS: WidgetKind[] = ['barChart', 'lineChart', 'pieChart']

/** A view over any data widget's fields, all optional — presence gates carry-over. */
type AnyDataConfig = Partial<
  BarChartConfig & LineChartConfig & PieChartConfig & KpiConfig & GaugeConfig & RecordListConfig
>

/** Copy only the defined keys from `obj` (so we never write `undefined` fields). */
function pickDefined<T extends object, K extends keyof T>(obj: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {}
  for (const key of keys) if (obj[key] !== undefined) out[key] = obj[key]
  return out
}

/**
 * Convert a widget configuration to another **data-widget** kind, carrying over
 * every field the target kind also has and filling target-only required fields
 * with defaults (gauge `rangeMax`, recordList `columns`). Field presence in the
 * source union does the gating — e.g. `groupBy` is only ever set on bar/line/pie,
 * so it naturally survives only into another group-by chart.
 *
 * The result may be an unconfigured shell (e.g. KPI → bar has no `groupBy`);
 * that's expected and caught downstream by {@link isChartConfigured} + the
 * pre-save gate. `richText`/`iframe` are not valid `from` or `to` kinds.
 */
export function convertWidgetConfiguration(
  from: WidgetConfiguration,
  toKind: WidgetKind
): WidgetConfiguration {
  if (from.kind === toKind) return from
  if (!isDataWidget(from) || toKind === 'richText' || toKind === 'iframe') {
    throw new Error(`Cannot change widget type: ${from.kind} → ${toKind}`)
  }

  const f = from as AnyDataConfig
  // Shared spine — present on every data widget.
  const spine = pickDefined(f, ['source', 'filters', 'globalDateFieldRef'])
  const metric: Metric = f.metric ?? { op: 'count' }
  const groupBy = GROUP_BY_KINDS.includes(from.kind) ? f.groupBy : undefined

  switch (toKind) {
    case 'barChart':
      return {
        kind: 'barChart',
        ...spine,
        ...pickDefined(f, [
          'description',
          'valueFormat',
          'labelFormat',
          'secondaryGroupBy',
          'layout',
          'stacked',
          'cumulative',
          'showDataLabels',
          'showLegend',
          'color',
          'rangeMin',
          'rangeMax',
        ]),
        metric,
        ...(groupBy && { groupBy }),
      } as WidgetConfiguration
    case 'lineChart':
      return {
        kind: 'lineChart',
        ...spine,
        ...pickDefined(f, [
          'description',
          'valueFormat',
          'labelFormat',
          'secondaryGroupBy',
          'stacked',
          'cumulative',
          'area',
          'showDataLabels',
          'showLegend',
          'color',
          'rangeMin',
          'rangeMax',
        ]),
        metric,
        ...(groupBy && { groupBy }),
      } as WidgetConfiguration
    case 'pieChart':
      return {
        kind: 'pieChart',
        ...spine,
        ...pickDefined(f, [
          'description',
          'valueFormat',
          'labelFormat',
          'donut',
          'showCenterTotal',
          'showDataLabels',
          'showLegend',
          'color',
        ]),
        metric,
        ...(groupBy && { groupBy }),
      } as WidgetConfiguration
    case 'kpi':
      return {
        kind: 'kpi',
        ...spine,
        ...pickDefined(f, ['description', 'valueFormat', 'prefix', 'suffix', 'trend']),
        metric,
      } as WidgetConfiguration
    case 'gauge':
      return {
        kind: 'gauge',
        ...spine,
        ...pickDefined(f, ['description', 'valueFormat', 'rangeMin', 'color', 'showDataLabels']),
        metric,
        rangeMax: f.rangeMax ?? DEFAULT_GAUGE_MAX,
      } as WidgetConfiguration
    case 'recordList':
      return {
        kind: 'recordList',
        ...spine,
        ...pickDefined(f, ['sort', 'pageSize']),
        columns: f.columns ?? [],
      } as WidgetConfiguration
    default:
      throw new Error(`Unhandled widget kind: ${toKind}`)
  }
}

/**
 * User-facing labels for the **configured** fields on `from` that would NOT
 * survive a change to `toKind` — drives the "this will remove …" confirm. Only
 * structural / user-entered fields are reported; cosmetic toggles are silent.
 * Empty ⇒ lossless ⇒ no confirmation needed.
 */
export function droppedFieldsOnConvert(from: WidgetConfiguration, toKind: WidgetKind): string[] {
  if (from.kind === toKind || !isDataWidget(from)) return []
  const to = convertWidgetConfiguration(from, toKind) as AnyDataConfig
  const f = from as AnyDataConfig
  const dropped: string[] = []
  const check = (key: keyof AnyDataConfig, label: string, configured: boolean) => {
    if (configured && to[key] === undefined) dropped.push(label)
  }

  check('groupBy', 'Category', Boolean(f.groupBy?.fieldRef))
  check('secondaryGroupBy', 'Series', Boolean(f.secondaryGroupBy?.fieldRef))
  check('trend', 'Trend', Boolean(f.trend))
  check('prefix', 'Prefix', Boolean(f.prefix))
  check('suffix', 'Suffix', Boolean(f.suffix))
  check('sort', 'Sort', Boolean(f.sort))
  check('columns', 'Columns', Array.isArray(f.columns) && f.columns.length > 0)
  // Metric is only "lost" when the target has none (recordList), and only worth
  // flagging if it's beyond the default count.
  check('metric', 'Metric', Boolean(f.metric && (f.metric.op !== 'count' || f.metric.fieldRef)))

  return dropped
}

/**
 * The starter layout every new (and duplicated-from-empty) dashboard begins
 * with: a single empty `Overview` tab. Client-minted ids (`generateId`), so the
 * same factory serves both the create mutation (plan 02) and the draft store's
 * add-tab action (plan 06).
 */
export function createStarterLayoutDoc(): DashboardLayoutDoc {
  return { tabs: [{ id: generateId(), title: 'Overview', icon: null, widgets: [] }] }
}

// ── Drill-down: segment → conditions ────────────────────────────────────────

/**
 * A clicked chart segment (bar / slice / point). One shape per group-by column
 * type — resolved by the aggregate engine when it emits group rows (plan 03),
 * consumed here to build the drill-down filter (plan 08). Kept in one place so
 * the group-expression and segment-condition logic live together.
 */
export type SegmentValue =
  | { kind: 'option'; optionId: string }
  | { kind: 'related'; relatedEntityId: string }
  | { kind: 'scalar'; value: string | number | boolean }
  /** The null / no-value bucket. */
  | { kind: 'empty' }
  /** A date bucket, half-open `[from, to)` in ISO. */
  | { kind: 'dateBucket'; from: string; to: string }

/**
 * Translate a clicked segment on a group-by field into a `ConditionGroup[]` the
 * record views + SQL builders both understand. Combined with the widget filter
 * and global filter by the drill-down caller (plan 08). `fieldRef` flows through
 * unwrapped — `Condition.fieldId` accepts a `ResourceFieldId` or a path array,
 * which is exactly `WidgetFieldRef`.
 */
export function segmentToConditions(
  fieldRef: WidgetFieldRef,
  segment: SegmentValue
): ConditionGroup[] {
  const group = (conditions: ConditionGroup['conditions']): ConditionGroup[] => [
    { id: generateId(), logicalOperator: 'AND', conditions },
  ]
  const cond = (
    operator: string,
    value: string | number | boolean | undefined
  ): ConditionGroup['conditions'][number] => ({
    id: generateId(),
    fieldId: fieldRef,
    operator: operator as ConditionGroup['conditions'][number]['operator'],
    value: value as ConditionGroup['conditions'][number]['value'],
  })

  switch (segment.kind) {
    case 'empty':
      return group([cond('empty', undefined)])
    case 'option':
      return group([cond('is', segment.optionId)])
    case 'related':
      return group([cond('is', segment.relatedEntityId)])
    case 'scalar':
      return group([cond('is', segment.value)])
    case 'dateBucket':
      return group([cond('after', segment.from), cond('before', segment.to)])
  }
}

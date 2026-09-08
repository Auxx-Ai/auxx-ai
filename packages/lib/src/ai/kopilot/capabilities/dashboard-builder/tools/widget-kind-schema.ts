// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/widget-kind-schema.ts

/**
 * PROJECTION of the existing widget constants and zod schemas into the shape
 * `list_widget_kinds` / `describe_widget_kind` answer with.
 *
 * The whole point of this file is that it holds NO table of widget kinds. A
 * ninth kind is a new member of `WIDGET_KINDS` plus a new option on
 * `widgetConfigurationSchema`, and both tools pick it up with no Kopilot edit at
 * all. What IS written down here is the mapping from a stored config key to the
 * FRIENDLY input key the tools accept, because that mapping is a property of
 * this capability's argument surface (`WidgetConfigInput`), not of any kind.
 *
 * `requiredToPublish` comes from the STRICT publish schema
 * (`widgetConfigurationSchema`), not from prose: it is the set of keys that
 * schema will not accept a widget without, so it is the same answer
 * `publishDashboard` gives. That is how a caller learns that a gauge needs
 * `rangeMax` and a bar chart needs a `groupBy` without anyone maintaining a
 * sentence that can rot.
 */

import type { LayoutWidget, WidgetConfiguration } from '../../../../../dashboards/client'
import { WIDGET_KIND_LABELS, type WidgetKind } from '../../../../../dashboards/client'
import { widgetConfigurationSchema } from '../../../../../dashboards/config-schemas'
// The leaf `validate` module, never the `draft-edit` barrel: this file is
// imported at tool-construction time and `validate.ts` is pure (no db, no
// Redis, no org cache), while the barrel pulls all three.
import { widgetIssues } from '../../../../../dashboards/draft-edit/validate'

/** The minimum a zod schema node exposes that this projection reads. */
interface SchemaNode {
  def?: {
    type?: string
    innerType?: SchemaNode
    values?: unknown[]
    entries?: Record<string, unknown>
  }
  isOptional?: () => boolean
  safeParse?: (value: unknown) => { success: boolean }
}

interface ObjectSchemaNode extends SchemaNode {
  shape: Record<string, SchemaNode>
}

/**
 * The discriminated union's options. `widgetConfigurationSchema` is exported
 * with an `as z.ZodType<WidgetConfiguration>` cast for callers, so the union
 * shape is invisible to TypeScript while being entirely present at runtime.
 */
function unionOptions(): ObjectSchemaNode[] {
  const union = widgetConfigurationSchema as unknown as { options?: ObjectSchemaNode[] }
  return Array.isArray(union.options) ? union.options : []
}

/** The option whose `kind` literal is `kind`. */
function optionFor(kind: WidgetKind): ObjectSchemaNode | undefined {
  return unionOptions().find((option) => {
    const values = option.shape?.kind?.def?.values
    return Array.isArray(values) && values[0] === kind
  })
}

/** Unwrap optional/nullable/default/catch wrappers down to the value schema. */
function unwrap(node: SchemaNode | undefined): SchemaNode | undefined {
  let current = node
  const wrappers = new Set(['optional', 'nullable', 'default', 'catch', 'prefault'])
  while (current?.def && wrappers.has(current.def.type ?? '')) {
    current = current.def.innerType
  }
  return current
}

/** A short type name for one config key, with enum members when it has them. */
function describeType(node: SchemaNode | undefined): string {
  const inner = unwrap(node)
  const type = inner?.def?.type ?? 'unknown'
  if (type === 'enum' && inner?.def?.entries) {
    return `one of ${Object.keys(inner.def.entries).join(' | ')}`
  }
  if (type === 'literal' && Array.isArray(inner?.def?.values)) {
    return String(inner.def.values[0])
  }
  return type
}

/**
 * Stored config key to the friendly input key the tools take. Anything absent
 * from this map is a display-only setting and goes through `options`.
 */
const FRIENDLY_KEY: Record<string, string> = {
  source: 'source',
  metric: 'metric',
  groupBy: 'groupBy',
  secondaryGroupBy: 'secondaryGroupBy',
  columns: 'columns',
  sort: 'sort',
  globalDateFieldRef: 'globalDateField',
  trend: 'trend',
  filters: 'filters',
}

/** What each friendly key expects, said once rather than per kind. */
const FRIENDLY_SHAPE: Record<string, string> = {
  source: 'a source NAME from list_dashboard_sources',
  metric: "{ op: 'count' | 'sum' | 'avg' | 'min' | 'max', field?: <field name> }",
  groupBy: '{ field: <field name>, dateGranularity?, sort?, limit?, omitEmpty? }',
  secondaryGroupBy: '{ field: <field name>, dateGranularity?, sort?, limit?, omitEmpty? }',
  columns: '[<field name>, ...]',
  sort: '{ field: <field name>, desc? }',
  globalDateField: 'a date field NAME, or null to opt out of the global range',
  trend: "{ dateField: <field name>, compare: 'previousPeriod' | 'samePeriodLastYear' }",
  filters: '[{ field: <field name>, operator, value }] (plus filterMatch)',
}

/** One widget kind, compact, for {@link listWidgetKinds}. */
export interface WidgetKindSummary {
  kind: WidgetKind
  label: string
  description: string
  needsSource: boolean
}

/** The full projection for one kind, for {@link describeWidgetKind}. */
export interface WidgetKindDescription extends WidgetKindSummary {
  /** Friendly inputs this kind accepts, with what each expects. */
  config: Array<{ key: string; expects: string; required: boolean }>
  /** Display-only keys, passed inside `options`. */
  options: Array<{ key: string; type: string }>
  /**
   * What the PUBLISH schema will not accept this kind without, in friendly
   * terms. Derived from the strict schema, so it is the same answer publishing
   * gives.
   */
  requiredToPublish: string[]
  /**
   * What an EMPTY widget of this kind is missing before it renders anything
   * useful. Projected by running the same `widgetIssues` guard
   * `validate_dashboard` runs, so the two can never disagree.
   *
   * Kept separate from {@link requiredToPublish} because the two genuinely
   * differ: a record list with no columns and an embed with no URL render
   * nothing yet publish cleanly.
   */
  requiredToRender: string[]
  example: Record<string, unknown>
}

/**
 * One line per kind, written here because a zod schema cannot say what a widget
 * is FOR. Keyed by kind so a new kind that forgets a line still lists (with an
 * honest fallback) instead of dropping out of the catalog.
 */
const KIND_DESCRIPTIONS: Partial<Record<WidgetKind, string>> = {
  barChart: 'Counts or sums split across a category or date dimension, drawn as bars.',
  lineChart: 'A measure over time (or any ordered dimension), drawn as a line or area.',
  pieChart: 'One measure split across a small number of categories, as a pie or donut.',
  kpi: 'A single headline number, optionally with a trend against a previous window.',
  gauge: 'A single number against a target, drawn as a dial. Needs a maximum.',
  recordList: 'A filtered, sorted table of records with the columns you pick.',
  richText: 'A formatted note. Reads no data.',
  iframe: 'An embedded external page by URL. Reads no data.',
}

/** Worked example per kind, in the exact friendly argument shape. */
const KIND_EXAMPLES: Partial<Record<WidgetKind, Record<string, unknown>>> = {
  barChart: {
    kind: 'barChart',
    title: 'Tickets by status',
    source: 'tickets',
    metric: { op: 'count' },
    groupBy: { field: 'Status' },
  },
  lineChart: {
    kind: 'lineChart',
    title: 'Tickets per week',
    source: 'tickets',
    metric: { op: 'count' },
    groupBy: { field: 'Created at', dateGranularity: 'week' },
  },
  pieChart: {
    kind: 'pieChart',
    title: 'Tickets by priority',
    source: 'tickets',
    metric: { op: 'count' },
    groupBy: { field: 'Priority' },
  },
  kpi: {
    kind: 'kpi',
    title: 'Open tickets',
    source: 'tickets',
    metric: { op: 'count' },
    filters: [{ field: 'Status', operator: 'is', value: 'Open' }],
  },
  gauge: {
    kind: 'gauge',
    title: 'Tickets closed this month',
    source: 'tickets',
    metric: { op: 'count' },
    options: { rangeMax: 200 },
  },
  recordList: {
    kind: 'recordList',
    title: 'Newest tickets',
    source: 'tickets',
    columns: ['Subject', 'Status', 'Priority'],
    sort: { field: 'Created at', desc: true },
  },
  richText: { kind: 'richText', title: 'Notes', options: { content: null } },
  iframe: { kind: 'iframe', title: 'Status page', options: { url: 'https://example.com' } },
}

/** Whether a kind reads data at all, taken from its schema rather than a list. */
function needsSource(kind: WidgetKind): boolean {
  return optionFor(kind)?.shape?.source !== undefined
}

/**
 * Does the STRICT publish schema reject a widget that leaves this key unset?
 *
 * Two conditions, and the second is the one that matters: the key must be
 * required AND must not accept `null`. An embed's `url` is
 * `z.string().url().nullable()`, so a null url publishes cleanly and calling it
 * "required to publish" would have the model refuse to finish work that was
 * already finishable. That it renders nothing is a RENDER problem, and
 * {@link requiredToRender} is where it belongs.
 */
function isRequiredToPublish(node: SchemaNode): boolean {
  if (node.isOptional?.() !== false) return false
  return node.safeParse?.(null).success !== true
}

/** The placeholder ref the render-requirement probe below is worded around. */
const PROBE_REF = 'this widget'

/**
 * What a brand-new, empty widget of this kind is still missing, straight from
 * the guard `validate_dashboard` uses. A projection, not a restatement.
 */
function requiredToRender(kind: WidgetKind): string[] {
  const widget = {
    id: 'probe',
    title: PROBE_REF,
    type: kind,
    gridPosition: { column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
    configuration: { kind } as WidgetConfiguration,
  } as LayoutWidget
  return widgetIssues(widget, PROBE_REF)
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message)
}

/** The compact catalog. Projects `WIDGET_KINDS` verbatim. */
export function listWidgetKinds(kinds: readonly WidgetKind[]): WidgetKindSummary[] {
  return kinds.map((kind) => ({
    kind,
    label: WIDGET_KIND_LABELS[kind] ?? kind,
    description: KIND_DESCRIPTIONS[kind] ?? `The ${WIDGET_KIND_LABELS[kind] ?? kind} widget.`,
    needsSource: needsSource(kind),
  }))
}

/** The full projection for one kind, or undefined when the kind is unknown. */
export function describeWidgetKind(kind: WidgetKind): WidgetKindDescription | undefined {
  const option = optionFor(kind)
  if (!option) return undefined

  const config: WidgetKindDescription['config'] = []
  const options: WidgetKindDescription['options'] = []
  const requiredToPublish: string[] = []

  for (const [key, node] of Object.entries(option.shape)) {
    if (key === 'kind') continue
    const required = isRequiredToPublish(node)
    const friendly = FRIENDLY_KEY[key]
    if (friendly) {
      config.push({
        key: friendly,
        expects: FRIENDLY_SHAPE[friendly] ?? describeType(node),
        required,
      })
      if (required) requiredToPublish.push(friendly)
    } else {
      options.push({ key, type: describeType(node) })
      // A required key with no friendly counterpart is set through `options`
      // (a gauge's `rangeMax`), so name it that way.
      if (required) requiredToPublish.push(`options.${key}`)
    }
  }

  return {
    kind,
    label: WIDGET_KIND_LABELS[kind] ?? kind,
    description: KIND_DESCRIPTIONS[kind] ?? `The ${WIDGET_KIND_LABELS[kind] ?? kind} widget.`,
    needsSource: needsSource(kind),
    config: config.sort((a, b) => Number(b.required) - Number(a.required)),
    options,
    requiredToPublish,
    requiredToRender: requiredToRender(kind),
    example: KIND_EXAMPLES[kind] ?? { kind },
  }
}

// apps/web/src/components/dashboard/lib/widget-config-defaults.ts
//
// Default configuration + title for a newly added widget. PROVISIONAL — plan 07
// (widget config panel) owns the real defaults and the source-picker flow; this
// is the minimum the draft store needs to insert a widget today.
//
// richText/iframe get complete, persistable configs. Data widgets (chart/kpi/
// gauge/recordList) get an UNCONFIGURED SHELL: the layout-doc schema requires a
// `source` (+ groupBy / rangeMax), so these can't be saved until configured —
// they render the "Configure this widget" CTA (plan 05) and plan 07 fills them
// in. The shells intentionally omit `source`, matching the `isChartConfigured`
// guard which treats a missing source as unconfigured.

import {
  WIDGET_KIND_LABELS,
  type WidgetConfiguration,
  type WidgetKind,
} from '@auxx/lib/dashboards/client'

/** A new widget's title: the kind label (e.g. "Bar chart"). Uniqueness is the store's job. */
export function defaultWidgetTitle(kind: WidgetKind): string {
  return WIDGET_KIND_LABELS[kind]
}

/**
 * Default configuration for a freshly added widget of `kind`. Data-widget
 * configs are unconfigured shells (no `source`) — cast because the config type
 * marks `source` required, but the add-then-configure flow legitimately starts
 * without one (plan 07 sets it).
 */
export function defaultWidgetConfiguration(kind: WidgetKind): WidgetConfiguration {
  switch (kind) {
    case 'richText':
      return { kind: 'richText', content: null }
    case 'iframe':
      return { kind: 'iframe', url: null }
    case 'barChart':
      return { kind: 'barChart', metric: { op: 'count' } } as WidgetConfiguration
    case 'lineChart':
      return { kind: 'lineChart', metric: { op: 'count' } } as WidgetConfiguration
    case 'pieChart':
      return { kind: 'pieChart', metric: { op: 'count' } } as WidgetConfiguration
    case 'kpi':
      return { kind: 'kpi', metric: { op: 'count' } } as WidgetConfiguration
    case 'gauge':
      return { kind: 'gauge', metric: { op: 'count' } } as WidgetConfiguration
    case 'recordList':
      return { kind: 'recordList', columns: [] } as WidgetConfiguration
  }
}

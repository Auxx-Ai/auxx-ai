// apps/web/src/components/dynamic-table/utils/table-view-preference.ts

import type { TableViewPreferenceConfig } from '@auxx/lib/conditions/client'
import type { TableUIConfig } from '../stores/store-types'

/** Strip transient query state and shared-view structure from a personal overlay. */
export function toTableViewPreferenceConfig(
  config: Partial<TableUIConfig>
): TableViewPreferenceConfig {
  return {
    columnVisibility: config.columnVisibility ?? {},
    columnOrder: config.columnOrder ?? [],
    columnSizing: config.columnSizing ?? {},
    columnPinning: config.columnPinning,
    columnLabels: config.columnLabels,
    columnFormatting: config.columnFormatting,
    rowHeight: config.rowHeight,
  }
}

/**
 * Convert a persisted preference row back into a personal overlay.
 * `toTableViewPreferenceConfig` coerces untouched keys to empty containers to
 * satisfy the schema; hydrating those back verbatim would shadow the shared
 * view's saved config (e.g. an empty `columnOrder` masking the view's real
 * order), so empty `[]`/`{}` values are dropped.
 */
export function toPersonalOverlayConfig(config: TableViewPreferenceConfig): Partial<TableUIConfig> {
  const overlay: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (value == null) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
      continue
    overlay[key] = value
  }
  return overlay as Partial<TableUIConfig>
}

/** Whether an extracted config contains presentation state worth persisting. */
export function hasPresentationPreference(config: TableViewPreferenceConfig): boolean {
  return (
    Object.keys(config.columnVisibility).length > 0 ||
    config.columnOrder.length > 0 ||
    Object.keys(config.columnSizing).length > 0 ||
    Boolean(
      config.columnPinning &&
        ((config.columnPinning.left?.length ?? 0) > 0 ||
          (config.columnPinning.right?.length ?? 0) > 0)
    ) ||
    Boolean(config.columnLabels && Object.keys(config.columnLabels).length > 0) ||
    Boolean(config.columnFormatting && Object.keys(config.columnFormatting).length > 0) ||
    Boolean(config.rowHeight)
  )
}

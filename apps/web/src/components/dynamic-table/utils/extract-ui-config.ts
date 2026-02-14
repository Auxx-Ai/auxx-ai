// apps/web/src/components/dynamic-table/utils/extract-ui-config.ts

import type { TableUIConfig } from '../stores/store-types'
import type { ViewConfig } from '../types'

/**
 * Extract TableUIConfig from ViewConfig by removing filters.
 * Filters are managed separately in the filter slice.
 */
export function extractUIConfig(viewConfig: ViewConfig): TableUIConfig {
  const { filters: _filters, ...uiConfig } = viewConfig

  return {
    sorting: uiConfig.sorting ?? [],
    columnVisibility: uiConfig.columnVisibility ?? {},
    columnOrder: uiConfig.columnOrder ?? [],
    columnSizing: uiConfig.columnSizing ?? {},
    columnPinning: uiConfig.columnPinning,
    columnLabels: uiConfig.columnLabels,
    columnFormatting: uiConfig.columnFormatting,
    rowHeight: uiConfig.rowHeight,
    viewType: uiConfig.viewType ?? 'table',
    kanban: uiConfig.kanban,
  }
}

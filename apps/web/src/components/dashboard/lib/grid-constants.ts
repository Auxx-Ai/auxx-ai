// apps/web/src/components/dashboard/lib/grid-constants.ts
//
// react-grid-layout tuning for the dashboard grid: responsive breakpoints, the
// 12-col / 1-col column counts, pixel row-height + margin, and the per-kind
// default/minimum span table. Spans mirror DEFAULT_WIDGET_SIZE / MIN_WIDGET_SIZE
// in `@auxx/lib/dashboards/client` (the versioned layout-doc source of truth) —
// this is the react-grid-layout-shaped ({ w, h }) projection of those.

import { DEFAULT_WIDGET_SIZE, MIN_WIDGET_SIZE, type WidgetKind } from '@auxx/lib/dashboards/client'

/** Responsive breakpoints (min-width px). Desktop ≥768, mobile below. */
export const GRID_BREAKPOINTS = { desktop: 768, mobile: 0 } as const

/** Column count per breakpoint: full 12-col grid on desktop, single stack on mobile. */
export const GRID_COLUMNS = { desktop: 12, mobile: 1 } as const

/** Height of one grid row unit, in px. */
export const GRID_ROW_HEIGHT = 55

/** Gap between grid items, in px (applied on both axes). */
export const GRID_MARGIN = 8

/** react-grid-layout span pair. */
export type GridSpan = { w: number; h: number }

/** Per-kind default footprint + minimum footprint, in 12-col grid units. */
export type GridSizeConstraint = { default: GridSpan; min: GridSpan }

/**
 * Per-kind size table, projected from the layout-doc `{ columnSpan, rowSpan }`
 * constants into react-grid-layout `{ w, h }`. `tabToLayouts` reads `min` for
 * `minW`/`minH`; the add-widget flow (plan 07) reads `default` for placement.
 */
export const WIDGET_GRID_SIZE: Record<WidgetKind, GridSizeConstraint> = Object.fromEntries(
  (Object.keys(DEFAULT_WIDGET_SIZE) as WidgetKind[]).map((kind) => [
    kind,
    {
      default: { w: DEFAULT_WIDGET_SIZE[kind].columnSpan, h: DEFAULT_WIDGET_SIZE[kind].rowSpan },
      min: { w: MIN_WIDGET_SIZE[kind].columnSpan, h: MIN_WIDGET_SIZE[kind].rowSpan },
    },
  ])
) as Record<WidgetKind, GridSizeConstraint>

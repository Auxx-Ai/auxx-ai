// packages/lib/src/dashboards/layout-ops.ts
//
// Pure, client-safe transforms over a `DashboardLayoutDoc`: grid placement,
// new-widget defaults, and one function per document edit the dashboard editor
// can make (add/update/duplicate/remove a widget, tab CRUD, global filters).
//
// These lived in the browser draft store (`apps/web/.../dashboard-draft-store.ts`)
// and in `apps/web/src/components/dashboard/lib/` while that store was the only
// writer. The Kopilot dashboard-builder capability is a SECOND writer against the
// same doc, so they moved here: a server-side `add_widget` that placed widgets by
// its own rules would drift from where the canvas puts them, and a server-side
// default config that differed from the panel's would produce widgets the UI then
// treats as a different shape. One definition, both callers.
//
// Every function is pure: it returns a NEW doc and never mutates its input.
//
// Import rules: this module may only reach for `./client`, `@auxx/utils` and
// `@auxx/types`. It is deliberately NOT re-exported through `client.ts` (it
// imports client, so that would be a cycle) — consumers import
// `@auxx/lib/dashboards/layout-ops`.

import { generateId } from '@auxx/utils'
import {
  convertWidgetConfiguration,
  DASHBOARD_GRID_COLUMNS,
  type DashboardGlobalFilters,
  type DashboardLayoutDoc,
  DEFAULT_WIDGET_SIZE,
  type GridPosition,
  type LayoutTab,
  type LayoutWidget,
  MIN_WIDGET_SIZE,
  WIDGET_KIND_LABELS,
  type WidgetConfiguration,
  type WidgetKind,
  type WidgetSource,
} from './client'

/** A react-grid-layout-shaped span pair: `w` columns by `h` rows. */
export type WidgetSpan = { w: number; h: number }

/** A grid cell to drop a widget at: `x` = column, `y` = row. */
export type GridCell = { x: number; y: number }

// ── grid placement ──────────────────────────────────────────────────────────

/**
 * First-fit placement on the 12-col grid. Scans rows top-down and columns
 * left-right over a per-row occupancy view of the existing widgets; the first
 * position where the `span` rectangle fits without overlap wins. Falls back to
 * appending at the bottom (below everything) when nothing fits within the
 * scanned window: the grid grows vertically without bound, so this always
 * succeeds.
 *
 * `span.w` is clamped to the grid width. Rows are unbounded; the scan ceiling is
 * derived from the current content height plus the new widget, which is always
 * enough to expose a free row.
 */
export function findNextFreePosition(widgets: GridPosition[], span: WidgetSpan): GridPosition {
  const columns = DASHBOARD_GRID_COLUMNS
  const w = Math.min(Math.max(1, span.w), columns)
  const h = Math.max(1, span.h)

  // Bottom of the tallest widget: the scan needs to reach at least here + h so
  // the append-at-bottom fallback is always reachable.
  const contentBottom = widgets.reduce((max, p) => Math.max(max, p.row + p.rowSpan), 0)
  const maxRow = contentBottom + h

  const occupied = (col: number, row: number): boolean =>
    widgets.some(
      (p) =>
        col < p.column + p.columnSpan &&
        col + w > p.column &&
        row < p.row + p.rowSpan &&
        row + h > p.row
    )

  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col + w <= columns; col++) {
      if (!occupied(col, row)) {
        return { column: col, row, columnSpan: w, rowSpan: h }
      }
    }
  }

  // Unreachable given maxRow, but keep the total-fallback explicit.
  return { column: 0, row: contentBottom, columnSpan: w, rowSpan: h }
}

/**
 * Place a widget of `span` at a chosen grid cell (`at.x` = column, `at.y` =
 * row). The column is clamped so the widget stays fully on the 12-col grid; the
 * row is honoured as-is (the grid's vertical compactor settles any overlap on
 * the next layout pass). Used by the empty-cell "click to add" overlay and by
 * Kopilot's placement tools.
 */
export function placeAt(at: GridCell, span: WidgetSpan): GridPosition {
  const columns = DASHBOARD_GRID_COLUMNS
  const w = Math.min(Math.max(1, span.w), columns)
  const h = Math.max(1, span.h)
  const column = Math.min(Math.max(0, at.x), columns - w)
  const row = Math.max(0, at.y)
  return { column, row, columnSpan: w, rowSpan: h }
}

// ── new-widget defaults ─────────────────────────────────────────────────────

/**
 * The grid footprint a newly added widget of `kind` gets. Projected from
 * `DEFAULT_WIDGET_SIZE` (the versioned layout-doc source of truth) into the
 * `{ w, h }` shape the placement functions take.
 */
export function defaultWidgetSpan(kind: WidgetKind): WidgetSpan {
  const size = DEFAULT_WIDGET_SIZE[kind]
  return { w: size.columnSpan, h: size.rowSpan }
}

/** The smallest footprint `kind` may occupy, projected from `MIN_WIDGET_SIZE`. */
export function minWidgetSpan(kind: WidgetKind): WidgetSpan {
  const size = MIN_WIDGET_SIZE[kind]
  return { w: size.columnSpan, h: size.rowSpan }
}

/** A new widget's title: the kind label (e.g. "Bar chart"). Uniqueness is the caller's job. */
export function defaultWidgetTitle(kind: WidgetKind): string {
  return WIDGET_KIND_LABELS[kind]
}

/**
 * Default configuration for a freshly added widget of `kind`.
 *
 * richText/iframe get complete, persistable configs. Data widgets get an
 * UNCONFIGURED SHELL: the strict layout-doc schema requires a `source` (+
 * groupBy / rangeMax), so these cannot be PUBLISHED until configured. They save
 * to the draft fine and render the "Configure this widget" CTA. The shells
 * intentionally omit `source`, matching the `isChartConfigured` guard which
 * treats a missing source as unconfigured.
 *
 * When the owning dashboard is linked to an entity def
 * (`Dashboard.entityDefinitionId`), new data widgets prefill `source` to that
 * entity: a still-editable default, not a hard requirement.
 */
export function defaultWidgetConfiguration(
  kind: WidgetKind,
  entityDefinitionId?: string | null
): WidgetConfiguration {
  const source: WidgetSource | undefined = entityDefinitionId
    ? { kind: 'entity', entityDefinitionId }
    : undefined
  switch (kind) {
    case 'richText':
      return { kind: 'richText', content: null }
    case 'iframe':
      return { kind: 'iframe', url: null }
    case 'barChart':
      return { kind: 'barChart', metric: { op: 'count' }, source } as WidgetConfiguration
    case 'lineChart':
      return { kind: 'lineChart', metric: { op: 'count' }, source } as WidgetConfiguration
    case 'pieChart':
      return { kind: 'pieChart', metric: { op: 'count' }, source } as WidgetConfiguration
    case 'kpi':
      return { kind: 'kpi', metric: { op: 'count' }, source } as WidgetConfiguration
    case 'gauge':
      return { kind: 'gauge', metric: { op: 'count' }, source } as WidgetConfiguration
    case 'recordList':
      return { kind: 'recordList', columns: [], source } as WidgetConfiguration
  }
}

// ── document helpers ────────────────────────────────────────────────────────

/** Deep copy of a layout doc. Callers use this to fork a doc before handing it on. */
export function cloneDoc(doc: DashboardLayoutDoc): DashboardLayoutDoc {
  return JSON.parse(JSON.stringify(doc)) as DashboardLayoutDoc
}

/** Deep copy of a single widget (used when duplicating). */
export function cloneWidget(widget: LayoutWidget): LayoutWidget {
  return JSON.parse(JSON.stringify(widget)) as LayoutWidget
}

/** Map a doc's tabs; returns a new doc. */
export function editTabs(
  doc: DashboardLayoutDoc,
  fn: (tabs: LayoutTab[]) => LayoutTab[]
): DashboardLayoutDoc {
  return { ...doc, tabs: fn(doc.tabs) }
}

/** Map the single widget matching `widgetId` across all tabs; returns a new doc. */
export function editWidget(
  doc: DashboardLayoutDoc,
  widgetId: string,
  fn: (w: LayoutWidget) => LayoutWidget
): DashboardLayoutDoc {
  return editTabs(doc, (tabs) =>
    tabs.map((tab) => {
      if (!tab.widgets.some((w) => w.id === widgetId)) return tab
      return { ...tab, widgets: tab.widgets.map((w) => (w.id === widgetId ? fn(w) : w)) }
    })
  )
}

/** Locate a widget and its owning tab, or `null` when no tab holds that id. */
export function findWidget(
  tabs: LayoutTab[],
  widgetId: string
): { tab: LayoutTab; widget: LayoutWidget } | null {
  for (const tab of tabs) {
    const widget = tab.widgets.find((w) => w.id === widgetId)
    if (widget) return { tab, widget }
  }
  return null
}

/**
 * `base` if it is free, else the first of `base 2`, `base 3`, ... that is.
 * Deliberately NOT `incrementTitle` from `@auxx/utils`: that produces different
 * user-visible names for the same input.
 */
export function uniqueTitle(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

// ── widget transforms ───────────────────────────────────────────────────────

/** Everything `addWidget` needs beyond the doc itself. */
export type AddWidgetInput = {
  tabId: string
  kind: WidgetKind
  /** A chosen grid cell; omitted means first-fit auto-placement. */
  at?: GridCell
  /** The dashboard's linked entity def, prefilled as the new widget's source. */
  entityDefinitionId?: string | null
}

/** A transform that mints an id returns it alongside the new doc. */
export type DocWithId = { doc: DashboardLayoutDoc; id: string }

/**
 * Append a widget of `kind` to a tab. Returns `null` when `tabId` names no tab,
 * so the caller can bail without recording an edit. The widget's id is minted
 * here with `generateId` and is final: the server never rewrites it.
 */
export function addWidget(doc: DashboardLayoutDoc, input: AddWidgetInput): DocWithId | null {
  const tab = doc.tabs.find((t) => t.id === input.tabId)
  if (!tab) return null

  const id = generateId()
  const span = defaultWidgetSpan(input.kind)
  const gridPosition = input.at
    ? placeAt(input.at, span)
    : findNextFreePosition(
        tab.widgets.map((w) => w.gridPosition),
        span
      )
  const widget: LayoutWidget = {
    id,
    title: uniqueTitle(
      defaultWidgetTitle(input.kind),
      tab.widgets.map((w) => w.title)
    ),
    type: input.kind,
    gridPosition,
    configuration: defaultWidgetConfiguration(input.kind, input.entityDefinitionId),
  }
  const next = editTabs(doc, (tabs) =>
    tabs.map((t) => (t.id === input.tabId ? { ...t, widgets: [...t.widgets, widget] } : t))
  )
  return { doc: next, id }
}

/** Shallow-patch a widget's editable presentation fields (today: its title). */
export function patchWidget(
  doc: DashboardLayoutDoc,
  widgetId: string,
  patch: Partial<Pick<LayoutWidget, 'title'>>
): DashboardLayoutDoc {
  return editWidget(doc, widgetId, (w) => ({ ...w, ...patch }))
}

/** Replace a widget's configuration wholesale. */
export function setWidgetConfig(
  doc: DashboardLayoutDoc,
  widgetId: string,
  config: WidgetConfiguration
): DashboardLayoutDoc {
  return editWidget(doc, widgetId, (w) => ({ ...w, configuration: config }))
}

/**
 * Convert a widget to another data-widget kind in place, carrying its
 * configuration across via `convertWidgetConfiguration`.
 *
 * Two deliberate rules:
 * - the widget is RETITLED only when its title is still the source kind's
 *   default, so a user-chosen title survives the conversion;
 * - the grid span is clamped UP to the target kind's minimum and never shrunk,
 *   so converting does not silently make a widget smaller than the user sized it.
 *
 * A no-op when the widget is already `toKind`.
 */
export function changeWidgetType(
  doc: DashboardLayoutDoc,
  widgetId: string,
  toKind: WidgetKind
): DashboardLayoutDoc {
  return editWidget(doc, widgetId, (w) => {
    if (w.type === toKind) return w
    const min = minWidgetSpan(toKind)
    // Retitle only if the title was still the source kind's default.
    const title = w.title === defaultWidgetTitle(w.type) ? defaultWidgetTitle(toKind) : w.title
    return {
      ...w,
      type: toKind,
      title,
      configuration: convertWidgetConfiguration(w.configuration, toKind),
      // Keep position; clamp span UP to the new kind's minimum, never shrink.
      gridPosition: {
        ...w.gridPosition,
        columnSpan: Math.max(w.gridPosition.columnSpan, min.w),
        rowSpan: Math.max(w.gridPosition.rowSpan, min.h),
      },
    }
  })
}

/**
 * Deep-copy a widget into the next free slot of its own tab, inserted directly
 * after the original and titled `"<title> copy"` (uniquified). Returns `null`
 * when no tab holds `widgetId`.
 */
export function duplicateWidget(doc: DashboardLayoutDoc, widgetId: string): DocWithId | null {
  const found = findWidget(doc.tabs, widgetId)
  if (!found) return null
  const { tab, widget } = found

  const id = generateId()
  const gridPosition = findNextFreePosition(
    tab.widgets.map((w) => w.gridPosition),
    { w: widget.gridPosition.columnSpan, h: widget.gridPosition.rowSpan }
  )
  const copy: LayoutWidget = {
    ...cloneWidget(widget),
    id,
    title: uniqueTitle(
      `${widget.title} copy`,
      tab.widgets.map((w) => w.title)
    ),
    gridPosition,
  }
  const next = editTabs(doc, (tabs) =>
    tabs.map((t) => {
      if (t.id !== tab.id) return t
      const at = t.widgets.findIndex((w) => w.id === widgetId)
      const widgets = [...t.widgets]
      widgets.splice(at + 1, 0, copy)
      return { ...t, widgets }
    })
  )
  return { doc: next, id }
}

/** Drop a widget from whichever tab holds it. */
export function removeWidget(doc: DashboardLayoutDoc, widgetId: string): DashboardLayoutDoc {
  return editTabs(doc, (tabs) =>
    tabs.map((t) => ({ ...t, widgets: t.widgets.filter((w) => w.id !== widgetId) }))
  )
}

/** One widget's new grid rectangle, as reported by a drag/resize pass. */
export type GridLayoutChange = { id: string; gridPosition: GridPosition }

/**
 * Apply a batch of grid rectangles to the widgets of one tab. Ids not present in
 * `changes` (and widgets on other tabs) are left alone.
 */
export function applyGridLayout(
  doc: DashboardLayoutDoc,
  tabId: string,
  changes: GridLayoutChange[]
): DashboardLayoutDoc {
  const byId = new Map(changes.map((c) => [c.id, c.gridPosition]))
  return editTabs(doc, (tabs) =>
    tabs.map((t) =>
      t.id === tabId
        ? {
            ...t,
            widgets: t.widgets.map((w) =>
              byId.has(w.id) ? { ...w, gridPosition: byId.get(w.id) as GridPosition } : w
            ),
          }
        : t
    )
  )
}

// ── tab transforms ──────────────────────────────────────────────────────────

/**
 * Append an empty tab. An omitted / blank `title` falls back to `Tab <n>`; the
 * result is uniquified against the existing tab titles either way.
 */
export function addTab(doc: DashboardLayoutDoc, title?: string): DocWithId {
  const id = generateId()
  const finalTitle = uniqueTitle(
    title?.trim() || `Tab ${doc.tabs.length + 1}`,
    doc.tabs.map((t) => t.title)
  )
  const next = editTabs(doc, (tabs) => [
    ...tabs,
    { id, title: finalTitle, icon: null, widgets: [] },
  ])
  return { doc: next, id }
}

/** Shallow-patch a tab's title and/or icon. */
export function updateTab(
  doc: DashboardLayoutDoc,
  tabId: string,
  patch: { title?: string; icon?: string | null }
): DashboardLayoutDoc {
  return editTabs(doc, (tabs) => tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)))
}

/** Drop a tab. The LAST remaining tab is never removed: a doc always has one. */
export function removeTab(doc: DashboardLayoutDoc, tabId: string): DashboardLayoutDoc {
  if (doc.tabs.length <= 1) return doc
  return editTabs(doc, (tabs) => tabs.filter((t) => t.id !== tabId))
}

/**
 * Reorder tabs to match `orderedIds`. A partial or unknown id list would
 * silently drop tabs, so a list that does not resolve to the same number of tabs
 * the doc already has leaves it untouched.
 */
export function reorderTabs(doc: DashboardLayoutDoc, orderedIds: string[]): DashboardLayoutDoc {
  const byId = new Map(doc.tabs.map((t) => [t.id, t]))
  const reordered = orderedIds.map((id) => byId.get(id)).filter((t): t is LayoutTab => !!t)
  // Guard against a partial id list dropping tabs.
  if (reordered.length !== doc.tabs.length) return doc
  return { ...doc, tabs: reordered }
}

// ── dashboard-level ─────────────────────────────────────────────────────────

/** Replace the dashboard-level filter defaults. */
export function setGlobalFilters(
  doc: DashboardLayoutDoc,
  filters: DashboardGlobalFilters
): DashboardLayoutDoc {
  return { ...doc, globalFilters: filters }
}

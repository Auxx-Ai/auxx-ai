// packages/lib/src/dashboards/__tests__/layout-ops.test.ts
//
// The pure document transforms. Two writers share these (the browser draft store
// and the server-side Kopilot dashboard builder), so the rules that are easy to
// lose in a rewrite are asserted explicitly here: `changeWidgetType`'s
// retitle-and-clamp, `uniqueTitle`'s numbering, first-fit vs chosen-cell
// placement, the unconfigured data-widget shells, and immutability.

import { describe, expect, it } from 'vitest'
import type { DashboardLayoutDoc, LayoutTab, LayoutWidget, WidgetKind } from '../client'
import { MIN_WIDGET_SIZE } from '../client'
import {
  addTab,
  addWidget,
  applyGridLayout,
  changeWidgetType,
  cloneDoc,
  type DocWithId,
  defaultWidgetSpan,
  duplicateWidget,
  editTabs,
  editWidget,
  findWidget,
  patchWidget,
  removeTab,
  removeWidget,
  reorderTabs,
  setGlobalFilters,
  setWidgetConfig,
  uniqueTitle,
  updateTab,
} from '../layout-ops'

const TAB = 'tab-1'

function widget(overrides: Partial<LayoutWidget> = {}): LayoutWidget {
  return {
    id: 'w1',
    title: 'KPI',
    type: 'kpi',
    gridPosition: { column: 0, row: 0, columnSpan: 3, rowSpan: 2 },
    configuration: { kind: 'kpi', metric: { op: 'count' } } as LayoutWidget['configuration'],
    ...overrides,
  }
}

function doc(widgets: LayoutWidget[] = []): DashboardLayoutDoc {
  return { tabs: [{ id: TAB, title: 'Overview', icon: null, widgets }] }
}

/** Assert a transform did not bail, and narrow away its `null`. */
function ok(result: DocWithId | null): DocWithId {
  expect(result).not.toBeNull()
  return result as DocWithId
}

const tabAt = (d: DashboardLayoutDoc, index = 0): LayoutTab => d.tabs[index] as LayoutTab
const widgetsOf = (d: DashboardLayoutDoc, index = 0): LayoutWidget[] => tabAt(d, index).widgets
const widgetAt = (d: DashboardLayoutDoc, index: number): LayoutWidget =>
  widgetsOf(d)[index] as LayoutWidget

/** Snapshot a doc so a transform can be asserted not to have touched its input. */
const snapshot = (d: DashboardLayoutDoc) => JSON.stringify(d)

// ── helpers ─────────────────────────────────────────────────────────────────

describe('uniqueTitle', () => {
  it.each([
    { base: 'KPI', existing: [], expected: 'KPI' },
    { base: 'KPI', existing: ['KPI'], expected: 'KPI 2' },
    { base: 'KPI', existing: ['KPI', 'KPI 2'], expected: 'KPI 3' },
    // A gap is NOT filled: numbering walks up from 2 until a name is free.
    { base: 'KPI', existing: ['KPI', 'KPI 3'], expected: 'KPI 2' },
    { base: 'KPI', existing: ['Other'], expected: 'KPI' },
  ])('$base against $existing gives $expected', ({ base, existing, expected }) => {
    expect(uniqueTitle(base, existing)).toBe(expected)
  })
})

describe('findWidget', () => {
  it('finds a widget and its owning tab', () => {
    const d = doc([widget()])
    expect(findWidget(d.tabs, 'w1')?.tab.id).toBe(TAB)
    expect(findWidget(d.tabs, 'nope')).toBeNull()
  })
})

describe('cloneDoc / editTabs / editWidget', () => {
  it('cloneDoc deep-copies', () => {
    const d = doc([widget()])
    const copy = cloneDoc(d)
    expect(copy).toEqual(d)
    expect(copy).not.toBe(d)
    expect(widgetAt(copy, 0)).not.toBe(widgetAt(d, 0))
  })

  it('editTabs returns a new doc and leaves the input alone', () => {
    const d = doc()
    const before = snapshot(d)
    const next = editTabs(d, (tabs) => tabs.map((t) => ({ ...t, title: 'Renamed' })))
    expect(tabAt(next).title).toBe('Renamed')
    expect(snapshot(d)).toBe(before)
  })

  it('editWidget leaves unrelated tabs by REFERENCE (no needless rerenders)', () => {
    const d: DashboardLayoutDoc = {
      tabs: [
        { id: TAB, title: 'A', icon: null, widgets: [widget()] },
        { id: 'tab-2', title: 'B', icon: null, widgets: [] },
      ],
    }
    const next = editWidget(d, 'w1', (w) => ({ ...w, title: 'Changed' }))
    expect(tabAt(next, 1)).toBe(tabAt(d, 1))
    expect(tabAt(next, 0)).not.toBe(tabAt(d, 0))
  })
})

// ── addWidget ───────────────────────────────────────────────────────────────

describe('addWidget', () => {
  it('mints an id, a default title and the kind default config', () => {
    const result = ok(addWidget(doc(), { tabId: TAB, kind: 'richText' }))
    const w = widgetAt(result.doc, 0)
    expect(w.id).toBe(result.id)
    expect(w.id).toBeTruthy()
    expect(w.type).toBe('richText')
    expect(w.title).toBe('Rich text')
    expect(w.configuration).toEqual({ kind: 'richText', content: null })
  })

  it('mints DISTINCT ids for successive widgets', () => {
    const first = ok(addWidget(doc(), { tabId: TAB, kind: 'kpi' }))
    const second = ok(addWidget(first.doc, { tabId: TAB, kind: 'kpi' }))
    expect(second.id).not.toBe(first.id)
    // ids come from `generateId()`, never a uuid.
    expect(first.id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  it('uniquifies duplicate kind titles as "base", "base 2", "base 3"', () => {
    let d = doc()
    for (let i = 0; i < 3; i++) d = ok(addWidget(d, { tabId: TAB, kind: 'kpi' })).doc
    expect(widgetsOf(d).map((w) => w.title)).toEqual(['KPI', 'KPI 2', 'KPI 3'])
  })

  it('places at the chosen cell when one is given', () => {
    const span = defaultWidgetSpan('kpi')
    const result = ok(addWidget(doc(), { tabId: TAB, kind: 'kpi', at: { x: 5, y: 3 } }))
    expect(widgetAt(result.doc, 0).gridPosition).toEqual({
      column: 5,
      row: 3,
      columnSpan: span.w,
      rowSpan: span.h,
    })
  })

  it('first-fits when no cell is given', () => {
    const existing = widget({ gridPosition: { column: 0, row: 0, columnSpan: 12, rowSpan: 2 } })
    const result = ok(addWidget(doc([existing]), { tabId: TAB, kind: 'kpi' }))
    expect(widgetAt(result.doc, 1).gridPosition).toEqual({
      column: 0,
      row: 2,
      columnSpan: 3,
      rowSpan: 2,
    })
  })

  it('prefills the source from the dashboard entity def', () => {
    const result = ok(
      addWidget(doc(), { tabId: TAB, kind: 'barChart', entityDefinitionId: 'def-1' })
    )
    expect(widgetAt(result.doc, 0).configuration).toMatchObject({
      source: { kind: 'entity', entityDefinitionId: 'def-1' },
    })
  })

  it('returns null for an unknown tab and does not touch the doc', () => {
    const d = doc()
    const before = snapshot(d)
    expect(addWidget(d, { tabId: 'nope', kind: 'kpi' })).toBeNull()
    expect(snapshot(d)).toBe(before)
  })

  it('does not mutate the input doc', () => {
    const d = doc()
    const before = snapshot(d)
    addWidget(d, { tabId: TAB, kind: 'kpi' })
    expect(snapshot(d)).toBe(before)
  })
})

// ── changeWidgetType ────────────────────────────────────────────────────────

describe('changeWidgetType', () => {
  it('is a no-op when the widget is already that kind', () => {
    const d = doc([widget()])
    expect(widgetAt(changeWidgetType(d, 'w1', 'kpi'), 0)).toBe(widgetAt(d, 0))
  })

  it.each([
    // The SOURCE kind's default title: retitled to the target's default.
    { from: 'kpi', title: 'KPI', to: 'barChart', expected: 'Bar chart' },
    { from: 'gauge', title: 'Gauge', to: 'kpi', expected: 'KPI' },
    // A user-chosen title survives.
    { from: 'kpi', title: 'Open tickets', to: 'barChart', expected: 'Open tickets' },
    // The TARGET kind's default is not the source's default, so it is user-chosen.
    { from: 'kpi', title: 'Bar chart', to: 'barChart', expected: 'Bar chart' },
  ] as Array<{
    from: WidgetKind
    title: string
    to: WidgetKind
    expected: string
  }>)('$from titled "$title" becomes $to titled "$expected"', ({ from, title, to, expected }) => {
    const d = doc([
      widget({
        type: from,
        title,
        configuration: { kind: from } as LayoutWidget['configuration'],
      }),
    ])
    const w = widgetAt(changeWidgetType(d, 'w1', to), 0)
    expect(w.title).toBe(expected)
    expect(w.type).toBe(to)
  })

  it('clamps the span UP to the target minimum', () => {
    // A 2x2 KPI converted to a bar chart (min 3x3) grows on both axes.
    const d = doc([widget({ gridPosition: { column: 1, row: 4, columnSpan: 2, rowSpan: 2 } })])
    expect(widgetAt(changeWidgetType(d, 'w1', 'barChart'), 0).gridPosition).toEqual({
      column: 1,
      row: 4,
      columnSpan: MIN_WIDGET_SIZE.barChart.columnSpan,
      rowSpan: MIN_WIDGET_SIZE.barChart.rowSpan,
    })
  })

  it('NEVER shrinks a span that is already above the target minimum', () => {
    const d = doc([
      widget({
        type: 'barChart',
        title: 'Bar chart',
        configuration: {
          kind: 'barChart',
          metric: { op: 'count' },
        } as LayoutWidget['configuration'],
        gridPosition: { column: 0, row: 0, columnSpan: 12, rowSpan: 9 },
      }),
    ])
    expect(widgetAt(changeWidgetType(d, 'w1', 'kpi'), 0).gridPosition).toMatchObject({
      columnSpan: 12,
      rowSpan: 9,
    })
  })

  it('keeps the widget position', () => {
    const d = doc([widget({ gridPosition: { column: 7, row: 11, columnSpan: 4, rowSpan: 4 } })])
    expect(widgetAt(changeWidgetType(d, 'w1', 'pieChart'), 0).gridPosition).toMatchObject({
      column: 7,
      row: 11,
    })
  })

  it('converts the configuration to the target kind', () => {
    const d = doc([widget()])
    expect(widgetAt(changeWidgetType(d, 'w1', 'gauge'), 0).configuration.kind).toBe('gauge')
  })

  it('does not mutate the input doc', () => {
    const d = doc([widget()])
    const before = snapshot(d)
    changeWidgetType(d, 'w1', 'barChart')
    expect(snapshot(d)).toBe(before)
  })
})

// ── the remaining widget transforms ─────────────────────────────────────────

describe('patchWidget / setWidgetConfig', () => {
  it('patches the title only', () => {
    const d = doc([widget()])
    const w = widgetAt(patchWidget(d, 'w1', { title: 'Renamed' }), 0)
    expect(w.title).toBe('Renamed')
    expect(w.type).toBe('kpi')
    expect(widgetAt(d, 0).title).toBe('KPI')
  })

  it('replaces the configuration wholesale', () => {
    const d = doc([widget({ type: 'iframe', configuration: { kind: 'iframe', url: null } })])
    const next = setWidgetConfig(d, 'w1', { kind: 'iframe', url: 'https://example.com' })
    expect(widgetAt(next, 0).configuration).toEqual({
      kind: 'iframe',
      url: 'https://example.com',
    })
    expect(widgetAt(d, 0).configuration).toEqual({ kind: 'iframe', url: null })
  })

  it('is a no-op for an unknown widget id', () => {
    const d = doc([widget()])
    expect(patchWidget(d, 'nope', { title: 'x' })).toEqual(d)
  })
})

describe('duplicateWidget', () => {
  it('inserts a deep copy right after the original with a new id and " copy" title', () => {
    const d = doc([widget(), widget({ id: 'w2', title: 'Other' })])
    const result = ok(duplicateWidget(d, 'w1'))
    expect(widgetsOf(result.doc).map((w) => w.id)).toEqual(['w1', result.id, 'w2'])
    expect(widgetAt(result.doc, 1).title).toBe('KPI copy')
    expect(widgetAt(result.doc, 1).configuration).not.toBe(widgetAt(d, 0).configuration)
  })

  it('uniquifies a repeated copy title', () => {
    let d = doc([widget()])
    d = ok(duplicateWidget(d, 'w1')).doc
    d = ok(duplicateWidget(d, 'w1')).doc
    expect(widgetsOf(d).map((w) => w.title)).toEqual(['KPI', 'KPI copy 2', 'KPI copy'])
  })

  it('places the copy in the next free slot', () => {
    const d = doc([widget({ gridPosition: { column: 0, row: 0, columnSpan: 12, rowSpan: 2 } })])
    expect(widgetAt(ok(duplicateWidget(d, 'w1')).doc, 1).gridPosition).toEqual({
      column: 0,
      row: 2,
      columnSpan: 12,
      rowSpan: 2,
    })
  })

  it('returns null for an unknown widget and does not touch the doc', () => {
    const d = doc([widget()])
    const before = snapshot(d)
    expect(duplicateWidget(d, 'nope')).toBeNull()
    expect(snapshot(d)).toBe(before)
  })
})

describe('removeWidget', () => {
  it('drops the widget from whichever tab holds it', () => {
    const d = doc([widget(), widget({ id: 'w2' })])
    const before = snapshot(d)
    expect(widgetsOf(removeWidget(d, 'w1')).map((w) => w.id)).toEqual(['w2'])
    expect(snapshot(d)).toBe(before)
  })
})

describe('applyGridLayout', () => {
  it('applies rectangles by id and leaves the rest alone', () => {
    const d = doc([widget(), widget({ id: 'w2' })])
    const next = applyGridLayout(d, TAB, [
      { id: 'w1', gridPosition: { column: 6, row: 2, columnSpan: 4, rowSpan: 3 } },
    ])
    expect(widgetAt(next, 0).gridPosition).toEqual({
      column: 6,
      row: 2,
      columnSpan: 4,
      rowSpan: 3,
    })
    expect(widgetAt(next, 1)).toBe(widgetAt(d, 1))
    expect(widgetAt(d, 0).gridPosition.column).toBe(0)
  })

  it('ignores an unknown tab id', () => {
    const d = doc([widget()])
    expect(applyGridLayout(d, 'nope', [])).toEqual(d)
  })
})

// ── tab transforms ──────────────────────────────────────────────────────────

describe('tab transforms', () => {
  it('addTab appends a uniquely titled empty tab', () => {
    const first = addTab(doc())
    expect(first.doc.tabs).toHaveLength(2)
    expect(tabAt(first.doc, 1)).toMatchObject({ id: first.id, title: 'Tab 2', widgets: [] })
  })

  it('addTab honours a trimmed explicit title and uniquifies it', () => {
    const d = addTab(doc(), '  Sales  ').doc
    expect(tabAt(d, 1).title).toBe('Sales')
    expect(tabAt(addTab(d, 'Sales').doc, 2).title).toBe('Sales 2')
  })

  it('addTab falls back to "Tab n" for a blank title', () => {
    expect(tabAt(addTab(doc(), '   ').doc, 1).title).toBe('Tab 2')
  })

  it('updateTab patches title and icon', () => {
    const d = doc()
    expect(tabAt(updateTab(d, TAB, { title: 'Renamed', icon: 'chart' }))).toMatchObject({
      title: 'Renamed',
      icon: 'chart',
    })
    expect(tabAt(d).title).toBe('Overview')
  })

  it('removeTab never removes the LAST tab', () => {
    expect(removeTab(doc(), TAB).tabs).toHaveLength(1)
  })

  it('removeTab drops a non-last tab', () => {
    const { doc: d, id } = addTab(doc())
    expect(removeTab(d, id).tabs.map((t) => t.id)).toEqual([TAB])
  })

  it('reorderTabs reorders by id', () => {
    const { doc: d, id } = addTab(doc())
    expect(reorderTabs(d, [id, TAB]).tabs.map((t) => t.id)).toEqual([id, TAB])
  })

  it('reorderTabs ignores a partial or unknown id list', () => {
    const { doc: d } = addTab(doc())
    expect(reorderTabs(d, [TAB]).tabs).toHaveLength(2)
    expect(reorderTabs(d, ['a', 'b']).tabs.map((t) => t.id)).toEqual(d.tabs.map((t) => t.id))
  })
})

describe('setGlobalFilters', () => {
  it('replaces the filter defaults without touching the tabs', () => {
    const d = doc([widget()])
    const next = setGlobalFilters(d, { dateRange: 'last30d' })
    expect(next.globalFilters).toEqual({ dateRange: 'last30d' })
    expect(next.tabs).toBe(d.tabs)
    expect(d.globalFilters).toBeUndefined()
  })
})

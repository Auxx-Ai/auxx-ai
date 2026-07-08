// apps/web/src/components/dashboard/stores/dashboard-draft-store.test.ts

import type { DashboardLayoutDoc } from '@auxx/lib/dashboards/client'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearStoredDraft,
  readStoredDraft,
  selectIsDirty,
  useDashboardStore,
} from './dashboard-draft-store'

const TAB = 'tab-1'
const DASH = 'dash-1'

function doc(): DashboardLayoutDoc {
  return { tabs: [{ id: TAB, title: 'Overview', icon: null, widgets: [] }] }
}

const store = () => useDashboardStore.getState()

beforeEach(() => {
  useDashboardStore.getState().reset()
  clearStoredDraft(DASH)
})

describe('lifecycle', () => {
  it('seed sets the persisted snapshot without entering edit mode', () => {
    store().seed(DASH, doc(), 3)
    expect(store().persisted?.tabs).toHaveLength(1)
    expect(store().persistedVersionNumber).toBe(3)
    expect(store().isEditMode).toBe(false)
    expect(store().draft).toBeNull()
  })

  it('enterEditMode clones persisted into an independent draft', () => {
    store().seed(DASH, doc(), 1)
    store().enterEditMode()
    expect(store().isEditMode).toBe(true)
    expect(store().isDirty).toBe(false)
    // Mutating the draft must not bleed into persisted (deep clone).
    store().addWidget(TAB, 'kpi')
    expect(store().draft?.tabs[0].widgets).toHaveLength(1)
    expect(store().persisted?.tabs[0].widgets).toHaveLength(0)
  })

  it('markSaved swaps persisted, exits edit mode, and clears the stored draft', () => {
    store().seed(DASH, doc(), 1)
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    expect(readStoredDraft(DASH)).not.toBeNull()

    const saved = store().draft as DashboardLayoutDoc
    store().markSaved(saved, 2)
    expect(store().isEditMode).toBe(false)
    expect(store().draft).toBeNull()
    expect(store().persistedVersionNumber).toBe(2)
    expect(store().persisted?.tabs[0].widgets).toHaveLength(1)
    expect(readStoredDraft(DASH)).toBeNull()
  })

  it('cancelEdit drops the draft and clears the stored draft', () => {
    store().seed(DASH, doc(), 1)
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    store().cancelEdit()
    expect(store().draft).toBeNull()
    expect(store().isEditMode).toBe(false)
    expect(readStoredDraft(DASH)).toBeNull()
  })

  it('a refetch during edit of the same dashboard keeps the draft', () => {
    store().seed(DASH, doc(), 1)
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    // Simulated background refetch (same id, still editing).
    store().seed(DASH, doc(), 1)
    expect(store().isEditMode).toBe(true)
    expect(store().draft?.tabs[0].widgets).toHaveLength(1)
  })

  it('seeding a different dashboard resets edit state', () => {
    store().seed(DASH, doc(), 1)
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    store().seed('dash-2', doc(), 1)
    expect(store().isEditMode).toBe(false)
    expect(store().draft).toBeNull()
  })
})

describe('widget CRUD', () => {
  beforeEach(() => {
    store().seed(DASH, doc(), 1)
    store().enterEditMode()
  })

  it('addWidget mints a widget with a default config and marks dirty', () => {
    const id = store().addWidget(TAB, 'richText')
    expect(id).toBeTruthy()
    const w = store().draft?.tabs[0].widgets[0]
    expect(w?.type).toBe('richText')
    expect(w?.configuration).toEqual({ kind: 'richText', content: null })
    expect(store().isDirty).toBe(true)
  })

  it('addWidget gives duplicate kinds unique titles', () => {
    store().addWidget(TAB, 'kpi')
    store().addWidget(TAB, 'kpi')
    const titles = store().draft?.tabs[0].widgets.map((w) => w.title)
    expect(titles).toEqual(['KPI', 'KPI 2'])
  })

  it('updateWidgetConfig replaces the configuration', () => {
    const id = store().addWidget(TAB, 'iframe') as string
    store().updateWidgetConfig(id, { kind: 'iframe', url: 'https://example.com' })
    expect(store().draft?.tabs[0].widgets[0].configuration).toEqual({
      kind: 'iframe',
      url: 'https://example.com',
    })
  })

  it('duplicateWidget inserts a copy right after the original with a new id', () => {
    const id = store().addWidget(TAB, 'kpi') as string
    const copyId = store().duplicateWidget(id)
    const widgets = store().draft?.tabs[0].widgets ?? []
    expect(widgets).toHaveLength(2)
    expect(widgets[1].id).toBe(copyId)
    expect(copyId).not.toBe(id)
    expect(widgets[1].title).toBe('KPI copy')
  })

  it('removeWidget deletes by id', () => {
    const id = store().addWidget(TAB, 'kpi') as string
    store().removeWidget(id)
    expect(store().draft?.tabs[0].widgets).toHaveLength(0)
  })

  it('CRUD is a no-op outside edit mode', () => {
    store().cancelEdit()
    expect(store().addWidget(TAB, 'kpi')).toBeNull()
    expect(store().isDirty).toBe(false)
  })
})

describe('applyGridLayout', () => {
  beforeEach(() => {
    store().seed(DASH, doc(), 1)
    store().enterEditMode()
  })

  it('applies position changes to the matching widgets', () => {
    const id = store().addWidget(TAB, 'kpi') as string
    store().applyGridLayout(TAB, [
      { id, gridPosition: { column: 6, row: 2, columnSpan: 4, rowSpan: 3 } },
    ])
    expect(store().draft?.tabs[0].widgets[0].gridPosition).toEqual({
      column: 6,
      row: 2,
      columnSpan: 4,
      rowSpan: 3,
    })
  })

  it('empty change list is a no-op and does not dirty', () => {
    store().addWidget(TAB, 'kpi')
    // reset dirty to observe the guard
    store().markSaved(store().draft as DashboardLayoutDoc, 2)
    store().enterEditMode()
    store().applyGridLayout(TAB, [])
    expect(store().isDirty).toBe(false)
  })
})

describe('tab CRUD', () => {
  beforeEach(() => {
    store().seed(DASH, doc(), 1)
    store().enterEditMode()
  })

  it('addTab appends a uniquely titled empty tab', () => {
    const id = store().addTab()
    const tabs = store().draft?.tabs ?? []
    expect(tabs).toHaveLength(2)
    expect(tabs[1].id).toBe(id)
    expect(tabs[1].title).toBe('Tab 2')
  })

  it('removeTab never removes the last tab', () => {
    store().removeTab(TAB)
    expect(store().draft?.tabs).toHaveLength(1)
  })

  it('removeTab drops a non-last tab', () => {
    const second = store().addTab() as string
    store().removeTab(second)
    expect(store().draft?.tabs.map((t) => t.id)).toEqual([TAB])
  })

  it('reorderTabs reorders by id and ignores a partial list', () => {
    const second = store().addTab() as string
    store().reorderTabs([second, TAB])
    expect(store().draft?.tabs.map((t) => t.id)).toEqual([second, TAB])
    // Partial list is rejected (would drop tabs).
    store().reorderTabs([TAB])
    expect(store().draft?.tabs).toHaveLength(2)
  })
})

describe('localStorage durability', () => {
  it('mirrors a dirty draft and restoreDraft re-enters edit mode', () => {
    store().seed(DASH, doc(), 1)
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')

    const stored = readStoredDraft(DASH)
    expect(stored?.baseVersion).toBe(1)
    expect(stored?.doc.tabs[0].widgets).toHaveLength(1)

    // Simulate a fresh load: reset, re-seed, restore from storage.
    store().reset()
    store().seed(DASH, doc(), 1)
    expect(store().isEditMode).toBe(false)
    store().restoreDraft(stored!.doc)
    expect(store().isEditMode).toBe(true)
    expect(store().isDirty).toBe(true)
    expect(store().draft?.tabs[0].widgets).toHaveLength(1)
  })

  it('reset does NOT clear the stored draft (survives navigation)', () => {
    store().seed(DASH, doc(), 1)
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    store().reset()
    expect(readStoredDraft(DASH)).not.toBeNull()
  })
})

describe('selectIsDirty', () => {
  it('is true only while editing AND dirty', () => {
    store().seed(DASH, doc(), 1)
    expect(selectIsDirty(store())).toBe(false)
    store().enterEditMode()
    expect(selectIsDirty(store())).toBe(false)
    store().addWidget(TAB, 'kpi')
    expect(selectIsDirty(store())).toBe(true)
  })
})

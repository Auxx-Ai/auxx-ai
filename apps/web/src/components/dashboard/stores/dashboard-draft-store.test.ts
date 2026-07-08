// apps/web/src/components/dashboard/stores/dashboard-draft-store.test.ts

import type { DashboardLayoutDoc } from '@auxx/lib/dashboards/client'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type DashboardSeed,
  selectCurrentTabs,
  selectHasUnpublishedChanges,
  selectViewLayer,
  useDashboardStore,
} from './dashboard-draft-store'

const TAB = 'tab-1'
const DASH = 'dash-1'

function doc(): DashboardLayoutDoc {
  return { tabs: [{ id: TAB, title: 'Overview', icon: null, widgets: [] }] }
}

const store = () => useDashboardStore.getState()

/** Seed the store the way the sync hook does (published + server draft). */
function seedStore(opts: Partial<DashboardSeed> & { id?: string } = {}) {
  store().seed(opts.id ?? DASH, {
    published: opts.published ?? doc(),
    draft: opts.draft ?? null,
    versionNumber: opts.versionNumber ?? 1,
    hasUnpublishedChanges: opts.hasUnpublishedChanges ?? false,
  })
}

beforeEach(() => {
  useDashboardStore.getState().reset()
})

describe('lifecycle', () => {
  it('seed sets the published snapshot and a draft mirror without entering edit mode', () => {
    seedStore({ versionNumber: 3 })
    expect(store().persisted?.tabs).toHaveLength(1)
    expect(store().persistedVersionNumber).toBe(3)
    expect(store().isEditMode).toBe(false)
    // Draft mirrors the published layout (cloned) so entering edit has something to edit.
    expect(store().draft?.tabs).toHaveLength(1)
    expect(store().draft).not.toBe(store().persisted)
    expect(store().hasUnpublishedChanges).toBe(false)
  })

  it('seed adopts a diverged server draft + the unsaved flag', () => {
    const serverDraft: DashboardLayoutDoc = {
      tabs: [
        { id: TAB, title: 'Overview', icon: null, widgets: [] },
        { id: 't2', title: 'Extra', icon: null, widgets: [] },
      ],
    }
    seedStore({ draft: serverDraft, hasUnpublishedChanges: true })
    expect(store().draft?.tabs).toHaveLength(2)
    expect(store().persisted?.tabs).toHaveLength(1)
    expect(store().hasUnpublishedChanges).toBe(true)
  })

  it('enterEditMode edits an independent draft (no bleed into persisted)', () => {
    seedStore()
    store().enterEditMode()
    expect(store().isEditMode).toBe(true)
    expect(store().isDirty).toBe(false)
    store().addWidget(TAB, 'kpi')
    expect(store().draft?.tabs[0].widgets).toHaveLength(1)
    expect(store().persisted?.tabs[0].widgets).toHaveLength(0)
  })

  it('markPublished adopts the new active version and clears dirty flags', () => {
    seedStore()
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    expect(store().hasUnpublishedChanges).toBe(true)

    const published = store().draft as DashboardLayoutDoc
    store().markPublished(published, 2)
    expect(store().persistedVersionNumber).toBe(2)
    expect(store().persisted?.tabs[0].widgets).toHaveLength(1)
    expect(store().draft?.tabs[0].widgets).toHaveLength(1)
    expect(store().isDirty).toBe(false)
    expect(store().hasUnpublishedChanges).toBe(false)
    // Still editing after publish (pill flips green).
    expect(store().isEditMode).toBe(true)
  })

  it('markDiscarded reverts the draft to the active version and clears flags', () => {
    seedStore()
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    // Discard returns the active (published) layout with no widgets.
    store().markDiscarded(doc())
    expect(store().draft?.tabs[0].widgets).toHaveLength(0)
    expect(store().hasUnpublishedChanges).toBe(false)
    expect(store().isDirty).toBe(false)
  })

  it('adoptDraft loads a restored layout into the draft and enters edit mode', () => {
    seedStore()
    const restored: DashboardLayoutDoc = {
      tabs: [
        { id: TAB, title: 'Overview', icon: null, widgets: [] },
        { id: 't2', title: 'Old', icon: null, widgets: [] },
      ],
    }
    store().adoptDraft(restored, true)
    expect(store().isEditMode).toBe(true)
    expect(store().isDirty).toBe(false)
    expect(store().hasUnpublishedChanges).toBe(true)
    expect(store().draft?.tabs).toHaveLength(2)
    // persisted (live) untouched — nothing goes live until publish.
    expect(store().persisted?.tabs).toHaveLength(1)
  })

  it('exitEditMode keeps the draft parked (server-persisted)', () => {
    seedStore()
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    store().exitEditMode()
    expect(store().isEditMode).toBe(false)
    expect(store().draft?.tabs[0].widgets).toHaveLength(1)
  })
})

describe('view layer (Live/Draft toggle)', () => {
  it('cold seed lands on the live layer', () => {
    seedStore({ draft: doc(), hasUnpublishedChanges: true })
    expect(selectViewLayer(store())).toBe('live')
  })

  it('pressing Done drops the canvas to the draft layer', () => {
    seedStore()
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    store().exitEditMode()
    expect(selectViewLayer(store())).toBe('draft')
    // The canvas (currentDoc via selectCurrentTabs) now renders the draft.
    expect(selectCurrentTabs(store())[0].widgets).toHaveLength(1)
  })

  it('the live layer renders the published snapshot, not the parked draft', () => {
    seedStore()
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    store().exitEditMode() // → draft layer, canvas shows the new widget
    store().setViewLayer('live')
    expect(selectCurrentTabs(store())[0].widgets).toHaveLength(0)
  })

  it('the draft layer only overrides the canvas when there are unpublished changes', () => {
    seedStore() // no divergence
    store().setViewLayer('draft')
    // Nothing unpublished → still renders the published snapshot.
    expect(selectCurrentTabs(store())[0].widgets).toHaveLength(0)
  })

  it('publish/discard reset the toggle back to live', () => {
    seedStore()
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    store().exitEditMode()
    expect(selectViewLayer(store())).toBe('draft')

    store().markPublished(doc(), 2)
    expect(selectViewLayer(store())).toBe('live')

    store().exitEditMode()
    store().markDiscarded(doc())
    expect(selectViewLayer(store())).toBe('live')
  })

  it('a refetch during edit of the same dashboard keeps the local draft', () => {
    seedStore()
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    seedStore() // background refetch, same id, still editing
    expect(store().isEditMode).toBe(true)
    expect(store().draft?.tabs[0].widgets).toHaveLength(1)
  })

  it('seeding a different dashboard resets edit state', () => {
    seedStore()
    store().enterEditMode()
    store().addWidget(TAB, 'kpi')
    seedStore({ id: 'dash-2' })
    expect(store().isEditMode).toBe(false)
    expect(store().draft?.tabs[0].widgets).toHaveLength(0)
  })
})

describe('widget CRUD', () => {
  beforeEach(() => {
    seedStore()
    store().enterEditMode()
  })

  it('addWidget mints a widget with a default config, marks dirty + unsaved', () => {
    const id = store().addWidget(TAB, 'richText')
    expect(id).toBeTruthy()
    const w = store().draft?.tabs[0].widgets[0]
    expect(w?.type).toBe('richText')
    expect(w?.configuration).toEqual({ kind: 'richText', content: null })
    expect(store().isDirty).toBe(true)
    expect(store().hasUnpublishedChanges).toBe(true)
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
    store().exitEditMode()
    expect(store().addWidget(TAB, 'kpi')).toBeNull()
  })
})

describe('applyGridLayout', () => {
  beforeEach(() => {
    seedStore()
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
    store().markPublished(store().draft as DashboardLayoutDoc, 2)
    store().applyGridLayout(TAB, [])
    expect(store().isDirty).toBe(false)
  })
})

describe('tab CRUD', () => {
  beforeEach(() => {
    seedStore()
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
    store().reorderTabs([TAB])
    expect(store().draft?.tabs).toHaveLength(2)
  })
})

describe('selectHasUnpublishedChanges', () => {
  it('flips true on the first draft mutation, clears on publish', () => {
    seedStore()
    expect(selectHasUnpublishedChanges(store())).toBe(false)
    store().enterEditMode()
    expect(selectHasUnpublishedChanges(store())).toBe(false)
    store().addWidget(TAB, 'kpi')
    expect(selectHasUnpublishedChanges(store())).toBe(true)
    store().markPublished(store().draft as DashboardLayoutDoc, 2)
    expect(selectHasUnpublishedChanges(store())).toBe(false)
  })
})

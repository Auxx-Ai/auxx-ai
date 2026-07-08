// apps/web/src/components/dashboard/stores/dashboard-draft-store.ts
'use client'

// The dashboard draft store — client source of truth for an OPEN editor. Holds
// the active-version snapshot (`persisted`) and, while editing, an editable
// `draft` (a deep clone). Every save is a publish (plan 02 `dashboard.save`), so
// there's no server draft and no id reconciliation: widget/tab ids are minted
// here with `generateId` and are final. Modeled on `connector-draft-store.ts`
// (create + subscribeWithSelector, deep-clone seed, exported selectors, reset on
// teardown), simplified by the versioning model.
//
// Durability: the draft is mirrored to localStorage (`dash-draft:<id>`) so a
// reload/crash mid-edit can restore it (plan 06 decision). Cleared on publish
// and explicit discard — NOT on unmount `reset()`.

import {
  convertWidgetConfiguration,
  type DashboardGlobalFilters,
  type DashboardLayoutDoc,
  type GridPosition,
  type LayoutTab,
  type LayoutWidget,
  type WidgetConfiguration,
  type WidgetKind,
} from '@auxx/lib/dashboards/client'
import { generateId } from '@auxx/utils'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { WIDGET_GRID_SIZE } from '../lib/grid-constants'
import { findNextFreePosition, placeAt } from '../lib/grid-placement'
import { defaultWidgetConfiguration, defaultWidgetTitle } from '../lib/widget-config-defaults'

export type SaveState = 'idle' | 'saving' | 'error'

interface DashboardDraftState {
  dashboardId: string | null
  /** Active-version snapshot — replaced on fetch + successful save. */
  persisted: DashboardLayoutDoc | null
  persistedVersionNumber: number | null
  /** Editable copy; null outside edit mode. */
  draft: DashboardLayoutDoc | null
  isEditMode: boolean
  isDirty: boolean
  draggingWidgetId: string | null
  saveState: SaveState

  // ── lifecycle ──
  seed: (dashboardId: string, doc: DashboardLayoutDoc, versionNumber: number) => void
  reset: () => void
  enterEditMode: () => void
  cancelEdit: () => void
  markSaved: (doc: DashboardLayoutDoc, versionNumber: number) => void
  /** Adopt a localStorage-restored draft (plan 06 durability) — enters edit mode dirty. */
  restoreDraft: (doc: DashboardLayoutDoc) => void

  // ── widget CRUD (draft-only; no-op unless editing) ──
  /**
   * Add a widget to a tab. `at` (a clicked grid cell, x=column/y=row) places the
   * widget there; omitted → first-fit auto-placement. Returns the minted id.
   */
  addWidget: (tabId: string, kind: WidgetKind, at?: { x: number; y: number }) => string | null
  updateWidget: (widgetId: string, patch: Partial<Pick<LayoutWidget, 'title'>>) => void
  updateWidgetConfig: (widgetId: string, config: WidgetConfiguration) => void
  /** Convert a widget to another data-widget kind in place (plan 09). */
  changeWidgetType: (widgetId: string, toKind: WidgetKind) => void
  duplicateWidget: (widgetId: string) => string | null
  removeWidget: (widgetId: string) => void
  applyGridLayout: (
    tabId: string,
    changes: Array<{ id: string; gridPosition: GridPosition }>
  ) => void

  // ── tab CRUD ──
  addTab: () => string | null
  updateTab: (tabId: string, patch: { title?: string; icon?: string | null }) => void
  removeTab: (tabId: string) => void
  reorderTabs: (orderedIds: string[]) => void

  // ── dashboard-level ──
  setGlobalFilters: (filters: DashboardGlobalFilters) => void

  // ── transient ──
  setDraggingWidgetId: (id: string | null) => void
  setSaveState: (state: SaveState) => void
}

// ── localStorage draft mirror ────────────────────────────────────────────────

const DRAFT_KEY_PREFIX = 'dash-draft:'
const draftKey = (id: string) => `${DRAFT_KEY_PREFIX}${id}`

type StoredDraft = { baseVersion: number | null; doc: DashboardLayoutDoc }

/** Read a persisted draft for a dashboard (client only). Malformed → cleared. */
export function readStoredDraft(dashboardId: string): StoredDraft | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(draftKey(dashboardId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredDraft
    if (!parsed?.doc?.tabs) throw new Error('bad shape')
    return parsed
  } catch {
    window.localStorage.removeItem(draftKey(dashboardId))
    return null
  }
}

function writeStoredDraft(dashboardId: string, stored: StoredDraft): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(draftKey(dashboardId), JSON.stringify(stored))
  } catch {
    // Quota / disabled storage — durability is best-effort, never block editing.
  }
}

export function clearStoredDraft(dashboardId: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(draftKey(dashboardId))
}

// ── immutable draft helpers ──────────────────────────────────────────────────

const EMPTY_TABS: LayoutTab[] = []

const cloneDoc = (doc: DashboardLayoutDoc): DashboardLayoutDoc =>
  JSON.parse(JSON.stringify(doc)) as DashboardLayoutDoc

/** Map a draft's tabs; returns a new doc. */
function editTabs(
  draft: DashboardLayoutDoc,
  fn: (tabs: LayoutTab[]) => LayoutTab[]
): DashboardLayoutDoc {
  return { ...draft, tabs: fn(draft.tabs) }
}

/** Map the single widget matching `widgetId` across all tabs. */
function editWidget(
  draft: DashboardLayoutDoc,
  widgetId: string,
  fn: (w: LayoutWidget) => LayoutWidget
): DashboardLayoutDoc {
  return editTabs(draft, (tabs) =>
    tabs.map((tab) => {
      if (!tab.widgets.some((w) => w.id === widgetId)) return tab
      return { ...tab, widgets: tab.widgets.map((w) => (w.id === widgetId ? fn(w) : w)) }
    })
  )
}

function findWidget(
  tabs: LayoutTab[],
  widgetId: string
): { tab: LayoutTab; widget: LayoutWidget } | null {
  for (const tab of tabs) {
    const widget = tab.widgets.find((w) => w.id === widgetId)
    if (widget) return { tab, widget }
  }
  return null
}

function uniqueTitle(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

// ── store ────────────────────────────────────────────────────────────────────

const INITIAL = {
  dashboardId: null,
  persisted: null,
  persistedVersionNumber: null,
  draft: null,
  isEditMode: false,
  isDirty: false,
  draggingWidgetId: null,
  saveState: 'idle' as SaveState,
}

export const useDashboardStore = create<DashboardDraftState>()(
  subscribeWithSelector((set, get) => {
    /** Apply a draft transform, mark dirty. No-op unless editing. */
    const mutate = (fn: (draft: DashboardLayoutDoc) => DashboardLayoutDoc) => {
      const { draft, isEditMode } = get()
      if (!isEditMode || !draft) return
      set({ draft: fn(draft), isDirty: true })
    }

    return {
      ...INITIAL,

      seed: (dashboardId, doc, versionNumber) =>
        set((s) => {
          // A refetch during edit of the SAME dashboard must not clobber the draft.
          const keepDraft = s.dashboardId === dashboardId && s.isEditMode
          return {
            dashboardId,
            persisted: doc,
            persistedVersionNumber: versionNumber,
            draft: keepDraft ? s.draft : null,
            isEditMode: keepDraft ? s.isEditMode : false,
            isDirty: keepDraft ? s.isDirty : false,
          }
        }),

      reset: () => set({ ...INITIAL }),

      enterEditMode: () =>
        set((s) => ({
          draft: s.persisted ? cloneDoc(s.persisted) : null,
          isEditMode: true,
          isDirty: false,
        })),

      cancelEdit: () => {
        const { dashboardId } = get()
        if (dashboardId) clearStoredDraft(dashboardId)
        set({ draft: null, isEditMode: false, isDirty: false })
      },

      markSaved: (doc, versionNumber) => {
        const { dashboardId } = get()
        if (dashboardId) clearStoredDraft(dashboardId)
        set({
          persisted: doc,
          persistedVersionNumber: versionNumber,
          draft: null,
          isEditMode: false,
          isDirty: false,
          saveState: 'idle',
        })
      },

      restoreDraft: (doc) => set({ draft: doc, isEditMode: true, isDirty: true }),

      addWidget: (tabId, kind, at) => {
        const { draft, isEditMode } = get()
        if (!isEditMode || !draft) return null
        const tab = draft.tabs.find((t) => t.id === tabId)
        if (!tab) return null

        const id = generateId()
        const span = WIDGET_GRID_SIZE[kind].default
        const gridPosition = at
          ? placeAt(at, span)
          : findNextFreePosition(
              tab.widgets.map((w) => w.gridPosition),
              span
            )
        const widget: LayoutWidget = {
          id,
          title: uniqueTitle(
            defaultWidgetTitle(kind),
            tab.widgets.map((w) => w.title)
          ),
          type: kind,
          gridPosition,
          configuration: defaultWidgetConfiguration(kind),
        }
        set({
          draft: editTabs(draft, (tabs) =>
            tabs.map((t) => (t.id === tabId ? { ...t, widgets: [...t.widgets, widget] } : t))
          ),
          isDirty: true,
        })
        return id
      },

      updateWidget: (widgetId, patch) =>
        mutate((draft) => editWidget(draft, widgetId, (w) => ({ ...w, ...patch }))),

      updateWidgetConfig: (widgetId, config) =>
        mutate((draft) => editWidget(draft, widgetId, (w) => ({ ...w, configuration: config }))),

      changeWidgetType: (widgetId, toKind) =>
        mutate((draft) =>
          editWidget(draft, widgetId, (w) => {
            if (w.type === toKind) return w
            const min = WIDGET_GRID_SIZE[toKind].min
            // Retitle only if the title was still the source kind's default.
            const title =
              w.title === defaultWidgetTitle(w.type) ? defaultWidgetTitle(toKind) : w.title
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
        ),

      duplicateWidget: (widgetId) => {
        const { draft, isEditMode } = get()
        if (!isEditMode || !draft) return null
        const found = findWidget(draft.tabs, widgetId)
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
        set({
          draft: editTabs(draft, (tabs) =>
            tabs.map((t) => {
              if (t.id !== tab.id) return t
              const at = t.widgets.findIndex((w) => w.id === widgetId)
              const widgets = [...t.widgets]
              widgets.splice(at + 1, 0, copy)
              return { ...t, widgets }
            })
          ),
          isDirty: true,
        })
        return id
      },

      removeWidget: (widgetId) =>
        mutate((draft) =>
          editTabs(draft, (tabs) =>
            tabs.map((t) => ({ ...t, widgets: t.widgets.filter((w) => w.id !== widgetId) }))
          )
        ),

      applyGridLayout: (tabId, changes) => {
        if (changes.length === 0) return // no-op guard — don't dirty
        const byId = new Map(changes.map((c) => [c.id, c.gridPosition]))
        mutate((draft) =>
          editTabs(draft, (tabs) =>
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
        )
      },

      addTab: () => {
        const { draft, isEditMode } = get()
        if (!isEditMode || !draft) return null
        const id = generateId()
        const title = uniqueTitle(
          `Tab ${draft.tabs.length + 1}`,
          draft.tabs.map((t) => t.title)
        )
        set({
          draft: editTabs(draft, (tabs) => [...tabs, { id, title, icon: null, widgets: [] }]),
          isDirty: true,
        })
        return id
      },

      updateTab: (tabId, patch) =>
        mutate((draft) =>
          editTabs(draft, (tabs) => tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)))
        ),

      removeTab: (tabId) => {
        const { draft } = get()
        if (!draft || draft.tabs.length <= 1) return // never remove the last tab
        mutate((d) => editTabs(d, (tabs) => tabs.filter((t) => t.id !== tabId)))
      },

      reorderTabs: (orderedIds) =>
        mutate((draft) => {
          const byId = new Map(draft.tabs.map((t) => [t.id, t]))
          const reordered = orderedIds.map((id) => byId.get(id)).filter((t): t is LayoutTab => !!t)
          // Guard against a partial id list dropping tabs.
          if (reordered.length !== draft.tabs.length) return draft
          return { ...draft, tabs: reordered }
        }),

      setGlobalFilters: (filters) => mutate((draft) => ({ ...draft, globalFilters: filters })),

      setDraggingWidgetId: (draggingWidgetId) => set({ draggingWidgetId }),
      setSaveState: (saveState) => set({ saveState }),
    }
  })
)

const cloneWidget = (w: LayoutWidget): LayoutWidget => JSON.parse(JSON.stringify(w)) as LayoutWidget

// Mirror the draft to localStorage while editing (client only). Fires on every
// draft-ref change; writes only a dirty, in-edit draft. Clearing is explicit
// (markSaved / cancelEdit) so navigating away and back can still restore.
if (typeof window !== 'undefined') {
  useDashboardStore.subscribe(
    (s) => s.draft,
    (draft) => {
      const { dashboardId, isEditMode, isDirty, persistedVersionNumber } =
        useDashboardStore.getState()
      if (!dashboardId || !isEditMode || !draft || !isDirty) return
      writeStoredDraft(dashboardId, { baseVersion: persistedVersionNumber, doc: draft })
    }
  )
}

/** Imperative snapshot for the save hook. */
export function getDashboardDraftState(): DashboardDraftState {
  return useDashboardStore.getState()
}

// ── selectors ────────────────────────────────────────────────────────────────

/** The doc components render: the draft while editing, else the persisted snapshot. */
export const selectCurrentDoc = (s: DashboardDraftState): DashboardLayoutDoc | null =>
  s.draft ?? s.persisted

export const selectCurrentTabs = (s: DashboardDraftState): LayoutTab[] =>
  (s.draft ?? s.persisted)?.tabs ?? EMPTY_TABS

export const selectWidget =
  (widgetId: string | null) =>
  (s: DashboardDraftState): LayoutWidget | null =>
    widgetId
      ? (findWidget((s.draft ?? s.persisted)?.tabs ?? EMPTY_TABS, widgetId)?.widget ?? null)
      : null

export const selectGlobalFilters = (s: DashboardDraftState): DashboardGlobalFilters | undefined =>
  (s.draft ?? s.persisted)?.globalFilters

/** Dirty only counts while editing (drives the Save button enabled state). */
export const selectIsDirty = (s: DashboardDraftState): boolean => s.isEditMode && s.isDirty

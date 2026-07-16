// apps/web/src/components/dashboard/stores/dashboard-draft-store.ts
'use client'

// The dashboard draft store — client mirror of the SERVER-persisted draft. Agent
// versioning model: the `Dashboard` row holds `draftLayout` (the editable working
// copy), edits auto-save to it (`use-dashboard-autosave`), and explicit Publish/
// Discard drive versioning. This store keeps the published `persisted` snapshot
// (view mode), the editable `draft` (edit mode), a local `isDirty` flag (pending
// autosave flush), and the server-reconciled `hasUnpublishedChanges` (the pill).
// Widget/tab ids are minted here with `generateId` and are final — the server
// never rewrites them. Modeled on `connector-draft-store.ts`.

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

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** In view mode, which layer the canvas renders: the live version or the parked draft. */
export type ViewLayer = 'live' | 'draft'

/** Server payload the sync hook seeds from (`api.dashboard.get`). */
export interface DashboardSeed {
  published: DashboardLayoutDoc
  draft: DashboardLayoutDoc | null
  versionNumber: number
  hasUnpublishedChanges: boolean
  /** Set ⇒ THE dashboard for this entity def — new widgets default their source to it (plan 02). */
  entityDefinitionId: string | null
}

interface DashboardDraftState {
  dashboardId: string | null
  /** Set ⇒ THE dashboard for this entity def — `addWidget`'s source-picker prefill (plan 02). */
  entityDefinitionId: string | null
  /** Published active-version snapshot — what VIEW mode renders. */
  persisted: DashboardLayoutDoc | null
  persistedVersionNumber: number | null
  /** Editable copy of the server draft — what EDIT mode renders. */
  draft: DashboardLayoutDoc | null
  isEditMode: boolean
  /** Local edits not yet flushed to the server draft (drives the autosave debounce). */
  isDirty: boolean
  /** Server truth: the draft diverges from the active version (drives the pill). */
  hasUnpublishedChanges: boolean
  /**
   * View-mode only: which layer the canvas renders when a draft is parked. Cold
   * loads show `'live'` (the canonical published version); pressing Done drops to
   * `'draft'` so you keep looking at your work. The header toggle flips it.
   */
  viewLayer: ViewLayer
  draggingWidgetId: string | null
  saveState: SaveState

  // ── lifecycle ──
  seed: (dashboardId: string, seed: DashboardSeed) => void
  reset: () => void
  enterEditMode: () => void
  exitEditMode: () => void
  /** After a successful publish: adopt the new active version, clear dirty flags. */
  markPublished: (doc: DashboardLayoutDoc, versionNumber: number) => void
  /** After a successful discard: adopt the reverted draft, clear dirty flags. */
  markDiscarded: (doc: DashboardLayoutDoc) => void
  /**
   * After a successful restore-as-draft: adopt the restored layout as the draft
   * and drop into edit mode so the user can review before publishing. `persisted`
   * (the live version) is untouched — nothing goes live until publish.
   */
  adoptDraft: (doc: DashboardLayoutDoc, hasUnpublishedChanges: boolean) => void

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
  addTab: (title?: string) => string | null
  updateTab: (tabId: string, patch: { title?: string; icon?: string | null }) => void
  removeTab: (tabId: string) => void
  reorderTabs: (orderedIds: string[]) => void

  // ── dashboard-level ──
  setGlobalFilters: (filters: DashboardGlobalFilters) => void

  // ── transient ──
  /** Flip the view-mode canvas between the live version and the parked draft. */
  setViewLayer: (layer: ViewLayer) => void
  setDraggingWidgetId: (id: string | null) => void
  setSaveState: (state: SaveState) => void
  /** Autosave reconciles the pill from the server's saveDraft result. */
  setHasUnpublishedChanges: (value: boolean) => void
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
  entityDefinitionId: null,
  persisted: null,
  persistedVersionNumber: null,
  draft: null,
  isEditMode: false,
  isDirty: false,
  hasUnpublishedChanges: false,
  viewLayer: 'live' as ViewLayer,
  draggingWidgetId: null,
  saveState: 'idle' as SaveState,
}

export const useDashboardStore = create<DashboardDraftState>()(
  subscribeWithSelector((set, get) => {
    /** Apply a draft transform, mark dirty + optimistically unpublished. No-op unless editing. */
    const mutate = (fn: (draft: DashboardLayoutDoc) => DashboardLayoutDoc) => {
      const { draft, isEditMode } = get()
      if (!isEditMode || !draft) return
      set({ draft: fn(draft), isDirty: true, hasUnpublishedChanges: true })
    }

    return {
      ...INITIAL,

      seed: (dashboardId, seed) =>
        set((s) => {
          // A refetch during an active edit of the SAME dashboard must not clobber
          // the local draft (it may hold edits mid-flush).
          const keep = s.dashboardId === dashboardId && s.isEditMode
          return {
            dashboardId,
            entityDefinitionId: seed.entityDefinitionId,
            persisted: seed.published,
            persistedVersionNumber: seed.versionNumber,
            draft: keep ? s.draft : (seed.draft ?? cloneDoc(seed.published)),
            isEditMode: keep ? s.isEditMode : false,
            isDirty: keep ? s.isDirty : false,
            hasUnpublishedChanges: keep ? s.hasUnpublishedChanges : seed.hasUnpublishedChanges,
            // Cold loads land on the live version; the toggle/Done opt into the draft.
            viewLayer: keep ? s.viewLayer : 'live',
          }
        }),

      reset: () => set({ ...INITIAL }),

      enterEditMode: () =>
        set((s) => ({
          isEditMode: true,
          draft: s.draft ?? (s.persisted ? cloneDoc(s.persisted) : null),
          isDirty: false,
        })),

      // Leave edit mode but KEEP the draft — it's persisted server-side, parked
      // until the user publishes or discards. Land on the draft layer so the
      // canvas keeps showing the work you just did (a toggle flips to live).
      exitEditMode: () => set({ isEditMode: false, viewLayer: 'draft' }),

      markPublished: (doc, versionNumber) =>
        set({
          persisted: doc,
          persistedVersionNumber: versionNumber,
          draft: cloneDoc(doc),
          isDirty: false,
          hasUnpublishedChanges: false,
          viewLayer: 'live',
          saveState: 'idle',
        }),

      markDiscarded: (doc) =>
        set({
          persisted: doc,
          draft: cloneDoc(doc),
          isDirty: false,
          hasUnpublishedChanges: false,
          viewLayer: 'live',
          saveState: 'idle',
        }),

      adoptDraft: (doc, hasUnpublishedChanges) =>
        set({
          draft: cloneDoc(doc),
          isEditMode: true,
          isDirty: false,
          hasUnpublishedChanges,
          saveState: 'idle',
        }),

      addWidget: (tabId, kind, at) => {
        const { draft, isEditMode, entityDefinitionId } = get()
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
          configuration: defaultWidgetConfiguration(kind, entityDefinitionId),
        }
        set({
          draft: editTabs(draft, (tabs) =>
            tabs.map((t) => (t.id === tabId ? { ...t, widgets: [...t.widgets, widget] } : t))
          ),
          isDirty: true,
          hasUnpublishedChanges: true,
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
          hasUnpublishedChanges: true,
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

      addTab: (title?: string) => {
        const { draft, isEditMode } = get()
        if (!isEditMode || !draft) return null
        const id = generateId()
        const finalTitle = uniqueTitle(
          title?.trim() || `Tab ${draft.tabs.length + 1}`,
          draft.tabs.map((t) => t.title)
        )
        set({
          draft: editTabs(draft, (tabs) => [
            ...tabs,
            { id, title: finalTitle, icon: null, widgets: [] },
          ]),
          isDirty: true,
          hasUnpublishedChanges: true,
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

      setViewLayer: (viewLayer) => set({ viewLayer }),
      setDraggingWidgetId: (draggingWidgetId) => set({ draggingWidgetId }),
      setSaveState: (saveState) => set({ saveState }),
      setHasUnpublishedChanges: (hasUnpublishedChanges) => set({ hasUnpublishedChanges }),
    }
  })
)

const cloneWidget = (w: LayoutWidget): LayoutWidget => JSON.parse(JSON.stringify(w)) as LayoutWidget

/** Imperative snapshot for the autosave/publish hooks. */
export function getDashboardDraftState(): DashboardDraftState {
  return useDashboardStore.getState()
}

// ── selectors ────────────────────────────────────────────────────────────────

/**
 * The doc that's currently rendered: the draft while editing; in view mode the
 * parked draft when the toggle is on `'draft'` (only meaningful with unpublished
 * changes), else the published snapshot.
 */
function currentDoc(s: DashboardDraftState): DashboardLayoutDoc | null {
  if (s.isEditMode) return s.draft ?? s.persisted
  if (s.hasUnpublishedChanges && s.viewLayer === 'draft') return s.draft ?? s.persisted
  return s.persisted
}

export const selectCurrentDoc = (s: DashboardDraftState): DashboardLayoutDoc | null => currentDoc(s)

export const selectCurrentTabs = (s: DashboardDraftState): LayoutTab[] =>
  currentDoc(s)?.tabs ?? EMPTY_TABS

export const selectWidget =
  (widgetId: string | null) =>
  (s: DashboardDraftState): LayoutWidget | null =>
    widgetId ? (findWidget(currentDoc(s)?.tabs ?? EMPTY_TABS, widgetId)?.widget ?? null) : null

export const selectGlobalFilters = (s: DashboardDraftState): DashboardGlobalFilters | undefined =>
  currentDoc(s)?.globalFilters

/** The pill / Publish-Discard gate: the draft diverges from the active version. */
export const selectHasUnpublishedChanges = (s: DashboardDraftState): boolean =>
  s.hasUnpublishedChanges

/** Which layer view mode renders (drives the header Live/Draft toggle). */
export const selectViewLayer = (s: DashboardDraftState): ViewLayer => s.viewLayer

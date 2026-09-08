// apps/web/src/components/dashboard/stores/dashboard-draft-store.ts
'use client'

// The dashboard draft store — client mirror of the SERVER-persisted draft. Agent
// versioning model: the `Dashboard` row holds `draftLayout` (the editable working
// copy), edits auto-save to it (`use-dashboard-autosave`), and explicit Publish/
// Discard drive versioning. This store keeps the published `persisted` snapshot
// (view mode), the editable `draft` (edit mode), a local `isDirty` flag (pending
// autosave flush), and the server-reconciled `hasUnpublishedChanges` (the pill).
// Widget/tab ids are minted client-side with `generateId` and are final: the
// server never rewrites them. Modeled on `connector-draft-store.ts`.
//
// The document transforms themselves are NOT here: they live in
// `@auxx/lib/dashboards/layout-ops`, pure and client-safe, so the server-side
// Kopilot dashboard builder edits the same doc by exactly the same rules.

import type {
  DashboardGlobalFilters,
  DashboardLayoutDoc,
  GridPosition,
  LayoutTab,
  LayoutWidget,
  WidgetConfiguration,
  WidgetKind,
} from '@auxx/lib/dashboards/client'
import {
  addTab as addTabOp,
  addWidget as addWidgetOp,
  applyGridLayout as applyGridLayoutOp,
  changeWidgetType as changeWidgetTypeOp,
  cloneDoc,
  duplicateWidget as duplicateWidgetOp,
  findWidget,
  patchWidget,
  removeTab as removeTabOp,
  removeWidget as removeWidgetOp,
  reorderTabs as reorderTabsOp,
  setGlobalFilters as setGlobalFiltersOp,
  setWidgetConfig,
  updateTab as updateTabOp,
} from '@auxx/lib/dashboards/layout-ops'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

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
  /**
   * May this viewer edit? Decides which LAYER a cold load lands on.
   *
   * An editor with unpublished changes lands on the DRAFT, because that is the
   * work they were last looking at: they moved a widget, hit Done, reloaded,
   * and the published layout snapped it back to where it used to be. Nothing
   * was lost, but "I moved it, refreshed, and it moved back" is
   * indistinguishable from data loss, and the unsaved-changes pill is easy to
   * miss.
   *
   * The decision lives HERE rather than in an effect on the page, because
   * `seed` re-runs on every `dashboard.get` settle and unconditionally reset
   * the layer to `'live'`, so a page-level effect was clobbered by the next
   * refetch.
   *
   * Viewers are excluded deliberately, and it is not cosmetic for them: the
   * published version is the canonical dashboard, and a viewer has no
   * Live/Draft toggle to get back with.
   */
  canEdit?: boolean
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

// The document transforms themselves live in `@auxx/lib/dashboards/layout-ops`
// (pure, client-safe) so the server-side Kopilot dashboard-builder edits the
// same doc by the same rules. This store owns only the UI state around them:
// edit mode, dirty/unpublished flags, the view layer, and drag state.

const EMPTY_TABS: LayoutTab[] = []

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
            // Cold loads land on the live version, EXCEPT for an editor with
            // unpublished work (see `DashboardSeed.canEdit`). The toggle and
            // Done still opt in and out freely.
            viewLayer: keep
              ? s.viewLayer
              : seed.canEdit && seed.hasUnpublishedChanges && seed.draft
                ? 'draft'
                : 'live',
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
        const result = addWidgetOp(draft, { tabId, kind, at, entityDefinitionId })
        if (!result) return null // unknown tab: nothing edited, stay clean
        set({ draft: result.doc, isDirty: true, hasUnpublishedChanges: true })
        return result.id
      },

      updateWidget: (widgetId, patch) => mutate((draft) => patchWidget(draft, widgetId, patch)),

      updateWidgetConfig: (widgetId, config) =>
        mutate((draft) => setWidgetConfig(draft, widgetId, config)),

      changeWidgetType: (widgetId, toKind) =>
        mutate((draft) => changeWidgetTypeOp(draft, widgetId, toKind)),

      duplicateWidget: (widgetId) => {
        const { draft, isEditMode } = get()
        if (!isEditMode || !draft) return null
        const result = duplicateWidgetOp(draft, widgetId)
        if (!result) return null // unknown widget: nothing edited, stay clean
        set({ draft: result.doc, isDirty: true, hasUnpublishedChanges: true })
        return result.id
      },

      removeWidget: (widgetId) => mutate((draft) => removeWidgetOp(draft, widgetId)),

      applyGridLayout: (tabId, changes) => {
        if (changes.length === 0) return // no-op guard — don't dirty
        mutate((draft) => applyGridLayoutOp(draft, tabId, changes))
      },

      addTab: (title?: string) => {
        const { draft, isEditMode } = get()
        if (!isEditMode || !draft) return null
        const result = addTabOp(draft, title)
        set({ draft: result.doc, isDirty: true, hasUnpublishedChanges: true })
        return result.id
      },

      updateTab: (tabId, patch) => mutate((draft) => updateTabOp(draft, tabId, patch)),

      removeTab: (tabId) => {
        const { draft } = get()
        if (!draft || draft.tabs.length <= 1) return // never remove the last tab (don't dirty)
        mutate((d) => removeTabOp(d, tabId))
      },

      reorderTabs: (orderedIds) => mutate((draft) => reorderTabsOp(draft, orderedIds)),

      setGlobalFilters: (filters) => mutate((draft) => setGlobalFiltersOp(draft, filters)),

      setViewLayer: (viewLayer) => set({ viewLayer }),
      setDraggingWidgetId: (draggingWidgetId) => set({ draggingWidgetId }),
      setSaveState: (saveState) => set({ saveState }),
      setHasUnpublishedChanges: (hasUnpublishedChanges) => set({ hasUnpublishedChanges }),
    }
  })
)

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

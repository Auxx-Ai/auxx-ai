// apps/web/src/components/dynamic-table/hooks/use-default-table-persistence.ts
'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { useDynamicTableStore } from '../stores/dynamic-table-store'
import {
  useActiveViewId,
  usePersonalTableView,
  useViewStoreInitialized,
} from '../stores/store-selectors'
import type { ExtendedColumnDef, TableView, ViewConfig } from '../types'
import { PERSONAL_TABLE_VIEW_NAME } from '../utils/constants'

const DEBOUNCE_MS = 400

interface UseDefaultTablePersistenceOptions {
  /** Table id the default table reads (`entity-${entityDefinitionId}`). */
  tableId: string
  /** Column defs (carry `defaultVisible`) used to compute registry defaults. */
  columns: ExtendedColumnDef[]
  /** Gate — only run once the resource + columns are ready. */
  enabled: boolean
}

/** Stable signature of the persisted personal state (for change detection). */
function serialize(
  sparseVisibility: Record<string, boolean>,
  columnSizing: Record<string, number>,
  columnOrder: string[],
  columnPinning: ViewConfig['columnPinning']
): string {
  return JSON.stringify({
    v: sparseVisibility,
    s: columnSizing,
    o: columnOrder,
    p: columnPinning ?? null,
  })
}

/**
 * Persists per-user personalization of the DEFAULT (unnamed, `activeViewId ===
 * null`) table into a dedicated `TableView` override row (sentinel name,
 * `isShared:false`), keyed by `tableId` (`entity-${entityDefinitionId}`), so it's
 * found on reload — the fix for the old `entity-<id>` vs `<id>` key mismatch.
 *
 * - Column visibility default is the LIVE registry (`showInTable` / `showInPanel`)
 *   via each column's `defaultVisible`. Only columns the user toggled AWAY from
 *   that default (plus any user-added `::` path columns) are stored — a SPARSE
 *   `columnVisibility` delta. A resize therefore never writes a full visibility
 *   snapshot, so a registry default flip still reaches un-toggled columns.
 * - `columnSizing` / `columnOrder` / `columnPinning` are stored verbatim (full
 *   maps) — this is the column-width persistence requirement.
 *
 * Named/saved views (`activeViewId` set) are untouched — this hook no-ops for them.
 */
export function useDefaultTablePersistence({
  tableId,
  columns,
  enabled,
}: UseDefaultTablePersistenceOptions) {
  const initialized = useViewStoreInitialized()
  const activeViewId = useActiveViewId(tableId)
  const personalView = usePersonalTableView(tableId)

  const updateSessionConfig = useDynamicTableStore((s) => s.updateSessionConfig)
  const addView = useDynamicTableStore((s) => s.addView)

  const sessionConfig = useDynamicTableStore(useShallow((s) => s.sessionConfigs[tableId]))

  // Live registry default visibility per column — mirrors computeInitialViewConfig
  // (columns that can't be hidden are omitted; `defaultVisible === true` = shown).
  const registryVisibility = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const col of columns) {
      const id = col.id
      if (!id || col.enableHiding === false) continue
      map[id] = col.defaultVisible === true
    }
    return map
  }, [columns])

  const isDefaultTable = enabled && initialized && activeViewId === null && columns.length > 0

  const hydratedRef = useRef<string | null>(null)
  const lastPersistedRef = useRef<string | null>(null)
  const rowIdRef = useRef<string | null>(null)
  const creatingRef = useRef(false)

  const createMutation = api.tableView.create.useMutation({
    onSuccess: (view) => {
      rowIdRef.current = view.id
      addView(view as TableView)
    },
    onSettled: () => {
      creatingRef.current = false
    },
  })
  const updateMutation = api.tableView.update.useMutation()

  // ── Hydrate the session config from the personal override row (once) ──────────
  useEffect(() => {
    if (!isDefaultTable) return
    if (hydratedRef.current === tableId) return
    hydratedRef.current = tableId

    if (!personalView) return
    rowIdRef.current = personalView.id
    const cfg = personalView.config as ViewConfig
    const sparseVis = cfg.columnVisibility ?? {}
    const sizing = cfg.columnSizing ?? {}
    const order = cfg.columnOrder ?? []
    const pinning = cfg.columnPinning

    // Seed a FULL visibility map (registry defaults overlaid with the sparse
    // personal delta) so use-dynamic-table's own default-seed effect sees a
    // non-empty config and does not overwrite it.
    updateSessionConfig(tableId, {
      columnVisibility: { ...registryVisibility, ...sparseVis },
      columnSizing: sizing,
      columnOrder: order,
      columnPinning: pinning,
    })

    // Record what we just hydrated so the first persist run is a no-op.
    lastPersistedRef.current = serialize(sparseVis, sizing, order, pinning)
  }, [isDefaultTable, tableId, personalView, registryVisibility, updateSessionConfig])

  // Reset hydration bookkeeping when switching tables.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tableId intentionally drives the cleanup — refs are reset when the table id changes.
  useEffect(() => {
    return () => {
      hydratedRef.current = null
      lastPersistedRef.current = null
      rowIdRef.current = null
    }
  }, [tableId])

  const persist = useCallback(() => {
    if (!isDefaultTable) return
    if (creatingRef.current) return

    const cfg = useDynamicTableStore.getState().sessionConfigs[tableId]
    if (!cfg) return

    const fullVis = cfg.columnVisibility ?? {}
    const sparse: Record<string, boolean> = {}
    for (const [colId, visible] of Object.entries(fullVis)) {
      if (colId.includes('::')) {
        // User-added path column — its presence is meaningful, always keep it.
        sparse[colId] = visible
        continue
      }
      const def = registryVisibility[colId]
      if (def === undefined) continue // special/unknown column — not our concern
      if (visible !== def) sparse[colId] = visible
    }

    const sizing = cfg.columnSizing ?? {}
    const order = cfg.columnOrder ?? []
    const pinning = cfg.columnPinning

    const serialized = serialize(sparse, sizing, order, pinning)
    if (serialized === lastPersistedRef.current) return

    const rowId = rowIdRef.current ?? personalView?.id ?? null
    const meaningful =
      Object.keys(sparse).length > 0 || Object.keys(sizing).length > 0 || order.length > 0

    // Don't create a row until there's genuine personalization; but always update
    // an existing row (e.g. when the user resets everything back to defaults).
    if (!rowId && !meaningful) return

    lastPersistedRef.current = serialized

    const config: ViewConfig = {
      filters: [],
      sorting: [],
      columnVisibility: sparse,
      columnOrder: order,
      columnSizing: sizing,
      columnPinning: pinning,
      viewType: 'table',
    }

    if (rowId) {
      updateMutation.mutate({ id: rowId, config })
    } else {
      creatingRef.current = true
      createMutation.mutate({
        tableId,
        name: PERSONAL_TABLE_VIEW_NAME,
        contextType: 'table',
        isShared: false,
        isDefault: false,
        config,
      })
    }
  }, [isDefaultTable, tableId, registryVisibility, personalView, createMutation, updateMutation])

  const debouncedPersist = useDebouncedCallback(persist, DEBOUNCE_MS)

  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionConfig is the intentional trigger — a change to it schedules a (debounced) persist; the effect body reads the live config via getState() inside `persist`.
  useEffect(() => {
    if (!isDefaultTable) return
    if (hydratedRef.current !== tableId) return
    debouncedPersist()
  }, [sessionConfig, isDefaultTable, tableId, debouncedPersist])

  useEffect(() => {
    return () => {
      debouncedPersist.cancel?.()
    }
  }, [debouncedPersist])
}

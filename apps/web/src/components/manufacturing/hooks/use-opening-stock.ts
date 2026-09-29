// apps/web/src/components/manufacturing/hooks/use-opening-stock.ts

// The count step's read + draft model (money 52 §2.3; 111 D21): one row per part, the count
// typed for it, the delta the run would write, and the Q25 signal. Kinds are set in Stock setup
// step 1 and costs in step 2 (plans/mrp/22), never here.

import { calendarDayKey, toCalendarDayIso } from '@auxx/lib/field-values/client'
import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useBulkMode,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { useResourceProperty } from '~/components/resources'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'
import { api, type RouterOutputs } from '~/trpc/react'
import { kindCheckRows } from '../stock-setup/kind-check'
import { stockSetupHref } from '../stock-setup/stock-setup-href'

export {
  type OpeningStockKind,
  partKindLabel,
  toOpeningStockKind,
} from '../stock-setup/kind-check'

/** Fifty: every row mounts a `RecordBadge`, and 202 rows put 400 ids on one GET (431). */
export const OPENING_STOCK_PAGE_SIZE = 50

/** `setCountPreflight` takes at most this many parts per call. */
const PREFLIGHT_CHUNK = 500

/** Typed counts survive a reload or a step change until Save (plans/mrp/22 F4). */
const DRAFTS_STORAGE_PREFIX = 'stock-setup-count-drafts'

/** Set counts is Stock setup's count step; `parts` and `job` prefilter it. */
export function setCountsHrefForParts(partIds: readonly string[]): string {
  return stockSetupHref('count', { parts: partIds.join(',') })
}

export function setCountsHrefForJob(jobId: string): string {
  return stockSetupHref('count', { job: jobId })
}

export type OpeningStockCandidate =
  RouterOutputs['purchasing']['listOpeningStockCandidates'][number]
export type SetCountPreflightRow = RouterOutputs['purchasing']['setCountPreflight'][number]
export type OpeningStockRunResult = RouterOutputs['purchasing']['runSetCounts']

/**
 * `new`: no movement yet, a count writes an `initial` on the count day. `uncounted`: moved
 * but never counted, a count reconstructs the `initial` at the ledger start. `counted`:
 * anchored, a count writes an `adjust` for the difference.
 */
export type OpeningStockRowState = 'new' | 'uncounted' | 'counted'

export type OpeningStockFilter = 'all' | 'not-counted' | 'counted' | 'uncounted' | 'unbuilt'

export interface OpeningStockRow {
  partId: string
  recordId: RecordId | null
  title: string
  sku: string | null
  /** `part_standard_cost`, minor units; `null` means the count is valued once step 2 sets one. */
  standardCost: number | null
  /** Why step 1 still flags this part's kind, or `null` (plans/mrp/22 F3). */
  kindWarning: string | null
  quantity: number | null
  /** Calendar-day ISO: the run's count date. */
  date: string
  state: OpeningStockRowState
  /** Net of every movement to now; `null` until the preflight lands. */
  netToday: number | null
  hasBom: boolean
  /** BOM parts only: the negative replay a backflush would cover (111 Q25). */
  unbuiltSales: number
  /** Units produced by builds, net of undone builds; `0` until the preflight lands. */
  built: number
  earliest: Date | null
  /** `quantity − netToday`, the row the run would write today; `null` when either is unknown. */
  delta: number | null
}

export interface OpeningStockCounts {
  all: number
  notCounted: number
  counted: number
  uncounted: number
  /** Made parts with sales no build covers: backflush them before counting (Q25). */
  unbuilt: number
}

/** What a count would write: `count − net`, or `null` while either side is unknown. */
export function previewDelta(quantity: number | null, netToday: number | null): number | null {
  if (quantity == null || !Number.isFinite(quantity) || netToday == null) return null
  return quantity - netToday
}

/**
 * The line under a never-counted part's on-hand (13-backflush-summary §5): a made part's 0 is
 * builds matching sales, a bought part's negative is what arrived unrecorded, never shelf stock.
 */
export function onHandNote(
  row: Pick<OpeningStockRow, 'state' | 'netToday' | 'hasBom' | 'built'>
): 'built' | 'not-received' | null {
  if (row.state === 'counted' || row.netToday == null) return null
  if (row.hasBom && row.built > 0) return 'built'
  if (!row.hasBom && row.netToday < 0) return 'not-received'
  return null
}

/** `first`: a backdated `initial` anchors the part; `adjust`: the part is counted already. */
export function rowOutcome(state: OpeningStockRowState): 'first' | 'adjust' {
  return state === 'counted' ? 'adjust' : 'first'
}

/** 111 Q25: a BOM part with a negative replay should be backflushed before it is counted. */
export function needsBackflushFirst(
  row: Pick<OpeningStockRow, 'hasBom' | 'unbuiltSales'>
): boolean {
  return row.hasBom && row.unbuiltSales > 0
}

/** The run takes a row with a count of zero or more. */
export function isRunnable(row: Pick<OpeningStockRow, 'quantity'>): boolean {
  return row.quantity != null && Number.isFinite(row.quantity) && row.quantity >= 0
}

/** Initial list filters a link may ask for with `?filter=`. */
const LINKABLE_FILTERS: readonly OpeningStockFilter[] = [
  'all',
  'not-counted',
  'counted',
  'uncounted',
  'unbuilt',
]

export function parseOpeningStockFilter(value: string | null | undefined): OpeningStockFilter {
  return LINKABLE_FILTERS.find((filter) => filter === value) ?? 'all'
}

/** Stored drafts, keeping only finite, non-negative counts. */
export function parseStoredDrafts(raw: string | null): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [partId, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[partId] = value
    }
    return out
  } catch {
    return {}
  }
}

function rowState(candidate: OpeningStockCandidate): OpeningStockRowState {
  if (candidate.hasInitialMovement) return 'counted'
  return candidate.hasMovements ? 'uncounted' : 'new'
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Typed counts, kept in the browser per org until Save. */
function useStoredDrafts(organizationId: string | null) {
  const key = organizationId ? `${DRAFTS_STORAGE_PREFIX}:${organizationId}` : null
  const [drafts, setDrafts] = useState<Record<string, number | null>>({})
  const [loaded, setLoaded] = useState(false)
  // Effect, not initial state: localStorage is unavailable during SSR.
  useEffect(() => {
    if (!key) return
    setDrafts(parseStoredDrafts(window.localStorage.getItem(key)))
    setLoaded(true)
  }, [key])
  useEffect(() => {
    if (!loaded || !key) return
    const kept = Object.fromEntries(Object.entries(drafts).filter(([, value]) => value != null))
    if (Object.keys(kept).length === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(kept))
  }, [drafts, loaded, key])
  return [drafts, setDrafts] as const
}

export function useOpeningStock() {
  const { organizationId } = useOrganizationIdContext()
  const candidates = api.purchasing.listOpeningStockCandidates.useQuery()
  const kindConflicts = api.builds.kindConflicts.useQuery(
    {},
    { staleTime: 60_000, refetchOnWindowFocus: false }
  )
  const utils = api.useUtils()

  const partDefId = useResourceProperty('part', 'id')
  const { canEditEntity } = useAccess()
  // `runSetCounts` asserts the same edit on `part`.
  const canOpenStock = partDefId ? canEditEntity(partDefId) : false

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const cutoffPeriod = (getSetting('accounting.cutoffPeriod') as string | null) ?? null

  // ── Prefilter (111 Q24): `?parts=a,b` or `?job=<import job>` ────────────────
  const [partsParam, setPartsParam] = useQueryState('parts')
  const [jobParam, setJobParam] = useQueryState('job')
  const jobRecordIds = api.dataImport.listJobResultRecordIds.useQuery(
    { jobId: jobParam ?? '' },
    { enabled: !!jobParam }
  )
  const prefilterIds = useMemo<Set<string> | null>(() => {
    if (partsParam) return new Set(partsParam.split(',').filter(Boolean))
    if (jobParam) return jobRecordIds.data ? new Set(jobRecordIds.data) : new Set()
    return null
  }, [partsParam, jobParam, jobRecordIds.data])
  const clearPrefilter = useCallback(() => {
    void setPartsParam(null)
    void setJobParam(null)
  }, [setPartsParam, setJobParam])

  // ── Preflight: the anchor state and the backflush signal, in chunks of 500 ──
  const candidateIds = useMemo(
    () => (candidates.data ?? []).map((candidate) => candidate.partId),
    [candidates.data]
  )
  const preflightResults = api.useQueries((t) =>
    chunk(candidateIds, PREFLIGHT_CHUNK).map((partIds) =>
      t.purchasing.setCountPreflight({ partIds })
    )
  )
  const preflightKey = preflightResults.map((result) => result.dataUpdatedAt).join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `preflightKey` stands in for the results array, which is rebuilt every render
  const preflight = useMemo(() => {
    const map = new Map<string, SetCountPreflightRow>()
    for (const result of preflightResults)
      for (const row of result.data ?? []) map.set(row.partId, row)
    return map
  }, [preflightKey])

  const kindWarnings = useMemo(
    () =>
      new Map(
        kindCheckRows(kindConflicts.data ?? [], candidates.data ?? []).map((row) => [
          row.partId,
          row.reason,
        ])
      ),
    [kindConflicts.data, candidates.data]
  )

  // The run-wide date, a calendar day.
  const [occurredAt, setOccurredAt] = useState<string>(() => toCalendarDayIso(new Date()))
  const [drafts, setDrafts] = useStoredDrafts(organizationId)

  const bulkMode = useBulkMode()
  const clearSelection = useListSelection((s) => s.clear)
  const exitSelection = useListSelection((s) => s.exit)
  const selectedIds = useSelectionIds()
  const selectedCount = useSelectionCount()

  const rows = useMemo<OpeningStockRow[]>(() => {
    const list = candidates.data ?? []
    const scoped = prefilterIds ? list.filter((c) => prefilterIds.has(c.partId)) : list
    return scoped.map((candidate) => {
      const quantity = drafts[candidate.partId] ?? null
      const flight = preflight.get(candidate.partId)
      const netToday = flight?.netToday ?? null
      return {
        partId: candidate.partId,
        recordId: partDefId ? toRecordId(partDefId, candidate.partId) : null,
        title: candidate.title,
        sku: candidate.sku,
        standardCost: candidate.standardCost,
        kindWarning: kindWarnings.get(candidate.partId) ?? null,
        quantity,
        date: occurredAt,
        state: flight ? (flight.hasInitial ? 'counted' : rowState(candidate)) : rowState(candidate),
        netToday,
        hasBom: flight?.hasBom ?? false,
        unbuiltSales: flight?.unbuiltSales ?? 0,
        built: flight?.built ?? 0,
        earliest: flight?.earliest ?? null,
        delta: previewDelta(quantity, netToday),
      }
    })
  }, [candidates.data, prefilterIds, drafts, partDefId, preflight, occurredAt, kindWarnings])

  const counts = useMemo<OpeningStockCounts>(
    () => ({
      all: rows.length,
      notCounted: rows.filter((row) => row.state !== 'counted').length,
      counted: rows.filter((row) => row.state === 'counted').length,
      uncounted: rows.filter((row) => row.state === 'uncounted').length,
      unbuilt: rows.filter(needsBackflushFirst).length,
    }),
    [rows]
  )

  /** Exactly the rows the run will write. */
  const counted = useMemo(() => rows.filter(isRunnable), [rows])

  const entries = useMemo(
    () =>
      counted.map((row) => ({
        partId: row.partId,
        quantity: row.quantity as number,
        day: calendarDayKey(row.date) ?? undefined,
      })),
    [counted]
  )

  const summary = useMemo(
    () => ({
      firstCounts: counted.filter((row) => rowOutcome(row.state) === 'first').length,
      adjustments: counted.filter((row) => rowOutcome(row.state) === 'adjust').length,
      pending: counted.filter((row) => row.standardCost == null).length,
      kindWarnings: counted.filter((row) => row.kindWarning != null).length,
      unbuilt: counted
        .filter(needsBackflushFirst)
        .map((row) => ({ title: row.title, unbuiltSales: row.unbuiltSales })),
    }),
    [counted]
  )

  // ── Drafts ──────────────────────────────────────────────────────────────
  const setQuantity = useCallback(
    (partId: string, quantity: number | null) => {
      setDrafts((prev) => ({ ...prev, [partId]: quantity }))
    },
    [setDrafts]
  )
  /** Bulk: count every selected part as zero on the shelf. */
  const countSelectedAsZero = useCallback(() => {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const partId of selectedIds) next[partId] = 0
      return next
    })
    clearSelection()
  }, [selectedIds, setDrafts, clearSelection])
  const clearDrafts = useCallback(() => setDrafts({}), [setDrafts])

  // ── Writes ──────────────────────────────────────────────────────────────
  const runSetCounts = api.purchasing.runSetCounts.useMutation()

  const run = useCallback(async (): Promise<OpeningStockRunResult | null> => {
    if (entries.length === 0) return null
    try {
      const result = await runSetCounts.mutateAsync({
        day: calendarDayKey(occurredAt) ?? undefined,
        adjustAnchored: true,
        entries,
      })
      setDrafts({})
      clearSelection()
      return result
    } finally {
      void candidates.refetch()
      void utils.purchasing.setCountPreflight.invalidate()
      void utils.purchasing.stockSetupStatus.invalidate()
    }
  }, [runSetCounts, occurredAt, entries, candidates, clearSelection, utils, setDrafts])

  return {
    rows,
    counts,
    entries,
    runSize: entries.length,
    summary,
    isLoading: candidates.isLoading || (!!jobParam && jobRecordIds.isLoading),
    isPreflightLoading: preflightResults.some((result) => result.isLoading),
    cutoffPeriod,
    occurredAt,
    setOccurredAt,
    setQuantity,
    countSelectedAsZero,
    clearDrafts,
    prefilter: prefilterIds ? { count: rows.length, fromJob: !!jobParam } : null,
    clearPrefilter,
    bulkMode,
    selectedCount,
    exitSelection,
    canOpenStock,
    run,
    isRunning: runSetCounts.isPending,
  }
}

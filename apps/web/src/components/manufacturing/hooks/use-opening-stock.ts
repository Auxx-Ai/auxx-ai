// apps/web/src/components/manufacturing/hooks/use-opening-stock.ts

// The Set counts tab's read + draft model (money 52 §2.3; 111 D21): one row per part, a
// count and a date per row, the delta each row would write, and the Q25 signal.
//
// The account comes from `openingStockAccountLabel`, which resolves through the same
// function the write path uses; a kind that is only a suggestion holds its row out of the
// run, because the movement freezes the account it resolves (§6.3).

import { calendarDayKey, toCalendarDayIso } from '@auxx/lib/field-values/client'
import {
  type StandardCostOriginValue,
  type StandardCostSourceValue,
  type StandardCostSuggestion,
  suggestStandardCost,
} from '@auxx/lib/inventory/costing/client'
import { resolveInventoryRoleForPartKind } from '@auxx/lib/inventory/movements/client'
import { PartKind, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { roundMinorUnits } from '@auxx/utils/currency'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import {
  isPartKindUnclassified,
  shouldSuggestFinishedGood,
} from '~/components/drawers/cards/part-family-suggestion'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { useResourceProperty } from '~/components/resources'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api, type RouterInputs, type RouterOutputs } from '~/trpc/react'
import { openingStockAccountCode, openingStockAccountLabel } from '../parts/opening-stock-input'

/** Fifty: every row mounts a `RecordBadge`, and 202 rows put 400 ids on one GET (431). */
export const OPENING_STOCK_PAGE_SIZE = 50

/** `setCountPreflight` takes at most this many parts per call. */
const PREFLIGHT_CHUNK = 500

/** Where Set counts lives; `parts` and `job` prefilter it. */
export const SET_COUNTS_HREF = '/app/parts/manage/costing'

export function setCountsHrefForParts(partIds: readonly string[]): string {
  return `${SET_COUNTS_HREF}?parts=${encodeURIComponent(partIds.join(','))}`
}

export function setCountsHrefForJob(jobId: string): string {
  return `${SET_COUNTS_HREF}?job=${encodeURIComponent(jobId)}`
}

export type OpeningStockCandidate =
  RouterOutputs['purchasing']['listOpeningStockCandidates'][number]
export type SetCountPreflightRow = RouterOutputs['purchasing']['setCountPreflight'][number]
export type OpeningStockKind = RouterInputs['purchasing']['bulkSetPartKind']['kind']
export type OpeningStockRunSummary = RouterOutputs['purchasing']['runSetCounts']
type WorklistPart = RouterOutputs['builds']['standardCostWorklist'][number]

/**
 * `new`: no movement yet, a count writes an `initial` on the count day. `uncounted`: moved
 * but never counted, a count reconstructs the `initial` at the ledger start. `counted`:
 * anchored, a count writes an `adjust` for the difference.
 */
export type OpeningStockRowState = 'new' | 'uncounted' | 'counted'

export type OpeningStockFilter =
  | 'all'
  | 'not-counted'
  | 'counted'
  | 'uncounted'
  | 'unclassified'
  | 'uncosted'
  | 'uncosted-or-provisional'
  | 'unbuilt'
  | `kind:${string}`

interface OpeningStockDraft {
  quantity?: number | null
  /** Present once typed, even as `null`; absent means the row shows the standard or the suggestion. */
  unitCost?: number | null
  /** Calendar-day ISO. Absent: the row follows the run-wide date. */
  date?: string
}

export interface OpeningStockRow {
  partId: string
  recordId: RecordId | null
  title: string
  sku: string | null
  storedKind: string | null
  kind: OpeningStockKind | ''
  kindIsUnconfirmed: boolean
  accountLabel: string
  accountCode: string
  accountRole: string
  isUnclassified: boolean
  /** `part_standard_cost`, minor units; `null` means the row is valued when a cost is set. */
  standardCost: number | null
  standardSource: StandardCostSourceValue | null
  standardOrigin: StandardCostOriginValue | null
  quantity: number | null
  /** What the Unit cost cell shows: typed, else the standard, else the D-SC4 suggestion. */
  unitCost: number | null
  /** `unitCost` is the untouched suggestion. */
  unitCostSuggested: boolean
  suggestion: StandardCostSuggestion | null
  /** The run sends `unitCost`: set, or different from the standard (which restates it). */
  sendsUnitCost: boolean
  /** Calendar-day ISO: the row's own date, or the run-wide one. */
  date: string
  hasOwnDate: boolean
  state: OpeningStockRowState
  /** Net of every movement to now; `null` until the preflight lands. */
  netToday: number | null
  /** A BOM part's cost comes only from a roll, so its Unit cost is read-only (D-SC3). */
  hasBom: boolean
  uncostedLeafCount: number
  /** Distinct BOM parents this part sits under. */
  usedIn: number
  /** BOM parts only: the negative replay a backflush would cover (111 Q25). */
  unbuiltSales: number
  earliest: Date | null
  /** `quantity − netToday`, the row the run would write today; `null` when either is unknown. */
  delta: number | null
}

export type OpeningStockExclusionReason = 'kind-unconfirmed' | 'no-quantity'

export interface OpeningStockExclusion {
  partId: string
  recordId: RecordId | null
  title: string
  reason: OpeningStockExclusionReason
  detail: string
}

export interface OpeningStockCounts {
  all: number
  notCounted: number
  counted: number
  uncounted: number
  unclassified: number
  uncosted: number
  uncostedOrProvisional: number
  /** Made parts with sales no build covers: backflush them before counting (Q25). */
  unbuilt: number
}

/** SINGLE_SELECT reads come back as arrays on some paths and scalars on others. */
function unwrapKind(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first !== '' ? first : null
}

export function toOpeningStockKind(value: unknown): OpeningStockKind | null {
  const first = Array.isArray(value) ? value[0] : value
  if (first === 'component' || first === 'subassembly' || first === 'finished_good') return first
  return null
}

export function partKindLabel(kind: string | null | undefined): string {
  if (!kind) return 'Unclassified'
  return PartKind.values.find((option) => option.value === kind)?.label ?? kind
}

export function setKindConfirmTitle(count: number, kind: OpeningStockKind): string {
  return `Set ${count} ${count === 1 ? 'part' : 'parts'} to ${partKindLabel(kind)}?`
}

/** What a count would write: `count − net`, or `null` while either side is unknown. */
export function previewDelta(quantity: number | null, netToday: number | null): number | null {
  if (quantity == null || !Number.isFinite(quantity) || netToday == null) return null
  return quantity - netToday
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

/** The one reason this row is out of the run, most disqualifying first. */
export function excludeReason(row: OpeningStockRow): OpeningStockExclusionReason | null {
  if (row.kindIsUnconfirmed) return 'kind-unconfirmed'
  if (row.quantity == null || !Number.isFinite(row.quantity) || row.quantity < 0) {
    return 'no-quantity'
  }
  return null
}

export function exclusionDetail(row: OpeningStockRow, reason: OpeningStockExclusionReason): string {
  switch (reason) {
    case 'kind-unconfirmed':
      return `Suggested ${partKindLabel(row.kind)}, which lands in ${row.accountLabel}. Stored as ${partKindLabel(row.storedKind)}.`
    case 'no-quantity':
      return row.quantity == null ? 'No count typed.' : `Count is ${row.quantity}.`
  }
}

/** The Unit cost cell (D-SC3/D-SC4): a BOM part takes none; a typed value wins over the standard. */
export function resolveUnitCost(input: {
  hasBom: boolean
  standardCost: number | null
  suggestion: StandardCostSuggestion | null
  /** `undefined`: never typed. */
  typed: number | null | undefined
}): Pick<OpeningStockRow, 'unitCost' | 'unitCostSuggested' | 'sendsUnitCost'> {
  if (input.hasBom) return { unitCost: null, unitCostSuggested: false, sendsUnitCost: false }
  const suggested = input.typed === undefined && input.standardCost == null && !!input.suggestion
  const unitCost =
    input.typed !== undefined
      ? input.typed
      : (input.standardCost ?? input.suggestion?.unitCost ?? null)
  return {
    unitCost,
    unitCostSuggested: suggested,
    sendsUnitCost: unitCost != null && unitCost !== input.standardCost,
  }
}

/** No standard, or one nobody has confirmed. */
export function isUncostedOrProvisional(
  row: Pick<OpeningStockRow, 'standardCost' | 'standardSource'>
): boolean {
  return row.standardCost == null || row.standardSource === 'provisional'
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

export function useOpeningStock() {
  const candidates = api.purchasing.listOpeningStockCandidates.useQuery()
  // Standard source, suggestion inputs and BOM facts; the tab still works without it.
  const worklist = api.builds.standardCostWorklist.useQuery({}, { retry: false })
  const utils = api.useUtils()
  const worklistById = useMemo(
    () => new Map<string, WorklistPart>((worklist.data ?? []).map((part) => [part.partId, part])),
    [worklist.data]
  )

  const partDefId = useResourceProperty('part', 'id')
  // Asked separately from the page's `part` gate: `stock_movement` carries its own grant.
  const movementDefId = useResourceProperty('stock_movement', 'id')
  const { canEditEntity } = useAccess()
  const canSetKind = partDefId ? canEditEntity(partDefId) : false
  const canOpenStock = movementDefId ? canEditEntity(movementDefId) : false

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
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

  // The run-wide date, a calendar day; every row without a date of its own follows it.
  const [occurredAt, setOccurredAt] = useState<string>(() => toCalendarDayIso(new Date()))
  const [drafts, setDrafts] = useState<Record<string, OpeningStockDraft>>({})
  /** Kinds this session has WRITTEN, so a row reads right before the refetch lands. */
  const [writtenKinds, setWrittenKinds] = useState<Record<string, string>>({})

  const bulkMode = useBulkMode()
  const clearSelection = useListSelection((s) => s.clear)
  const exitSelection = useListSelection((s) => s.exit)
  const selectedIds = useSelectionIds()
  const selectedCount = useSelectionCount()

  const rows = useMemo<OpeningStockRow[]>(() => {
    const list = candidates.data ?? []
    const scoped = prefilterIds ? list.filter((c) => prefilterIds.has(c.partId)) : list
    return scoped.map((candidate) => {
      const storedKind = writtenKinds[candidate.partId] ?? unwrapKind(candidate.partKind)
      const suggested = shouldSuggestFinishedGood({
        hasProduct: candidate.hasProduct,
        partKind: storedKind,
        subpartCheckLoaded: true,
        isSubpartOfAssembly: candidate.isSubpartOfAssembly,
      })
      const kind: OpeningStockKind | '' = suggested
        ? PartKind.FINISHED_GOOD
        : (toOpeningStockKind(storedKind) ?? '')

      const draft = drafts[candidate.partId]
      const quantity = draft?.quantity ?? null
      const flight = preflight.get(candidate.partId)
      const netToday = flight?.netToday ?? null
      const part = worklistById.get(candidate.partId)
      const hasBom = part?.hasBom ?? flight?.hasBom ?? false
      const suggestion = hasBom
        ? null
        : suggestStandardCost(part?.purchaseCost ?? null, part?.channelCost ?? null)
      const cost = resolveUnitCost({
        hasBom,
        standardCost: candidate.standardCost,
        suggestion,
        typed: draft && 'unitCost' in draft ? (draft.unitCost ?? null) : undefined,
      })

      return {
        partId: candidate.partId,
        recordId: partDefId ? toRecordId(partDefId, candidate.partId) : null,
        title: candidate.title,
        sku: candidate.sku,
        storedKind,
        kind,
        kindIsUnconfirmed: suggested,
        accountLabel: openingStockAccountLabel(kind || null),
        accountCode: openingStockAccountCode(kind || null),
        accountRole: resolveInventoryRoleForPartKind(kind || null),
        isUnclassified: isPartKindUnclassified(storedKind),
        standardCost: candidate.standardCost,
        standardSource: part?.standardCostSource ?? null,
        standardOrigin: part?.standardCostOrigin ?? null,
        quantity,
        ...cost,
        suggestion,
        date: draft?.date ?? occurredAt,
        hasOwnDate: draft?.date != null,
        state: flight ? (flight.hasInitial ? 'counted' : rowState(candidate)) : rowState(candidate),
        netToday,
        hasBom,
        uncostedLeafCount: part?.uncostedLeafCount ?? 0,
        usedIn: part?.usedIn ?? 0,
        unbuiltSales: flight?.unbuiltSales ?? 0,
        earliest: flight?.earliest ?? null,
        delta: previewDelta(quantity, netToday),
      }
    })
  }, [
    candidates.data,
    prefilterIds,
    drafts,
    writtenKinds,
    partDefId,
    preflight,
    occurredAt,
    worklistById,
  ])

  const counts = useMemo<OpeningStockCounts>(
    () => ({
      all: rows.length,
      notCounted: rows.filter((row) => row.state !== 'counted').length,
      counted: rows.filter((row) => row.state === 'counted').length,
      uncounted: rows.filter((row) => row.state === 'uncounted').length,
      unclassified: rows.filter((row) => row.isUnclassified).length,
      uncosted: rows.filter((row) => row.standardCost == null).length,
      uncostedOrProvisional: rows.filter(isUncostedOrProvisional).length,
      unbuilt: rows.filter(needsBackflushFirst).length,
    }),
    [rows]
  )

  const kindCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of rows) {
      if (!row.kind) continue
      map.set(row.kind, (map.get(row.kind) ?? 0) + 1)
    }
    return map
  }, [rows])

  const exclusions = useMemo<OpeningStockExclusion[]>(() => {
    const out: OpeningStockExclusion[] = []
    for (const row of rows) {
      const reason = excludeReason(row)
      if (!reason) continue
      out.push({
        partId: row.partId,
        recordId: row.recordId,
        title: row.title,
        reason,
        detail: exclusionDetail(row, reason),
      })
    }
    return out
  }, [rows])

  /** Exactly the rows the run will write. */
  const ready = useMemo(() => rows.filter((row) => excludeReason(row) === null), [rows])

  /** The mutation's own shape. The unit cost is a RATE, rounded to `RATE_DECIMALS`, never a cent. */
  const entries = useMemo(
    () =>
      ready.map((row) => ({
        partId: row.partId,
        quantity: row.quantity as number,
        ...(row.sendsUnitCost && row.unitCost != null
          ? { unitCost: roundMinorUnits(row.unitCost) }
          : {}),
        day: calendarDayKey(row.date) ?? undefined,
      })),
    [ready]
  )

  const summary = useMemo(
    () => ({
      firstCounts: ready.filter((row) => rowOutcome(row.state) === 'first').length,
      adjustments: ready.filter((row) => rowOutcome(row.state) === 'adjust').length,
      pending: ready.filter((row) => row.standardCost == null && !row.sendsUnitCost).length,
      restates: ready.filter((row) => row.standardCost != null && row.sendsUnitCost).length,
      backflushFirst: ready.filter(needsBackflushFirst).length,
    }),
    [ready]
  )

  // ── Drafts ──────────────────────────────────────────────────────────────
  const setQuantity = useCallback((partId: string, quantity: number | null) => {
    setDrafts((prev) => ({ ...prev, [partId]: { ...prev[partId], quantity } }))
  }, [])
  const setUnitCost = useCallback((partId: string, unitCost: number | null) => {
    setDrafts((prev) => ({ ...prev, [partId]: { ...prev[partId], unitCost } }))
  }, [])
  const setDate = useCallback((partId: string, date: string | null) => {
    setDrafts((prev) => {
      const next = { ...prev[partId] }
      if (date) next.date = date
      else delete next.date
      return { ...prev, [partId]: next }
    })
  }, [])

  // ── Writes ──────────────────────────────────────────────────────────────
  const bulkSetPartKind = api.purchasing.bulkSetPartKind.useMutation()
  const runSetCounts = api.purchasing.runSetCounts.useMutation()
  const { ConfirmDialog: KindConfirmDialog, runBatch } = useBulkRunner()

  const setKind = useCallback(
    async (partIds: string[], kind: OpeningStockKind) => {
      if (partIds.length === 0) return
      const { failed } = await bulkSetPartKind.mutateAsync({ partIds, kind })
      const failedIds = new Set(failed.map((skip) => skip.partId))
      setWrittenKinds((prev) => {
        const next = { ...prev }
        for (const partId of partIds) if (!failedIds.has(partId)) next[partId] = kind
        return next
      })
      if (failed.length > 0) {
        const titles = new Map((candidates.data ?? []).map((row) => [row.partId, row.title]))
        toastError({
          title: `${failed.length} ${failed.length === 1 ? 'part was' : 'parts were'} not changed`,
          description: failed
            .map((skip) => `${titles.get(skip.partId) ?? skip.partId}: ${skip.detail}`)
            .join('\n'),
        })
      }
      void candidates.refetch()
    },
    [bulkSetPartKind, candidates]
  )

  const setSelectedKind = useCallback(
    (kind: OpeningStockKind) => {
      const partIds = selectedIds
      void runBatch(partIds, () => setKind(partIds, kind), {
        title: setKindConfirmTitle(partIds.length, kind),
        description:
          'The kind decides which inventory account the movement is stamped with, and that stamp cannot be edited afterwards.',
        confirmText: 'Set kind',
        destructive: false,
        pendingLabel: 'Setting the kind…',
        removesItem: false,
        failureTitle: 'Error setting the part kind',
        onDone: clearSelection,
      })
    },
    [selectedIds, runBatch, setKind, clearSelection]
  )

  /** One call, per-part isolation on the server. `adjustAnchored`: this page shows the delta. */
  const run = useCallback(async (): Promise<OpeningStockRunSummary> => {
    const result = await runSetCounts.mutateAsync({
      day: calendarDayKey(occurredAt) ?? undefined,
      adjustAnchored: true,
      entries,
    })
    setDrafts({})
    clearSelection()
    void candidates.refetch()
    void utils.purchasing.setCountPreflight.invalidate()
    void utils.builds.standardCostWorklist.invalidate()
    return result
  }, [runSetCounts, occurredAt, entries, candidates, clearSelection, utils])

  return {
    rows,
    counts,
    kindCounts,
    exclusions,
    entries,
    summary,
    isLoading: candidates.isLoading || (!!jobParam && jobRecordIds.isLoading),
    isPreflightLoading: preflightResults.some((result) => result.isLoading),
    currencyCode,
    cutoffPeriod,
    occurredAt,
    setOccurredAt,
    setQuantity,
    setUnitCost,
    setDate,
    prefilter: prefilterIds ? { count: rows.length, fromJob: !!jobParam } : null,
    clearPrefilter,
    bulkMode,
    selectedCount,
    exitSelection,
    canSetKind,
    canOpenStock,
    setKind,
    setSelectedKind,
    KindConfirmDialog,
    isSettingKind: bulkSetPartKind.isPending,
    run,
    isRunning: runSetCounts.isPending,
  }
}

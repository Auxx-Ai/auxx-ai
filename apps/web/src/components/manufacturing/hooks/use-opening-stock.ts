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
import { createElement, Fragment, useCallback, useMemo, useState } from 'react'
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
import {
  type KindConflictDecision,
  type KindConflictPart,
  kindConflictPrompt,
  useKindConflictConfirm,
} from '../parts/use-kind-conflict-confirm'
import { stockSetupHref } from '../stock-setup/stock-setup-href'

/** Fifty: every row mounts a `RecordBadge`, and 202 rows put 400 ids on one GET (431). */
export const OPENING_STOCK_PAGE_SIZE = 50

/** `setCountPreflight` takes at most this many parts per call. */
const PREFLIGHT_CHUNK = 500

/** `builds.setStandardCosts` takes at most this many items per call. */
const COST_CHUNK = 500

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
export type OpeningStockKind = RouterInputs['purchasing']['bulkSetPartKind']['kind']
export type OpeningStockRunSummary = RouterOutputs['purchasing']['runSetCounts']

/** One press of the run: the count summary (`null` with no counts) and the cost-only first costs. */
export interface OpeningStockRunResult {
  counts: OpeningStockRunSummary | null
  firstCosts: number
  costFailures: { partId: string; detail: string }[]
}
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
  /** What the Cost cell shows: the standard, else typed, else the D-SC4 suggestion. */
  unitCost: number | null
  /** `unitCost` is the untouched suggestion. */
  unitCostSuggested: boolean
  /** Somebody typed (or took the suggestion for) a first cost; the row runs even without a count. */
  unitCostTyped: boolean
  suggestion: StandardCostSuggestion | null
  /** The run sends `unitCost` as a first cost; never true once the part has a standard (D6). */
  sendsUnitCost: boolean
  /** Calendar-day ISO: the run's count date. */
  date: string
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
  /** Units produced by builds, net of undone builds; `0` until the preflight lands. */
  built: number
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

/** A cost-only row (D6): no count, but a first cost somebody typed or took from the suggestion. */
export function isCostOnly(
  row: Pick<OpeningStockRow, 'quantity' | 'unitCostTyped' | 'sendsUnitCost'>
): boolean {
  return row.quantity == null && row.unitCostTyped && row.sendsUnitCost
}

/** The one reason this row is out of the run, most disqualifying first. */
export function excludeReason(row: OpeningStockRow): OpeningStockExclusionReason | null {
  if (row.kindIsUnconfirmed) return 'kind-unconfirmed'
  if (isCostOnly(row)) return null
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

/** The Cost cell (D6, D-SC3/D-SC4): a BOM part takes none, and a standard is read-only. */
export function resolveUnitCost(input: {
  hasBom: boolean
  standardCost: number | null
  suggestion: StandardCostSuggestion | null
  /** `undefined`: never typed. */
  typed: number | null | undefined
}): Pick<OpeningStockRow, 'unitCost' | 'unitCostSuggested' | 'unitCostTyped' | 'sendsUnitCost'> {
  const none = { unitCostSuggested: false, unitCostTyped: false, sendsUnitCost: false }
  if (input.hasBom) return { unitCost: null, ...none }
  if (input.standardCost != null) return { unitCost: input.standardCost, ...none }
  const typed = input.typed !== undefined
  const unitCost = typed ? (input.typed ?? null) : (input.suggestion?.unitCost ?? null)
  return {
    unitCost,
    unitCostSuggested: !typed && unitCost != null,
    unitCostTyped: typed && unitCost != null,
    // A suggestion is only sent once accepted; a count never takes it silently.
    sendsUnitCost: typed && unitCost != null,
  }
}

/** Initial list filters a link may ask for with `?filter=`. */
const LINKABLE_FILTERS: readonly OpeningStockFilter[] = [
  'all',
  'not-counted',
  'counted',
  'uncounted',
  'unclassified',
  'uncosted',
  'uncosted-or-provisional',
  'unbuilt',
]

export function parseOpeningStockFilter(value: string | null | undefined): OpeningStockFilter {
  return LINKABLE_FILTERS.find((filter) => filter === value) ?? 'all'
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
        kindConfirmed: candidate.kindConfirmed || candidate.partId in writtenKinds,
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
        date: occurredAt,
        state: flight ? (flight.hasInitial ? 'counted' : rowState(candidate)) : rowState(candidate),
        netToday,
        hasBom,
        uncostedLeafCount: part?.uncostedLeafCount ?? 0,
        usedIn: part?.usedIn ?? 0,
        unbuiltSales: flight?.unbuiltSales ?? 0,
        built: flight?.built ?? 0,
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

  /** Exactly the rows the run will write: counts, and first costs with no count. */
  const ready = useMemo(() => rows.filter((row) => excludeReason(row) === null), [rows])
  const counted = useMemo(() => ready.filter((row) => !isCostOnly(row)), [ready])

  /** The mutation's own shape. The unit cost is a RATE, rounded to `RATE_DECIMALS`, never a cent. */
  const entries = useMemo(
    () =>
      counted.map((row) => ({
        partId: row.partId,
        quantity: row.quantity as number,
        ...(row.sendsUnitCost && row.unitCost != null
          ? { unitCost: roundMinorUnits(row.unitCost) }
          : {}),
        day: calendarDayKey(row.date) ?? undefined,
      })),
    [counted]
  )
  // No movement: `setStandardCosts` sets the first standard and wakes `pricePartsJob`.
  const costEntries = useMemo(
    () =>
      ready
        .filter(isCostOnly)
        .map((row) => ({ partId: row.partId, unitCost: roundMinorUnits(row.unitCost as number) })),
    [ready]
  )

  const summary = useMemo(
    () => ({
      firstCounts: counted.filter((row) => rowOutcome(row.state) === 'first').length,
      adjustments: counted.filter((row) => rowOutcome(row.state) === 'adjust').length,
      firstCosts: ready.filter((row) => row.sendsUnitCost).length,
      pending: counted.filter((row) => row.standardCost == null && !row.sendsUnitCost).length,
      unbuilt: counted
        .filter(needsBackflushFirst)
        .map((row) => ({ title: row.title, unbuiltSales: row.unbuiltSales })),
    }),
    [counted, ready]
  )

  // ── Drafts ──────────────────────────────────────────────────────────────
  const setQuantity = useCallback((partId: string, quantity: number | null) => {
    setDrafts((prev) => ({ ...prev, [partId]: { ...prev[partId], quantity } }))
  }, [])
  const setUnitCost = useCallback((partId: string, unitCost: number | null) => {
    setDrafts((prev) => ({ ...prev, [partId]: { ...prev[partId], unitCost } }))
  }, [])
  /** Accept: take the suggested first cost on each named uncosted row. */
  const applySuggestions = useCallback(
    (partIds: readonly string[]) => {
      const byId = new Map(rows.map((row) => [row.partId, row]))
      setDrafts((prev) => {
        const next = { ...prev }
        for (const partId of partIds) {
          const row = byId.get(partId)
          if (!row?.unitCostSuggested || row.suggestion == null) continue
          next[partId] = { ...next[partId], unitCost: row.suggestion.unitCost }
        }
        return next
      })
    },
    [rows]
  )

  // ── Writes ──────────────────────────────────────────────────────────────
  const bulkSetPartKind = api.purchasing.bulkSetPartKind.useMutation()
  const runSetCounts = api.purchasing.runSetCounts.useMutation()
  const setStandardCosts = api.builds.setStandardCosts.useMutation()
  const { ConfirmDialog: BulkKindConfirmDialog, runBatch } = useBulkRunner()
  const { confirmKind, keepConfirmed, KindConflictDialog } = useKindConflictConfirm()
  const KindConfirmDialog = () =>
    createElement(
      Fragment,
      null,
      createElement(BulkKindConfirmDialog),
      createElement(KindConflictDialog)
    )

  /** BOM facts for the D4 check (plans/mrp/17): `hasBom` off the row, the child edge off the candidate. */
  const kindFacts = useCallback(
    (partIds: string[]): KindConflictPart[] => {
      const byId = new Map(rows.map((row) => [row.partId, row]))
      const inBom = new Map((candidates.data ?? []).map((c) => [c.partId, c.isSubpartOfAssembly]))
      return partIds.map((partId) => ({
        partId,
        title: byId.get(partId)?.title ?? '',
        isSubpartOfAssembly: inBom.get(partId) ?? false,
        hasBom: byId.get(partId)?.hasBom ?? false,
      }))
    },
    [rows, candidates.data]
  )

  const writeKind = useCallback(
    async (partIds: string[], kind: OpeningStockKind, decision?: KindConflictDecision) => {
      if (partIds.length === 0) return
      const { failed } = await bulkSetPartKind.mutateAsync({ partIds, kind })
      const failedIds = new Set(failed.map((skip) => skip.partId))
      setWrittenKinds((prev) => {
        const next = { ...prev }
        for (const partId of partIds) if (!failedIds.has(partId)) next[partId] = kind
        return next
      })
      if (decision) {
        const confirmIds = decision.confirmIds.filter((partId) => !failedIds.has(partId))
        await keepConfirmed({ ...decision, confirmIds })
      }
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
    [bulkSetPartKind, candidates, keepConfirmed]
  )

  /** The Kind column: asks first when the kind conflicts with the part's BOM (D4). */
  const setKind = useCallback(
    async (partIds: string[], kind: OpeningStockKind) => {
      const decision = await confirmKind(kindFacts(partIds), kind)
      if (!decision) return
      await writeKind(decision.apply, kind, decision)
    },
    [confirmKind, kindFacts, writeKind]
  )

  const setSelectedKind = useCallback(
    (kind: OpeningStockKind) => {
      const partIds = selectedIds
      // A conflict's own confirm replaces the bulk runner's, so nobody is asked twice.
      const facts = kindFacts(partIds)
      if (kindConflictPrompt(facts, kind)) {
        void (async () => {
          const decision = await confirmKind(facts, kind)
          if (!decision) return
          await writeKind(decision.apply, kind, decision)
          clearSelection()
        })().catch((error: unknown) =>
          toastError({
            title: 'Error setting the part kind',
            description: error instanceof Error ? error.message : undefined,
          })
        )
        return
      }
      void runBatch(partIds, () => writeKind(partIds, kind), {
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
    [selectedIds, runBatch, writeKind, clearSelection, kindFacts, confirmKind]
  )

  /** Counts in one call, first costs without a count in another; per-part isolation on the server. */
  const run = useCallback(async (): Promise<OpeningStockRunResult> => {
    try {
      const counts =
        entries.length > 0
          ? await runSetCounts.mutateAsync({
              day: calendarDayKey(occurredAt) ?? undefined,
              adjustAnchored: true,
              entries,
            })
          : null
      let firstCosts = 0
      const costFailures: { partId: string; detail: string }[] = []
      for (const items of chunk(costEntries, COST_CHUNK)) {
        for (const result of await setStandardCosts.mutateAsync({ items })) {
          if (result.ok) firstCosts += 1
          else costFailures.push({ partId: result.partId, detail: result.error ?? 'Not saved' })
        }
      }
      setDrafts({})
      clearSelection()
      return { counts, firstCosts, costFailures }
    } finally {
      void candidates.refetch()
      void utils.purchasing.setCountPreflight.invalidate()
      void utils.builds.standardCostWorklist.invalidate()
      void utils.purchasing.stockSetupStatus.invalidate()
    }
  }, [
    runSetCounts,
    setStandardCosts,
    occurredAt,
    entries,
    costEntries,
    candidates,
    clearSelection,
    utils,
  ])

  return {
    rows,
    counts,
    kindCounts,
    exclusions,
    entries,
    costEntries,
    /** Rows the run writes: counts plus cost-only first costs. */
    runSize: entries.length + costEntries.length,
    summary,
    isLoading: candidates.isLoading || (!!jobParam && jobRecordIds.isLoading),
    isPreflightLoading: preflightResults.some((result) => result.isLoading),
    currencyCode,
    cutoffPeriod,
    occurredAt,
    setOccurredAt,
    setQuantity,
    setUnitCost,
    applySuggestions,
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
    isRunning: runSetCounts.isPending || setStandardCosts.isPending,
  }
}

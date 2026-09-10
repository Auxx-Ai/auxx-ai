// apps/web/src/components/manufacturing/hooks/use-opening-stock.ts

// The Opening stock tab's whole read + draft model (money
// 52-parts-costing-page.md §2.3, §4): one row per part, the five row states the
// filter chips count, the per-account totals that ARE the opening journal
// entry, and the excluded block.
//
// 🛑 THE ACCOUNT COMES FROM `openingStockAccountLabel`, never from a second
// kind-to-account table. That function resolves through
// `resolveInventoryRoleForPartKind`, which is what the write path uses, so the
// only way a row can be wrong about the account is if the write is wrong about
// it too (§2.3). It matters more here than on the create form: 495 rows are
// stamped at once onto `updatable: false` movements, and a wrong `gl_account`
// is corrected only by reversing (§6.3).
//
// 🛑 THE UNIT COST DEFAULTS FROM `standardCost`, NEVER from `part_cost`.
// HANDOFF rule 2: `part_cost` is live replacement cost and is stamped onto a
// movement never; `part_standard_cost` is stamped onto every one. Defaulting
// from the wrong one would seed an append-only movement's frozen value from the
// single field that must not value a movement (§3, §6.1).
//
// 🛑 THE KIND IS A SUGGESTION WITH A CONFIRM, never an auto-write.
// `shouldSuggestFinishedGood` only ever OFFERS the value (Gap C §3.2), so a row
// whose displayed kind is the suggestion and whose STORED kind is still
// something else is held out of the run - see `kindIsUnconfirmed` and the
// `kind-unconfirmed` exclusion. Without that the row would name 1330 while the
// write resolved 1310 off the stored `component`, which is exactly the
// disagreement the paragraph above forbids.

import { normalizeCalendarDayIso, toCalendarDayIso } from '@auxx/lib/field-values/client'
import {
  ACCOUNT_ROLES,
  cutoverDateFor,
  OPENING_BASELINE_SETTING_KEYS,
} from '@auxx/lib/postings/client'
import {
  computeExtendedCost,
  resolveInventoryRoleForPartKind,
  roundMinorUnits,
} from '@auxx/lib/receiving/client'
import { PartKind, type RecordId, toRecordId } from '@auxx/lib/resources/client'
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
import {
  useDehydratedOrganizationId,
  useDehydratedStateContext,
} from '~/providers/dehydrated-state-provider'
import { api, type RouterInputs, type RouterOutputs } from '~/trpc/react'
import { openingStockAccountCode, openingStockAccountLabel } from '../parts/opening-stock-input'

/**
 * 🛑 Fifty, and NOT for scroll performance. Every row mounts a `RecordBadge`,
 * which asks the relationship store to hydrate its record, and the store
 * batches those into ONE `record.getByIds` GET - 202 rows put 400 ids on the
 * query string and the dev server answered **431 Request Header Fields Too
 * Large** for every batch (`tariff-classification-list.tsx:52`, driven
 * 2026-09-01). There are 495 parts here, so the same page size applies for the
 * same reason.
 */
export const OPENING_STOCK_PAGE_SIZE = 50

/** One part as the candidates read returns it. */
export type OpeningStockCandidate =
  RouterOutputs['purchasing']['listOpeningStockCandidates'][number]

/**
 * The three `part_kind` values `bulkSetPartKind` accepts, taken from the
 * procedure's own `z.enum` rather than restated - a fourth kind added to the
 * registry then reaches this page as a type error rather than as a silent gap.
 */
export type OpeningStockKind = RouterInputs['purchasing']['bulkSetPartKind']['kind']

/** What a run did, and what it did not do. */
export type OpeningStockRunSummary = RouterOutputs['purchasing']['runOpeningStock']

/**
 * §4's three MOVEMENT states. `unclassified` and `cost override` are not states
 * of the same axis - a not-opened row can be both - so they are booleans on the
 * row and chips of their own, never members of this union.
 */
export type OpeningStockRowState = 'not-opened' | 'opened' | 'blocked'

/** The filter chips: §4's five, plus one per kind once kinds are set. */
export type OpeningStockFilter =
  | 'all'
  | 'not-opened'
  | 'opened'
  | 'blocked'
  | 'unclassified'
  | 'cost-override'
  | `kind:${string}`

/** What the person typed into one row. An absent entry means "untouched". */
interface OpeningStockDraft {
  quantity: number | null
  /** `undefined` means the row still shows the standard cost. */
  unitCost?: number | null
}

export interface OpeningStockRow {
  partId: string
  /** For the `RecordBadge`. `null` until the part def id resolves. */
  recordId: RecordId | null
  title: string
  sku: string | null
  /** `part_kind` as STORED, unwrapped. What the write path will resolve against. */
  storedKind: string | null
  /** What the row DISPLAYS: the stored kind, or the finished-good suggestion. */
  kind: OpeningStockKind | ''
  /** The displayed kind is a suggestion the part does not store yet. */
  kindIsUnconfirmed: boolean
  /** Resolved through `openingStockAccountLabel`, never a second mapping. */
  accountLabel: string
  /**
   * The same account as {@link OpeningStockRow.accountLabel}, as just its
   * number - what the row's narrow account column shows, with the full label as
   * its tooltip. Both come off the one resolver in `opening-stock-input.ts`.
   */
  accountCode: string
  /**
   * The inventory ROLE both renderings above came from, off the SAME resolver
   * the write path uses. What the reconciliation groups and keys settings on.
   */
  accountRole: string
  /** `isPartKindUnclassified` on the STORED value - a stored `component` counts. */
  isUnclassified: boolean
  /** `part_standard_cost`, minor units. The ONLY source of the cost default. */
  standardCost: number | null
  quantity: number | null
  unitCost: number | null
  /** `round(unitCost x quantity)`, minor units. */
  extended: number
  /** A typed cost the part's standard disagrees with (§6.1). */
  isCostOverride: boolean
  state: OpeningStockRowState
}

/** Why a row is not in the run. */
export type OpeningStockExclusionReason =
  | 'opened'
  | 'blocked'
  | 'kind-unconfirmed'
  | 'no-quantity'
  | 'no-cost'

export interface OpeningStockExclusion {
  partId: string
  recordId: RecordId | null
  title: string
  reason: OpeningStockExclusionReason
  /** ⚠️ The value that PROVES the reason. A reason without evidence is an assertion. */
  detail: string
}

/** One line of the opening journal entry: an inventory account and its total. */
export interface OpeningStockAccountTotal {
  account: string
  /**
   * The inventory ROLE the account was resolved from, `inventory_raw_materials`.
   *
   * 🛑 Carried so the reconciliation can find the baseline SETTING that owns
   * this row. The role is what `accounting.opening*` is keyed on and what a
   * movement's `stock_movement_gl_account` freezes; the code and the name come
   * from a chart the org may renumber, so neither is a key.
   */
  role: string
  parts: number
  units: number
  /** Minor units. */
  extended: number
}

/**
 * The opening baseline settings, per inventory role: the frozen physical count
 * the first month-end close measures its delta from.
 *
 * `null` is UNSET, and it is not `0` - an org with no finished goods at cutover
 * has exactly zero, and the panel says something different in each case.
 */
export type OpeningStockBaseline = Record<string, number | null>

/**
 * 🛑 The two roles a `part_kind` can actually reach, and therefore the only ones
 * the reconciliation compares or proposes.
 *
 * `INVENTORY_ROLE_BY_PART_KIND` maps `component`/`subassembly` to raw materials
 * and `finished_good` to finished goods. **Nothing maps to `inventory_wip`**,
 * and `postings/build-entry.ts` says so outright. WIP is structurally zero here
 * because `completeBuild` writes the consume and the produce legs in one call,
 * so material never rests in work in process. Proposing a WIP baseline from a
 * count that cannot produce one would be inventing a number.
 */
export const PROPOSABLE_OPENING_ROLES = [
  ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
  ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
] as const

/** The counts the chips carry. The counts ARE the checklist (§4). */
export interface OpeningStockCounts {
  all: number
  notOpened: number
  opened: number
  blocked: number
  unclassified: number
  costOverride: number
}

/** SINGLE_SELECT reads come back as arrays on some paths and scalars on others. */
function unwrapKind(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first !== '' ? first : null
}

/**
 * Narrow anything a picker or the server hands back to a kind the write path
 * accepts, or `null`.
 *
 * An unrecognised value reads as unset rather than throwing, which is the same
 * call `resolveInventoryRoleForPartKind` makes: a checklist is not the place to
 * discover that somebody added a fourth part kind.
 */
export function toOpeningStockKind(value: unknown): OpeningStockKind | null {
  const first = Array.isArray(value) ? value[0] : value
  if (first === 'component' || first === 'subassembly' || first === 'finished_good') return first
  return null
}

/** `finished_good` -> `Finished Good`, from the field's own option list. */
export function partKindLabel(kind: string | null | undefined): string {
  if (!kind) return 'Unclassified'
  return PartKind.values.find((option) => option.value === kind)?.label ?? kind
}

/**
 * The bulk confirm's title: `Set 34 parts to Finished Good?`
 *
 * A named function rather than a template at the call site so the plural and
 * the kind's own LABEL - never a raw `finished_good` - are covered by a test.
 * The count is in the title because the ActionBar's selection is the only thing
 * that says how far this write reaches.
 */
export function setKindConfirmTitle(count: number, kind: OpeningStockKind): string {
  return `Set ${count} ${count === 1 ? 'part' : 'parts'} to ${partKindLabel(kind)}?`
}

/**
 * The one reason this row is out of the run, most disqualifying first.
 *
 * Ordered rather than collected: a row that already has an opening movement is
 * refused by `assertPartHasNoMovements` whatever else is true of it, and
 * listing "no quantity" beside that would suggest typing one would help.
 */
export function excludeReason(row: OpeningStockRow): OpeningStockExclusionReason | null {
  if (row.state === 'opened') return 'opened'
  if (row.state === 'blocked') return 'blocked'
  if (row.kindIsUnconfirmed) return 'kind-unconfirmed'
  if (row.quantity == null || !Number.isFinite(row.quantity) || row.quantity <= 0) {
    return 'no-quantity'
  }
  if (row.unitCost == null || !Number.isFinite(row.unitCost) || row.unitCost <= 0) return 'no-cost'
  return null
}

export function useOpeningStock() {
  const candidates = api.purchasing.listOpeningStockCandidates.useQuery()

  const partDefId = useResourceProperty('part', 'id')
  // 🛑 Asked SEPARATELY from the page's `part` gate. The two definitions carry
  // their own per-def grants, so somebody who may edit parts is not thereby
  // allowed to write `stock_movement` rows - and an affordance the mutation
  // refuses on click is worse than one that is absent.
  const movementDefId = useResourceProperty('stock_movement', 'id')
  const { canEditEntity } = useAccess()
  const canSetKind = partDefId ? canEditEntity(partDefId) : false
  const canOpenStock = movementDefId ? canEditEntity(movementDefId) : false

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const cutoffPeriod = (getSetting('accounting.cutoffPeriod') as string | null) ?? null

  /**
   * The opening baseline the count is reconciled against, per role.
   *
   * ⚠️ No query. `useSettings` rides the org cache, hydrated by the provider,
   * so every `accounting.*` key is already in hand on load at ZERO cost -
   * `postings/setup-readiness.ts`'s header is explicit that this is why there is
   * no readiness endpoint. A fresh read here would defeat the invalidation the
   * settings writes already fire.
   *
   * A non-number reads as UNSET rather than as zero. `0` is a legitimate
   * baseline (an org with no finished goods at cutover has exactly zero) and
   * collapsing the two would make the panel show a difference against a number
   * nobody supplied.
   */
  const openingBaseline = useMemo<OpeningStockBaseline>(() => {
    const entries = PROPOSABLE_OPENING_ROLES.map((role) => {
      const value = getSetting(OPENING_BASELINE_SETTING_KEYS[role])
      return [role, typeof value === 'number' && Number.isFinite(value) ? value : null] as const
    })
    return Object.fromEntries(entries)
  }, [getSetting])

  /**
   * The opening date the cutoff implies: the last day of the last month the
   * PREVIOUS system owned, which is the day before the first month auxx.ai
   * values. `null` when the cutoff is unset or is not a `YYYY-MM` month -
   * `cutoverDateFor` throws on a day key, and the page says so rather than
   * silently dating the run today (§3).
   */
  const cutoffDate = useMemo(() => {
    if (!cutoffPeriod) return null
    try {
      return cutoverDateFor(cutoffPeriod)
    } catch {
      return null
    }
  }, [cutoffPeriod])

  // ONE date for the whole run, not one per row (§2.3). `openStockBalance`
  // takes `occurredAt` per part, but an opening balance is one event on one
  // date and exposing it per row invites 495 dates for it.
  //
  // ⚠️ A CALENDAR DAY, in the canonical `YYYY-MM-DDT00:00:00.000Z` shape the
  // DATE input reads and writes. Built with `field-values`' own two helpers
  // rather than by hand: `normalizeCalendarDayIso` rounds to the NEAREST UTC
  // midnight because truncating is off by one for every writer east of UTC, and
  // an opening balance landing a day either side of the cutoff is the
  // difference between the frozen baseline covering it and month-end summing
  // it.
  const [occurredAtOverride, setOccurredAt] = useState<string | null>(null)
  const defaultOccurredAt = cutoffDate
    ? (normalizeCalendarDayIso(cutoffDate) ?? toCalendarDayIso(new Date()))
    : toCalendarDayIso(new Date())
  const occurredAt = occurredAtOverride ?? defaultOccurredAt

  const [drafts, setDrafts] = useState<Record<string, OpeningStockDraft>>({})
  /** Kinds this session has WRITTEN, so a row reads right before the refetch lands. */
  const [writtenKinds, setWrittenKinds] = useState<Record<string, string>>({})

  // ── Selection ───────────────────────────────────────────────────────────
  //
  // The shared `ListSelectionProvider` store owns it, so there is no second
  // selection set on this page and the ActionBar is the only bulk control.
  //
  // ⚠️ `itemIds` is fed by the LIST, not from here. The store resolves Cmd+A and
  // shift-ranges against `itemIds` as "what is on screen, in display order", and
  // only the list knows that - it holds the search, the filter chip and the
  // 50-row page. Feeding all 495 rows from here would let Cmd+A select rows the
  // filter is hiding and count them in the bar.
  const bulkMode = useBulkMode()
  const setBulkMode = useListSelection((s) => s.setBulkMode)
  const clearSelection = useListSelection((s) => s.clear)
  const exitSelection = useListSelection((s) => s.exit)
  const selectedIds = useSelectionIds()
  const selectedCount = useSelectionCount()

  const rows = useMemo<OpeningStockRow[]>(() => {
    const list = candidates.data ?? []
    return list.map((candidate) => {
      const storedKind = writtenKinds[candidate.partId] ?? unwrapKind(candidate.partKind)

      // ⚠️ `subpartCheckLoaded` is true because the candidates read resolves
      // `isSubpartOfAssembly` in the same query as the rest of the row - there
      // is no second, later answer for the suggestion to flash on ahead of.
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
      const unitCost = draft?.unitCost !== undefined ? draft.unitCost : candidate.standardCost

      const state: OpeningStockRowState = candidate.hasInitialMovement
        ? 'opened'
        : candidate.hasMovements
          ? 'blocked'
          : 'not-opened'

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
        quantity,
        unitCost,
        extended:
          quantity != null && unitCost != null ? computeExtendedCost(unitCost, quantity) : 0,
        isCostOverride:
          unitCost != null && candidate.standardCost != null && unitCost !== candidate.standardCost,
        state,
      }
    })
  }, [candidates.data, drafts, writtenKinds, partDefId])

  const counts = useMemo<OpeningStockCounts>(
    () => ({
      all: rows.length,
      notOpened: rows.filter((row) => row.state === 'not-opened').length,
      opened: rows.filter((row) => row.state === 'opened').length,
      blocked: rows.filter((row) => row.state === 'blocked').length,
      unclassified: rows.filter((row) => row.isUnclassified).length,
      costOverride: rows.filter((row) => row.isCostOverride).length,
    }),
    [rows]
  )

  /** kind -> row count, for the per-kind chips that appear once kinds are set. */
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

  /** Exactly the rows the run will write, in the mutation's own shape. */
  const entries = useMemo(
    () =>
      rows
        .filter((row) => excludeReason(row) === null)
        .map((row) => ({
          partId: row.partId,
          quantity: row.quantity as number,
          // 🛑 Rounded to `RATE_DECIMALS`, NEVER to a whole minor unit. The unit
          // cost is a RATE, and the standard it defaults from may legitimately
          // hold a fractional cent (a fastener at $15.94 per thousand is 1.594
          // minor units). `Math.round` here would rewrite that as 2 and freeze
          // the wrong number onto an append-only movement. `roundMinorUnits` is
          // the same function the write path uses, and it is what the
          // procedure's own precision refinement is checking against.
          unitCost: roundMinorUnits(row.unitCost as number),
        })),
    [rows]
  )

  /**
   * The opening journal entry, per inventory account.
   *
   * ⚠️ Grouped by the label `openingStockAccountLabel` produces rather than by a
   * hardcoded 1310/1320/1330 triple, so an account only appears when a row
   * actually lands in it - `subassembly` resolves to Raw Materials, so Work in
   * Process is correctly never a line here.
   */
  const accountTotals = useMemo<OpeningStockAccountTotal[]>(() => {
    const map = new Map<string, OpeningStockAccountTotal>()
    for (const row of rows) {
      if (excludeReason(row) !== null) continue
      const current = map.get(row.accountRole) ?? {
        account: row.accountLabel,
        role: row.accountRole,
        parts: 0,
        units: 0,
        extended: 0,
      }
      current.parts += 1
      current.units += row.quantity ?? 0
      current.extended += row.extended
      map.set(row.accountRole, current)
    }
    return [...map.values()].sort((a, b) => a.account.localeCompare(b.account))
  }, [rows])

  const totalExtended = accountTotals.reduce((sum, total) => sum + total.extended, 0)

  /**
   * What the run counts per proposable role, `0` for a role nothing landed in.
   *
   * Every proposable role is always present, because the propose action writes
   * BOTH settings: leaving finished goods unset while raw materials is set would
   * make the reconciliation pass on a row nobody counted.
   */
  const countedByRole = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const role of PROPOSABLE_OPENING_ROLES) map[role] = 0
    for (const total of accountTotals) map[total.role] = total.extended
    return map
  }, [accountTotals])

  // ── Drafts ──────────────────────────────────────────────────────────────

  const setQuantity = useCallback((partId: string, quantity: number | null) => {
    setDrafts((prev) => ({ ...prev, [partId]: { ...prev[partId], quantity } }))
  }, [])

  const setUnitCost = useCallback((partId: string, unitCost: number | null) => {
    setDrafts((prev) => ({
      ...prev,
      [partId]: { quantity: prev[partId]?.quantity ?? null, unitCost },
    }))
  }, [])

  // ── Writes ──────────────────────────────────────────────────────────────

  const bulkSetPartKind = api.purchasing.bulkSetPartKind.useMutation()
  const runOpeningStock = api.purchasing.runOpeningStock.useMutation()
  const proposeBaselineSettings = api.setting.batchUpdateOrganizationSettings.useMutation()
  const organizationId = useDehydratedOrganizationId()
  const { patchSettings } = useDehydratedStateContext()
  const { ConfirmDialog: KindConfirmDialog, runBatch } = useBulkRunner()

  /**
   * Write `part_kind` for one row or a whole selection.
   *
   * The inline select and the ActionBar's bulk control are the SAME write: a
   * second door into `part_kind` would be a second place for the account the row
   * names to diverge from the account the run resolves. The kind must be stored
   * before the run because the run freezes the account it resolves onto an
   * `updatable: false` movement (§6.3).
   */
  const setKind = useCallback(
    async (partIds: string[], kind: OpeningStockKind) => {
      if (partIds.length === 0) return
      await bulkSetPartKind.mutateAsync({ partIds, kind })
      setWrittenKinds((prev) => {
        const next = { ...prev }
        for (const partId of partIds) next[partId] = kind
        return next
      })
      void candidates.refetch()
    },
    [bulkSetPartKind, candidates]
  )

  /**
   * The ActionBar's bulk kind write: `setKind` over the selection, behind one
   * confirm that names the count and the kind.
   *
   * Through `useBulkRunner`'s `runBatch` rather than calling `setKind` straight,
   * so the selected rows carry the pending overlay for the round trip and a
   * rejection reports itself once as a toast - the same choreography as every
   * other bulk list action. One mutation for the whole set, never a loop.
   */
  const setSelectedKind = useCallback(
    (kind: OpeningStockKind) => {
      const partIds = selectedIds
      void runBatch(partIds, () => setKind(partIds, kind), {
        title: setKindConfirmTitle(partIds.length, kind),
        description:
          'The kind decides which inventory account the movement is stamped with, and that stamp cannot be edited afterwards.',
        confirmText: 'Set kind',
        // Not a delete. `part_kind` is an ordinary editable field; it is the
        // MOVEMENT's copy of the account that is append-only, which is what the
        // description is warning about.
        destructive: false,
        pendingLabel: 'Setting the kind…',
        // The rows stay on screen, so each overlay clears when the write
        // settles rather than waiting for a refetch that will never prune them.
        removesItem: false,
        failureTitle: 'Error setting the part kind',
        // Cleared, not exited: kinds get set in batches (all the motors, then
        // all the fasteners), so bulk mode stays on for the next one.
        onDone: clearSelection,
      })
    },
    [selectedIds, runBatch, setKind, clearSelection]
  )

  /**
   * The run. Never a loop over rows - one call, one pass, per-part isolation on
   * the server (§5). The candidates read is refetched afterwards rather than
   * patched: a partial run leaves work behind, and the new row states are what
   * says which.
   */
  const run = useCallback(async (): Promise<OpeningStockRunSummary> => {
    const result = await runOpeningStock.mutateAsync({ occurredAt: new Date(occurredAt), entries })
    setDrafts({})
    clearSelection()
    void candidates.refetch()
    return result
  }, [runOpeningStock, occurredAt, entries, candidates, clearSelection])

  /**
   * Write the counted totals into `accounting.openingRawMaterials` and
   * `accounting.openingFinishedGoods`.
   *
   * The count is the INPUT to the baseline, not a check against it: the baseline
   * IS the frozen physical count, valued at CPA-approved costs
   * (`postings/opening-baseline.ts`), and this page is where that count is
   * entered. So this proposes the totals; it never writes a trial-balance row,
   * which those settings own.
   *
   * 🛑 **`accounting.openingWip` is NEVER written.** See
   * {@link PROPOSABLE_OPENING_ROLES} - no part kind resolves to work in process,
   * so there is no counted figure to propose and a zero written here would be an
   * assertion the count cannot support.
   *
   * 🛑 No freeze check of its own. `setting.batchUpdateOrganizationSettings`
   * already calls `assertAccountingSetupUnfrozen`, so the server refuses once an
   * entry stands on these settings; a second guess here could only disagree with
   * it. The refusal reaches the caller as the mutation's own error.
   *
   * Through the tRPC mutation directly rather than through `useSettings`, which
   * fires `.mutate` and returns void - a refusal has to be awaitable to be
   * reportable. The dehydrated settings are patched by hand afterwards, which is
   * exactly what `useSettings` does, so the panel re-renders against the new
   * baseline without a refetch.
   */
  const proposeBaseline = useCallback(async (): Promise<void> => {
    const settings = PROPOSABLE_OPENING_ROLES.map((role) => ({
      key: OPENING_BASELINE_SETTING_KEYS[role] as string,
      value: countedByRole[role] ?? 0,
    }))
    await proposeBaselineSettings.mutateAsync({ settings })
    if (organizationId) {
      patchSettings(organizationId, Object.fromEntries(settings.map((s) => [s.key, s.value])))
    }
  }, [proposeBaselineSettings, countedByRole, organizationId, patchSettings])

  return {
    rows,
    counts,
    kindCounts,
    exclusions,
    entries,
    accountTotals,
    totalExtended,
    countedByRole,
    openingBaseline,
    proposeBaseline,
    isProposingBaseline: proposeBaselineSettings.isPending,
    isLoading: candidates.isLoading,
    currencyCode,
    cutoffPeriod,
    cutoffDate,
    occurredAt,
    setOccurredAt,
    setQuantity,
    setUnitCost,
    bulkMode,
    setBulkMode,
    selectedCount,
    exitSelection,
    canSetKind,
    canOpenStock,
    setKind,
    setSelectedKind,
    /** The `runBatch` confirm. Render it beside the ActionBar. */
    KindConfirmDialog,
    isSettingKind: bulkSetPartKind.isPending,
    run,
    isRunning: runOpeningStock.isPending,
  }
}

/**
 * The evidence beside a reason.
 *
 * ⚠️ Every exclusion carries the value that PROVES it - 44 §7.2b's rule, which
 * `fulfillment-exclusions.tsx` and `backfill-exclusions.tsx` both already
 * follow. "Already opened" explains nothing without saying what is already
 * there, and "no cost" explains nothing without the standard it would have
 * defaulted from.
 *
 * ⚠️ The two movement reasons name the boolean the read actually returned.
 * `listOpeningStockCandidates` carries `hasMovements` / `hasInitialMovement`
 * and not a movement COUNT, so a count here would be invented.
 */
export function exclusionDetail(row: OpeningStockRow, reason: OpeningStockExclusionReason): string {
  switch (reason) {
    case 'opened':
      return 'An opening movement is already on the ledger, and a movement is append-only.'
    case 'blocked':
      return 'Stock movements exist and none of them is an opening balance.'
    case 'kind-unconfirmed':
      return `Suggested ${partKindLabel(row.kind)}, which lands in ${row.accountLabel}. Stored as ${partKindLabel(row.storedKind)}.`
    case 'no-quantity':
      return row.quantity == null ? 'No quantity typed.' : `Quantity is ${row.quantity}.`
    case 'no-cost':
      return row.standardCost == null
        ? 'No unit cost typed, and the part has no standard cost to default from.'
        : 'No unit cost typed.'
  }
}

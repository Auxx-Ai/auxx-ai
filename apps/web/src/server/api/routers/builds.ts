// apps/web/src/server/api/routers/builds.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { BuildSourceValues, BuildStatusValues } from '@auxx/database/enums'
import { instantForBookDay } from '@auxx/lib/accounting/ledger'
import { getCachedEntityDefId, getOrgCache } from '@auxx/lib/cache'
import { BadRequestError, NotFoundError } from '@auxx/lib/errors'
import {
  amendPlannedBuildQuantity,
  type BuildRecord,
  buildNow,
  cancelBuild,
  completeBuild,
  computeBackfillPreflight,
  confirmKindConflicts,
  createBuild,
  executeBackfill,
  explodeBuildComponents,
  fixMovementAccounts,
  getBuildDetail,
  hasStandingBackflushBuilds,
  listBuilds,
  loadAutoBuildSettings,
  planBackfill,
  previewBackflush,
  readBackfillPlanReads,
  readBackflushRunRow,
  readBatchRun,
  readBuildDrift,
  readKindConflictFacts,
  readKindConflicts,
  readMovementAccountDrift,
  readPartQuantitiesOnHand,
  readUndoBackflushRunRow,
  reverseBuild,
  startBuild,
  summarizeBackflushPlan,
  toBackflushRun,
  toUndoBackflushRun,
  updateBuildNotes,
} from '@auxx/lib/inventory/builds'
import type {
  BackfillExclusion,
  BackfillGrouping,
  BackfillPartPlan,
  BackfillPlan,
  BackfillPreflight,
  BackfillStatus,
} from '@auxx/lib/inventory/builds/client'
import {
  confirmStandardCosts,
  loadPartAbsorptionRates,
  previewStandardCostRoll,
  readMovedPartIds,
  readStandardCostWorklist,
  rollStandardCost,
  setStandardCost,
  setStandardCosts,
} from '@auxx/lib/inventory/costing'
import { bulkSetPartKind } from '@auxx/lib/inventory/receiving'
import { enqueueBackflushRun, enqueueUndoBackflushRun } from '@auxx/lib/jobs'
import { PermissionKey } from '@auxx/lib/permissions'
import { getOrganizationSetting } from '@auxx/lib/settings'
import { dayKeyInZone, previousDayKey, startOfDayInstant } from '@auxx/utils/calendar-day'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { compareBuildLegs } from '~/server/api/build-legs'
import { calendarDaySchema } from '~/server/api/calendar-day-schema'
import { capabilityProcedure, createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/**
 * A roll may be scoped to a handful of parts, or run across the org.
 *
 * The cap is generous rather than meaningful — the widening step adds every
 * ancestor anyway, and an unscoped roll covers everything. It exists only so a
 * malformed client cannot send an unbounded array.
 */
const rollInput = z.object({
  partIds: z.array(z.string().min(1)).max(500).optional(),
  /** The day the new standards take effect, in the book zone. Defaults to now. */
  day: calendarDaySchema.optional(),
})

/** A typed per-unit cost: minor units at rate precision, so fractional cents are legal. Zero is a value. */
const unitCostInput = z.number().finite().nonnegative()

/** One row of the Set costs grid (106 §6.2). */
const standardCostItem = z.object({
  partId: z.string().min(1),
  unitCost: unitCostInput,
  /** A `PartKind` value, applied first through `bulkSetPartKind` so the 107 kind guard runs. */
  kind: z.string().min(1).optional(),
  /** "Set cost instead" on a part with a BOM (D-SC3). */
  overrideBom: z.boolean().optional(),
  /** Mark the written standard confirmed, stamped with this origin (plans/mrp/22 §3.3). */
  confirmAs: z.enum(['manual', 'supplier_price', 'channel']).optional(),
})

/** Per-item answer of `setStandardCosts`. `action` is absent when only the kind was written. */
interface SetStandardCostItemResult {
  partId: string
  ok: boolean
  error?: string
  action?: 'set' | 'restated'
  /** Signed minor units the restate posted to revaluation; 0 when nothing posted. */
  revaluationPostedMinor?: number
}

/** Money is stored in integer minor units (cents) everywhere in this subsystem. */
const minorUnits = z.number().int()

/**
 * A completion quantity. `doublePrecision` columns, so fractions are legal.
 *
 * Bounded rather than merely positive: `quantityConsumed` multiplies into an
 * extended cost and the movement rows are append-only, so an unbounded number
 * here is a number nobody can take back. The cap is far above any real run.
 */
const runQuantity = z.number().finite().positive().max(1_000_000)

/**
 * What the floor actually consumed, where it differs from the bill of materials.
 *
 * 🛑 **The one input that makes this a tool rather than a report.** Zero is
 * allowed and means "we did not use this at all" — `planBuildComponents` drops
 * the line rather than writing a zero-quantity movement. A part that is NOT on
 * the bill of materials is an off-BOM substitution and its movement carries
 * `qtyPerUnit: null`, which is the marker the movement's `qtyPerUnit` column exists
 * to make visible instead of silent.
 */
const componentOverride = z.object({
  partId: z.string().min(1),
  /** Units consumed by the WHOLE run, not per produced unit. */
  quantityConsumed: z.number().finite().nonnegative().max(1_000_000),
})

/**
 * The backfill's window and how it batches (plans/money/tasks/44 sections 7.0-7.3).
 *
 * `as const satisfies` rather than a bare `z.enum`: the vocabularies live in
 * `backfill-types.ts`, and a member renamed there has to break this file rather
 * than silently narrow what the browser is allowed to ask for.
 */
const BACKFILL_GROUPING_VALUES = [
  'order',
  'day',
  'week',
  'month',
  'range',
] as const satisfies readonly BackfillGrouping[]

const BACKFILL_STATUS_VALUES = ['planned', 'completed'] as const satisfies readonly BackfillStatus[]

const backfillShape = {
  /** Inclusive first day on `order_placed_at`, `YYYY-MM-DD` in the book time zone. */
  from: calendarDaySchema,
  /** Exclusive last day, `YYYY-MM-DD`. Bounded above by the build cutoff (section 7.0). */
  to: calendarDaySchema,
  grouping: z.enum(BACKFILL_GROUPING_VALUES),
  /**
   * What the run would land in. Section 7.3.
   *
   * On the PREVIEW it is not merely decoration: `completed` is what turns the
   * preflight on, and it is what makes this preview disclose the standard costs
   * a completion would freeze — which is why it also raises the gate.
   */
  status: z.enum(BACKFILL_STATUS_VALUES),
}

/** Inclusive book-zone days; the UI sends neither and the server resolves them (plans/mrp/17 D1). */
const backflushShape = {
  from: calendarDaySchema.optional(),
  to: calendarDaySchema.optional(),
}

/** The two quantities and the overrides — everything that prices a run. */
const completionShape = {
  quantityProduced: runQuantity,
  /**
   * Units started and lost (B7). They consume material and produce NO movement:
   * their whole standard cost lands in `varianceAmount` -> account 5090.
   */
  quantityScrapped: z.number().finite().nonnegative().max(1_000_000).optional(),
  componentOverrides: z.array(componentOverride).max(500).optional(),
}

/**
 * Builds — phase 1's standard cost and phase 2's build event
 * (plans/products/build/01-build-plan.md).
 *
 * **Every procedure here is the permission gate for the lib call underneath.**
 * `@auxx/lib/inventory/builds` contains no access checks by design, so if a gate is
 * missing here it is missing everywhere. A build is a table row, not a record, so its
 * gates are the MRP area's (plans/mrp/23 §4 Web); cost operations stay on the `part`:
 *
 * | procedure                              | gate                                      |
 * | -------------------------------------- | ----------------------------------------- |
 * | `previewRoll`, `roll`, `setStandardCost(s)`, `confirmStandardCosts`, `canRestateStandardCost`, `confirmKindConflicts` | edit on `part` |
 * | `standardCostWorklist`, `kindConflicts`, `kindConflictFacts`, `movementAccountDrift` | view on `part` |
 * | `list`, `get`, `getBatchRun`           | `mrp.view`                                |
 * | every other procedure (create, start, cancel, complete, reverse, notes, `amendQuantity`, backfill, backflush and its undo, `fixMovementAccounts`) | `mrp.manage` |
 *
 * Previews (`previewCompletion`, `previewBackfill`, `previewBackflush`) are gated as the
 * write they are the first half of: they disclose the standard costs that write freezes.
 *
 * Lib returns neverthrow `Result`s carrying `AuxxError`s; those are rethrown
 * as-is so `auxxErrorMiddleware` maps them. Wrapping one in a `TRPCError` would
 * flatten the 422 an unpriced component produces into a 500.
 */
export const buildsRouter = createTRPCRouter({
  /**
   * What a roll WOULD do to the balance sheet.
   *
   * 🛑 **This is the point of the whole action** (section 2.4). A roll restates
   * inventory value, so it must never be a button that just fires: this returns
   * the revaluation delta per part and summed, plus the parts that cannot be
   * valued at all, before anything is committed.
   *
   * A `.query()` because it writes nothing — not even the `part_cost` refresh
   * the roll performs. In practice `part_cost` is already current;
   * `recalculateAffectedParts` rewrites it on every vendor-price and
   * bill-of-materials change.
   */
  previewRoll: capabilityProcedure.input(rollInput).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'part'))

    const result = await previewStandardCostRoll(ctx.db, organizationId, {
      partIds: input.partIds,
      effectiveAt: input.day ? await instantForBookDay(organizationId, input.day) : new Date(),
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Freeze a new standard cost onto every part in scope, and post what that
   * does to the balance sheet.
   *
   * The revaluation delta lands as one `inventory_movement` entry of kind
   * `revalue` over cost-only movements — quantity 0, so nothing here touches a
   * count or an existing movement: a mid-period standard change
   * revalues on-hand inventory, it never restates history (73 §6.2 rule 2).
   */
  roll: capabilityProcedure.input(rollInput).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'part'))

    const result = await rollStandardCost(ctx.db, organizationId, userId, {
      partIds: input.partIds,
      effectiveAt: input.day ? await instantForBookDay(organizationId, input.day) : new Date(),
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * A typed unit cost for one part (106 §5, D-SC2a): a first standard, or a restate that revalues
   * a moved part. A part with a BOM needs `overrideBom` (D-SC3).
   */
  setStandardCost: capabilityProcedure
    .input(
      z.object({
        partId: z.string().min(1),
        unitCost: unitCostInput,
        overrideBom: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'part'))

      const result = await setStandardCost(ctx.db, organizationId, input, { userId })
      if (result.isErr()) throw result.error
      return { partId: input.partId, ...result.value }
    }),

  /**
   * The Set costs grid's save (106 §6.2): an optional kind per row first, then every cost through
   * `setStandardCost`'s rules. One outcome per distinct part; one bad row fails only itself.
   */
  setStandardCosts: capabilityProcedure
    .input(z.object({ items: z.array(standardCostItem).min(1).max(500) }))
    .mutation(async ({ ctx, input }): Promise<SetStandardCostItemResult[]> => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'part'))

      const failed = new Map<string, string>()
      const byKind = new Map<string, string[]>()
      for (const item of input.items) {
        if (!item.kind) continue
        byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item.partId])
      }
      for (const [kind, partIds] of byKind) {
        const written = await bulkSetPartKind(ctx.db, organizationId, userId, partIds, kind)
        if (written.isErr()) {
          for (const partId of partIds) failed.set(partId, written.error.message)
          continue
        }
        for (const skip of written.value.failed) failed.set(skip.partId, skip.detail)
      }

      // A service carries no standard, so its row is done once the kind lands.
      const costItems = input.items.filter(
        (item) => !failed.has(item.partId) && item.kind !== 'service'
      )
      const costs = await setStandardCosts(ctx.db, organizationId, costItems, { userId })
      if (costs.isErr()) throw costs.error
      const outcomes = new Map(costs.value.map((outcome) => [outcome.partId, outcome]))

      const toConfirm = costItems.flatMap((item) =>
        item.confirmAs && outcomes.get(item.partId)?.ok
          ? [{ partId: item.partId, origin: item.confirmAs }]
          : []
      )
      if (toConfirm.length > 0) {
        const confirmed = await confirmStandardCosts(ctx.db, organizationId, toConfirm)
        if (confirmed.isErr()) throw confirmed.error
      }

      const seen = new Set<string>()
      const results: SetStandardCostItemResult[] = []
      for (const item of input.items) {
        if (seen.has(item.partId)) continue
        seen.add(item.partId)
        const kindError = failed.get(item.partId)
        const outcome = outcomes.get(item.partId)
        if (kindError) results.push({ partId: item.partId, ok: false, error: kindError })
        else if (!outcome) results.push({ partId: item.partId, ok: true })
        else if (outcome.ok) {
          results.push({
            partId: item.partId,
            ok: true,
            action: outcome.action,
            revaluationPostedMinor: outcome.revaluationPostedMinor,
          })
        } else results.push({ partId: item.partId, ok: false, error: outcome.error.message })
      }
      return results
    }),

  /** Mark existing standards confirmed without changing the amount (plans/mrp/22 §3.3). */
  confirmStandardCosts: capabilityProcedure
    .input(z.object({ partIds: z.array(z.string().min(1)).min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'part'))

      const result = await confirmStandardCosts(
        ctx.db,
        organizationId,
        input.partIds.map((partId) => ({ partId }))
      )
      if (result.isErr()) throw result.error
      return { confirmed: result.value.length }
    }),

  /** Whether a provisional standard may still be restated: the part has no stock movement. */
  canRestateStandardCost: capabilityProcedure
    .input(z.object({ partId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'part'))

      const moved = await readMovedPartIds(ctx.db, organizationId, [input.partId])
      return { canRestate: !moved.has(input.partId) }
    }),

  /**
   * Set costs and Set counts rows (D-SC3/D-SC4): every stocked part, or the named ones plus the
   * uncosted leaves under their BOMs. View on `part`: these are the part's own field values.
   */
  standardCostWorklist: capabilityProcedure
    .input(z.object({ partIds: z.array(z.string().min(1)).max(5000).optional() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'part'))

      const result = await readStandardCostWorklist(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  // ─── Kind conflicts (plans/mrp/17 D3/D4) ─────────────────────────────

  /** Parts whose kind disagrees with their BOM and was not confirmed; `partIds` narrows. */
  kindConflicts: capabilityProcedure
    .input(z.object({ partIds: z.array(z.string().min(1)).max(5000).optional() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'part'))

      const result = await readKindConflicts(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Whether each part sits inside a BOM or has one, for the confirm before saving a kind. */
  kindConflictFacts: capabilityProcedure
    .input(z.object({ partIds: z.array(z.string().min(1)).min(1).max(5000) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'part'))

      const result = await readKindConflictFacts(organizationId, input.partIds)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** "Sold as-is too, keep it": the current kind is intended. Same gate as the kind write. */
  confirmKindConflicts: capabilityProcedure
    .input(z.object({ partIds: z.array(z.string().min(1)).min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'part'))

      const result = await confirmKindConflicts(ctx.db, organizationId, userId, input.partIds)
      if (result.isErr()) throw result.error
      return result.value
    }),

  // ─── The build event (phase 2) ──────────────────────────────────────

  /**
   * Builds, newest first, paged by offset (`cursor`). The part, order and batch-run surfaces and
   * the build sheet's run list read this; there is no builds page.
   */
  list: permissionProcedure(PermissionKey.mrpView)
    .input(
      z.object({
        status: z.enum(BuildStatusValues).optional(),
        source: z.enum(BuildSourceValues).optional(),
        partId: z.string().min(1).optional(),
        orderId: z.string().min(1).optional(),
        batchRun: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.number().int().min(0).nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { cursor, ...filters } = input
      const limit = filters.limit ?? 50
      const offset = cursor ?? 0
      const result = await listBuilds(ctx.db, ctx.session.organizationId, {
        ...filters,
        limit,
        offset,
      })
      if (result.isErr()) throw result.error
      // Two queries for the whole page, not one per build.
      const drift = await readBuildDrift(ctx.db, ctx.session.organizationId, result.value)
      const items = result.value.map((build) => ({
        ...build,
        drifted: drift.get(build.buildId)?.drifted ?? false,
      }))
      return { items, nextCursor: items.length === limit ? offset + limit : null }
    }),

  /**
   * Everything the build sheet shows, in one read: the build with its drift verdict, the part and
   * order names, the reversal link in both directions, and the consume/produce legs.
   *
   * `null` for a build that does not exist or belongs to another org, indistinguishably.
   * `drifted` (plans/products/13 Q4): on a `planned` order build it means the last convergence
   * could not finish; on a started, completed or manual build it is permanent by design.
   */
  get: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ buildId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const result = await getBuildDetail(ctx.db, organizationId, input.buildId)
      if (result.isErr()) throw result.error
      if (!result.value) return null
      const { build, drifted, reversedBy, reversalOf, movements } = result.value

      const names = await readEntityNames(ctx.db, organizationId, [
        build.partId,
        ...(build.orderId ? [build.orderId] : []),
        ...movements.map((movement) => movement.partId),
      ])

      return {
        ...build,
        drifted,
        partName: names[build.partId] ?? null,
        orderName: build.orderId ? (names[build.orderId] ?? null) : null,
        reversedBy: buildLink(reversedBy),
        reversalOf: buildLink(reversalOf),
        movements: movements
          .map((movement) => ({
            id: movement.id,
            partId: movement.partId,
            partName: names[movement.partId] ?? null,
            type: movement.type,
            quantity: movement.quantity,
            reason: movement.reason,
            reference: movement.reference,
            unitCostMinor: movement.unitCostMinor,
            extendedCostMinor: movement.extendedCostMinor,
            costBasis: movement.costBasis,
            effectiveAt: movement.effectiveAt,
          }))
          .sort(compareBuildLegs),
      }
    }),

  /** The one field a person edits on a build. Any status. */
  updateNotes: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object({ buildId: z.string().min(1), notes: z.string().max(2000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const notes = input.notes?.trim() ? input.notes : null
      const result = await updateBuildNotes(ctx.db, ctx.session.organizationId, {
        buildId: input.buildId,
        notes,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Change a `planned` build's quantity. On an order-raised build the next order change converges
   * it back to the order (plans/products/13 Q3); the sheet says so beside the field.
   */
  amendQuantity: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object({ buildId: z.string().min(1), quantityPlanned: runQuantity }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await amendPlannedBuildQuantity(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Raise a run. Always lands `planned`, and writes NO stock movements (B2).
   */
  create: permissionProcedure(PermissionKey.mrpManage)
    .input(
      z.object({
        partId: z.string().min(1),
        quantityPlanned: runQuantity,
        notes: z.string().max(2000).optional(),
        orderId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // 🛑 `source` is NOT accepted from the browser. It is the discriminator
      // that says whether a person raised this run or the order trigger did
      // (products/12 AB7), and a browser claiming `order` would make an
      // auto-build indistinguishable from a deliberate one. `createBuild`
      // defaults it to `manual`; the trigger passes `order` server-side.
      const result = await createBuild(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Move a `planned` run to `in_progress`. Writes no movements. */
  start: permissionProcedure(PermissionKey.mrpManage)
    .input(
      z.object({
        buildId: z.string().min(1),
        /** When work actually began, which is not when it was keyed. Defaults to now. */
        startedAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const result = await startBuild(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Abandon a run that has not been completed. Writes no movements.
   *
   * The correction for a run that never happened. A run that DID happen and was
   * wrong is corrected by `reverse`, never by cancelling — a completed build has
   * an append-only ledger behind it and cancelling would leave it standing.
   */
  cancel: permissionProcedure(PermissionKey.mrpManage)
    .input(
      z.object({
        buildId: z.string().min(1),
        reason: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const result = await cancelBuild(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * What a completion WOULD consume, at what cost, without consuming it.
   *
   * 🛑 **The completion form is this query.** `completeBuild` is irreversible
   * except by a reversing build (B6) and refuses a second attempt (B8), so it
   * must never be a button that just fires: this returns the priced component
   * lines the run will consume, the produced part's frozen standard, and every
   * part that has no standard at all — before anything is written.
   *
   * It re-runs on every override edit, so the numbers under the form are always
   * the numbers the write will freeze. The two absorption rates ride along
   * because the form has to PREFILL the labour and overhead defaults, and a
   * second round trip for the part's two rates would leave the prefill arriving
   * after the person had already typed over it.
   *
   * A `.query()` because it writes nothing at all.
   */
  previewCompletion: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object({ partId: z.string().min(1), ...completionShape }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // The same per-part read `completeBuild` makes, so the previewed variance is the posted one.
      const [plan, rates] = await Promise.all([
        explodeBuildComponents(ctx.db, organizationId, input),
        loadPartAbsorptionRates(ctx.db, organizationId, input.partId),
      ])
      if (plan.isErr()) throw plan.error

      // What each consumed part has on hand RIGHT NOW, so a preview can say
      // `will take Feet Bracket to -3` (23 §3.4). `completeBuild` performs no
      // sufficiency check at all and deliberately still does not — receiving
      // keyed late is normal in a small shop, and a build refused on a stale
      // count is a worse failure than a negative a receipt corrects an hour
      // later. So this is a WARNING's input, never a gate's.
      const onHand = await readPartQuantitiesOnHand(
        ctx.db,
        organizationId,
        plan.value.components.map((line) => line.partId)
      )

      return { plan: plan.value, rates, onHand: Object.fromEntries(onHand) }
    }),

  /**
   * Raise, start and complete a run in one call — the part drawer's `Build now`
   * (plans/money/tasks/23-build-from-the-part.md §3.3).
   *
   * 🛑 **It is not atomic and the result says so.** A refused completion comes
   * back with `status: 'left_in_progress'` and the build that was raised, at a
   * 200 — not as an error. The caller MUST render that arm as a failure that
   * names and links the run, because "nothing happened" is what makes somebody
   * press the button a second time and raise a duplicate.
   */
  buildNow: permissionProcedure(PermissionKey.mrpManage)
    .input(
      z.object({
        partId: z.string().min(1),
        /** Good units produced. Both the planned and the produced quantity. */
        quantity: runQuantity,
        notes: z.string().max(2000).optional(),
        /** THE accounting date, stamped on the build and every movement. Defaults to now. */
        completedAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const result = await buildNow(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Finish a run and write the ledger — the ONE procedure here that writes a
   * stock movement.
   *
   * One `build_consume` per component at its frozen `part_standard_cost`, one
   * `build_produce` for the good units, and the five cost fields stamped onto
   * the build. It refuses outright if any component has no standard: a
   * zero-cost consume row understates COGS forever on an `updatable: false` row.
   *
   * `laborCost` / `overheadCost` are OPTIONAL and the browser may state them.
   * Omitted, the server absorbs `rate x unitsStarted` from the two
   * `manufacturing.*` settings. There is no other authority for what a specific
   * run absorbed, so the form is entitled to override the default — the same
   * call `adjustStock` makes about a unit cost nobody else can supply.
   */
  complete: permissionProcedure(PermissionKey.mrpManage)
    .input(
      z.object({
        buildId: z.string().min(1),
        ...completionShape,
        /** Absorbed direct labour for the WHOLE run, minor units. */
        laborCost: minorUnits.nonnegative().optional(),
        /** Applied overhead for the whole run, minor units. */
        overheadCost: minorUnits.nonnegative().optional(),
        /** THE accounting day, stamped on the build and every movement. Defaults to now. */
        day: calendarDaySchema.optional(),
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const { day, ...rest } = input
      const completedAt = day ? await instantForBookDay(organizationId, day) : undefined
      const result = await completeBuild(ctx.db, organizationId, userId, { ...rest, completedAt })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Undo a completed build by writing its negation (B6).
   *
   * Not an edit and not a delete. A completed build is never edited: every
   * `StockMovement` row is append-only on purpose, so a correction is
   * a second build whose movements carry the ORIGINAL's frozen costs. Re-pricing
   * a reversal at today's standard nets a build and its undo to a non-zero
   * amount of inventory value out of nothing.
   */
  reverse: permissionProcedure(PermissionKey.mrpManage)
    .input(
      z.object({
        buildId: z.string().min(1),
        /** Why it is being undone. Stamped on the reversing build; the original is never touched. */
        reason: z.string().max(2000).optional(),
        /** The reversal's accounting date. Defaults to now. */
        occurredAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const result = await reverseBuild(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  // ─── The backfill (plans/money/tasks/44 §7) ─────────────────────────

  /**
   * What the backfill WOULD create over a range, netted per part.
   *
   * 🛑 **The only read in this subsystem that is an AGGREGATE** (§7.1). Every
   * other read in `builds/` answers for one order; this one answers *"what has
   * been ordered and not yet built"* across a window, which is the whole content
   * of the preview screen. Rows are `(part, period)` and an order is never a row
   * — an order with two parts can carry a build for one and not the other, so it
   * is neither covered nor uncovered as a whole.
   *
   * **It returns a REFUSAL rather than throwing on a bad range**, and that is
   * deliberate. §7.0 says the dialog must refuse a `to` past the build cutoff
   * *and say why* rather than clamp silently — but the dialog cannot bound its
   * own date picker without knowing the cutoff, and a thrown error carries a
   * sentence, not a date. So the cutoff rides on every response, a refused range
   * comes back with `plan: null` and the reason, and the write door
   * ({@link runBackfill}) throws on exactly the same conditions. The refusal is
   * real; it is just legible.
   */
  previewBackfill: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object(backfillShape))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // ⚠️ `enabledAt`, not `enabled`. The bound exists because the reconciler is
      // live ABOVE the cutoff (§7.0); a null stamp means no order has ever
      // qualified for a live raise, so there is nothing for a batch build to
      // collide with and the range is unbounded above.
      const [{ enabledAt: cutoff }, timeZone] = await Promise.all([
        loadAutoBuildSettings(organizationId),
        readBookTimeZone(organizationId),
      ])
      const range = resolveBackfillRange(input, timeZone)
      // The cutoff as a book-zone day, so the dialog can offer it as the exclusive `to`.
      const cutoffDay = cutoff ? dayKeyInZone(cutoff, timeZone ?? 'UTC') : null
      const refusal = refuseBackfillRange(range, cutoff, timeZone)
      if (refusal) {
        return { cutoff, cutoffDay, refusal, plan: null, partNames: {}, preflight: null }
      }

      const plan = await buildBackfillPlan(ctx.db, organizationId, range, timeZone)

      // The contract carries part IDS; a screen somebody has to judge carries
      // part NAMES. Resolved here rather than in the plan because the plan is
      // the thing the writer executes, and a display name has no business in it.
      const [partNames, preflightResult] = await Promise.all([
        readEntityNames(ctx.db, organizationId, [
          ...plan.parts.map((part: BackfillPartPlan) => part.partId),
          ...plan.excluded.map((exclusion: BackfillExclusion) => exclusion.partId),
        ]),
        input.status === 'completed'
          ? computeBackfillPreflight(ctx.db, organizationId, plan)
          : Promise.resolve(null),
      ])

      // The preflight fails as a whole rather than per part: it writes nothing,
      // and one silently omitted part would under-report the consent it exists
      // to obtain (44 §7.3).
      let preflight: BackfillPreflight | null = null
      if (preflightResult) {
        if (preflightResult.isErr()) throw preflightResult.error
        preflight = preflightResult.value
      }

      return { cutoff, cutoffDay, refusal: null, plan, partNames, preflight }
    }),

  /**
   * Create the builds the preview showed.
   *
   * 🛑 **Not atomic, and the summary says so** (§7.4). `buildNow` reports a
   * refused completion as the `left_in_progress` RESULT rather than an error,
   * carrying the build it already raised, so the run records those and keeps
   * going. A run that aborted on the first refusal would tell somebody "failed"
   * about builds that exist, and they would press the button again.
   */
  runBackfill: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object(backfillShape))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const [{ enabledAt: cutoff }, timeZone] = await Promise.all([
        loadAutoBuildSettings(organizationId),
        readBookTimeZone(organizationId),
      ])
      // The write door throws where the preview merely explains. Both run the
      // same predicate, so the button the dialog disables and the call the
      // server refuses can never disagree.
      const range = resolveBackfillRange(input, timeZone)
      const refusal = refuseBackfillRange(range, cutoff, timeZone)
      if (refusal) throw new BadRequestError(refusal)

      // 🛑 Re-planned server-side rather than taken from the browser. The plan
      // is what `executeBackfill` writes, and a client-supplied one would let a
      // stale preview (or a crafted payload) name quantities and periods that no
      // read ever produced.
      const plan = await buildBackfillPlan(ctx.db, organizationId, range, timeZone)

      const result = await executeBackfill(ctx.db, organizationId, userId, plan, {
        from: range.from,
        to: range.to,
        grouping: input.grouping,
        status: input.status,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  // ─── Backflush (111 D23/D24) ────────────────────────────────────────

  /**
   * The builds a backflush over a range would write, per part and day — the D24 confirm.
   */
  previewBackflush: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object(backflushShape))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // The UI sends no range; that preview is cached per org (plans/mrp/17 D1).
      if (!input.from && !input.to) return getOrgCache().get(organizationId, 'backflushPreview')
      const result = await previewBackflush(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return summarizeBackflushPlan(result.value)
    }),

  /**
   * Start a sliced backflush run on the worker (plans/mrp/11); 409 while one is running, 422 while
   * a kind conflict is left. The same walk the preview showed, re-planned as each slice runs.
   */
  runBackflush: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object(backflushShape))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      return enqueueBackflushRun(organizationId, input, userId)
    }),

  /** One backflush run, or the org's latest; `null` when there is none. */
  getBackflushRun: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object({ runId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const row = await readBackflushRunRow(ctx.db, organizationId, input.runId)
      return row ? toBackflushRun(row) : null
    }),

  // ─── The batch run (plans/money/tasks/45 §4, §11) ───────────────────

  /**
   * One batch run's members, counted by status: what lets the build sheet's Undo button state its
   * blast radius before it is pressed (45 §11). A run is not a record (45 §3.1).
   */
  getBatchRun: permissionProcedure(PermissionKey.mrpView)
    .input(z.object({ runNumber: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const result = await readBatchRun(ctx.db, organizationId, input.runNumber)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Undo past builds on the worker (plans/mrp/17 §8): every backflush batch run, or `runNumber`
   * alone (the drawer card). Planned builds are cancelled, completed ones reversed, dated today;
   * nothing is deleted. 409 while a backflush or undo run is live for the org.
   */
  startUndoBackflush: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object({ runNumber: z.number().int().positive().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      return enqueueUndoBackflushRun(organizationId, userId, input?.runNumber)
    }),

  /** One undo run, or the org's latest; `null` when there is none. */
  getUndoBackflushRun: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object({ runId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const row = await readUndoBackflushRunRow(ctx.db, organizationId, input.runId)
      return row ? toUndoBackflushRun(row) : null
    }),

  /** Whether any backflush build still stands, so "Undo past builds" has something to undo. */
  hasBackflushBuilds: permissionProcedure(PermissionKey.mrpManage).query(({ ctx }) =>
    hasStandingBackflushBuilds(ctx.db, ctx.session.organizationId)
  ),

  /** Parts whose movements carry an account their current kind no longer maps to (17 §5.2). */
  movementAccountDrift: capabilityProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'part'))

    const result = await readMovementAccountDrift(ctx.db, organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Restamp unposted drifted movements and post one correcting entry per part for posted ones.
   */
  fixMovementAccounts: permissionProcedure(PermissionKey.mrpManage)
    .input(z.object({ partIds: z.array(z.string().min(1)).max(5000).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const result = await fixMovementAccounts(ctx.db, organizationId, userId, {
        partIds: input?.partIds,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),
})

/**
 * Read what the plan is decided from, then decide it.
 *
 * The split is `reconcile-policy.ts` / `reconcile-order-builds.ts`'s: the reads
 * come back as data and the decision is pure, so the painful cases (a monthly
 * build viewed by week, on hand spread across eight buckets) are unit tests
 * rather than browser clicks. `grouping` and `timeZone` are the caller's — one
 * is a dialog choice, the other an org setting, and neither is a read.
 */
async function buildBackfillPlan(
  db: Database,
  organizationId: string,
  input: { from: Date; to: Date; grouping: BackfillGrouping },
  timeZone: string | null
): Promise<BackfillPlan> {
  const reads = await readBackfillPlanReads(db, organizationId, {
    from: input.from,
    to: input.to,
  })
  if (reads.isErr()) throw reads.error
  return planBackfill({ ...reads.value, grouping: input.grouping, timeZone: timeZone ?? 'UTC' })
}

/**
 * `accounting.bookTimeZone`, or `null` when the org has not set one.
 *
 * ⚠️ The catalog says this setting fails CLOSED, and it does — for posting. It
 * cannot fail closed here without contradicting §11.1, which puts the preview
 * and the `planned` write in phases 1-3, explicitly *"blocked by nothing"* in
 * the cutover chain: an org that has not begun the chain has no book timezone
 * and would be unable to open this dialog at all. So the preview and a
 * `planned` run fall back to UTC, and a `completed` run — the one that dates a
 * ledger — is refused outright when the zone is unset
 * ({@link refuseBackfillRange}). Nothing is silently posted into the wrong
 * month, because nothing is posted.
 */
async function readBookTimeZone(organizationId: string): Promise<string | null> {
  const value = await getOrganizationSetting({
    organizationId,
    key: 'accounting.bookTimeZone',
  })
  // Deliberately `null` rather than `'UTC'`: an org whose books genuinely ARE
  // kept in UTC has SET the zone, and collapsing the two would refuse it a
  // completed backfill it is entitled to.
  return typeof value === 'string' && value.trim() ? value : null
}

interface ResolvedBackfillRange {
  fromDay: string
  toDay: string
  from: Date
  to: Date
  grouping: BackfillGrouping
  status: BackfillStatus
}

/** The picked days as instants at the start of each day in the book zone (UTC when unset). */
function resolveBackfillRange(
  input: { from: string; to: string; grouping: BackfillGrouping; status: BackfillStatus },
  timeZone: string | null
): ResolvedBackfillRange {
  const zone = timeZone ?? 'UTC'
  return {
    ...input,
    fromDay: input.from,
    toDay: input.to,
    from: startOfDayInstant(input.from, zone),
    to: startOfDayInstant(input.to, zone),
  }
}

/**
 * Why this range cannot be backfilled, or `null` when it can.
 *
 * One predicate, run by both the preview and the write, so the reason the dialog
 * prints is literally the reason the server would give.
 */
function refuseBackfillRange(
  input: ResolvedBackfillRange,
  cutoff: Date | null,
  timeZone: string | null
): string | null {
  if (!(input.fromDay < input.toDay)) {
    return 'The from date has to be before the to date.'
  }

  // §7.0. A batch build is only safe BELOW the cutoff: above it the reconciler
  // is live and a batch build does not suppress a raise, so any order up there
  // that later moves would get a per-order build stacked on the batch one.
  if (cutoff && input.to.getTime() > cutoff.getTime()) {
    return `This range ends after the build cutoff of ${dayKeyInZone(cutoff, timeZone ?? 'UTC')}. Above the cutoff builds are raised per order, so a batch build there would end up stacked on top of a live one. Move the to date back to the cutoff or earlier.`
  }

  if (input.status === 'completed') {
    // The one place `accounting.bookTimeZone` still fails closed, as its catalog
    // entry demands: a completed build carries the date that decides which
    // month-end entry reflects it, and deriving that date in an assumed UTC is
    // exactly the silent misstatement the setting exists to prevent.
    if (!timeZone) {
      return 'Set the book timezone in accounting settings before creating completed builds. A completed build carries the date that decides which month it closes in, and that date cannot be derived without it.'
    }

    // §7.3 gate 1. Completing future demand is meaningless.
    if (input.to.getTime() > Date.now()) {
      return 'A completed backfill dates the ledger, so its range cannot reach into the future. Move the to date back to today, or create the builds as planned.'
    }

    // §7.3 / the contract on `BackfillGrouping`. `build_completed_at` decides
    // which month-end entry reflects a build, so one build for a range spanning
    // several months misstates every month it spans.
    if (input.grouping === 'range' && spansSeveralMonths(input.fromDay, input.toDay)) {
      return 'One build for the whole range would date every unit to a single month, and this range spans more than one. Group by month or finer, or create the builds as planned.'
    }
  }

  return null
}

/** Does `[from, to)` cross a calendar month boundary? Day keys; `to` is exclusive. */
function spansSeveralMonths(from: string, to: string): boolean {
  return from.slice(0, 7) !== previousDayKey(to).slice(0, 7)
}

/**
 * `EntityInstance.displayName` for a set of ids, as a plain record.
 *
 * A record rather than a `Map` because it crosses the tRPC boundary — superjson
 * would carry a `Map`, but every consumer here is a lookup in JSX.
 */
async function readEntityNames(
  db: Database,
  organizationId: string,
  ids: string[]
): Promise<Record<string, string | null>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return {}

  const rows = await db
    .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(
      and(
        inArray(schema.EntityInstance.id, unique),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  const names: Record<string, string | null> = {}
  for (const row of rows) names[row.id] = row.displayName
  return names
}

/** A build as the other end of a reversal link. */
function buildLink(build: BuildRecord | null): { buildId: string; number: string } | null {
  return build ? { buildId: build.buildId, number: build.number } : null
}

/**
 * Resolve an entity definition id from the org cache, or refuse.
 *
 * A missing def is a 404 rather than a 403: the member is not being denied
 * anything, the organization simply has no such records yet (entity migration
 * 109 has not run for it).
 */
async function requireDefId(organizationId: string, entityType: string): Promise<string> {
  const defId = await getCachedEntityDefId(organizationId, entityType)
  if (!defId) {
    throw new NotFoundError(`This organization has no ${entityType} records yet.`)
  }
  return defId
}

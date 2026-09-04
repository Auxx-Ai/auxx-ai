// apps/web/src/server/api/routers/builds.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import {
  buildNow,
  cancelBuild,
  completeBuild,
  createBuild,
  executeBackfill,
  explodeBuildComponents,
  getBuild,
  listBuilds,
  loadAutoBuildSettings,
  loadEffectiveAbsorptionRates,
  planBackfill,
  previewStandardCostRoll,
  readBackfillPlanReads,
  readBuildDrift,
  readPartQuantitiesOnHand,
  reverseBuild,
  rollStandardCost,
  startBuild,
} from '@auxx/lib/builds'
import type {
  BackfillExclusion,
  BackfillGrouping,
  BackfillPartPlan,
  BackfillPlan,
  BackfillStatus,
} from '@auxx/lib/builds/client'
import { getCachedEntityDefId } from '@auxx/lib/cache'
import { BadRequestError, NotFoundError } from '@auxx/lib/errors'
import { getOrganizationSetting } from '@auxx/lib/settings'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'

/**
 * A roll may be scoped to a handful of parts, or run across the org.
 *
 * The cap is generous rather than meaningful — the widening step adds every
 * ancestor anyway, and an unscoped roll covers everything. It exists only so a
 * malformed client cannot send an unbounded array.
 */
const rollInput = z.object({
  partIds: z.array(z.string().min(1)).max(500).optional(),
  /** When the new standards take effect. Defaults to now. */
  effectiveAt: z.coerce.date().optional(),
})

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
 * `qtyPerUnit: null`, which is the marker `stock_movement_qty_per_unit` exists
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
  /** Inclusive lower bound on `order_placed_at`. */
  from: z.coerce.date(),
  /** Exclusive upper bound. Bounded above by the build cutoff (section 7.0). */
  to: z.coerce.date(),
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
 * `@auxx/lib/builds` contains no access checks by design — its module headers
 * say so explicitly — so if a gate is missing here it is missing everywhere.
 * The authority is per-definition, resolved from the org cache and asserted
 * against the request's `CapabilitySet`:
 *
 * | procedure                              | gate                                      |
 * | -------------------------------------- | ----------------------------------------- |
 * | `previewRoll`, `roll`                  | edit on `part`                            |
 * | `list`, `get`                          | view on `build`                           |
 * | `create`, `start`, `cancel`            | edit on `build`                           |
 * | `previewCompletion`, `complete`, `reverse`, `buildNow` | edit on `build` AND edit on `stock_movement` |
 *
 * Three notes on why those, and not something coarser:
 *
 * 1. **`assertEditEntity`, never the coarser `assertWriteEntity`.** It is the
 *    server mirror of the `canEditEntity(defId)` the cards run to decide whether
 *    to render a button, so the button the UI hides and the door the server
 *    closes are the same door.
 * 2. **`complete` and `reverse` assert BOTH.** They are the only two paths in
 *    this router that write a `stock_movement`, and `stock_movement` is where
 *    the rest of manufacturing puts that authority — `purchasing.receiveStock`,
 *    `adjustStock` and `reverseMovement` all gate on exactly that def. A person
 *    who may raise a build but may not move stock must not be able to post a
 *    ledger entry through the completion form, and gating on `build` alone would
 *    let them.
 * 3. **`previewCompletion` is gated as the write, not as a read.** Same argument
 *    as `previewRoll`: the preview exists solely to be the first half of a
 *    write, it discloses the standard costs that write will freeze, and a reader
 *    who cannot complete has no use for it.
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
      effectiveAt: input.effectiveAt ?? new Date(),
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Freeze a new standard cost onto every part in scope.
   *
   * The revaluation delta comes back on the result and is **not posted** — GL
   * posting is out of scope for this directory (README B9). Nothing here
   * touches an existing `stock_movement`: a mid-period standard change revalues
   * on-hand inventory, it never restates history.
   */
  roll: capabilityProcedure.input(rollInput).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'part'))

    const result = await rollStandardCost(ctx.db, organizationId, userId, {
      partIds: input.partIds,
      effectiveAt: input.effectiveAt ?? new Date(),
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  // ─── The build event (phase 2) ──────────────────────────────────────

  /**
   * Builds, newest first, with every cost already resolved.
   *
   * The generic record list is what the `/app/builds` page renders; this exists
   * for the surfaces that need a build's NUMBERS rather than its field values —
   * a part's builds, an order's builds, the run card's sibling lookups — without
   * one field-value read per row.
   */
  list: capabilityProcedure
    .input(
      z.object({
        status: z.enum(['planned', 'in_progress', 'completed', 'canceled']).optional(),
        partId: z.string().min(1).optional(),
        orderId: z.string().min(1).optional(),
        source: z.enum(['manual', 'order']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'build'))

      const result = await listBuilds(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * One build, fully priced, with its drift verdict.
   *
   * `null` for a build that does not exist, is archived, or belongs to another
   * org — the same three cases, deliberately indistinguishable, so this cannot
   * be used to probe for ids.
   *
   * `drifted` answers plans/products/13 Q4 — *"how is drift surfaced on a build
   * that cannot be reconciled"*. It rides along rather than being its own
   * procedure because `readBuildDrift` takes RECORDS, deliberately: *"every
   * caller that wants drift is already listing builds, and re-reading them here
   * would be the composed-read problem"*. A second procedure would re-read this
   * very build to answer one boolean.
   *
   * ⚠️ Since Model B shipped, a `planned` order-raised build is converged
   * automatically, so drift on one is transient — it means the last convergence
   * could not finish. Persistent drift lives on the builds convergence may not
   * touch: `in_progress`, `completed`, and `manual`. That is exactly the set Q4
   * was asked about.
   */
  get: capabilityProcedure
    .input(z.object({ buildId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'build'))

      const result = await getBuild(ctx.db, organizationId, input.buildId)
      if (result.isErr()) throw result.error
      const build = result.value
      if (!build) return null

      const drift = await readBuildDrift(ctx.db, organizationId, [build])
      return { ...build, drifted: drift.get(build.buildId)?.drifted ?? false }
    }),

  /**
   * Raise a run. Always lands `planned`, and writes NO stock movements (B2).
   *
   * Gated on `build` alone, not on `stock_movement`: that is the whole point of
   * B2 — planning a run is not moving stock, so planning must not require the
   * authority to move it.
   */
  create: capabilityProcedure
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
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'build'))

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
  start: capabilityProcedure
    .input(
      z.object({
        buildId: z.string().min(1),
        /** When work actually began, which is not when it was keyed. Defaults to now. */
        startedAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'build'))

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
  cancel: capabilityProcedure
    .input(
      z.object({
        buildId: z.string().min(1),
        reason: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'build'))

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
   * second round trip for two org settings would leave the prefill arriving
   * after the person had already typed over it.
   *
   * A `.query()` because it writes nothing at all.
   */
  previewCompletion: capabilityProcedure
    .input(z.object({ partId: z.string().min(1), ...completionShape }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await assertCanPostBuildLedger(ctx)

      // 🛑 The EFFECTIVE rates, not the bare org ones. The dialog previews the
      // variance this run will post, and `completeBuild` resolves the produced
      // part's own absorption overrides before it writes — a preview built from
      // the org rate would disagree with the write on exactly the parts that
      // carry an override.
      const [plan, rates] = await Promise.all([
        explodeBuildComponents(ctx.db, organizationId, input),
        loadEffectiveAbsorptionRates(ctx.db, organizationId, input.partId),
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
   * Gated exactly as `complete` is, because it ends in a completion.
   *
   * 🛑 **It is not atomic and the result says so.** A refused completion comes
   * back with `status: 'left_in_progress'` and the build that was raised, at a
   * 200 — not as an error. The caller MUST render that arm as a failure that
   * names and links the run, because "nothing happened" is what makes somebody
   * press the button a second time and raise a duplicate.
   */
  buildNow: capabilityProcedure
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
      await assertCanPostBuildLedger(ctx)

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
  complete: capabilityProcedure
    .input(
      z.object({
        buildId: z.string().min(1),
        ...completionShape,
        /** Absorbed direct labour for the WHOLE run, minor units. */
        laborCost: minorUnits.nonnegative().optional(),
        /** Applied overhead for the whole run, minor units. */
        overheadCost: minorUnits.nonnegative().optional(),
        /** THE accounting date, stamped on the build and every movement. Defaults to now. */
        completedAt: z.coerce.date().optional(),
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await assertCanPostBuildLedger(ctx)

      const result = await completeBuild(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Undo a completed build by writing its negation (B6).
   *
   * Not an edit and not a delete. A completed build is never edited: every
   * `stock_movement` field is `updatable: false` on purpose, so a correction is
   * a second build whose movements carry the ORIGINAL's frozen costs. Re-pricing
   * a reversal at today's standard nets a build and its undo to a non-zero
   * amount of inventory value out of nothing.
   *
   * 🛑 **The reversing build is written on the quiet lane, so it emits no
   * `record:created` frame** and no open list learns about it on its own. The
   * caller invalidates — see `build-run-card.tsx`.
   */
  reverse: capabilityProcedure
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
      await assertCanPostBuildLedger(ctx)

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
   *
   * Gated as a write, not as a read, on the same argument `previewRoll` and
   * `previewCompletion` make: the preview exists solely to be the first half of
   * a write, and a reader who cannot raise a build has no use for it. When
   * `status` is `completed` it also discloses the standard costs the run would
   * freeze, so it takes the full ledger gate.
   */
  previewBackfill: capabilityProcedure
    .input(z.object(backfillShape))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await assertCanRunBackfill(ctx, input.status)

      // ⚠️ `enabledAt`, not `enabled`. The bound exists because the reconciler is
      // live ABOVE the cutoff (§7.0); a null stamp means no order has ever
      // qualified for a live raise, so there is nothing for a batch build to
      // collide with and the range is unbounded above.
      const [{ enabledAt: cutoff }, timeZone] = await Promise.all([
        loadAutoBuildSettings(organizationId),
        readBookTimeZone(organizationId),
      ])
      const refusal = refuseBackfillRange(input, cutoff, timeZone)
      if (refusal) return { cutoff, refusal, plan: null, partNames: {}, preflight: null }

      const plan = await buildBackfillPlan(ctx.db, organizationId, input, timeZone)

      // The contract carries part IDS; a screen somebody has to judge carries
      // part NAMES. Resolved here rather than in the plan because the plan is
      // the thing the writer executes, and a display name has no business in it.
      const [partNames, preflight] = await Promise.all([
        readEntityNames(ctx.db, organizationId, [
          ...plan.parts.map((part: BackfillPartPlan) => part.partId),
          ...plan.excluded.map((exclusion: BackfillExclusion) => exclusion.partId),
        ]),
        input.status === 'completed'
          ? computeBackfillPreflight(ctx.db, organizationId, plan)
          : Promise.resolve(null),
      ])

      return { cutoff, refusal: null, plan, partNames, preflight }
    }),

  /**
   * Create the builds the preview showed.
   *
   * 🛑 **Not atomic, and the summary says so** (§7.4). `buildNow` reports a
   * refused completion as the `left_in_progress` RESULT rather than an error,
   * carrying the build it already raised, so the run records those and keeps
   * going. A run that aborted on the first refusal would tell somebody "failed"
   * about builds that exist, and they would press the button again.
   *
   * Same two gates as the preview, for the same reason — a `completed` backfill
   * is a stock movement by any other name.
   */
  runBackfill: capabilityProcedure
    .input(z.object(backfillShape))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await assertCanRunBackfill(ctx, input.status)

      const [{ enabledAt: cutoff }, timeZone] = await Promise.all([
        loadAutoBuildSettings(organizationId),
        readBookTimeZone(organizationId),
      ])
      // The write door throws where the preview merely explains. Both run the
      // same predicate, so the button the dialog disables and the call the
      // server refuses can never disagree.
      const refusal = refuseBackfillRange(input, cutoff, timeZone)
      if (refusal) throw new BadRequestError(refusal)

      // 🛑 Re-planned server-side rather than taken from the browser. The plan
      // is what `executeBackfill` writes, and a client-supplied one would let a
      // stale preview (or a crafted payload) name quantities and periods that no
      // read ever produced.
      const plan = await buildBackfillPlan(ctx.db, organizationId, input, timeZone)

      const result = await executeBackfill(ctx.db, organizationId, userId, plan, {
        from: input.from,
        to: input.to,
        grouping: input.grouping,
        status: input.status,
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

/**
 * What a `completed` backfill would write, checked before anything is written.
 *
 * §7.3 gates 2, 3 and 4: the consent for a completed run is *"N builds, M stock
 * movements, on an append-only ledger correctable only by reversing"*, and both
 * numbers have to be real. `completeBuild` also aborts per build when a
 * component has no `part_standard_cost`, and discovering that on build 400 of
 * 900 is the wrong time.
 */
interface BackfillPreflight {
  /** Builds the run would raise. */
  buildCount: number
  /** `build_consume` + `build_produce` rows those builds would append. */
  movementCount: number
  /** Parts with no standard cost, which `completeBuild` refuses outright. */
  unpricedParts: { partId: string; partName: string | null }[]
  /**
   * Where the run leaves each consumed component.
   *
   * ⚠️ A WARNING's input, never a gate's (§7.3 gate 4). Negative on hand is a
   * true statement about a ledger missing its receipts, and refusing would make
   * the backfill unusable on exactly the org that needs it most. The remedy is
   * opening stock, which is the person's call to make first.
   */
  projectedOnHand: {
    partId: string
    partName: string | null
    onHand: number
    consumed: number
    projected: number
  }[]
}

/**
 * Explode every part in the plan and total what the run would consume.
 *
 * Exploded once per part at its WHOLE range quantity rather than once per
 * bucket: component quantities are linear in the produced quantity, so the total
 * is identical and a twenty-part plan costs twenty round trips instead of
 * ninety-four.
 */
async function computeBackfillPreflight(
  db: Database,
  organizationId: string,
  plan: BackfillPlan
): Promise<BackfillPreflight> {
  const buildCount = plan.buildCount
  let movementCount = 0
  const unpriced = new Set<string>()
  const consumed = new Map<string, number>()

  const explosions = await Promise.all(
    plan.parts.map((part) =>
      explodeBuildComponents(db, organizationId, {
        partId: part.partId,
        quantityProduced: part.quantityToBuild,
      })
    )
  )

  for (const [index, explosion] of explosions.entries()) {
    const part = plan.parts[index]
    if (!part) continue
    if (explosion.isErr()) throw explosion.error
    const components = explosion.value.components
    // One `build_produce` per build, plus one `build_consume` per component per
    // build. The component set is the same for every bucket of a part.
    movementCount += part.buckets.length * (components.length + 1)
    for (const missing of explosion.value.missingStandardPartIds) unpriced.add(missing)
    for (const line of components) {
      consumed.set(line.partId, (consumed.get(line.partId) ?? 0) + line.quantityConsumed)
    }
  }

  const componentIds = [...consumed.keys()]
  const [onHand, names] = await Promise.all([
    readPartQuantitiesOnHand(db, organizationId, componentIds),
    readEntityNames(db, organizationId, [...componentIds, ...unpriced]),
  ])

  return {
    buildCount,
    movementCount,
    unpricedParts: [...unpriced].map((partId) => ({
      partId,
      partName: names[partId] ?? null,
    })),
    projectedOnHand: componentIds
      .map((partId) => {
        const available = onHand.get(partId) ?? 0
        const used = consumed.get(partId) ?? 0
        return {
          partId,
          partName: names[partId] ?? null,
          onHand: available,
          consumed: used,
          projected: available - used,
        }
      })
      // Worst first: the rows that matter are the ones the run drives negative.
      .sort((a, b) => a.projected - b.projected),
  }
}

/**
 * Why this range cannot be backfilled, or `null` when it can.
 *
 * One predicate, run by both the preview and the write, so the reason the dialog
 * prints is literally the reason the server would give.
 */
function refuseBackfillRange(
  input: { from: Date; to: Date; grouping: BackfillGrouping; status: BackfillStatus },
  cutoff: Date | null,
  timeZone: string | null
): string | null {
  if (!(input.from.getTime() < input.to.getTime())) {
    return 'The from date has to be before the to date.'
  }

  // §7.0. A batch build is only safe BELOW the cutoff: above it the reconciler
  // is live and a batch build does not suppress a raise, so any order up there
  // that later moves would get a per-order build stacked on the batch one.
  if (cutoff && input.to.getTime() > cutoff.getTime()) {
    return `This range ends after the build cutoff of ${cutoff.toISOString().slice(0, 10)}. Above the cutoff builds are raised per order, so a batch build there would end up stacked on top of a live one. Move the to date back to the cutoff or earlier.`
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
    //
    // ⚠️ Compared in UTC, while the writer buckets in the org's book timezone.
    // The two can disagree for a range that ends within hours of a month
    // boundary; this is a guard rail on an obviously multi-month range, not the
    // authority on where a period ends.
    if (input.grouping === 'range' && spansSeveralMonths(input.from, input.to)) {
      return 'One build for the whole range would date every unit to a single month, and this range spans more than one. Group by month or finer, or create the builds as planned.'
    }
  }

  return null
}

/** Does `[from, to)` cross a calendar month boundary? `to` is exclusive. */
function spansSeveralMonths(from: Date, to: Date): boolean {
  const last = new Date(to.getTime() - 1)
  return (
    from.getUTCFullYear() !== last.getUTCFullYear() || from.getUTCMonth() !== last.getUTCMonth()
  )
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

/**
 * The gate on both halves of the backfill.
 *
 * EDIT on `build` always, because builds are raised. Plus EDIT on
 * `stock_movement` when the run lands `completed`, because that is the arm that
 * appends consume and produce rows — the same split
 * {@link assertCanPostBuildLedger} makes for a single completion.
 */
async function assertCanRunBackfill(
  ctx: {
    session: { organizationId: string }
    capabilities: { assertEditEntity: (defId: string) => void }
  },
  status: BackfillStatus
): Promise<void> {
  if (status === 'completed') {
    await assertCanPostBuildLedger(ctx)
    return
  }
  ctx.capabilities.assertEditEntity(await requireDefId(ctx.session.organizationId, 'build'))
}

/**
 * The gate on every path that writes a build's ledger.
 *
 * Both halves, in one place so the three procedures cannot drift: EDIT on
 * `build` because the run's own status and cost fields are rewritten, and EDIT
 * on `stock_movement` because consume and produce rows are appended. The rest of
 * manufacturing puts movement authority on `stock_movement` — `receiveStock`,
 * `adjustStock` and `reverseMovement` all assert exactly that def — and a build
 * completion is a stock movement by any other name.
 */
async function assertCanPostBuildLedger(ctx: {
  session: { organizationId: string }
  capabilities: { assertEditEntity: (defId: string) => void }
}): Promise<void> {
  const { organizationId } = ctx.session
  const [buildDefId, movementDefId] = await Promise.all([
    requireDefId(organizationId, 'build'),
    requireDefId(organizationId, 'stock_movement'),
  ])
  ctx.capabilities.assertEditEntity(buildDefId)
  ctx.capabilities.assertEditEntity(movementDefId)
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

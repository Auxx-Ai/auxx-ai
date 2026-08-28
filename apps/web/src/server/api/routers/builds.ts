// apps/web/src/server/api/routers/builds.ts

import {
  cancelBuild,
  completeBuild,
  createBuild,
  explodeBuildComponents,
  getBuild,
  listBuilds,
  loadAbsorptionRates,
  previewStandardCostRoll,
  readBuildDrift,
  reverseBuild,
  rollStandardCost,
  startBuild,
} from '@auxx/lib/builds'
import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
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
 * | `previewCompletion`, `complete`, `reverse` | edit on `build` AND edit on `stock_movement` |
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

      const [plan, rates] = await Promise.all([
        explodeBuildComponents(ctx.db, organizationId, input),
        loadAbsorptionRates(organizationId),
      ])
      if (plan.isErr()) throw plan.error
      return { plan: plan.value, rates }
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
})

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

// packages/lib/src/builds/build-mutations.ts

/**
 * The three build writes that touch NO stock movement: raise a run, start it,
 * abandon it.
 *
 * plans/products/build/01-build-plan.md section 3.4.
 *
 * 🛑 **B2 is the safety property this whole file exists to state.** A `planned`
 * build writes no movements, and `completeBuild` — in its own file — is the only
 * function in this module that does. That is what let the `build` entity, its
 * UI and the order-triggered auto-build all ship and be used before
 * `part_standard_cost` had a writer: nothing here can produce a wrong number,
 * because nothing here produces a number at all.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md`
 * section 6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { loadDirectSubparts } from '../bom/subpart-graph'
import { getCachedEntityDefId } from '../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { BuildStatus } from '../resources/registry/enum-values'
import { type RecordId, toRecordId } from '../resources/resource-id'
import {
  assertBuildStatus,
  type BuildFieldContext,
  getBuild,
  readPartKinds,
  requireBuildFieldContext,
} from './build-queries'
import { canAmendBuild, canCancelBuild, canStartBuild, resolvePartKind } from './client'
import { guard } from './guard'
import type { BuildRecord, CancelBuildInput, CreateBuildInput, StartBuildInput } from './types'

const logger = createScopedLogger('builds:mutations')

/**
 * The exemption every sanctioned writer of `build_status` carries.
 *
 * `field-hooks/pre/build-status-guard.ts` refuses a manual write of `in_progress`,
 * `completed` or `canceled`, and `fireFieldPreHooks` short-circuits on
 * `ctx.bypassFieldGuards.has(systemAttribute)` before that handler runs.
 * `UnifiedCrudHandler` forwards this set to the `FieldValueService` it owns, so passing it at
 * construction is what lets these functions produce the values the wall exists to protect.
 *
 * 🛑 **Without it the guard refuses the actions it was built for** — Start, Complete and
 * Cancel simply stop working, which is the half-a-fix failure mode
 * (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §4).
 *
 * 🛑 **ONE element, asserted by a test.** `completeBuild` and `reverseBuild` write their stock
 * movements through the same handler and so inherit this set; naming a second attribute would
 * silently disarm a guard on the movement rows, and nothing would say so.
 */
export const BUILD_STATUS_BYPASS: ReadonlySet<SystemAttribute> = new Set<SystemAttribute>([
  'build_status',
])

/**
 * Raise a build. Always lands `planned`.
 *
 * The two validations are the ones a wrong answer to is expensive later:
 *
 * 1. **`part_kind` must be `finished_good` or `subassembly`.** A `component` is
 *    purchased, not assembled; a build against one would consume nothing and
 *    produce inventory value out of thin air. NULL reads as `component`
 *    ({@link resolvePartKind}), so an unclassified part is refused with a
 *    message that says so — classifying the built parts is a prerequisite of
 *    the first roll and of the first build alike.
 * 2. **At least one direct subpart.** A run with no bill of materials has
 *    nothing to consume, and completing it would write a lone `build_produce`
 *    row: inventory created from nothing, at a standard cost that no consumed
 *    material backs. Refusing here is the difference between a data problem
 *    somebody fixes and a balance sheet nobody can explain.
 *
 * 🛑 **Writes no movements.** Asserted by a test, because it is the property
 * every later phase leans on rather than a matter of what this happens to do.
 */
export async function createBuild(
  db: Database,
  organizationId: string,
  userId: string,
  input: CreateBuildInput
): Promise<Result<BuildRecord, Error>> {
  return guard(
    async () => {
      const ctx = await requireBuildFieldContext(organizationId)

      if (!Number.isFinite(input.quantityPlanned) || input.quantityPlanned <= 0) {
        throw new BadRequestError('A build must plan to produce at least one unit')
      }

      const partDefId = await requireDefId(organizationId, 'part')
      await assertPartExists(db, organizationId, partDefId, input.partId)

      const kinds = await readPartKinds(db, organizationId, [input.partId])
      const partKind = resolvePartKind(kinds.get(input.partId))
      if (partKind === 'component') {
        throw new UnprocessableEntityError(
          'Only a finished good or a subassembly can be built. Set the part kind first.'
        )
      }

      const subparts = await loadDirectSubparts(db, organizationId, input.partId)
      if (subparts.length === 0) {
        throw new UnprocessableEntityError(
          'This part has no bill of materials, so a build would consume nothing'
        )
      }

      const values: Record<string, unknown> = {
        build_part: toRecordId(partDefId, input.partId),
        build_status: BuildStatus.PLANNED,
        build_quantity_planned: input.quantityPlanned,
        build_source: input.source ?? 'manual',
      }
      if (input.notes) values.build_notes = input.notes
      if (input.orderId) {
        const orderDefId = await requireDefId(organizationId, 'order')
        values.build_order = toRecordId(orderDefId, input.orderId)

        // Stamp what the order asked production for AT THIS MOMENT
        // (plans/products/13 Model A+). Compared later against the order's own
        // `order_build_revision` to show that the order has changed since.
        //
        // 🛑 Only for a build the ORDER raised. A person who raises a build
        // against an order deliberately is not tracking it, and stamping them
        // would report drift for a build that never claimed to follow anything
        // — the same distinction `build_source` exists to make (12 AB7).
        //
        // Absent on failure rather than fatal: `hasDrifted` reads a missing
        // stamp as *unknown*, not *drifted*, so the worst case is a build that
        // cannot show drift — never a build that is not raised.
        //
        // `input.orderRevision` short-circuits the read and nothing else. The
        // convergence pass has already computed this exact fingerprint in order
        // to decide whether to raise anything at all, so re-deriving it here
        // would re-run `loadAutoBuildOrders` for one order per build raised.
        if ((input.source ?? 'manual') === 'order' && ctx.fields.build_order_revision) {
          const stamp =
            input.orderRevision ??
            (await readOrderDemandFingerprint(db, organizationId, input.orderId))
          if (stamp) values.build_order_revision = stamp
        }
      }

      // The DEFAULT (interactive) write session on purpose. Only the two paths
      // that write stock movements take the quiet lane (`write-lane.ts`); a
      // planned build writes nothing a record rule can act on, and silencing it
      // would cost the list its realtime update for no benefit.
      // `planned` is not in the guarded set, but the bypass is here anyway: the exemption
      // belongs to the sanctioned WRITER rather than to today's value set, so widening the
      // guard later cannot silently break the action that raises a build.
      const crud = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
        bypassFieldGuards: BUILD_STATUS_BYPASS,
      })
      const created = await crud.create(ctx.buildDefId, values)

      logger.info('Raised build', {
        organizationId,
        buildId: created.instance.id,
        partId: input.partId,
        quantityPlanned: input.quantityPlanned,
        source: values.build_source,
      })

      return requireBuild(db, organizationId, created.instance.id)
    },
    'Failed to create build',
    { organizationId, partId: input.partId }
  )
}

/**
 * Move a `planned` run to `in_progress` and stamp `startedAt`.
 *
 * Refused from any other status with a `ConflictError`: restarting a completed
 * run would leave a build whose movements were written under a status that says
 * they have not been.
 */
export async function startBuild(
  db: Database,
  organizationId: string,
  userId: string,
  input: StartBuildInput
): Promise<Result<BuildRecord, Error>> {
  return guard(
    async () => {
      const ctx = await requireBuildFieldContext(organizationId)
      const build = await requireBuild(db, organizationId, input.buildId)
      assertBuildStatus(build, canStartBuild, 'Only a planned build can be started')

      const startedAt = input.startedAt ?? new Date()
      const values: Record<string, unknown> = { build_status: BuildStatus.IN_PROGRESS }
      if (ctx.fields.build_started_at) values.build_started_at = startedAt.toISOString()

      await updateBuild(db, organizationId, userId, ctx, input.buildId, values)
      return requireBuild(db, organizationId, input.buildId)
    },
    'Failed to start build',
    { organizationId, buildId: input.buildId }
  )
}

/**
 * Abandon a run that has not been completed.
 *
 * 🛑 **Cancelling is the whole of the correction for an unposted run, and
 * reversal is the whole of it for a posted one** (B6). There is deliberately no
 * path that cancels a `completed` build: its movements are in an append-only
 * ledger and a status flip would leave them there, valuing inventory against a
 * run the system says never happened.
 */
export async function cancelBuild(
  db: Database,
  organizationId: string,
  userId: string,
  input: CancelBuildInput
): Promise<Result<BuildRecord, Error>> {
  return guard(
    async () => {
      const ctx = await requireBuildFieldContext(organizationId)
      const build = await requireBuild(db, organizationId, input.buildId)
      assertBuildStatus(
        build,
        canCancelBuild,
        'A completed build is reversed, never cancelled. A cancelled build is already cancelled.'
      )

      const values: Record<string, unknown> = { build_status: BuildStatus.CANCELED }
      if (input.reason && ctx.fields.build_notes) {
        values.build_notes = appendNote(build.notes, input.reason)
      }

      await updateBuild(db, organizationId, userId, ctx, input.buildId, values)
      return requireBuild(db, organizationId, input.buildId)
    },
    'Failed to cancel build',
    { organizationId, buildId: input.buildId }
  )
}

/**
 * Amend what a `planned` run intends to produce — the write plan 13's Model B
 * reconciler converges an order-raised build with.
 *
 * 🛑 **`planned` ONLY**, via {@link canAmendBuild}, which is deliberately
 * narrower than {@link canCancelBuild}. An `in_progress` build has written no
 * movements, so nothing in the ledger forbids the write; what forbids it is
 * that somebody may already be cutting material against the old quantity. It
 * stays cancellable and stops being amendable
 * (plans/products/13-order-build-reconciliation.md §1.0(a), §1.5). Any other
 * status — including a row whose status is missing entirely — is a
 * `ConflictError`.
 *
 * 🛑 **Writes no movements**, like everything else in this file (B2). The
 * quantity a run *plans* is not a number the ledger has seen; only
 * `completeBuild` turns intent into stock.
 *
 * `orderRevision` re-stamps `build_order_revision`, the drift fingerprint
 * `createBuild` sets on the insert. Rewriting it is the point here rather than
 * a violation of the "stamped once" rule that field's registry entry states:
 * under Model B a reconcile is the moment the build *stops* differing from its
 * order, so leaving the old stamp would report drift that has just been
 * resolved. Passing `null` clears it back to *unknown* — which is what a caller
 * that could not compute the order's fingerprint should say, since
 * `hasDrifted` reads a missing stamp as unknown and never as drifted. Omitting
 * the property leaves whatever is stored untouched.
 */
export async function amendPlannedBuildQuantity(
  db: Database,
  organizationId: string,
  userId: string,
  input: { buildId: string; quantityPlanned: number; orderRevision?: string | null }
): Promise<Result<BuildRecord, Error>> {
  return guard(
    async () => {
      const ctx = await requireBuildFieldContext(organizationId)

      // The same refusal, in the same words, as `createBuild`: a build that
      // plans to produce nothing is not an amendment, it is a cancellation, and
      // `cancelBuild` is the function that performs one.
      if (!Number.isFinite(input.quantityPlanned) || input.quantityPlanned <= 0) {
        throw new BadRequestError('A build must plan to produce at least one unit')
      }

      const build = await requireBuild(db, organizationId, input.buildId)
      assertBuildStatus(
        build,
        canAmendBuild,
        'Only a planned build can be amended. An in-progress build may be cancelled, never ' +
          'silently changed, because material may already be cut.'
      )

      const values: Record<string, unknown> = {
        build_quantity_planned: input.quantityPlanned,
      }
      // One update, not two. The quantity and the stamp that explains which
      // version of the order it came from must land together, or a reader
      // between the two writes sees a build that disagrees with its own
      // fingerprint.
      if (input.orderRevision !== undefined && ctx.fields.build_order_revision) {
        values.build_order_revision = input.orderRevision
      }

      await updateBuild(db, organizationId, userId, ctx, input.buildId, values)

      logger.info('Amended a planned build', {
        organizationId,
        buildId: input.buildId,
        quantityPlanned: input.quantityPlanned,
        restamped: values.build_order_revision !== undefined,
      })

      return requireBuild(db, organizationId, input.buildId)
    },
    'Failed to amend build quantity',
    { organizationId, buildId: input.buildId }
  )
}

/**
 * One `UnifiedCrudHandler.update` on the DEFAULT (interactive) lane.
 *
 * Every caller here writes only fields a `planned` build carries — a status, a
 * note, a planned quantity — and none of them writes a stock movement, so the
 * quiet lane is wrong: `buildWriteSession()` exists for `completeBuild` and
 * `reverseBuild` alone (`write-lane.ts`), and silencing an amendment would cost
 * the build list its realtime update for no benefit.
 */
async function updateBuild(
  db: Database,
  organizationId: string,
  userId: string,
  ctx: BuildFieldContext,
  buildId: string,
  values: Record<string, unknown>
): Promise<void> {
  const crud = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
    // Two of the three callers write a GUARDED value — `startBuild` sets `in_progress`,
    // `cancelBuild` sets `canceled` — so this is what keeps those actions working.
    // `amendPlannedBuildQuantity` writes no guarded value and carries the set anyway, for
    // the reason `createBuild` does: the exemption belongs to the sanctioned WRITER rather
    // than to today's value set.
    bypassFieldGuards: BUILD_STATUS_BYPASS,
  })
  await crud.update(toRecordId(ctx.buildDefId, buildId) as RecordId, values)
}

/**
 * The order's current demand fingerprint, or `null` when it cannot be computed.
 *
 * Never throws: a build must be raised whether or not its drift stamp can be
 * taken. Lazy-imported so `build-mutations` keeps no static edge to the
 * auto-build query layer.
 */
async function readOrderDemandFingerprint(
  db: Database,
  organizationId: string,
  orderId: string
): Promise<string | null> {
  try {
    const [{ loadAutoBuildOrders }, { orderDemandFingerprint }] = await Promise.all([
      import('./auto-build-queries'),
      import('./order-fingerprint'),
    ])
    const [order] = await loadAutoBuildOrders(db, organizationId, [orderId])
    if (!order) return null
    return orderDemandFingerprint({ cancelledAt: order.cancelledAt, lines: order.lines })
  } catch (error) {
    logger.warn('Could not stamp the build with its order revision', {
      organizationId,
      orderId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** {@link getBuild}, as the `NotFoundError` a write path needs. */
export async function requireBuild(
  db: Database,
  organizationId: string,
  buildId: string
): Promise<BuildRecord> {
  const result = await getBuild(db, organizationId, buildId)
  if (result.isErr()) throw result.error
  if (!result.value) throw new NotFoundError(`Build ${buildId} not found`)
  return result.value
}

/** The part must exist, in this org, unarchived — before anything else is read. */
async function assertPartExists(
  db: Database,
  organizationId: string,
  partDefId: string,
  partId: string
): Promise<void> {
  const [instance] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, partId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, partDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)

  if (!instance) throw new NotFoundError(`Part ${partId} not found`)
}

/** Free text is appended, never replaced — a cancellation reason is not the notes. */
function appendNote(existing: string | null, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition
}

/**
 * Resolve a def id the caller's input already committed us to, as an
 * `UnprocessableEntityError` rather than the bare `Error` the cache helper
 * throws — "you named an order and this org has no orders" is a 422 the UI can
 * act on, not a 500.
 */
export async function requireDefId(organizationId: string, entityType: string): Promise<string> {
  const defId = await getCachedEntityDefId(organizationId, entityType)
  if (!defId) {
    throw new UnprocessableEntityError(
      `This organization has no ${entityType} entity definition yet`
    )
  }
  return defId
}

// packages/lib/src/builds/build-now.ts

/**
 * Raise, start and complete a run in one call
 * (plans/money/tasks/23-build-from-the-part.md §3.3).
 *
 * The whole of it is a composition: `createBuild` -> `startBuild` ->
 * `completeBuild`, in that order, with no arithmetic of its own. A shop
 * assembling five brackets on the bench should not have to walk a three-state
 * lifecycle to say so, and the three-state lifecycle is still what actually
 * happens underneath.
 *
 * 🛑 **It is NOT atomic, and no caller may be told otherwise.** Each of the three
 * runs its own `UnifiedCrudHandler` work inside its own `guard`, so a refused
 * completion — a component with no `part_standard_cost` being the likely
 * reason — leaves the run sitting at `in_progress` with no movements written.
 * That is recoverable, not corrupt: the build is in the builds list and
 * `build-run-card` can complete or cancel it.
 *
 * 🛑 **Which is why a mid-composition failure is a RESULT, not an error.** It
 * comes back as {@link BuildNowOutcome} `left_in_progress`, carrying the build
 * that was raised, because the caller has to be able to name and link it. An
 * error channel cannot do that: `errorFormatter` sends the client a message and
 * nothing else, so the person would be told "failed" about a run that exists,
 * and would press the button again. The `err` channel is reserved for
 * `createBuild` refusing, which writes nothing at all.
 *
 * 🛑 **Do not make it atomic by inlining the three bodies.** That would put a
 * second copy of the ledger writer in the tree, which is the one thing
 * `complete-build.ts` is structured to prevent.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md` §6) —
 * and it must assert BOTH halves, because this path writes stock movements.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { createBuild, startBuild } from './build-mutations'
import { completeBuild } from './complete-build'
import type { BuildRecord, CompleteBuildResult } from './types'

const logger = createScopedLogger('builds:build-now')

/** What `buildNow` needs. The completion's overrides are deliberately absent — see below. */
export interface BuildNowInput {
  /** `EntityInstance.id` of the `part` to produce. */
  partId: string
  /** Good units produced. This is both the planned and the produced quantity. */
  quantity: number
  notes?: string
  /** THE accounting date, stamped on the build and every movement. Defaults to now. */
  completedAt?: Date
}

/**
 * What happened. Both arms carry the build, because both arms raised one.
 *
 * `left_in_progress` is the recoverable end state §3.3 names: the run exists,
 * it has written no movements, and somebody has to finish or cancel it from the
 * builds list. `reason` is the refusal verbatim — an unpriced component, almost
 * always — so the person is told why rather than only that.
 */
export type BuildNowOutcome =
  | { status: 'completed'; build: BuildRecord; completion: CompleteBuildResult }
  | {
      status: 'left_in_progress'
      build: BuildRecord
      /** How far the composition got before it stopped. */
      stage: 'start' | 'complete'
      reason: string
    }

/**
 * Create a run, start it, and complete it at BOM-standard consumption.
 *
 * 🛑 **The assertion this makes on the caller's behalf**: standard consumption
 * straight off the bill of materials, zero scrap, and the effective absorption
 * rates. No component overrides, and `laborCost` / `overheadCost` are omitted so
 * the server resolves them from the produced part's own rates falling back to
 * the org's (`routers/builds.ts` documents omitting them as the supported case).
 *
 * That assertion is true for most small runs and false for some. When it is
 * false the person wants the full completion dialog, which is why the part
 * drawer keeps a "Plan and open..." verb beside this one rather than growing
 * override inputs into a two-field popover.
 */
export async function buildNow(
  db: Database,
  organizationId: string,
  userId: string,
  input: BuildNowInput
): Promise<Result<BuildNowOutcome, Error>> {
  const created = await createBuild(db, organizationId, userId, {
    partId: input.partId,
    quantityPlanned: input.quantity,
    ...(input.notes ? { notes: input.notes } : {}),
  })
  // Nothing was written, so this failure needs no recovery sentence — it is the
  // ordinary refusal a person meets when the part is unclassified or has no BOM.
  if (created.isErr()) return err(created.error)
  const raised = created.value

  const started = await startBuild(db, organizationId, userId, { buildId: raised.buildId })
  if (started.isErr()) {
    return ok(stopped(raised, 'start', started.error))
  }
  const build = started.value

  const completed = await completeBuild(db, organizationId, userId, {
    buildId: build.buildId,
    quantityProduced: input.quantity,
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
  })
  if (completed.isErr()) {
    return ok(stopped(build, 'complete', completed.error))
  }

  logger.info('Built a run in one step', {
    organizationId,
    buildId: build.buildId,
    partId: input.partId,
    quantity: input.quantity,
    varianceAmount: completed.value.varianceAmount,
  })

  return ok({ status: 'completed', build, completion: completed.value })
}

/** The `left_in_progress` arm, with the run that has to be finished or cancelled. */
function stopped(
  build: BuildRecord,
  stage: 'start' | 'complete',
  error: Error
): Extract<BuildNowOutcome, { status: 'left_in_progress' }> {
  logger.warn('buildNow stopped after raising the build', {
    buildId: build.buildId,
    stage,
    error: error.message,
  })
  return { status: 'left_in_progress', build, stage, reason: error.message }
}

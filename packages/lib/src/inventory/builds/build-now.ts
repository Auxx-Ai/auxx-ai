// packages/lib/src/inventory/builds/build-now.ts

/**
 * Raise, start and complete a run in one call (plans/money/tasks/23-build-from-the-part.md §3.3):
 * `createBuild` -> `startBuild` -> `completeBuild`, with no arithmetic of its own. Not atomic: a
 * refused completion leaves the run `in_progress` with no movements, and that comes back as the
 * `left_in_progress` result carrying the build, so the caller can name it. The router must assert
 * both the build and the part permissions, because this path writes stock movements.
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
 * Create a run, start it, and complete it at BOM-standard consumption: no overrides, no scrap,
 * and the absorption rates resolved server-side. Anything else is the full completion dialog.
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

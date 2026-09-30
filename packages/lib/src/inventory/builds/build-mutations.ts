// packages/lib/src/inventory/builds/build-mutations.ts

/**
 * The build writes that touch no stock movement: raise, start, cancel, amend, edit notes.
 * plans/products/build/01-build-plan.md section 3.4. No permission checks (`docs/lib-module-guide.md`
 * section 6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId } from '../../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { BuildStatus } from '../../resources/registry/enum-values'
import { loadDirectSubparts } from '../bom/subpart-graph'
import { resolvePartKind } from '../costing/client'
import { assertBuildStatus, getBuild, lockBuild, readPartKinds } from './build-queries'
import { publishBuildsChanged } from './build-realtime'
import { type BuildPatch, insertBuild, type NewBuild, updateBuild } from './build-writes'
import { canAmendBuild, canCancelBuild, canStartBuild } from './client'
import { guard } from './guard'
import type { BuildRecord, CancelBuildInput, CreateBuildInput, StartBuildInput } from './types'

const logger = createScopedLogger('builds:mutations')

/** The sources whose builds carry a batch run: one run number, one undo. */
const RUN_NUMBERED_SOURCES: ReadonlySet<string> = new Set(['batch', 'backflush'])

/** Raise a build. Always lands `planned` and writes no movements (B2). */
export async function createBuild(
  db: Database,
  organizationId: string,
  userId: string,
  input: CreateBuildInput
): Promise<Result<BuildRecord, Error>> {
  return guard(
    async () => {
      const values = await raiseBuildValues(db, organizationId, input)
      const build = await insertBuild(db, organizationId, userId, values)
      logger.info('Raised build', {
        organizationId,
        buildId: build.buildId,
        partId: build.partId,
        quantityPlanned: build.quantityPlanned,
        source: build.source,
        batchRun: build.batchRun,
      })
      await publishBuildsChanged(organizationId, [build])
      return build
    },
    'Failed to create build',
    { organizationId, partId: input.partId }
  )
}

/** The validated insert of a `planned` build: part exists, is buildable, has a BOM. No write. */
export async function raiseBuildValues(
  db: Database,
  organizationId: string,
  input: CreateBuildInput
): Promise<NewBuild> {
  assertPlannedQuantity(input.quantityPlanned)
  await assertPartsExist(db, organizationId, [input.partId])

  const kinds = await readPartKinds(db, organizationId, [input.partId])
  const subparts = await loadDirectSubparts(db, organizationId, input.partId)
  const values = composeRaiseValues(input, {
    kind: kinds.get(input.partId),
    subpartCount: subparts.length,
  })

  if (input.orderId) {
    values.orderId = input.orderId
    // Only an order-raised build tracks its order; a stamp that cannot be taken stays unknown.
    if (values.source === 'order') {
      values.orderRevision =
        input.orderRevision ?? (await readOrderDemandFingerprint(db, organizationId, input.orderId))
    }
  }
  return values
}

export function assertPlannedQuantity(quantityPlanned: number): void {
  if (!Number.isFinite(quantityPlanned) || quantityPlanned <= 0) {
    throw new BadRequestError('A build must plan to produce at least one unit')
  }
}

/**
 * The insert of a `planned` build without an order, from its part's kind and BOM size; refuses a
 * part that cannot be built. The batched completion raises from the same function.
 */
export function composeRaiseValues(
  input: CreateBuildInput,
  part: { kind: string | undefined; subpartCount: number }
): NewBuild {
  const partKind = resolvePartKind(part.kind)
  if (partKind === 'service') {
    throw new BadRequestError('A service is not stocked, so it cannot be built')
  }
  if (partKind === 'component') {
    throw new UnprocessableEntityError(
      'This part is classified as purchased, so it cannot be built. Change its part kind ' +
        'to a subassembly or a finished good if it is made in-house.'
    )
  }
  if (part.subpartCount === 0) {
    throw new UnprocessableEntityError(
      'This part has no bill of materials, so a build would consume nothing'
    )
  }

  const source = input.source ?? 'manual'
  const values: NewBuild = {
    partId: input.partId,
    status: BuildStatus.PLANNED,
    source,
    quantityPlanned: input.quantityPlanned,
    notes: input.notes || null,
  }

  // Written at insert or never: moving a claimed period restates what netting believes is covered.
  if (input.period && source === 'batch') {
    if (input.period.end.getTime() <= input.period.start.getTime()) {
      throw new BadRequestError('A build period must end after it starts')
    }
    values.periodStart = input.period.start
    values.periodEnd = input.period.end
  }
  // Allocated once per run by the caller; the run number is what undo keys on.
  if (input.batchRun !== undefined && RUN_NUMBERED_SOURCES.has(source)) {
    values.batchRun = input.batchRun
  }
  return values
}

/** Every part exists, is live and is a `part`; one read for a batch of builds. */
export async function assertPartsExist(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<void> {
  const wanted = [...new Set(partIds)]
  if (wanted.length === 0) return
  const partDefId = await getCachedEntityDefId(organizationId, 'part')
  if (!partDefId) throw new NotFoundError(`Part ${wanted[0]} not found`)
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        inArray(schema.EntityInstance.id, wanted),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, partDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  const found = new Set(rows.map((row) => row.id))
  const missing = wanted.find((partId) => !found.has(partId))
  if (missing) throw new NotFoundError(`Part ${missing} not found`)
}

/** Move a `planned` run to `in_progress` and stamp `startedAt`. */
export async function startBuild(
  db: Database,
  organizationId: string,
  _userId: string,
  input: StartBuildInput
): Promise<Result<BuildRecord, Error>> {
  return guard(
    () =>
      transition(db, organizationId, input.buildId, (build) => {
        assertBuildStatus(build, canStartBuild, 'Only a planned build can be started')
        return { status: BuildStatus.IN_PROGRESS, startedAt: input.startedAt ?? new Date() }
      }),
    'Failed to start build',
    { organizationId, buildId: input.buildId }
  )
}

/**
 * Abandon a run that has not been completed. A completed build is reversed, never cancelled: its
 * movements stay in the ledger (B6).
 */
export async function cancelBuild(
  db: Database,
  organizationId: string,
  _userId: string,
  input: CancelBuildInput
): Promise<Result<BuildRecord, Error>> {
  return guard(
    () =>
      transition(db, organizationId, input.buildId, (build) => {
        assertBuildStatus(
          build,
          canCancelBuild,
          'A completed build is reversed, never cancelled. A cancelled build is already cancelled.'
        )
        const patch: BuildPatch = { status: BuildStatus.CANCELED }
        if (input.reason) patch.notes = appendNote(build.notes, input.reason)
        return patch
      }),
    'Failed to cancel build',
    { organizationId, buildId: input.buildId }
  )
}

/**
 * Amend what a `planned` run intends to produce (plan 13 Model B). `in_progress` is refused: material
 * may already be cut. `orderRevision` re-stamps the drift fingerprint in the same update (`null`
 * clears it to unknown; omitted leaves it).
 */
export async function amendPlannedBuildQuantity(
  db: Database,
  organizationId: string,
  _userId: string,
  input: { buildId: string; quantityPlanned: number; orderRevision?: string | null }
): Promise<Result<BuildRecord, Error>> {
  return guard(
    async () => {
      assertPlannedQuantity(input.quantityPlanned)
      const build = await transition(db, organizationId, input.buildId, (locked) => {
        assertBuildStatus(
          locked,
          canAmendBuild,
          'Only a planned build can be amended. An in-progress build may be cancelled, never ' +
            'silently changed, because material may already be cut.'
        )
        const patch: BuildPatch = { quantityPlanned: input.quantityPlanned }
        if (input.orderRevision !== undefined) patch.orderRevision = input.orderRevision
        return patch
      })
      logger.info('Amended a planned build', {
        organizationId,
        buildId: input.buildId,
        quantityPlanned: input.quantityPlanned,
        restamped: input.orderRevision !== undefined,
      })
      return build
    },
    'Failed to amend build quantity',
    { organizationId, buildId: input.buildId }
  )
}

/** Replace a build's notes, the one field a person edits freely, in any status. */
export async function updateBuildNotes(
  db: Database,
  organizationId: string,
  input: { buildId: string; notes: string | null }
): Promise<Result<BuildRecord, Error>> {
  return guard(
    () =>
      transition(db, organizationId, input.buildId, () => ({
        notes: input.notes?.trim() ? input.notes : null,
      })),
    'Failed to update build notes',
    { organizationId, buildId: input.buildId }
  )
}

/** Lock, check and patch one build in a transaction, then announce it after the commit. */
async function transition(
  db: Database,
  organizationId: string,
  buildId: string,
  decide: (build: BuildRecord) => BuildPatch
): Promise<BuildRecord> {
  const build = await db.transaction(async (tx) => {
    const locked = await lockBuild(tx, organizationId, buildId)
    return updateBuild(tx, organizationId, buildId, decide(locked))
  })
  await publishBuildsChanged(organizationId, [build])
  return build
}

/** The order's demand fingerprint, or `null` when it cannot be computed; never throws. */
async function readOrderDemandFingerprint(
  db: Database,
  organizationId: string,
  orderId: string
): Promise<string | null> {
  try {
    // Lazy: `build-mutations` keeps no static edge to the auto-build query layer.
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

/** Free text is appended, never replaced: a cancellation reason is not the notes. */
function appendNote(existing: string | null, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition
}

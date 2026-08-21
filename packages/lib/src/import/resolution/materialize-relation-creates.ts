// packages/lib/src/import/resolution/materialize-relation-creates.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getCachedResource } from '../../cache'
import { ForbiddenError } from '../../errors'
import type { RelationCreateRequest, ResolvedValue } from '../types/resolution'
import { loadPendingCreates } from './get-relation-create-counts'
import { buildImportAuthority } from './import-authority'
import { relationCreateKey } from './relation-create-key'
import { type ResolutionRowWriteById, updateResolutionsById } from './write-resolution-rows'

const logger = createScopedLogger('materialize-relation-creates')

/**
 * Writes a record into the relation TARGET's definition.
 *
 * Supply the job's own manifest-aware writer, not a fresh one. The importer
 * writes on the silent `sync` lane and captures record-rule changes through a
 * manifest collector (`execute-plan-job.ts`); a writer that bypasses that
 * contract creates records no rule ever sees and no open grid ever refetches.
 * {@link createRelationTargetWriter} builds a conforming one.
 */
export type RelationTargetWriter = (
  entityDefinitionId: string,
  data: Record<string, unknown>
) => Promise<{ id: string }>

/** Options for {@link materializeRelationCreates} */
export interface MaterializeRelationCreatesOptions {
  organizationId: string
  /** Import job whose `status: 'create'` resolutions should be minted */
  jobId: string
  /** The member the import runs as (`ImportJob.createdById`) */
  userId: string
  /** Writer for the target definition, see {@link RelationTargetWriter} */
  createRecord: RelationTargetWriter
  /**
   * Explicit authority probe, overriding the `userId` lookup. Exists for
   * callers that already hold a `CapabilitySet` (and for tests).
   */
  canImportTarget?: (entityDefinitionId: string) => boolean | Promise<boolean>
}

/** Outcome of materializing one job's pending relation creates */
export interface MaterializeRelationCreatesResult {
  /** Distinct records actually minted */
  created: number
  /** Minted records per relation target */
  byEntityDefinition: Record<string, number>
  /** Distinct values that could not be minted, with the reason */
  failures: Array<{ entityDefinitionId: string; value: string; error: string }>
}

/** One distinct target: either minted, or failed with a reason. */
type MintOutcome = { id: string } | { error: string }

/**
 * Every resolution row that shares one mint outcome. Bucketing is what lets N
 * cells naming one supplier build their `resolvedValues` payload once; the
 * write itself is batched across ALL buckets, see {@link writeBackOutcomes}.
 */
interface WriteBackBucket {
  outcome: MintOutcome
  /** The raw cell the target was minted from, quoted in the failure message */
  value: string
  resolutionIds: string[]
}

/**
 * Mint the target records that `onNoMatch: 'create'` deferred, then rewrite
 * their resolutions to point at the new record ids.
 *
 * Call this ONCE, at the start of execution, BEFORE `getAllJobResolutions`
 * loads the map the executor builds rows from. Creation is deliberately not
 * done during plan generation: a user who abandons the wizard at the preview
 * must not be left with orphan companies.
 *
 * Exactly one record is minted per distinct `(target, matchField, value)`,
 * see {@link relationCreateKey}, so 500 rows naming "Acme" produce one
 * company, and so do two different columns naming it. Re-running is a no-op:
 * every row it succeeds on is left `status: 'valid'` and no longer loads.
 *
 * @param db - Database instance
 * @param options - Job, actor, and the target writer
 * @returns What was created and what could not be
 * @throws ForbiddenError when the actor may not import into a relation target
 */
export async function materializeRelationCreates(
  db: Database,
  options: MaterializeRelationCreatesOptions
): Promise<MaterializeRelationCreatesResult> {
  const { organizationId, jobId, userId, createRecord } = options

  const pending = await loadPendingCreates(db, jobId)
  if (pending.length === 0) {
    return { created: 0, byEntityDefinition: {}, failures: [] }
  }

  const canImportTarget = buildImportAuthority(organizationId, {
    userId,
    canImportTarget: options.canImportTarget,
  })

  // Second gate, after the plan-time one. The plan may have been generated
  // days ago and permissions move; authority is re-asserted against the
  // definitions actually about to be written. A denial fails the import rather
  // than silently dropping the links, because dropping them would import rows
  // that look complete and are not.
  for (const defId of new Set(pending.map((p) => p.request.entityDefinitionId))) {
    if (!(await canImportTarget(defId))) {
      throw new ForbiddenError(
        "You don't have permission to create the linked records this import needs."
      )
    }
  }

  const byEntityDefinition: Record<string, number> = {}
  const failures: MaterializeRelationCreatesResult['failures'] = []
  const outcomes = new Map<string, MintOutcome>()
  const writeBacks = new Map<string, WriteBackBucket>()
  let created = 0

  for (const row of pending) {
    const key = relationCreateKey(row.request)

    let outcome = outcomes.get(key)
    if (!outcome) {
      try {
        const id = await mintTarget(organizationId, row.request, createRecord)
        outcome = { id }
        created++
        byEntityDefinition[row.request.entityDefinitionId] =
          (byEntityDefinition[row.request.entityDefinitionId] ?? 0) + 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        outcome = { error: message }
        failures.push({
          entityDefinitionId: row.request.entityDefinitionId,
          value: row.request.value,
          error: message,
        })
        logger.error('Failed to auto-create relation target', {
          jobId,
          entityDefinitionId: row.request.entityDefinitionId,
          matchField: row.request.matchField,
          error: message,
        })
      }
      outcomes.set(key, outcome)
    }

    const bucket = writeBacks.get(key)
    if (bucket) {
      bucket.resolutionIds.push(row.resolutionId)
    } else {
      writeBacks.set(key, {
        outcome,
        value: row.request.value,
        resolutionIds: [row.resolutionId],
      })
    }
  }

  await writeBackOutcomes(db, [...writeBacks.values()])

  logger.info('Materialized relation creates', { jobId, created, failures: failures.length })
  return { created, byEntityDefinition, failures }
}

/**
 * Rewrite every pending resolution in chunks, whatever the outcomes were.
 *
 * Bucketing alone was not enough: buckets only merge when the same value is
 * reached from more than one column, so a file of 3k genuinely new suppliers
 * stayed at 3k statements. Flattening the buckets into one keyed write list
 * makes the count ceil(rows / 500) no matter how the outcomes distribute, and
 * a failed mint still cannot reach a successful one's rows because each
 * bucket's payload is built from its OWN outcome.
 */
async function writeBackOutcomes(db: Database, buckets: WriteBackBucket[]): Promise<void> {
  const writes: ResolutionRowWriteById[] = []

  for (const bucket of buckets) {
    const settled = bucket.outcome
    const succeeded = 'id' in settled
    const resolvedValues: ResolvedValue[] = succeeded
      ? [{ type: 'value', value: settled.id }]
      : [{ type: 'error', error: `Could not create "${bucket.value}": ${settled.error}` }]
    const errorMessage = succeeded ? null : (resolvedValues[0]?.error ?? null)

    for (const id of bucket.resolutionIds) {
      writes.push({
        id,
        status: succeeded ? 'valid' : 'error',
        resolvedValues,
        isValid: succeeded,
        errorMessage,
      })
    }
  }

  await updateResolutionsById(db, writes)
}

/**
 * Mint one target record carrying the match value on its match field.
 *
 * The field is addressed by its CustomField id when it has one and by its key
 * otherwise, the same dual convention `buildRecordData` uses, so the CRUD
 * layer routes it identically to every other imported value.
 */
async function mintTarget(
  organizationId: string,
  request: RelationCreateRequest,
  createRecord: RelationTargetWriter
): Promise<string> {
  const resource = await getCachedResource(organizationId, request.entityDefinitionId)
  if (!resource) {
    throw new Error(`Relation target not found: ${request.entityDefinitionId}`)
  }
  const field = resource.fields.find((f) => f.key === request.matchField)
  const dataKey = field?.id ?? request.matchField
  const result = await createRecord(resource.entityDefinitionId, { [dataKey]: request.value })
  return result.id
}

/** Options for {@link createRelationTargetWriter} */
export interface RelationTargetWriterOptions {
  organizationId: string
  userId: string
  db?: Database
  /**
   * Called after each successful mint. Feed the job's manifest collector here
   * so auto-created targets reach record rules the same way imported rows do.
   */
  onCreated?: (entityDefinitionId: string, recordId: string, data: Record<string, unknown>) => void
}

/**
 * Build a {@link RelationTargetWriter} that writes through the same CRUD path
 * and the same silent-lane contract the importer uses for its own rows: the
 * handler is constructed with no explicit session, so it inherits the job's
 * ambient `sync` session (plan 03 §4b S1 — `execute-plan-job.ts` wraps the
 * calls in `runWithWriteSession`).
 *
 * The silent lane is not an optimisation here, it is what keeps a 500-row
 * import from putting 500 `record:created` frames on the def channel. The
 * coarse `records:invalidated` frame the job already publishes covers the
 * target def too, provided the caller includes it (see the report notes).
 *
 * @param options - Org, actor, and an optional manifest hook
 */
export function createRelationTargetWriter(
  options: RelationTargetWriterOptions
): RelationTargetWriter {
  const { organizationId, userId, db, onCreated } = options
  // Lazy: `UnifiedCrudHandler` drags the whole resources graph in, and most
  // imports have nothing to create. Constructed on first call — inside the
  // job's `runWithWriteSession` wrap — so the ambient sync session binds.
  let handlerPromise: Promise<{
    create: (
      defId: string,
      values: Record<string, unknown>
    ) => Promise<{ instance: { id: string } }>
  }> | null = null

  return async (entityDefinitionId, data) => {
    handlerPromise ??= import('../../resources/crud/unified-handler').then(
      (m) => new m.UnifiedCrudHandler(organizationId, userId, db)
    )
    const handler = await handlerPromise
    const created = await handler.create(entityDefinitionId, data)
    onCreated?.(entityDefinitionId, created.instance.id, data)
    return { id: created.instance.id }
  }
}

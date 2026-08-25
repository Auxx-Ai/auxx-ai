// packages/lib/src/resources/record-existence.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedResources } from '../cache'
import { isMailLensTableId } from './picker/mail-lens-tables'
import { isCustomResource, isSystemResourceId } from './registry'
import { parseRecordId, type RecordId } from './resource-id'

/** The largest batch one call will judge. Matches `record.getByIds`. */
export const MAX_EXISTENCE_BATCH = 100

/** Parameters for {@link findMissingRecordTargets}. */
export interface FindMissingRecordTargetsParams {
  organizationId: string
  /** RecordIds to judge. Ids beyond {@link MAX_EXISTENCE_BATCH} are ignored. */
  recordIds: RecordId[]
}

/**
 * Answer which of these RecordIds point at a target that is **provably absent**
 * from the organization — the positive existence signal a caller needs before
 * it may remove a stored reference.
 *
 * 🛑 **This is deliberately NOT the inverse of "the picker could hydrate it".**
 * `record.getByIds` answers "can THIS viewer read it", and a `null` from that
 * path has at least five causes, only one of which is deletion:
 *
 * 1. the def is instance-access and unroutable through the record path
 *    (`filterHydratableRecordIds` in `record.ts`),
 * 2. the def is a mail-lens table — **every** `thread:` / `message:` id resolves
 *    to nothing there, for every viewer, alive or not
 *    (`RecordPickerService.getResourcesByIds` step 0.1),
 * 3. the viewer's record scope for the def is `none`,
 * 4. the per-row visibility predicate excluded the row in SQL,
 * 5. `admitSystemRows` dropped it on instance access (kb / dataset / article).
 *
 * Treating any of those as "deleted" would let a restricted viewer strip
 * references they merely could not see — for everyone. So this answers from the
 * row's own backing table instead, and **refuses to judge anything it cannot
 * resolve to `EntityInstance`**: a system table-backed def (`thread`,
 * `article`, `message`, `user`, …), a mail-lens def, or a def key that does not
 * resolve through the org's resource cache at all. Those are omitted from the
 * answer — never reported missing.
 *
 * `relatedEntityId` addresses four different backing tables; a check that joins
 * only `EntityInstance` and calls every miss "deleted" would condemn ~1,256
 * healthy `Thread` / `Article` / `DispatchWorker` references.
 *
 * ⚠️ **Archived is not absent.** No `archivedAt` predicate is applied, on
 * purpose — an archived record still exists and its references are live.
 *
 * @returns the subset of `recordIds` whose target row is confirmed gone
 */
export async function findMissingRecordTargets(
  db: Database | Transaction,
  params: FindMissingRecordTargetsParams
): Promise<Result<RecordId[], Error>> {
  const { organizationId } = params
  const recordIds = params.recordIds.slice(0, MAX_EXISTENCE_BATCH)
  if (recordIds.length === 0) return ok([])

  const isJudgeableDef = await buildJudgeableDefTest(organizationId)

  // instanceId -> the RecordIds that named it. One instance can be named under
  // several def prefixes (entityType slug vs definition id); all share a verdict.
  const judgeable = new Map<string, RecordId[]>()
  for (const recordId of recordIds) {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    if (!entityInstanceId || !isJudgeableDef(entityDefinitionId)) continue
    const named = judgeable.get(entityInstanceId)
    if (named) named.push(recordId)
    else judgeable.set(entityInstanceId, [recordId])
  }
  if (judgeable.size === 0) return ok([])

  let rows: { id: string }[]
  try {
    rows = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          inArray(schema.EntityInstance.id, [...judgeable.keys()])
        )
      )
  } catch (error) {
    return err(error instanceof Error ? error : new Error('Failed to resolve record targets'))
  }

  const present = new Set(rows.map((row) => row.id))
  const missing: RecordId[] = []
  for (const [instanceId, named] of judgeable) {
    if (!present.has(instanceId)) missing.push(...named)
  }
  return ok(missing)
}

/**
 * Build the synchronous "is a missing `EntityInstance` row conclusive for this
 * def?" test, reading the org's resource cache once.
 *
 * A def key reaches this in any of four spellings — the resource id, the
 * `entityDefinitionId`, the `entityType` slug, or the `apiSlug` — so all four
 * are indexed. Anything that does not resolve to a `type: 'custom'` resource
 * answers `false`, which is the safe direction: `article`'s EntityDefinition row
 * is filtered OUT of the resource cache precisely because its data lives in a
 * dedicated table, so "not in the cache" must never mean "gone".
 */
async function buildJudgeableDefTest(
  organizationId: string
): Promise<(entityDefinitionId: string) => boolean> {
  const resources = await getCachedResources(organizationId)
  const entityInstanceBacked = new Set<string>()
  for (const resource of resources) {
    if (!isCustomResource(resource)) continue
    entityInstanceBacked.add(resource.id)
    entityInstanceBacked.add(resource.apiSlug)
    if (resource.entityDefinitionId) entityInstanceBacked.add(resource.entityDefinitionId)
    if (resource.entityType) entityInstanceBacked.add(resource.entityType)
  }

  return (entityDefinitionId: string) => {
    if (!entityDefinitionId) return false
    // Static refusals stay ahead of the cache so a slug that somehow appears in
    // both keyspaces can never be judged.
    if (isMailLensTableId(entityDefinitionId)) return false
    if (isSystemResourceId(entityDefinitionId)) return false
    return entityInstanceBacked.has(entityDefinitionId)
  }
}

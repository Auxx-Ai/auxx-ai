// packages/lib/src/inventory/builds/build-writes.ts

import { type CreateBuildRowInput, type Database, schema, type Transaction } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { uniqueViolationConstraint } from '../../accounting/ledger/post/post-entry'
import { ConflictError, NotFoundError } from '../../errors'
import { chunkArray } from '../../import/utils/chunk-array'
import { recordNumbering } from '../../records/record-numbering'
import { toBuildRecord } from './build-row'
import type { BuildRecord } from './types'

type Db = Database | Transaction

const INSERT_CHUNK = 500

/** The unique partial index that makes a second reversal of one build impossible. */
const REVERSAL_UNIQUE_INDEX = 'Build_reversalOfBuildId_key'
const NUMBER_UNIQUE_INDEX = 'Build_org_number_key'

/** A build to insert. `number` is allocated when absent; `id` may be pre-generated to link movements. */
export type NewBuild = Omit<
  CreateBuildRowInput,
  'organizationId' | 'createdById' | 'number' | 'updatedAt'
> & { number?: string }

/** The columns a writer may change after insert. Identity, part, source, period and run are write-once. */
export type BuildPatch = Partial<
  Pick<
    CreateBuildRowInput,
    | 'status'
    | 'quantityPlanned'
    | 'quantityProduced'
    | 'quantityScrapped'
    | 'startedAt'
    | 'completedAt'
    | 'postedAt'
    | 'materialCost'
    | 'laborCost'
    | 'overheadCost'
    | 'producedValue'
    | 'varianceAmount'
    | 'orderRevision'
    | 'notes'
  >
>

/**
 * The next `count` build numbers (`B-0001`…) in one atomic sequence bump. Runs on its own
 * connection, so a number is burnt if the caller's transaction rolls back.
 */
export async function allocateBuildNumbers(
  organizationId: string,
  count: number
): Promise<string[]> {
  if (count === 0) return []
  const { recordNumbers } = await recordNumbering.createRange(organizationId, 'build', count)
  return recordNumbers
}

/**
 * Insert builds in the caller's transaction, numbering the ones without a `number` in one
 * allocation. Returns the rows in input order. A second reversal of one build, or a number already
 * in use, is a `ConflictError`.
 */
export async function insertBuilds(
  db: Db,
  organizationId: string,
  userId: string | null,
  builds: readonly NewBuild[]
): Promise<BuildRecord[]> {
  if (builds.length === 0) return []
  const numbers = await allocateBuildNumbers(
    organizationId,
    builds.filter((build) => !build.number).length
  )
  let next = 0
  const rows: CreateBuildRowInput[] = builds.map((build) => ({
    ...build,
    id: build.id ?? generateId(),
    organizationId,
    createdById: userId,
    number: build.number || numbers[next++]!,
  }))

  const byId = new Map<string, BuildRecord>()
  for (const chunk of chunkArray(rows, INSERT_CHUNK)) {
    const inserted = await db
      .insert(schema.Build)
      .values(chunk)
      .returning()
      .catch((error: unknown) => {
        const constraint = uniqueViolationConstraint(error)
        if (constraint === REVERSAL_UNIQUE_INDEX) {
          throw new ConflictError(
            'This build has already been reversed. Reversing it again would double the negation.'
          )
        }
        // The `build` sequence is user-editable; lowering it hands out numbers already in use.
        if (constraint === NUMBER_UNIQUE_INDEX) {
          throw new ConflictError(
            'A build with this number already exists. Raise the next build number in the numbering settings.'
          )
        }
        throw error
      })
    for (const row of inserted) byId.set(row.id, toBuildRecord(row))
  }
  return rows.map((row) => byId.get(row.id!)!)
}

/** {@link insertBuilds} for one build. */
export async function insertBuild(
  db: Db,
  organizationId: string,
  userId: string | null,
  build: NewBuild
): Promise<BuildRecord> {
  const [record] = await insertBuilds(db, organizationId, userId, [build])
  return record!
}

/**
 * Write columns of one build and return the row. Call it after `lockBuild` in the same
 * transaction; the lifecycle checks are the caller's.
 */
export async function updateBuild(
  tx: Transaction,
  organizationId: string,
  buildId: string,
  patch: BuildPatch
): Promise<BuildRecord> {
  const [row] = await tx
    .update(schema.Build)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.Build.organizationId, organizationId), eq(schema.Build.id, buildId)))
    .returning()
  if (!row) throw new NotFoundError(`Build ${buildId} not found`)
  return toBuildRecord(row)
}

// packages/lib/src/import/resolution/__tests__/override-follow-through.int.test.ts
//
// DB-backed (vitest.integration.config.ts): what an override must change besides its own row.
// Seen on DemoOrg1 2026-09-25: a fixed `Component (NEW)` kept the column at "1 errors to fix",
// and a plan generated before the fix was executed with the row skipped.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { generateId } from '@auxx/utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { recountJobPropertyErrors } from '../recount-job-property-errors'
import { updateValueResolution } from '../update-value-resolution'

type TestDb = ReturnType<typeof getTestDb>

interface Fixture {
  organizationId: string
  jobId: string
  mappingId: string
  jobPropertyId: string
}

/** A `ready` job with one planned select column holding one unresolvable value. */
async function seed(db: TestDb): Promise<Fixture> {
  const org = await createTestOrganization()
  const mappingId = generateId()
  await db.insert(schema.ImportMapping).values({
    id: mappingId,
    organizationId: org.id,
    entityDefinitionId: 'part',
    title: 'Parts',
    updatedAt: new Date(),
  } as typeof schema.ImportMapping.$inferInsert)

  const jobId = generateId()
  await db.insert(schema.ImportJob).values({
    id: jobId,
    organizationId: org.id,
    importMappingId: mappingId,
    sourceFileName: 'parts.csv',
    columnCount: 1,
    rowCount: 1,
    status: 'ready',
    allowPlanGeneration: true,
    updatedAt: new Date(),
  } as typeof schema.ImportJob.$inferInsert)

  const mappingPropertyId = generateId()
  await db.insert(schema.ImportMappingProperty).values({
    id: mappingPropertyId,
    importMappingId: mappingId,
    sourceColumnIndex: 3,
    sourceColumnName: 'Part Kind',
    targetFieldKey: 'part_kind',
    resolutionType: 'select:value',
    updatedAt: new Date(),
  } as typeof schema.ImportMappingProperty.$inferInsert)

  const jobPropertyId = generateId()
  await db.insert(schema.ImportJobProperty).values({
    id: jobPropertyId,
    importJobId: jobId,
    importMappingPropertyId: mappingPropertyId,
    errorCount: 1,
    updatedAt: new Date(),
  } as typeof schema.ImportJobProperty.$inferInsert)

  await db.insert(schema.ImportValueResolution).values({
    id: generateId(),
    importJobPropertyId: jobPropertyId,
    hashedValue: 'h-new',
    rawValue: 'Component (NEW)',
    resolvedValues: [{ type: 'error', error: 'No matching option for: Component (NEW)' }],
    errorMessage: 'No matching option for: Component (NEW)',
    status: 'error',
    isValid: false,
    updatedAt: new Date(),
  } as typeof schema.ImportValueResolution.$inferInsert)

  await db.insert(schema.ImportPlan).values({
    id: generateId(),
    importJobId: jobId,
    status: 'planned',
    updatedAt: new Date(),
  } as typeof schema.ImportPlan.$inferInsert)

  return { organizationId: org.id, jobId, mappingId, jobPropertyId }
}

async function readState(db: TestDb, f: Fixture) {
  const [prop] = await db
    .select({ errorCount: schema.ImportJobProperty.errorCount })
    .from(schema.ImportJobProperty)
    .where(eq(schema.ImportJobProperty.id, f.jobPropertyId))
  const [job] = await db
    .select({ status: schema.ImportJob.status })
    .from(schema.ImportJob)
    .where(eq(schema.ImportJob.id, f.jobId))
  const plans = await db
    .select({ id: schema.ImportPlan.id })
    .from(schema.ImportPlan)
    .where(eq(schema.ImportPlan.importJobId, f.jobId))
  return { errorCount: prop?.errorCount, status: job?.status, plans: plans.length }
}

function override(f: Fixture, isOverridden: boolean, value: string | null) {
  return {
    jobId: f.jobId,
    mappingId: f.mappingId,
    columnIndex: 3,
    hash: 'h-new',
    isOverridden,
    overrideValues: value === null ? null : [{ type: 'value' as const, value }],
    organizationId: f.organizationId,
    entityDefinitionId: 'part',
  }
}

describe('updateValueResolution follow-through', () => {
  let db: TestDb
  let f: Fixture

  beforeEach(async () => {
    db = getTestDb()
    f = await seed(db)
  })

  it('a fix clears the error count and sends a planned job back for re-planning', async () => {
    await updateValueResolution(db, override(f, true, 'component'))

    expect(await readState(db, f)).toEqual({ errorCount: 0, status: 'waiting', plans: 0 })
  })

  it('a revert restores the error count', async () => {
    await updateValueResolution(db, override(f, true, 'component'))
    await updateValueResolution(db, override(f, false, null))

    expect((await readState(db, f)).errorCount).toBe(1)
  })

  it('a skip is not an error', async () => {
    await updateValueResolution(db, {
      ...override(f, true, null),
      overrideValues: [{ type: 'skip', value: '' }],
    })

    expect(await recountJobPropertyErrors(db, f.jobPropertyId)).toBe(0)
  })

  it('leaves an executing job and its plan alone', async () => {
    await db
      .update(schema.ImportJob)
      .set({ status: 'executing' })
      .where(eq(schema.ImportJob.id, f.jobId))

    await updateValueResolution(db, override(f, true, 'component'))

    const state = await readState(db, f)
    expect(state.status).toBe('executing')
    expect(state.plans).toBe(1)
  })
})

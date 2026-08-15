// packages/lib/src/jobs/dedup/__tests__/duplicate-scan-job.int.test.ts
//
// DB-backed behavior tests (vitest.integration.config.ts → auxx_test) for the
// ONE scan job and its three scopes.
//
// Why integration and not unit: every claim this job rests on is a PREDICATE
// claim about SQL, and a chainable mock is predicate-blind.
//   1. The dirty predicate is `GREATEST(ei."updatedAt", max(fv."updatedAt")) >
//      "lastDuplicateScanAt"`, resolved through a LATERAL. The whole reason it
//      is not `updatedAt` alone is that a `skipEvents` writer leaves the
//      instance row untouched — only real rows can show that the lateral arm
//      fires.
//   2. Stamping the watermark must not RE-dirty the record. Drizzle's
//      `$onUpdate` on `EntityInstance.updatedAt` would do exactly that, which is
//      why the stamp is raw SQL; a mock would happily "pass" either way.
//
// The org cache barrel is mocked wholesale (deterministic, no Redis): field
// lookups read straight from the test DB. The feature service is mocked so the
// flag is a test input rather than a Redis-backed plan lookup.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = () => getTestDb() as never as import('@auxx/database').Database

// ── Feature flag as a test input ────────────────────────────────────────────

const flags = vi.hoisted(() => ({ enabled: new Set<string>() }))

vi.mock('../../../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    async hasAccess(organizationId: string) {
      return flags.enabled.has(organizationId)
    }
  },
}))

// ── Org-cache mock (wholesale — DB-backed, no Redis, no providers) ──────────

vi.mock('../../../cache', () => {
  const tdb = () => getTestDb() as never as import('@auxx/database').Database

  const fieldsForOrg = async (orgId: string) =>
    await tdb()
      .select()
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, orgId))

  return {
    getCachedFieldMap: async (orgId: string) => {
      const fields = await fieldsForOrg(orgId)
      return new Map(fields.map((f) => [f.id, f]))
    },
    getCachedCustomFields: async (orgId: string) => fieldsForOrg(orgId),
    getAllCachedCustomFields: async (orgId: string) => fieldsForOrg(orgId),
    getCachedResource: async () => null,
    findCachedResource: async () => null,
    getCachedResources: async () => [],
    getCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
    // Shaped like `ResourceField` — only what `deriveMatchKeys` reads.
    getCachedResourceFields: async (orgId: string, defId: string) => {
      const rows = await tdb()
        .select()
        .from(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.organizationId, orgId),
            eq(schema.CustomField.entityDefinitionId, defId)
          )
        )
      return rows.map((f) => ({
        id: f.id,
        key: f.name,
        label: f.name,
        type: 'string',
        fieldType: f.type,
        systemAttribute: f.systemAttribute ?? undefined,
        isUnique: f.isUnique,
        options: f.options ?? {},
        capabilities: {},
      }))
    },
  }
})

import { duplicateScanJob } from '../duplicate-scan-job'

// ── Fixtures ───────────────────────────────────────────────────────────────

interface Fixture {
  orgId: string
  defId: string
  emailFieldId: string
  phoneFieldId: string
}

async function seedContactOrg(): Promise<Fixture> {
  const org = await createTestOrganization()
  const orgId = org.id
  flags.enabled.add(orgId)

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType: 'contact',
      apiSlug: 'contacts',
      singular: 'contact',
      plural: 'contacts',
      updatedAt: new Date(),
    })
    .returning()

  const makeField = async (
    name: string,
    type: 'EMAIL' | 'PHONE_INTL',
    systemAttribute: string,
    sortOrder: string
  ) => {
    const [row] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: orgId,
        entityDefinitionId: def?.id as string,
        modelType: 'contact',
        name,
        type,
        systemAttribute,
        sortOrder,
        options: { multi: true },
        isCustom: false,
        isUnique: false,
        updatedAt: new Date(),
      })
      .returning()
    return row?.id as string
  }

  return {
    orgId,
    defId: def?.id as string,
    emailFieldId: await makeField('primaryEmail', 'EMAIL', 'primary_email', 'a2'),
    phoneFieldId: await makeField('phone', 'PHONE_INTL', 'phone', 'a3'),
  }
}

async function seedContact(
  f: Fixture,
  displayName: string,
  values: { email?: string; phone?: string } = {}
): Promise<string> {
  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      displayName,
      updatedAt: new Date(),
    })
    .returning()

  const write = async (fieldId: string, value?: string) => {
    if (!value) return
    await db()
      .insert(schema.FieldValue)
      .values({
        organizationId: f.orgId,
        entityId: inst?.id as string,
        entityDefinitionId: f.defId,
        fieldId,
        valueText: value,
        sortKey: 'a0',
      })
  }

  await write(f.emailFieldId, values.email)
  await write(f.phoneFieldId, values.phone)
  return inst?.id as string
}

const runJob = (data: Record<string, unknown>) =>
  duplicateScanJob({ job: { data, id: 'job_test' } } as never)

async function pairCount(orgId: string): Promise<number> {
  const rows = await db()
    .select({ id: schema.DuplicateSuggestion.id })
    .from(schema.DuplicateSuggestion)
    .where(eq(schema.DuplicateSuggestion.organizationId, orgId))
  return rows.length
}

async function watermark(instanceId: string): Promise<Date | null> {
  const [row] = await db()
    .select({ at: schema.EntityInstance.lastDuplicateScanAt })
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, instanceId))
  return row?.at ?? null
}

beforeEach(() => {
  flags.enabled.clear()
})

// ═══════════════════════════════════════════════════════════════════════════

describe('duplicateScanJob — org+def scope (the coalesced mutation seam)', () => {
  it('pairs two contacts sharing a phone and stamps both watermarks', async () => {
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { phone: '+12133734253' })
    const b = await seedContact(f, 'B', { phone: '+12133734253' })

    const stats = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(stats.scanned).toBe(2)
    expect(await pairCount(f.orgId)).toBe(1)
    expect(await watermark(a)).not.toBeNull()
    expect(await watermark(b)).not.toBeNull()
  })

  it('finds NOTHING dirty on an immediate second run', async () => {
    // The stamp must not re-dirty the record. `EntityInstance.updatedAt` carries
    // `$onUpdate`, so a Drizzle `.update()` here would bump `updatedAt` in the
    // same statement and loop the scanner forever.
    const f = await seedContactOrg()
    await seedContact(f, 'A', { phone: '+12133734253' })
    await seedContact(f, 'B', { phone: '+12133734253' })

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })
    const second = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(second.scanned).toBe(0)
  })

  it('picks a record up again once it is dirtied after the stamp', async () => {
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { phone: '+12133734253' })
    await seedContact(f, 'B', { phone: '+12133734253' })
    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    await db().execute(
      sql`UPDATE "EntityInstance" SET "updatedAt" = now() + interval '1 second' WHERE "id" = ${a}`
    )

    const again = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })
    expect(again.scanned).toBe(1)
  })

  it('finds a `skipEvents` write through the FieldValue lateral', async () => {
    // THE reason the predicate is not `updatedAt` alone: a connector sync or CSV
    // import leaves BOTH `EntityInstance.updatedAt` and `lastActivityAt`
    // untouched. `FieldValue.updatedAt` is the only timestamp that always moves.
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { email: 'a@example.com' })
    const b = await seedContact(f, 'B', { email: 'other@example.com' })
    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })
    expect(await pairCount(f.orgId)).toBe(0)

    // Exactly what a `skipEvents` writer does: the value row moves, the instance
    // row does not.
    await db().execute(sql`
      UPDATE "FieldValue"
      SET "valueText" = 'a@example.com', "updatedAt" = now() + interval '1 second'
      WHERE "entityId" = ${b} AND "fieldId" = ${f.emailFieldId}
    `)
    const beforeInstanceUpdatedAt = (
      await db()
        .select({ at: schema.EntityInstance.updatedAt })
        .from(schema.EntityInstance)
        .where(eq(schema.EntityInstance.id, b))
    )[0]?.at

    const again = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(again.scanned).toBe(1)
    expect(await pairCount(f.orgId)).toBe(1)
    // Sanity: the instance row really was untouched, so `updatedAt` alone could
    // never have found this record.
    const afterInstanceUpdatedAt = (
      await db()
        .select({ at: schema.EntityInstance.updatedAt })
        .from(schema.EntityInstance)
        .where(eq(schema.EntityInstance.id, b))
    )[0]?.at
    expect(afterInstanceUpdatedAt?.getTime()).toBe(beforeInstanceUpdatedAt?.getTime())
    expect(a).toBeTruthy()
  })

  it('closes a pair whose evidence is gone (rescore-on-change)', async () => {
    const f = await seedContactOrg()
    await seedContact(f, 'A', { email: 'same@example.com' })
    const b = await seedContact(f, 'B', { email: 'same@example.com' })
    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })
    expect(await pairCount(f.orgId)).toBe(1)

    await db().execute(sql`
      UPDATE "FieldValue"
      SET "valueText" = 'corrected@example.com', "updatedAt" = now() + interval '1 second'
      WHERE "entityId" = ${b} AND "fieldId" = ${f.emailFieldId}
    `)

    const again = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })
    expect(again.closed).toBe(1)
    expect(await pairCount(f.orgId)).toBe(0)
  })

  it('skips an org without the feature flag', async () => {
    const f = await seedContactOrg()
    flags.enabled.delete(f.orgId)
    await seedContact(f, 'A', { phone: '+12133734253' })
    await seedContact(f, 'B', { phone: '+12133734253' })

    const stats = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(stats.scanned).toBe(0)
    expect(await pairCount(f.orgId)).toBe(0)
  })

  it('never scans an archived record as a subject', async () => {
    // `EntityInstance_org_def_dup_scan_idx` is PARTIAL on `archivedAt IS NULL`,
    // so the predicate has to carry it — and it is correct on its own terms.
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { phone: '+12133734253' })
    await seedContact(f, 'B', { phone: '+12133734253' })
    await db()
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(eq(schema.EntityInstance.id, a))

    const stats = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(stats.scanned).toBe(1)
    expect(await pairCount(f.orgId)).toBe(0)
  })
})

describe('duplicateScanJob — recordIds scope (the sync-manifest door)', () => {
  it('scans exactly the manifest ids', async () => {
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { phone: '+12133734253' })
    const b = await seedContact(f, 'B', { phone: '+12133734253' })
    await seedContact(f, 'C', { phone: '+12125551234' })

    const stats = await runJob({
      organizationId: f.orgId,
      recordIds: [`${f.defId}:${a}`, `${f.defId}:${b}`],
    })

    expect(stats.scanned).toBe(2)
    expect(await pairCount(f.orgId)).toBe(1)
  })

  it('refuses ids from another organization', async () => {
    const f = await seedContactOrg()
    const other = await seedContactOrg()
    const foreign = await seedContact(other, 'X', { phone: '+12133734253' })

    const stats = await runJob({
      organizationId: f.orgId,
      recordIds: [`${other.defId}:${foreign}`],
    })

    expect(stats.scanned).toBe(0)
  })

  it('is idempotent — re-running the same manifest writes one pair', async () => {
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { phone: '+12133734253' })
    const b = await seedContact(f, 'B', { phone: '+12133734253' })
    const ids = [`${f.defId}:${a}`, `${f.defId}:${b}`]

    await runJob({ organizationId: f.orgId, recordIds: ids })
    await runJob({ organizationId: f.orgId, recordIds: ids })

    expect(await pairCount(f.orgId)).toBe(1)
  })
})

describe('duplicateScanJob — no scope (the 6h sweep)', () => {
  it('walks feature-enabled orgs × allowlisted definitions', async () => {
    const f = await seedContactOrg()
    await seedContact(f, 'A', { email: 'sweep@example.com' })
    await seedContact(f, 'B', { email: 'sweep@example.com' })

    const stats = await runJob({ dryRun: false })

    expect(stats.definitions).toBeGreaterThanOrEqual(1)
    expect(await pairCount(f.orgId)).toBe(1)
  })

  it('skips a definition whose entityType is not allowlisted', async () => {
    const f = await seedContactOrg()
    await db()
      .update(schema.EntityDefinition)
      .set({ entityType: 'ticket' })
      .where(eq(schema.EntityDefinition.id, f.defId))
    await seedContact(f, 'A', { email: 'sweep@example.com' })
    await seedContact(f, 'B', { email: 'sweep@example.com' })

    const stats = await runJob({ dryRun: false })

    expect(stats.definitions).toBe(0)
    expect(await pairCount(f.orgId)).toBe(0)
  })

  it('dryRun writes no pairs and stamps no watermark', async () => {
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { email: 'dry@example.com' })
    await seedContact(f, 'B', { email: 'dry@example.com' })

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId, dryRun: true })

    expect(await pairCount(f.orgId)).toBe(0)
    expect(await watermark(a)).toBeNull()
  })
})

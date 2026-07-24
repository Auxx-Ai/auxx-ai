// packages/lib/src/dashboards/dashboard-entity-link.int.test.ts
//
// DB-backed behavior tests (vitest.integration.config.ts → auxx_test database)
// for the Dashboards v2 entity link (plans/dashboard/v2/01-schema-and-api.md):
// the partial unique index (`Dashboard_org_entityDef_unique`), the forced
// org-shared workspace baseline (`isPrivate: false`) on link (doc 13), the
// BadRequestError/ConflictError mapping, the `getDashboard` entity-selector
// branch, and `duplicateDashboard` dropping the link. Written as integration
// tests (not db-mocked unit tests) — under the
// plain `vitest.config.ts`, `@auxx/database` is mocked to an empty Proxy
// (see [[project-drizzle-columns-undefined-in-vitest]]), which makes
// exercising real Drizzle queries impossible there; this suite is the closest
// thing to "unit" coverage the codebase's mocking style allows for
// db-touching mutation/query logic.
//
// `entityDefinitionId` values used below are real cuids (>= 20 chars), so
// `resolveEntityIdFromCache` short-circuits on its length check before ever
// touching the Redis-backed org cache — no cache mocking needed for those
// tests. Only the `slug` (unresolvable-key) test below goes through the
// resource-cache lookup path, so it mocks `../cache` the same way
// `resources/aggregate/run-aggregate.int.test.ts` does.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { generateId } from '@auxx/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, ConflictError, NotFoundError } from '../errors'
import {
  archiveDashboard,
  createDashboard,
  duplicateDashboard,
  updateDashboard,
} from './dashboard-mutations'
import { getDashboard } from './dashboard-queries'

vi.mock('../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    // The real org cache is Redis-backed and not available in this harness —
    // emulate the `resources` cache straight from the test DB so the
    // `assertEntityDefInOrg` cache check sees exactly the seeded defs.
    getCachedResources: async (orgId: string) => {
      const { eq } = await import('drizzle-orm')
      const rows = await (getTestDb() as unknown as Database)
        .select({ id: schema.EntityDefinition.id })
        .from(schema.EntityDefinition)
        .where(eq(schema.EntityDefinition.organizationId, orgId))
      return rows.map((r) => ({ entityDefinitionId: r.id }))
    },
    // Only exercised by the `slug` test — everything else here resolves via
    // a long entityDefinitionId and never reaches these.
    findCachedResource: async () => null,
    getCachedEntityDefId: async () => undefined,
    getOrgCache: () => ({ get: async () => ({}) }),
  }
})

const db = () => getTestDb() as unknown as Database

async function seedDef(orgId: string) {
  const name = `def_${generateId().slice(0, 8)}`
  const [row] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      apiSlug: name,
      singular: name,
      plural: `${name}s`,
      updatedAt: new Date(),
    })
    .returning()
  return row!
}

describe('dashboard entity link (plan 01)', () => {
  let org: Awaited<ReturnType<typeof createTestOrganization>>

  beforeEach(async () => {
    org = await createTestOrganization()
  })

  it('create forces the workspace baseline open when entityDefinitionId is set', async () => {
    const def = await seedDef(org.id)
    const result = await createDashboard(db(), org.id, org.ownerId, {
      name: 'Tickets',
      isPrivate: true,
      entityDefinitionId: def.id,
    })
    expect(result.isOk()).toBe(true)
    const dashboard = result._unsafeUnwrap()
    expect(dashboard.isPrivate).toBe(false)
    expect(dashboard.entityDefinitionId).toBe(def.id)
  })

  it('create rejects an entity def from another org', async () => {
    const otherOrg = await createTestOrganization()
    const foreignDef = await seedDef(otherOrg.id)
    const result = await createDashboard(db(), org.id, org.ownerId, {
      name: 'Tickets',
      entityDefinitionId: foreignDef.id,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('second create for the same def conflicts', async () => {
    const def = await seedDef(org.id)
    const first = await createDashboard(db(), org.id, org.ownerId, {
      name: 'Tickets',
      entityDefinitionId: def.id,
    })
    expect(first.isOk()).toBe(true)

    const second = await createDashboard(db(), org.id, org.ownerId, {
      name: 'Tickets 2',
      entityDefinitionId: def.id,
    })
    expect(second.isErr()).toBe(true)
    expect(second._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
  })

  it('archiving the linked dashboard lets a new one claim the def', async () => {
    const def = await seedDef(org.id)
    const first = await createDashboard(db(), org.id, org.ownerId, {
      name: 'Tickets',
      entityDefinitionId: def.id,
    })
    const firstId = first._unsafeUnwrap().id

    await archiveDashboard(db(), org.id, firstId)

    const second = await createDashboard(db(), org.id, org.ownerId, {
      name: 'Tickets 2',
      entityDefinitionId: def.id,
    })
    expect(second.isOk()).toBe(true)
  })

  it('duplicate drops the entity link', async () => {
    const def = await seedDef(org.id)
    const created = await createDashboard(db(), org.id, org.ownerId, {
      name: 'Tickets',
      entityDefinitionId: def.id,
    })
    const source = created._unsafeUnwrap()

    const copy = await duplicateDashboard(db(), org.id, org.ownerId, source.id)
    expect(copy.isOk()).toBe(true)
    expect(copy._unsafeUnwrap().entityDefinitionId).toBeNull()
  })

  describe('getDashboard by entity', () => {
    it('returns null when no dashboard is linked', async () => {
      const def = await seedDef(org.id)
      const result = await getDashboard(db(), org.id, { entityDefinitionId: def.id })
      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBeNull()
    })

    it('returns the linked dashboard once one exists', async () => {
      const def = await seedDef(org.id)
      const created = await createDashboard(db(), org.id, org.ownerId, {
        name: 'Tickets',
        entityDefinitionId: def.id,
      })
      const dashboardId = created._unsafeUnwrap().id

      const result = await getDashboard(db(), org.id, { entityDefinitionId: def.id })
      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()?.id).toBe(dashboardId)
    })

    it('returns null again after the linked dashboard is archived', async () => {
      const def = await seedDef(org.id)
      const created = await createDashboard(db(), org.id, org.ownerId, {
        name: 'Tickets',
        entityDefinitionId: def.id,
      })
      const dashboardId = created._unsafeUnwrap().id
      await archiveDashboard(db(), org.id, dashboardId)

      const result = await getDashboard(db(), org.id, { entityDefinitionId: def.id })
      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBeNull()
    })

    it('an unresolvable entity key is a NotFoundError', async () => {
      const result = await getDashboard(db(), org.id, { slug: 'not-a-real-slug' })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    })
  })

  describe('updateDashboard entity link', () => {
    it('linking forces the workspace baseline open and rejects a foreign def', async () => {
      const def = await seedDef(org.id)
      const created = await createDashboard(db(), org.id, org.ownerId, {
        name: 'Plain',
        isPrivate: true,
      })
      const dashboardId = created._unsafeUnwrap().id

      const otherOrg = await createTestOrganization()
      const foreignDef = await seedDef(otherOrg.id)
      const rejected = await updateDashboard(db(), org.id, org.ownerId, dashboardId, {
        entityDefinitionId: foreignDef.id,
      })
      expect(rejected.isErr()).toBe(true)
      expect(rejected._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)

      const linked = await updateDashboard(db(), org.id, org.ownerId, dashboardId, {
        entityDefinitionId: def.id,
      })
      expect(linked.isOk()).toBe(true)
      const value = linked._unsafeUnwrap()
      expect(value.isPrivate).toBe(false)
      expect(value.entityDefinitionId).toBe(def.id)
    })

    it('unlinking with null clears the def and leaves the baseline untouched', async () => {
      const def = await seedDef(org.id)
      const created = await createDashboard(db(), org.id, org.ownerId, {
        name: 'Tickets',
        entityDefinitionId: def.id,
      })
      const dashboardId = created._unsafeUnwrap().id

      const unlinked = await updateDashboard(db(), org.id, org.ownerId, dashboardId, {
        entityDefinitionId: null,
      })
      expect(unlinked.isOk()).toBe(true)
      const value = unlinked._unsafeUnwrap()
      expect(value.entityDefinitionId).toBeNull()
      // Was forced open on create; unlinking doesn't touch the baseline.
      expect(value.isPrivate).toBe(false)
    })

    it('linking to a def another live dashboard already owns conflicts', async () => {
      const def = await seedDef(org.id)
      await createDashboard(db(), org.id, org.ownerId, {
        name: 'Tickets',
        entityDefinitionId: def.id,
      })

      const other = await createDashboard(db(), org.id, org.ownerId, { name: 'Plain' })
      const otherId = other._unsafeUnwrap().id

      const result = await updateDashboard(db(), org.id, org.ownerId, otherId, {
        entityDefinitionId: def.id,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    })
  })
})

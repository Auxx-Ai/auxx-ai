// packages/lib/src/seed/entity-seeder/create-default-dashboards.int.test.ts
//
// DB-backed behavior tests (vitest.integration.config.ts → auxx_test database) for the
// Dashboards v2 default-entity-dashboard seeder (plans/dashboard/v2/03-seeding.md): fresh-org
// seeding creates exactly the 3 templated dashboards, each strict-valid; re-running is a no-op;
// an org with an archived ticket dashboard gets no new one.
//
// A full `EntitySeeder.seedSystemEntities()` (or `OrganizationSeeder.seedNewOrganization()`) run
// is too heavy for this harness (it touches billing, KB, inboxes, snippets, etc.) — this suite
// seeds just the EntityDefinition + CustomField rows `ensureDefaultDashboard` actually reads
// (mirroring the shape `EntitySeeder`'s Pass 1/2 would have produced) and calls
// `ensureDefaultDashboard` directly per entity type, the same loop `createDefaultDashboards`
// runs internally.

import { type Database, schema } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { dashboardLayoutDocSchema } from '../../dashboards/config-schemas'
import { COMPANY_FIELDS } from '../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../resources/registry/resources/contact-fields'
import { TICKET_FIELDS } from '../../resources/registry/resources/ticket-fields'
import { DEFAULT_DASHBOARD_CONFIGS } from '../default-dashboard-configs'
import { ensureDefaultDashboard, type ResolvableEntityDefMap } from './create-default-dashboards'
import type { ResolvableFieldMap } from './create-default-views'

const db = () => getTestDb() as unknown as Database

/** Insert EntityDefinition + CustomField rows for ticket/contact/company and return the maps
 * `ensureDefaultDashboard` expects (mirrors what `EntitySeeder` Pass 1/2 produce for real). */
async function seedEntityDefsAndFields(
  orgId: string
): Promise<{ entityDefMap: ResolvableEntityDefMap; fieldMap: ResolvableFieldMap }> {
  const entityDefMap: ResolvableEntityDefMap = new Map()
  const fieldMap: ResolvableFieldMap = new Map()

  const registries: [string, Record<string, { id: string; systemAttribute?: string }>][] = [
    ['ticket', TICKET_FIELDS],
    ['contact', CONTACT_FIELDS],
    ['company', COMPANY_FIELDS],
  ]

  for (const [entityType, fields] of registries) {
    const [def] = await db()
      .insert(schema.EntityDefinition)
      .values({
        organizationId: orgId,
        entityType,
        apiSlug: `${entityType}s`,
        singular: entityType,
        plural: `${entityType}s`,
        updatedAt: new Date(),
      })
      .returning()
    if (!def) throw new Error(`Failed to seed EntityDefinition for ${entityType}`)
    entityDefMap.set(entityType, { id: def.id })

    for (const field of Object.values(fields)) {
      if (!field.systemAttribute) continue
      const [created] = await db()
        .insert(schema.CustomField)
        .values({
          organizationId: orgId,
          entityDefinitionId: def.id,
          modelType: entityType,
          name: field.systemAttribute,
          type: 'TEXT',
          systemAttribute: field.systemAttribute,
          isCustom: false,
          updatedAt: new Date(),
        })
        .returning()
      if (!created) throw new Error(`Failed to seed CustomField ${entityType}:${field.id}`)
      fieldMap.set(`${entityType}:${field.id}`, {
        id: created.id,
        systemAttribute: field.systemAttribute,
      })
    }
  }

  return { entityDefMap, fieldMap }
}

async function seedAllDefaultDashboards(
  orgId: string,
  userId: string,
  entityDefMap: ResolvableEntityDefMap,
  fieldMap: ResolvableFieldMap
): Promise<boolean[]> {
  const results: boolean[] = []
  for (const [entityType, def] of Object.entries(DEFAULT_DASHBOARD_CONFIGS)) {
    if (!def) continue
    results.push(
      await ensureDefaultDashboard(db(), orgId, userId, entityType, def, entityDefMap, fieldMap)
    )
  }
  return results
}

describe('create-default-dashboards (plan 03)', () => {
  let org: Awaited<ReturnType<typeof createTestOrganization>>

  beforeEach(async () => {
    org = await createTestOrganization()
  })

  it('fresh-org seeding creates exactly 3 strict-valid dashboards', async () => {
    const { entityDefMap, fieldMap } = await seedEntityDefsAndFields(org.id)

    const created = await seedAllDefaultDashboards(org.id, org.ownerId, entityDefMap, fieldMap)
    expect(created).toEqual([true, true, true])

    const rows = await db()
      .select()
      .from(schema.Dashboard)
      .where(eq(schema.Dashboard.organizationId, org.id))
    expect(rows.length).toBe(3)

    const linkedDefIds = new Set(rows.map((r) => r.entityDefinitionId))
    expect(linkedDefIds).toEqual(
      new Set([
        entityDefMap.get('ticket')!.id,
        entityDefMap.get('contact')!.id,
        entityDefMap.get('company')!.id,
      ])
    )

    for (const row of rows) {
      expect(row.activeVersionId).not.toBeNull()

      const version = await db().query.DashboardVersion.findFirst({
        where: eq(schema.DashboardVersion.id, row.activeVersionId!),
      })
      expect(version).toBeTruthy()
      const parsed = dashboardLayoutDocSchema.safeParse(version!.layout)
      expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error!.format())).toBe(
        true
      )
      // draftLayout mirrors the published version and starts with no pending changes.
      expect(row.draftLayout).toEqual(version!.layout)
      expect(row.hasUnpublishedChanges).toBe(false)

      // insertPublishedDashboard writes the org-shared workspace baseline for
      // free (doc 13 §2/§4) — a default dashboard must be visible with no
      // separate Share-card step.
      const baseline = await db().query.ResourceAccess.findFirst({
        where: and(
          eq(schema.ResourceAccess.organizationId, org.id),
          eq(schema.ResourceAccess.entityDefinitionId, 'dashboard'),
          eq(schema.ResourceAccess.entityInstanceId, row.id),
          eq(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
          eq(schema.ResourceAccess.granteeId, 'org_member')
        ),
      })
      expect(baseline?.rung).toBe('read')
    }
  })

  it('re-running is a no-op — the unique index stays intact', async () => {
    const { entityDefMap, fieldMap } = await seedEntityDefsAndFields(org.id)

    await seedAllDefaultDashboards(org.id, org.ownerId, entityDefMap, fieldMap)
    const secondRun = await seedAllDefaultDashboards(org.id, org.ownerId, entityDefMap, fieldMap)
    expect(secondRun).toEqual([false, false, false])

    const rows = await db()
      .select()
      .from(schema.Dashboard)
      .where(eq(schema.Dashboard.organizationId, org.id))
    expect(rows.length).toBe(3)
  })

  it('an org with an archived ticket dashboard gets no new one', async () => {
    const { entityDefMap, fieldMap } = await seedEntityDefsAndFields(org.id)
    const ticketDefId = entityDefMap.get('ticket')!.id

    // Simulate a user-deleted (archived) ticket dashboard that predates the seeder run.
    await db().insert(schema.Dashboard).values({
      organizationId: org.id,
      name: 'Old Tickets',
      entityDefinitionId: ticketDefId,
      archivedAt: new Date(),
      updatedAt: new Date(),
    })

    const created = await seedAllDefaultDashboards(org.id, org.ownerId, entityDefMap, fieldMap)
    expect(created).toEqual([false, true, true]) // ticket skipped, contact + company seeded

    const ticketRows = await db()
      .select()
      .from(schema.Dashboard)
      .where(
        and(
          eq(schema.Dashboard.organizationId, org.id),
          eq(schema.Dashboard.entityDefinitionId, ticketDefId)
        )
      )
    expect(ticketRows.length).toBe(1) // only the pre-existing archived row — never resurrected
    expect(ticketRows[0]!.archivedAt).not.toBeNull()
  })
})

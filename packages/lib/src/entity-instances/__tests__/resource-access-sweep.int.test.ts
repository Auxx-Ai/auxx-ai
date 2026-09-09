// packages/lib/src/entity-instances/__tests__/resource-access-sweep.int.test.ts
//
// DB-backed regression test (vitest.integration.config.ts → auxx_test) for a
// deleted record leaving its share rows behind.
//
// `ResourceAccess.entityInstanceId` is a bare `text()` column with no foreign
// key — it cannot have one, because `entityDefinitionId` carries two disjoint
// keyspaces (an `EntityDefinition.id`, or a reserved slug like 'contact' /
// 'thread' / 'dashboard') and the target therefore lives in a different table
// per row. No delete path had ever swept it: dev held 3 rows granting access to
// things that no longer exist (plan 46 §11), unbounded over time.
//
// WHY INTEGRATION. The claim is about a column written in TWO keyspaces for one
// record, and the unit test cannot make it: `src/test/setup.ts` mocks
// `@auxx/database` and its schema proxy gives every table columns of
// `undefined`, so a def filter and an instance filter are indistinguishable
// there. Only real rows in real Postgres prove that BOTH keyspaces go.
//
// The org cache is mocked wholesale (same approach as `timeline-sweep.int.test.ts`)
// because the field-value sweep's display cascade reads Redis-backed
// `getCachedResources`.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteEntityInstance } from '../delete-entity-instance'

const db = () => getTestDb() as never as Database

vi.mock('../../cache', () => ({
  getCachedResources: async () => [],
}))

interface Fixture {
  orgId: string
  otherOrgId: string
  contactDefId: string
  contactId: string
  bystanderId: string
}

async function grant(args: {
  orgId: string
  entityDefinitionId: string
  entityInstanceId: string | null
  granteeId?: string
}): Promise<string> {
  const [row] = await db()
    .insert(schema.ResourceAccess)
    .values({
      organizationId: args.orgId,
      entityDefinitionId: args.entityDefinitionId,
      entityInstanceId: args.entityInstanceId,
      granteeType: 'role',
      granteeId: args.granteeId ?? 'org_member',
      rung: 'read',
      updatedAt: new Date(),
    })
    .returning()
  return row!.id
}

async function grantsFor(instanceId: string) {
  return await db()
    .select()
    .from(schema.ResourceAccess)
    .where(eq(schema.ResourceAccess.entityInstanceId, instanceId))
}

async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()
  const otherOrg = await createTestOrganization()

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      entityType: 'contact',
      apiSlug: 'contacts',
      singular: 'Contact',
      plural: 'Contacts',
      updatedAt: new Date(),
    })
    .returning()

  const [contact] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      displayName: 'Mario Dunkel',
      updatedAt: new Date(),
    })
    .returning()

  const [bystander] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      displayName: 'Anna Reiter',
      updatedAt: new Date(),
    })
    .returning()

  return {
    orgId: org.id,
    otherOrgId: otherOrg.id,
    contactDefId: def!.id,
    contactId: contact!.id,
    bystanderId: bystander!.id,
  }
}

let f: Fixture
beforeEach(async () => {
  vi.clearAllMocks()
  f = await seed()
})

describe('deleteEntityInstance — ResourceAccess sweep', () => {
  it('⚠️ takes the record’s rows under BOTH keyspaces', async () => {
    // A contact's grants are keyed under the 'contact' SLUG; a custom record's
    // under its definition's cuid. The same instance can hold both, and a caller
    // with an instance id cannot know which was used — which is exactly why the
    // sweep carries no `entityDefinitionId` filter at all.
    await grant({
      orgId: f.orgId,
      entityDefinitionId: f.contactDefId,
      entityInstanceId: f.contactId,
    })
    await grant({ orgId: f.orgId, entityDefinitionId: 'contact', entityInstanceId: f.contactId })
    expect(await grantsFor(f.contactId)).toHaveLength(2)

    const result = await deleteEntityInstance({ id: f.contactId, organizationId: f.orgId })
    expect(result.isOk()).toBe(true)

    expect(await grantsFor(f.contactId)).toHaveLength(0)
  })

  it('does not reach another record’s rows in the same org', async () => {
    await grant({ orgId: f.orgId, entityDefinitionId: 'contact', entityInstanceId: f.contactId })
    await grant({ orgId: f.orgId, entityDefinitionId: 'contact', entityInstanceId: f.bystanderId })
    await grant({
      orgId: f.orgId,
      entityDefinitionId: f.contactDefId,
      entityInstanceId: f.bystanderId,
    })

    await deleteEntityInstance({ id: f.contactId, organizationId: f.orgId })

    expect(await grantsFor(f.contactId)).toHaveLength(0)
    expect(await grantsFor(f.bystanderId)).toHaveLength(2)
  })

  it('leaves TYPE-level rows alone — those describe the definition, not the record', async () => {
    // `entityInstanceId IS NULL` means "every instance of this type". The
    // definition is still alive; only one of its records went.
    await grant({ orgId: f.orgId, entityDefinitionId: f.contactDefId, entityInstanceId: null })
    await grant({
      orgId: f.orgId,
      entityDefinitionId: f.contactDefId,
      entityInstanceId: f.contactId,
    })

    await deleteEntityInstance({ id: f.contactId, organizationId: f.orgId })

    const typeRows = await db()
      .select()
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, f.orgId),
          eq(schema.ResourceAccess.entityDefinitionId, f.contactDefId),
          isNull(schema.ResourceAccess.entityInstanceId)
        )
      )
    expect(typeRows).toHaveLength(1)
  })

  it('is org-scoped — a mismatched org sweeps nothing', async () => {
    await grant({ orgId: f.orgId, entityDefinitionId: 'contact', entityInstanceId: f.contactId })

    const result = await deleteEntityInstance({ id: f.contactId, organizationId: f.otherOrgId })
    expect(result.isOk()).toBe(true)

    expect(await grantsFor(f.contactId)).toHaveLength(1)
  })

  it('sweeps every grantee’s row on the record, not just one', async () => {
    await grant({
      orgId: f.orgId,
      entityDefinitionId: 'contact',
      entityInstanceId: f.contactId,
      granteeId: 'org_member',
    })
    await grant({
      orgId: f.orgId,
      entityDefinitionId: 'contact',
      entityInstanceId: f.contactId,
      granteeId: 'org_admin',
    })

    await deleteEntityInstance({ id: f.contactId, organizationId: f.orgId })

    expect(await grantsFor(f.contactId)).toHaveLength(0)
  })
})

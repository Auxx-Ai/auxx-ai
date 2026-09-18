// packages/lib/src/accounting/providers/__tests__/book-connections.int.test.ts
import { schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  activateAccountingBookConnection,
  readPinnedAccountingConnection,
  repairAccountingBookConnection,
} from '../book-connections'

const db = () => getTestDb()
let organizationId: string, actorUserId: string, appId: string, appInstallationId: string
const openingPolicy = {
  version: 1 as const,
  kind: 'explicit_cutover' as const,
  exportFromDate: '2026-09-01',
  reason: 'Reviewed opening boundary',
}
beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  actorUserId = (await createTestUser()).id
  const [developer] = await db()
    .insert(schema.DeveloperAccount)
    .values({ slug: 'accounting-fixture', title: 'Fixture' })
    .returning()
  const [app] = await db()
    .insert(schema.App)
    .values({ developerAccountId: developer!.id, slug: 'quickbooks', title: 'QuickBooks' })
    .returning()
  appId = app!.id
  const [install] = await db()
    .insert(schema.AppInstallation)
    .values({ appId, organizationId, installationType: 'development' })
    .returning()
  appInstallationId = install!.id
})
async function credential(companyId: string) {
  const [row] = await db()
    .insert(schema.Credential)
    .values({
      organizationId,
      appId,
      appInstallationId,
      kind: 'app',
      name: 'Fixture authorization',
      encryptedSecrets: 'fixture-only-no-token',
      metadata: { realmId: companyId },
      updatedAt: new Date(),
    })
    .returning()
  return row!
}
async function activate(credentialId: string, expectedActiveConnectionId: string | null) {
  return activateAccountingBookConnection(db(), {
    organizationId,
    actorUserId,
    credentialId,
    expectedActiveConnectionId,
    openingPolicy,
    exportFromDate: openingPolicy.exportFromDate,
  })
}
function repair(
  connectionId: string,
  credentialId: string,
  expectedActiveConnectionId: string | null
) {
  return repairAccountingBookConnection(db(), {
    organizationId,
    actorUserId,
    connectionId,
    credentialId,
    expectedActiveConnectionId,
    reason: 'Authorization restored',
  })
}
describe('explicit accounting connection repair against PostgreSQL', () => {
  it('restores disconnected connectivity without changing epoch, boundary or original binding evidence', async () => {
    const first = await credential('A')
    const connection = await activate(first.id, null)
    await db()
      .update(schema.ExternalBookConnection)
      .set({ state: 'disconnected' })
      .where(eq(schema.ExternalBookConnection.id, connection.id))
    const replacement = await credential('A')
    const repaired = await repair(connection.id, replacement.id, null)
    expect(repaired).toMatchObject({
      id: connection.id,
      bookId: connection.bookId,
      epoch: connection.epoch,
      openingPolicy: connection.openingPolicy,
      exportFromDate: connection.exportFromDate,
      credentialBindingSnapshot: connection.credentialBindingSnapshot,
      credentialId: replacement.id,
      state: 'active',
    })
    expect(await readPinnedAccountingConnection(db(), organizationId, connection.id)).toMatchObject(
      { companyId: 'A', credentialId: replacement.id }
    )
  })
  it('requires explicit rebind before a historical epoch uses the current same-company credential', async () => {
    const first = await credential('A')
    const original = await activate(first.id, null)
    const replacement = await credential('A')
    const current = await activate(replacement.id, original.id)
    await expect(readPinnedAccountingConnection(db(), organizationId, original.id)).rejects.toThrow(
      'Repair'
    )
    await repair(original.id, replacement.id, current.id)
    expect(await readPinnedAccountingConnection(db(), organizationId, original.id)).toMatchObject({
      connectionId: original.id,
      companyId: 'A',
      credentialId: replacement.id,
    })
    expect(
      (await db().select().from(schema.ExternalBookConnection))
        .filter((c) => c.state === 'active')
        .map((c) => c.id)
    ).toEqual([current.id])
  })
  it('refuses credentials for another company without changing history', async () => {
    const first = await credential('A')
    const original = await activate(first.id, null)
    const wrong = await credential('B')
    await expect(repair(original.id, wrong.id, original.id)).rejects.toThrow(
      'original QuickBooks company'
    )
    expect((await db().select().from(schema.ExternalBookConnection))[0]!.credentialId).toBe(
      first.id
    )
  })
  it('blocks historical delivery and repair while another company is active', async () => {
    const first = await credential('A')
    const original = await activate(first.id, null)
    const other = await credential('B')
    const current = await activate(other.id, original.id)
    await expect(
      readPinnedAccountingConnection(db(), organizationId, original.id)
    ).rejects.toThrow()
    await expect(repair(original.id, first.id, current.id)).rejects.toThrow(
      'same QuickBooks company'
    )
  })
  it('refuses stale activation state and saves no repair audit', async () => {
    const first = await credential('A')
    const original = await activate(first.id, null)
    const audits = await db().select().from(schema.AuditLog)
    await expect(repair(original.id, first.id, null)).rejects.toThrow(
      'active accounting company changed'
    )
    expect(await db().select().from(schema.AuditLog)).toHaveLength(audits.length)
  })
  it('rejects cross-organization connection references', async () => {
    const first = await credential('A')
    const original = await activate(first.id, null)
    const other = (await createTestOrganization()).id
    await expect(
      repairAccountingBookConnection(db(), {
        organizationId: other,
        actorUserId,
        connectionId: original.id,
        credentialId: first.id,
        expectedActiveConnectionId: null,
        reason: 'Repair',
      })
    ).rejects.toThrow('not found')
  })
})

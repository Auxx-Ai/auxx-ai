// packages/lib/src/connections/__tests__/credential-writes.test.ts
//
// What "default" means for an app's connections: exactly one org-scoped row carries the
// flag. The clear and the set are two statements, so the order and the predicates are
// what keep the partial unique index from refusing the pair.

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { setDefaultAppCredential } from '../credential-writes'

/** The bound parameters of a rendered predicate — identifiers come back blank. */
function params(fragment: unknown): unknown[] {
  return new PgDialect().sqlToQuery(fragment as never).params
}

function fakeDb() {
  const updates: { values: Record<string, unknown>; params: unknown[] }[] = []
  const db = {
    updates,
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async (predicate: unknown) => {
          updates.push({ values, params: params(predicate) })
        },
      }),
    }),
  }
  return db as unknown as Parameters<typeof setDefaultAppCredential>[0] & typeof db
}

describe('setDefaultAppCredential', () => {
  it('clears the old default before it sets the new one', async () => {
    const db = fakeDb()
    await setDefaultAppCredential(db, 'org_1', { appId: 'app_1', credentialId: 'cred_2' })

    expect(db.updates).toHaveLength(2)
    expect(db.updates[0]?.values.isDefault).toBe(false)
    expect(db.updates[1]?.values.isDefault).toBe(true)
  })

  it('clears only the SIBLINGS of the same org and app, never the chosen row', async () => {
    // Without the `ne(id)` arm the clear would race the set and leave the org with no
    // default at all; without the app scope it would clear another app's connection.
    const db = fakeDb()
    await setDefaultAppCredential(db, 'org_1', { appId: 'app_1', credentialId: 'cred_2' })

    expect(db.updates[0]?.params).toEqual(expect.arrayContaining(['org_1', 'app_1', 'cred_2']))
  })

  it('sets the flag on one credential, scoped to its org', async () => {
    const db = fakeDb()
    await setDefaultAppCredential(db, 'org_1', { appId: 'app_1', credentialId: 'cred_2' })

    expect(db.updates[1]?.params).toEqual(expect.arrayContaining(['org_1', 'cred_2']))
    expect(db.updates[1]?.params).not.toContain('app_1')
  })
})

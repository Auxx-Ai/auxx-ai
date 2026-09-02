// packages/lib/src/data-connectors/adopt-shared-owned-def.test.ts
// Adoption decision for a second connector's owned mapping: share an existing app-owned
// def by (appInstallationId, sourceKey) instead of forking. Requires the SAME app install
// (owned field values resolve through @app: refs keyed on appFieldKey + install); no
// install → never adopt (fork). See shared-definitions-across-connectors-plan.md.

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { adoptSharedOwnedDefId } from './mutations'

/** Minimal drizzle chain whose terminal `.limit()` resolves to `rows`. */
function mockDb(rows: Array<{ id: string }>) {
  const limit = vi.fn(() => Promise.resolve(rows))
  const chain = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit,
  }
  return { db: chain as unknown as Database, select: chain.select, limit }
}

const ORG = 'org_1'
const INSTALL = 'inst_1'
const KEY = 'issues'

describe('adoptSharedOwnedDefId', () => {
  it('adopts the existing app-owned def for the record type', async () => {
    const { db, limit } = mockDb([{ id: 'def_shared' }])
    await expect(adoptSharedOwnedDefId(db, ORG, INSTALL, KEY)).resolves.toBe('def_shared')
    expect(limit).toHaveBeenCalledWith(1)
  })

  it('forks (returns null) when no matching def exists', async () => {
    const { db } = mockDb([])
    await expect(adoptSharedOwnedDefId(db, ORG, INSTALL, KEY)).resolves.toBeNull()
  })

  it('never adopts across installs — no appInstallationId means fork, and no query runs', async () => {
    const { db, select } = mockDb([{ id: 'def_shared' }])
    await expect(adoptSharedOwnedDefId(db, ORG, null, KEY)).resolves.toBeNull()
    await expect(adoptSharedOwnedDefId(db, ORG, undefined, KEY)).resolves.toBeNull()
    expect(select).not.toHaveBeenCalled()
  })
})

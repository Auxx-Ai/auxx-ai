// packages/lib/src/connections/__tests__/credential-reads.test.ts
//
// Renders the WHERE Drizzle builds, the same technique as
// approval-requests/__tests__/approval-request-queries.test.ts: the default lib
// mock replaces every schema column with `{}`, which makes a predicate assertion
// pass vacuously, so this re-mocks `@auxx/database` with the real schema barrel.

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  return { schema }
})

let listAppCredentials: typeof import('../credential-reads').listAppCredentials

beforeAll(async () => {
  ;({ listAppCredentials } = await import('../credential-reads'))
})

/** A `db.select(...)` stub that captures the `where` predicate and resolves empty. */
function dbCapturingWhere(capture: (condition: unknown) => void) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: (condition: unknown) => {
      capture(condition)
      return chain
    },
    limit: () => Promise.resolve([]),
    then: (resolve: (rows: unknown[]) => void) => resolve([]),
  }
  return { select: () => chain } as never
}

const render = (predicate: unknown) => new PgDialect().sqlToQuery(predicate as never)

describe('listAppCredentials', () => {
  it('always scopes to the org and kind=app', async () => {
    let captured: unknown
    await listAppCredentials(
      dbCapturingWhere((c) => (captured = c)),
      'org_1',
      {}
    )
    const { sql, params } = render(captured)
    expect(sql).toContain('"organizationId" =')
    expect(sql).toContain('"kind" =')
    expect(params).toContain('org_1')
    expect(params).toContain('app')
  })

  it('adds the userId-is-null arm only when orgScopedOnly is set', async () => {
    let captured: unknown
    await listAppCredentials(
      dbCapturingWhere((c) => (captured = c)),
      'org_1',
      {
        orgScopedOnly: true,
      }
    )
    const { sql } = render(captured)
    expect(sql.toLowerCase()).toContain('"userid" is null')
  })

  it('omits the userId arm when orgScopedOnly is not set', async () => {
    let captured: unknown
    await listAppCredentials(
      dbCapturingWhere((c) => (captured = c)),
      'org_1',
      {}
    )
    const { sql } = render(captured)
    expect(sql.toLowerCase()).not.toContain('"userid" is null')
  })

  it('filters on the App slug when appSlug is given', async () => {
    let captured: unknown
    await listAppCredentials(
      dbCapturingWhere((c) => (captured = c)),
      'org_1',
      {
        appSlug: 'quickbooks',
      }
    )
    const { sql, params } = render(captured)
    expect(sql).toContain('"slug" =')
    expect(params).toContain('quickbooks')
  })

  it('filters on appInstallationId when given, widened for the disconnect caller', async () => {
    let captured: unknown
    await listAppCredentials(
      dbCapturingWhere((c) => (captured = c)),
      'org_1',
      {
        appInstallationId: 'install_1',
      }
    )
    const { sql, params } = render(captured)
    expect(sql).toContain('"appInstallationId" =')
    expect(params).toContain('install_1')
  })
})

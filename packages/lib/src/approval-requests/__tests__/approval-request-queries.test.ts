// packages/lib/src/approval-requests/__tests__/approval-request-queries.test.ts
//
// Plan 28 H1 + plan 42 §11 item 8: the two INDEPENDENT nullable-column exclusions
// that would each, on their own, ship the access lane invisible.
//
// These assert on RENDERED SQL, deliberately. The default lib Vitest config mocks
// `@auxx/database`'s `schema` as `new Proxy({}, { get: () => ({}) })`
// (`src/test/setup.ts:76`), so every column is a fresh empty object and any
// assertion on a predicate built from it passes VACUOUSLY. This file therefore
// re-mocks `@auxx/database` with the REAL schema barrel — which is pure Drizzle
// with no connection — and renders the predicate through `PgDialect`. A mutation
// that drops `isNull(expiresAt)` or the `kind <> 'workflow'` arm changes the SQL
// text, so the test fails.

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// NOTE on the deep relative import: it puts `packages/database/src/**` into THIS
// package's tsc program, which surfaces ~200 of that package's own pre-existing
// errors under a `packages/lib` typecheck. That is cosmetic — `packages/lib`'s own
// `src/` count is unaffected — and the alternatives are worse: a variable specifier
// breaks Vitest's resolution, and `@auxx/database` itself is the module being
// mocked here, so it cannot also be the source of the real schema.
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  const enums = await import('../../../../database/src/enums')
  return { schema, ...enums, database: {} }
})

const isOrgMember = vi.fn(async () => true)
vi.mock('../../cache', () => ({
  getCachedUserGroupIds: vi.fn(async () => []),
  getCachedMembersByUserIds: vi.fn(async () => []),
  isOrgMember: (...args: unknown[]) =>
    (isOrgMember as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}))

let notExpired: typeof import('../approval-request-queries').notExpired
let runStillActiveOrNotWorkflow: typeof import('../approval-request-queries').runStillActiveOrNotWorkflow

beforeAll(async () => {
  const mod = await import('../approval-request-queries')
  notExpired = mod.notExpired
  runStillActiveOrNotWorkflow = mod.runStillActiveOrNotWorkflow
})

const render = (predicate: unknown) => new PgDialect().sqlToQuery(predicate as never)

describe('notExpired — plan 42 §11 item 8 (H1’s sibling)', () => {
  it('admits a NULL expiry rather than silently excluding it', () => {
    const { sql } = render(notExpired())
    // `NULL > now()` is NULL, not true. Without the explicit null arm a request
    // with no expiry is invisible in BOTH the list and the badge.
    expect(sql.toLowerCase()).toContain('"expiresat" is null')
  })

  it('still excludes a request whose expiry has passed', () => {
    const { sql } = render(notExpired())
    expect(sql).toContain('"expiresAt" >')
  })

  it('ORs the two arms rather than ANDing them', () => {
    const { sql } = render(notExpired())
    expect(sql.toLowerCase()).toContain(' or ')
    expect(sql.toLowerCase()).not.toContain(' and ')
  })
})

describe('runStillActiveOrNotWorkflow — plan 28 H1', () => {
  it('admits any row whose kind is not `workflow`', () => {
    const { sql, params } = render(runStillActiveOrNotWorkflow())
    // The LEFT JOIN yields NULL for an access row, and `NULL IN (...)` is NULL —
    // so the run-status arm must be reachable only for workflow rows.
    expect(sql).toContain('"kind" <>')
    expect(params).toContain('workflow')
  })

  it('still constrains a workflow row to a live run', () => {
    const { sql, params } = render(runStillActiveOrNotWorkflow())
    expect(sql.toLowerCase()).toContain('in (')
    expect(params).toContain('RUNNING')
    expect(params).toContain('WAITING')
  })

  it('ORs the kind escape with the run-status filter', () => {
    const { sql } = render(runStillActiveOrNotWorkflow())
    expect(sql.toLowerCase()).toContain(' or ')
  })
})

/**
 * A `db` stub that records every `where()` argument so the built predicate can be
 * rendered to SQL and asserted, and resolves the builder to `[]` — `getPendingCount`
 * awaits it and destructures `[row]`.
 */
const capture = () => {
  const whereArgs: unknown[] = []
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'leftJoin', 'orderBy', 'limit']) {
    chain[key] = () => chain
  }
  chain.where = (arg: unknown) => {
    whereArgs.push(arg)
    return chain
  }
  ;(chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => resolve([])
  return { db: { select: () => chain }, whereArgs }
}

describe('both list surfaces use the same two predicates', () => {
  // The predicate is duplicated in SQL across `listApprovalsForUser` and
  // `getPendingCount`. A fix applied to one leaves the badge disagreeing with the
  // list, which is why this asserts the WHERE clause of each carries both arms.

  it('listApprovalsForUser admits a null-expiry access row', async () => {
    const mod = await import('../approval-request-queries')
    const { db, whereArgs } = capture()
    await mod.listApprovalsForUser(db as never, 'org1', 'user1')
    const { sql, params } = render(whereArgs[0])
    expect(sql.toLowerCase()).toContain('"expiresat" is null')
    expect(sql).toContain('"kind" <>')
    expect(params).toContain('workflow')
  })

  it('getPendingCount admits a null-expiry access row too', async () => {
    const mod = await import('../approval-request-queries')
    const { db, whereArgs } = capture()
    await mod.getPendingCount(db as never, 'org1', 'user1')
    const { sql, params } = render(whereArgs[0])
    expect(sql.toLowerCase()).toContain('"expiresat" is null')
    expect(sql).toContain('"kind" <>')
    expect(params).toContain('workflow')
  })
})

describe('listApprovalsForUser — the two views partition the member’s rows', () => {
  // `past` is the COMPLEMENT of `pending`, not a status list. A status list would
  // strand a `pending` access request whose 14-day expiry lapsed — nothing ever
  // rewrites it to `timeout` — leaving it in neither view.
  it('past negates the whole actionable predicate rather than listing statuses', async () => {
    const mod = await import('../approval-request-queries')
    const { db, whereArgs } = capture()
    await mod.listApprovalsForUser(db as never, 'org1', 'user1', { view: 'past' })
    const { sql } = render(whereArgs[0])
    expect(sql.toLowerCase()).toContain('not (')
    // The negated conjunction still carries both null-safety arms — negating a
    // predicate that could go NULL would silently drop rows.
    expect(sql.toLowerCase()).toContain('"expiresat" is null')
  })

  // A requester is never in `assigneeUsers`, so an assignee-only audience would
  // hide the outcome of their own request — and a DENIED row is exactly the case
  // where they have no access to hydrate the target from anywhere else.
  it('past admits rows the member filed, pending does not', async () => {
    const mod = await import('../approval-request-queries')
    const past = capture()
    await mod.listApprovalsForUser(past.db as never, 'org1', 'user1', { view: 'past' })
    expect(render(past.whereArgs[0]).sql).toContain('"createdById"')

    const pending = capture()
    await mod.listApprovalsForUser(pending.db as never, 'org1', 'user1')
    expect(render(pending.whereArgs[0]).sql).not.toContain('"createdById"')
  })
})

describe('canUserViewApproval — plan 28 H3', () => {
  // Both assignee columns are nullable `text().array()`. Calling `.includes` /
  // `.some` on NULL THROWS, which made a null-assignee request unreadable rather
  // than merely unassigned.
  //
  // Membership is the CACHED `isOrgMember`, not an `OrganizationMember` query —
  // hence the mock rather than a `db.query.OrganizationMember` double.
  const dbWith = (request: unknown) => ({
    query: { ApprovalRequest: { findFirst: async () => request } },
  })

  beforeEach(() => isOrgMember.mockResolvedValue(true as never))

  it('does not throw when both assignee arrays are NULL', async () => {
    const mod = await import('../approval-request-queries')
    const db = dbWith({ organizationId: 'org1', assigneeUsers: null, assigneeGroups: null })
    await expect(mod.canUserViewApproval(db as never, 'user1', 'req1')).resolves.toBe(false)
  })

  it('still finds a directly-named approver', async () => {
    const mod = await import('../approval-request-queries')
    const db = dbWith({ organizationId: 'org1', assigneeUsers: ['user1'], assigneeGroups: null })
    await expect(mod.canUserViewApproval(db as never, 'user1', 'req1')).resolves.toBe(true)
  })

  it('refuses a non-member even when they are named', async () => {
    const mod = await import('../approval-request-queries')
    isOrgMember.mockResolvedValue(false as never)
    const db = dbWith({ organizationId: 'org1', assigneeUsers: ['user1'], assigneeGroups: [] })
    await expect(mod.canUserViewApproval(db as never, 'user1', 'req1')).resolves.toBe(false)
  })

  // The audience columns and the actionability columns come from ONE read now.
  // Pinning the count is what stops the two predicates drifting back apart into
  // a read each (plus a third in the resolve path).
  it('reads the request row exactly once', async () => {
    const mod = await import('../approval-request-queries')
    const findFirst = vi.fn(async () => ({
      organizationId: 'org1',
      status: 'pending',
      expiresAt: null,
      assigneeUsers: ['user1'],
      assigneeGroups: [],
    }))
    const db = { query: { ApprovalRequest: { findFirst } } }
    await expect(mod.canUserApprove(db as never, 'user1', 'req1')).resolves.toBe(true)
    expect(findFirst).toHaveBeenCalledTimes(1)
  })
})

describe('canUserApprove — plan 28 H2', () => {
  const dbWith = (request: Record<string, unknown>) => ({
    query: {
      ApprovalRequest: {
        findFirst: async () => ({
          organizationId: 'org1',
          assigneeUsers: ['user1'],
          assigneeGroups: [],
          ...request,
        }),
      },
    },
  })

  beforeEach(() => isOrgMember.mockResolvedValue(true as never))

  it('treats a NULL expiry as "never expires", not as expired', async () => {
    const mod = await import('../approval-request-queries')
    // `null < new Date()` coerces null→0 and is TRUE in JS, so a bare comparison
    // makes a null-expiry request permanently UN-approvable.
    const db = dbWith({ status: 'pending', expiresAt: null })
    await expect(mod.canUserApprove(db as never, 'user1', 'req1')).resolves.toBe(true)
  })

  it('still refuses a request whose expiry has passed', async () => {
    const mod = await import('../approval-request-queries')
    const db = dbWith({ status: 'pending', expiresAt: new Date(Date.now() - 60_000) })
    await expect(mod.canUserApprove(db as never, 'user1', 'req1')).resolves.toBe(false)
  })

  it('refuses a request that is no longer pending', async () => {
    const mod = await import('../approval-request-queries')
    const db = dbWith({ status: 'approved', expiresAt: null })
    await expect(mod.canUserApprove(db as never, 'user1', 'req1')).resolves.toBe(false)
  })
})

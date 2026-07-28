// packages/lib/src/workflows/workflow-app-access-guard.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '../errors'

/**
 * Lockdown guard for system-owned `WorkflowApp` rows (Sequences plan §3.4/§21.4,
 * permissions v2 plan 30).
 *
 * Two things are under test and they need different machinery:
 *
 *  1. **The decision** — `ownerType IS NOT NULL` forbids, the super-admin escape
 *     needs BOTH halves, a missing row is a deliberate no-op. A rows-in/result-out
 *     fake covers this.
 *
 *  2. **The query the decision is made from** — every one of these reads is
 *     org-scoped, and org scope is the security property. HANDOFF.md's standing
 *     lesson applies here verbatim: *a fake that models the return value but not
 *     the REQUEST cannot fail on the request.* `fakeDb` below hands back whatever
 *     rows the test declared no matter what was asked for, so deleting
 *     `eq(...organizationId...)` — a cross-org read of another tenant's workflow —
 *     would leave every behavioural test green.
 *
 * So the WHERE clause is asserted directly, following the precedent in
 * `../permissions/capabilities/grantee-access.test.ts` (which spies `or` and
 * counts disjuncts). Two things make that possible here:
 *
 *  - `drizzle-orm`'s `eq`/`and` are replaced with recorders returning inspectable
 *    plain objects, and `fakeDb` keeps the tree it was handed;
 *  - `@auxx/database` is re-mocked locally. The global `src/test/setup.ts` proxies
 *    `schema` to a FRESH `{}` per access, so a column ref carries no identity at
 *    all (see the standing "drizzle columns undefined in vitest" gotcha). Stable,
 *    self-describing markers restore exactly the identity these assertions need —
 *    which also lets the version guard's SELECT projection be pinned to
 *    `WorkflowApp.id` rather than trusted.
 */

const ORG = 'org_1'
const OTHER_APP = 'app_1'
const VERSION = 'wf_v1'
const RUN = 'run_1'
const USER = 'user_alice'

/** A column reference as the local `@auxx/database` mock materialises it. */
interface ColumnMarker {
  table: string
  column: string
}

/** `eq(left, right)` as the local `drizzle-orm` mock records it. */
interface EqNode {
  __eq: [ColumnMarker, unknown]
}

vi.mock('@auxx/database', () => {
  const tables = new Map<string, Record<string, ColumnMarker>>()
  const table = (name: string) => {
    let columns = tables.get(name)
    if (!columns) {
      columns = new Proxy({} as Record<string, ColumnMarker>, {
        get: (_t, column: string) =>
          column === '__table' ? name : ({ table: name, column } satisfies ColumnMarker),
      })
      tables.set(name, columns)
    }
    return columns
  }
  return { schema: new Proxy({}, { get: (_t, name: string) => table(name) }) }
})

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    eq: (left: unknown, right: unknown) => ({ __eq: [left, right] }),
    and: (...args: unknown[]) => ({ __and: args }),
  }
})

const {
  assertWorkflowAppNotSystemOwned,
  assertWorkflowRunNotSystemOwned,
  assertWorkflowVersionNotSystemOwned,
  getWorkflowRunCreatorId,
} = await import('./workflow-app-access-guard')

const SYSTEM_OWNED_MESSAGE =
  'This workflow is managed by the system and cannot be accessed directly.'

/** What `fakeDb` observed about the single query the guard issued. */
interface QuerySpy {
  projection: Record<string, ColumnMarker>
  from?: string
  joins: { table: string; on: unknown }[]
  where?: unknown
  limit?: number
}

/**
 * A drizzle select builder that returns the declared rows and, crucially,
 * remembers what it was asked. `limit()` resolves because every guard here
 * awaits the builder at `.limit(1)`.
 */
function fakeDb(rows: unknown[]) {
  const spy: QuerySpy = { projection: {}, joins: [] }
  const chain = {
    from: (t: { __table: string }) => {
      spy.from = t.__table
      return chain
    },
    innerJoin: (t: { __table: string }, on: unknown) => {
      spy.joins.push({ table: t.__table, on })
      return chain
    },
    where: (condition: unknown) => {
      spy.where = condition
      return chain
    },
    limit: (n: number) => {
      spy.limit = n
      return Promise.resolve(rows)
    },
  }
  const db = {
    select: (projection: Record<string, ColumnMarker>) => {
      spy.projection = projection
      return chain
    },
  } as never
  return { db, spy }
}

/** Every `eq(column, value)` leaf inside a recorded WHERE tree. */
function eqLeaves(node: unknown): EqNode['__eq'][] {
  if (!node || typeof node !== 'object') return []
  if ('__eq' in node) return [(node as EqNode).__eq]
  if ('__and' in node) return (node as { __and: unknown[] }).__and.flatMap(eqLeaves)
  return []
}

/** How many predicates the WHERE tree ANDs together. */
function whereArity(node: unknown): number {
  if (node && typeof node === 'object' && '__and' in node) {
    return (node as { __and: unknown[] }).__and.length
  }
  return node === undefined ? 0 : 1
}

/**
 * The assertion the behavioural tests cannot make: this query is org-scoped, on
 * the table it claims to be scoping, against the caller's org — and the WHERE is
 * exactly the identity predicate plus that one, so the scope cannot have been
 * traded away for a second identity check either.
 */
function expectOrgScoped(spy: QuerySpy, table: string, organizationId: string) {
  const leaves = eqLeaves(spy.where)
  expect(whereArity(spy.where)).toBe(2)
  expect(leaves).toContainEqual([{ table, column: 'organizationId' }, organizationId])
}

let db: ReturnType<typeof fakeDb>

beforeEach(() => {
  db = fakeDb([])
})

describe('assertWorkflowAppNotSystemOwned', () => {
  it('allows an ordinary org-owned app (ownerType null)', async () => {
    db = fakeDb([{ ownerType: null }])

    await expect(
      assertWorkflowAppNotSystemOwned(db.db, { workflowAppId: OTHER_APP, organizationId: ORG })
    ).resolves.toBeUndefined()
  })

  it('allows an app whose row carries no ownerType key at all', async () => {
    db = fakeDb([{}])

    await expect(
      assertWorkflowAppNotSystemOwned(db.db, { workflowAppId: OTHER_APP, organizationId: ORG })
    ).resolves.toBeUndefined()
  })

  it('forbids a system-owned app', async () => {
    db = fakeDb([{ ownerType: 'sequence' }])

    await expect(
      assertWorkflowAppNotSystemOwned(db.db, { workflowAppId: OTHER_APP, organizationId: ORG })
    ).rejects.toThrow(ForbiddenError)
  })

  it('forbids with the system-owned message and a 403', async () => {
    db = fakeDb([{ ownerType: 'sequence' }])

    const error = await assertWorkflowAppNotSystemOwned(db.db, {
      workflowAppId: OTHER_APP,
      organizationId: ORG,
    }).catch((e) => e)

    expect(error).toBeInstanceOf(ForbiddenError)
    expect(error.message).toBe(SYSTEM_OWNED_MESSAGE)
    expect(error.statusCode).toBe(403)
  })

  it('forbids any non-null ownerType, not just the sequence domain', async () => {
    db = fakeDb([{ ownerType: 'some-future-owner' }])

    await expect(
      assertWorkflowAppNotSystemOwned(db.db, { workflowAppId: OTHER_APP, organizationId: ORG })
    ).rejects.toThrow(SYSTEM_OWNED_MESSAGE)
  })

  /**
   * A no-op, NOT a NOT_FOUND. Documented and deliberate: the guard only ever
   * narrows access, so the caller's own lookup is what reports a missing row —
   * making this throw would turn every guarded surface's 404 into a 403.
   */
  it('no-ops when the row does not exist rather than throwing', async () => {
    db = fakeDb([])

    await expect(
      assertWorkflowAppNotSystemOwned(db.db, { workflowAppId: 'nope', organizationId: ORG })
    ).resolves.toBeUndefined()
  })

  it('lets a super admin read a system-owned app', async () => {
    db = fakeDb([{ ownerType: 'sequence' }])

    await expect(
      assertWorkflowAppNotSystemOwned(db.db, {
        workflowAppId: OTHER_APP,
        organizationId: ORG,
        allowSuperAdminRead: true,
        isSuperAdmin: true,
      })
    ).resolves.toBeUndefined()
  })

  /**
   * The pair a sloppy `||` would break, split so each half fails on its own:
   * a mutate surface never opts in, so a super admin must still be refused there;
   * and a read surface that opts in must not open up for a non-super-admin.
   */
  it('still forbids a super admin on a surface that did not opt in', async () => {
    db = fakeDb([{ ownerType: 'sequence' }])

    await expect(
      assertWorkflowAppNotSystemOwned(db.db, {
        workflowAppId: OTHER_APP,
        organizationId: ORG,
        isSuperAdmin: true,
      })
    ).rejects.toThrow(SYSTEM_OWNED_MESSAGE)
  })

  it('still forbids a non-super-admin on a surface that did opt in', async () => {
    db = fakeDb([{ ownerType: 'sequence' }])

    await expect(
      assertWorkflowAppNotSystemOwned(db.db, {
        workflowAppId: OTHER_APP,
        organizationId: ORG,
        allowSuperAdminRead: true,
      })
    ).rejects.toThrow(SYSTEM_OWNED_MESSAGE)
  })

  it('scopes the lookup to the caller org', async () => {
    db = fakeDb([{ ownerType: null }])

    await assertWorkflowAppNotSystemOwned(db.db, {
      workflowAppId: OTHER_APP,
      organizationId: ORG,
    })

    expect(db.spy.from).toBe('WorkflowApp')
    expectOrgScoped(db.spy, 'WorkflowApp', ORG)
    expect(eqLeaves(db.spy.where)).toContainEqual([
      { table: 'WorkflowApp', column: 'id' },
      OTHER_APP,
    ])
  })
})

describe('assertWorkflowVersionNotSystemOwned', () => {
  it('returns the parent app id for an ordinary version', async () => {
    db = fakeDb([{ ownerType: null, workflowAppId: OTHER_APP }])

    await expect(
      assertWorkflowVersionNotSystemOwned(db.db, { workflowId: VERSION, organizationId: ORG })
    ).resolves.toBe(OTHER_APP)
  })

  it('forbids a version of a system-owned app', async () => {
    db = fakeDb([{ ownerType: 'sequence', workflowAppId: OTHER_APP }])

    await expect(
      assertWorkflowVersionNotSystemOwned(db.db, { workflowId: VERSION, organizationId: ORG })
    ).rejects.toThrow(SYSTEM_OWNED_MESSAGE)
  })

  it('returns the parent app id for a super-admin read', async () => {
    db = fakeDb([{ ownerType: 'sequence', workflowAppId: OTHER_APP }])

    await expect(
      assertWorkflowVersionNotSystemOwned(db.db, {
        workflowId: VERSION,
        organizationId: ORG,
        allowSuperAdminRead: true,
        isSuperAdmin: true,
      })
    ).resolves.toBe(OTHER_APP)
  })

  it('still forbids each half of the super-admin escape alone', async () => {
    db = fakeDb([{ ownerType: 'sequence', workflowAppId: OTHER_APP }])
    await expect(
      assertWorkflowVersionNotSystemOwned(db.db, {
        workflowId: VERSION,
        organizationId: ORG,
        isSuperAdmin: true,
      })
    ).rejects.toThrow(SYSTEM_OWNED_MESSAGE)

    db = fakeDb([{ ownerType: 'sequence', workflowAppId: OTHER_APP }])
    await expect(
      assertWorkflowVersionNotSystemOwned(db.db, {
        workflowId: VERSION,
        organizationId: ORG,
        allowSuperAdminRead: true,
      })
    ).rejects.toThrow(SYSTEM_OWNED_MESSAGE)
  })

  /** `undefined`, not a throw — same narrowing-only contract as the app guard. */
  it('returns undefined for a version that does not exist in the org', async () => {
    db = fakeDb([])

    await expect(
      assertWorkflowVersionNotSystemOwned(db.db, { workflowId: 'nope', organizationId: ORG })
    ).resolves.toBeUndefined()
  })

  it('scopes the lookup to the caller org', async () => {
    db = fakeDb([{ ownerType: null, workflowAppId: OTHER_APP }])

    await assertWorkflowVersionNotSystemOwned(db.db, { workflowId: VERSION, organizationId: ORG })

    expect(db.spy.from).toBe('Workflow')
    expect(db.spy.joins.map((j) => j.table)).toEqual(['WorkflowApp'])
    expectOrgScoped(db.spy, 'Workflow', ORG)
    expect(eqLeaves(db.spy.where)).toContainEqual([{ table: 'Workflow', column: 'id' }, VERSION])
  })

  /**
   * The returned id is the PARENT app's, which instance access keys on — a row
   * fake cannot tell `WorkflowApp.id` from `Workflow.id`, so the projection is
   * asserted instead of trusted.
   */
  it('projects the parent app id, not the version id', async () => {
    db = fakeDb([{ ownerType: null, workflowAppId: OTHER_APP }])

    await assertWorkflowVersionNotSystemOwned(db.db, { workflowId: VERSION, organizationId: ORG })

    expect(db.spy.projection.workflowAppId).toEqual({ table: 'WorkflowApp', column: 'id' })
    expect(db.spy.projection.ownerType).toEqual({ table: 'WorkflowApp', column: 'ownerType' })
  })
})

describe('assertWorkflowRunNotSystemOwned', () => {
  it('returns the parent app id for an ordinary run', async () => {
    db = fakeDb([{ ownerType: null, workflowAppId: OTHER_APP }])

    await expect(
      assertWorkflowRunNotSystemOwned(db.db, { runId: RUN, organizationId: ORG })
    ).resolves.toBe(OTHER_APP)
  })

  it('forbids a run of a system-owned app', async () => {
    db = fakeDb([{ ownerType: 'sequence', workflowAppId: OTHER_APP }])

    await expect(
      assertWorkflowRunNotSystemOwned(db.db, { runId: RUN, organizationId: ORG })
    ).rejects.toThrow(SYSTEM_OWNED_MESSAGE)
  })

  it('returns the parent app id for a super-admin read', async () => {
    db = fakeDb([{ ownerType: 'sequence', workflowAppId: OTHER_APP }])

    await expect(
      assertWorkflowRunNotSystemOwned(db.db, {
        runId: RUN,
        organizationId: ORG,
        allowSuperAdminRead: true,
        isSuperAdmin: true,
      })
    ).resolves.toBe(OTHER_APP)
  })

  it('still forbids each half of the super-admin escape alone', async () => {
    db = fakeDb([{ ownerType: 'sequence', workflowAppId: OTHER_APP }])
    await expect(
      assertWorkflowRunNotSystemOwned(db.db, {
        runId: RUN,
        organizationId: ORG,
        isSuperAdmin: true,
      })
    ).rejects.toThrow(SYSTEM_OWNED_MESSAGE)

    db = fakeDb([{ ownerType: 'sequence', workflowAppId: OTHER_APP }])
    await expect(
      assertWorkflowRunNotSystemOwned(db.db, {
        runId: RUN,
        organizationId: ORG,
        allowSuperAdminRead: true,
      })
    ).rejects.toThrow(SYSTEM_OWNED_MESSAGE)
  })

  it('returns undefined for a run that does not exist in the org', async () => {
    db = fakeDb([])

    await expect(
      assertWorkflowRunNotSystemOwned(db.db, { runId: 'nope', organizationId: ORG })
    ).resolves.toBeUndefined()
  })

  it('scopes the lookup to the caller org', async () => {
    db = fakeDb([{ ownerType: null, workflowAppId: OTHER_APP }])

    await assertWorkflowRunNotSystemOwned(db.db, { runId: RUN, organizationId: ORG })

    expect(db.spy.from).toBe('WorkflowRun')
    expect(db.spy.joins.map((j) => j.table)).toEqual(['WorkflowApp'])
    expectOrgScoped(db.spy, 'WorkflowRun', ORG)
    expect(eqLeaves(db.spy.where)).toContainEqual([{ table: 'WorkflowRun', column: 'id' }, RUN])
  })

  it('projects the parent app id', async () => {
    db = fakeDb([{ ownerType: null, workflowAppId: OTHER_APP }])

    await assertWorkflowRunNotSystemOwned(db.db, { runId: RUN, organizationId: ORG })

    expect(db.spy.projection.workflowAppId).toEqual({ table: 'WorkflowApp', column: 'id' })
  })
})

describe('getWorkflowRunCreatorId', () => {
  it("returns the run's creator", async () => {
    db = fakeDb([{ createdBy: USER }])

    await expect(getWorkflowRunCreatorId(db.db, { runId: RUN, organizationId: ORG })).resolves.toBe(
      USER
    )
  })

  it('returns null when the run does not exist', async () => {
    db = fakeDb([])

    await expect(
      getWorkflowRunCreatorId(db.db, { runId: 'nope', organizationId: ORG })
    ).resolves.toBeNull()
  })

  /** `ON DELETE SET NULL` when the creator's `User` row went away. */
  it('returns null when createdBy was nulled by the creator being deleted', async () => {
    db = fakeDb([{ createdBy: null }])

    await expect(
      getWorkflowRunCreatorId(db.db, { runId: RUN, organizationId: ORG })
    ).resolves.toBeNull()
  })

  it('returns null when the column was never written', async () => {
    db = fakeDb([{}])

    await expect(
      getWorkflowRunCreatorId(db.db, { runId: RUN, organizationId: ORG })
    ).resolves.toBeNull()
  })

  /**
   * The contract the "a `view` holder may stop a run THEY started" rule rests
   * on: a stored id comes back verbatim, and `null` is reserved for *absence*.
   * Nothing in between is mapped, invented or collapsed — so the caller's rule
   * is a plain id comparison and a headless run, whatever id it stored, fails
   * it without any sentinel handling.
   *
   * This asserts that verbatim contract rather than any story about which values
   * upstream can produce. `WorkflowRun.createdBy` FKs `User.id`, so in a live
   * database a non-user literal cannot be stored at all — but this function is
   * not the thing enforcing that, and must not start pretending to. The third
   * case therefore feeds it a literal that no writer produces (until 2026-07-28
   * `../jobs/workflow/scheduled-trigger-job.ts` passed
   * `userId: workflowApp.createdById || 'system'`, which FK-violated on a deleted
   * author) purely to pin that nothing here maps, collapses or special-cases it.
   */
  it.each([
    ['a human creator', USER],
    ['the org system user resolved by a headless start', 'user_org_system'],
    ['an arbitrary non-user literal, special-casing nothing', 'system'],
  ])('returns %s verbatim, mapping nothing', async (_label, storedId) => {
    db = fakeDb([{ createdBy: storedId }])

    const creator = await getWorkflowRunCreatorId(db.db, { runId: RUN, organizationId: ORG })

    expect(creator).toBe(storedId)
    // Distinguishable from a deleted creator, whose absence IS `null`.
    expect(creator).not.toBeNull()
  })

  it('denies a stopping caller who did not start the run, by id alone', async () => {
    db = fakeDb([{ createdBy: 'user_org_system' }])

    const creator = await getWorkflowRunCreatorId(db.db, { runId: RUN, organizationId: ORG })

    expect(creator === USER).toBe(false)
  })

  it('scopes the lookup to the caller org', async () => {
    db = fakeDb([{ createdBy: USER }])

    await getWorkflowRunCreatorId(db.db, { runId: RUN, organizationId: ORG })

    expect(db.spy.from).toBe('WorkflowRun')
    expectOrgScoped(db.spy, 'WorkflowRun', ORG)
    expect(eqLeaves(db.spy.where)).toContainEqual([{ table: 'WorkflowRun', column: 'id' }, RUN])
  })

  it('reads a single row', async () => {
    db = fakeDb([{ createdBy: USER }])

    await getWorkflowRunCreatorId(db.db, { runId: RUN, organizationId: ORG })

    expect(db.spy.limit).toBe(1)
  })
})

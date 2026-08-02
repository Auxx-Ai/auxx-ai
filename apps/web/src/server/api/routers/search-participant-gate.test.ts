// apps/web/src/server/api/routers/search-participant-gate.test.ts

import { PermissionKey } from '@auxx/lib/permissions/capabilities/registry'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `search.ts`'s two `Participant` reads answer the same question the mail lens
 * exists to refuse: **"has this address ever corresponded with anyone in this
 * org?"**
 *
 * `Participant` is org-scoped with no inbox column and no lens — one row per
 * email/phone identity that has ever touched the org, whichever mailbox it
 * arrived in, including someone else's PERSONAL one. Both reads were an
 * unqualified `ILIKE` over `identifier` / `name` / `displayName`:
 *
 *  - `suggestions`, the `from:` / `to:` / `cc:` / `recipient:` / `with:` /
 *    `participants` operator branch — a `capabilityProcedure` that asserted
 *    nothing, fifteen lines above a `TAG` branch that *does* check
 *    `canViewEntity('tag')`. So it was never a house convention; it was a
 *    missing check.
 *  - `participants`, the recipient typeahead — a bare `protectedProcedure` with
 *    no capability set in `ctx` at all.
 *
 * The bar is the coarse mail door, `PermissionKey.inboxesView` — the SAME
 * primitive every mail router already asserts as
 * `permissionProcedure(PermissionKey.inboxesView)`, including `participant.ts`,
 * whose `getByIds` was gated while this sibling read was not. Not a rank check:
 * `docs/channels-mail-architecture-guide.md` §16.3 forbids gating mail on rank,
 * and nothing here reads `isAdmin`.
 *
 * ⚠ **This gate is COARSE and these tests do not claim otherwise.** A member
 * holding one narrow inbox still passes and can still probe addresses drawn from
 * threads their lens hides. Narrowing suggestions to participants on
 * lens-admitted threads is the tight answer and is deliberately out of scope.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

// ─────────────────────────────────────────────────────────────────────────────
// Doubles
// ─────────────────────────────────────────────────────────────────────────────

/** Rows the stub db hands back, in call order. */
let dbRows: unknown[][] = []
/** How many times the router actually reached the database. */
let dbCalls = 0

const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          dbCalls += 1
          return dbRows.shift() ?? []
        },
      }),
    }),
  }),
}

// `apps/web` has no shared `drizzle-orm` / `@auxx/database` / `@auxx/logger`
// mock in `src/test/setup.ts` (it mocks only `next/*`), so these are this file's
// own doubles rather than a replacement of a shared one. The predicate helpers
// are inert on purpose — the stub `db` above never compiles SQL, and asserting
// on built predicates is meaningless when columns are placeholder objects.
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  or: (...args: unknown[]) => ({ or: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  ilike: (...args: unknown[]) => ({ ilike: args }),
  asc: (x: unknown) => x,
  inArray: (...args: unknown[]) => ({ inArray: args }),
  count: () => ({ count: true }),
}))

vi.mock('@auxx/database', () => ({
  schema: new Proxy({} as Record<string, Record<string, object>>, {
    get: (target, table: string) => {
      if (!(table in target)) {
        target[table] = new Proxy(
          {},
          {
            get: (cols: Record<string, object>, col: string) => {
              if (!(col in cols)) cols[col] = { table, col }
              return cols[col]
            },
          }
        )
      }
      return target[table]
    },
  }),
}))

// PARTIAL, not a replacement: `enums.ts` is a leaf module (no `db/client`, so no
// pool), and the real `CapabilitySet` reaches through it for `ResourcePermission`
// on the `tag` control path. A full replacement type-checks and passes fifteen
// tests before dying inside `levelToRecordBasePermission`.
vi.mock('@auxx/database/enums', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ParticipantRole: { FROM: 'FROM', TO: 'TO', CC: 'CC' },
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// The REAL operator vocabulary, reached at its deep path so the barrel (which
// hangs under vitest) is never loaded. Hard-coding `'from'` here would let the
// router's switch drift away from the test without either side noticing.
vi.mock('@auxx/lib/mail-query', async () => {
  const parser = await vi.importActual<Record<string, unknown>>(
    '@auxx/lib/mail-query/search-query-parser'
  )
  return { SearchOperator: parser.SearchOperator, IsOperatorValue: parser.IsOperatorValue }
})

vi.mock('@auxx/lib/permissions', async () => {
  const registry = await vi.importActual<Record<string, unknown>>(
    '@auxx/lib/permissions/capabilities/registry'
  )
  return { PermissionKey: registry.PermissionKey }
})

const listAll = vi.fn(async () => ({ items: [] }))
vi.mock('@auxx/lib/resources', () => ({ listAll }))
vi.mock('@auxx/lib/members', () => ({ listMembersWithUser: vi.fn(async () => []) }))
vi.mock('@auxx/lib/inboxes', () => ({
  InboxService: class {
    listInboxes = vi.fn(async () => [])
  },
}))

/**
 * Mirrors the REAL procedures: ctx already carries the capability set, so the
 * only thing dropped is the `getCapabilities` read. The gate under test is the
 * one written in `search.ts`, not a re-implementation here.
 */
vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    protectedProcedure: t.procedure,
    permissionProcedure: () => t.procedure,
    isAuxxError: (e: unknown) =>
      typeof e === 'object' && e !== null && 'statusCode' in (e as Record<string, unknown>),
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { searchRouter } = await import('./search')

type Caps = InstanceType<typeof CapabilitySet>

function capabilitiesFor(opts: { inboxes?: Level; derivedKeys?: PermissionKey[] } = {}): Caps {
  const toSlug = (id: string) => id
  return new CapabilitySet(
    new Set(
      expandLevelsToKeys({
        [Area.inboxes]: opts.inboxes ?? Level.Read,
        [Area.records]: Level.Edit,
      })
    ),
    {},
    'MEMBER',
    'full',
    toSlug,
    undefined,
    toSlug,
    {},
    new Set(),
    {},
    new Set(opts.derivedKeys ?? [])
  )
}

function ctxFor(capabilities: Caps) {
  return {
    db,
    capabilities,
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID, isAdmin: false },
    },
  } as never
}

const search = (c: Caps) => searchRouter.createCaller(ctxFor(c))

const PARTICIPANT_ROW = {
  id: 'prt_cuid00000000000000000a',
  identifier: 'someone@example.com',
  name: 'Someone',
  displayName: 'Someone',
  identifierType: 'EMAIL',
  entityInstanceId: null,
}

/** 403, asserted by STATUS — a denial surfacing as a 500 is a worse outcome. */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

beforeEach(() => {
  dbRows = []
  dbCalls = 0
  listAll.mockClear()
})

// ─────────────────────────────────────────────────────────────────────────────

describe('search.suggestions — participant operator branch', () => {
  const PARTICIPANT_OPERATORS = ['from', 'to', 'cc', 'recipient', 'with', 'participants']

  it.each(
    PARTICIPANT_OPERATORS
  )('%s: a member whose profile closes mail gets no participant suggestions', async (operator) => {
    dbRows = [[PARTICIPANT_ROW]]
    const result = await search(capabilitiesFor({ inboxes: Level.None })).suggestions({
      operator,
      query: 'someone',
    })

    expect(result).toEqual([])
    // Denied BEFORE the query — the address never leaves the database.
    expect(dbCalls).toBe(0)
  })

  it.each(
    PARTICIPANT_OPERATORS
  )('%s: a member with mail read still gets them', async (operator) => {
    dbRows = [[PARTICIPANT_ROW]]
    const result = await search(capabilitiesFor({ inboxes: Level.Read })).suggestions({
      operator,
      query: 'someone',
    })

    expect(result).toEqual([
      {
        type: 'participant',
        value: 'someone@example.com',
        label: 'Someone',
        secondary: 'someone@example.com',
      },
    ])
    expect(dbCalls).toBe(1)
  })

  it('denies by `break`, not by throwing — sibling operators still answer', async () => {
    // The whole point of `break`: `suggestions` is ONE procedure serving many
    // operator branches, so a mail-closed member typing `tag:` must still get
    // their tag suggestions. A `throw` here would have taken the router down for
    // every operator at once.
    const caller = search(capabilitiesFor({ inboxes: Level.None }))
    await expect(caller.suggestions({ operator: 'from', query: 'x' })).resolves.toEqual([])
    await expect(caller.suggestions({ operator: 'tag', query: 'x' })).resolves.toBeDefined()
    expect(listAll).toHaveBeenCalled()
  })

  it('an instance grant on ONE inbox is enough — the gate reads the front door', async () => {
    // `can()` is `keys ∪ instanceDerivedKeys`, NOT the area level: a member whose
    // profile sets `Area.inboxes = None` but who holds a `view`-or-better grant
    // on a single inbox has `inboxesView` synthesized at composition time and
    // genuinely does have mail reach. Gating on `areaLevel()` would deny them.
    dbRows = [[PARTICIPANT_ROW]]
    const result = await search(
      capabilitiesFor({ inboxes: Level.None, derivedKeys: [PermissionKey.inboxesView] })
    ).suggestions({ operator: 'from', query: 'someone' })

    expect(result).toHaveLength(1)
    expect(dbCalls).toBe(1)
  })
})

describe('search.participants — the recipient typeahead', () => {
  it('403s a member whose profile closes mail', async () => {
    dbRows = [[PARTICIPANT_ROW]]
    await expect(
      search(capabilitiesFor({ inboxes: Level.None })).participants({ query: 'someone' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(dbCalls).toBe(0)
  })

  it('serves a member with mail read', async () => {
    dbRows = [[PARTICIPANT_ROW]]
    const result = await search(capabilitiesFor({ inboxes: Level.Read })).participants({
      query: 'someone',
    })

    expect(result).toEqual([
      {
        id: PARTICIPANT_ROW.id,
        identifier: 'someone@example.com',
        displayName: 'Someone',
        identifierType: 'EMAIL',
        contactId: null,
        contact: null,
      },
    ])
  })

  it('an instance grant on ONE inbox is enough here too', async () => {
    dbRows = [[PARTICIPANT_ROW]]
    await expect(
      search(
        capabilitiesFor({ inboxes: Level.None, derivedKeys: [PermissionKey.inboxesView] })
      ).participants({ query: 'someone' })
    ).resolves.toHaveLength(1)
  })
})

// apps/web/src/server/api/routers/search-participant-label-repair.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * contact-name-precedence plan Phase 5 — `search.ts` used to return the stored
 * `Participant.displayName` verbatim. That column is nullable, and legacy
 * CHAT_VISITOR rows persist the raw session uuid there. Both participant reads
 * (the `participants` typeahead and the `suggestions` operator labels) now
 * route through the same read-time repair `getParticipantMetaBatch` uses:
 * contact-name precedence (`usableContactName`) first, then
 * `calculateParticipantDisplayInfo` over the stored name/identifier.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

// ─────────────────────────────────────────────────────────────────────────────
// Doubles
// ─────────────────────────────────────────────────────────────────────────────

/** Rows the stub db hands back, in call order. */
let dbRows: unknown[][] = []

// Unlike the gate test's stub, `where()` must BE awaitable as well as carry
// `.limit()` — `fetchContactNames` awaits the where-chain directly while the
// participant reads chain `.limit(n)` after it.
const db = {
  select: () => ({
    from: () => ({
      where: () => {
        const rows = dbRows.shift() ?? []
        const chain = Promise.resolve(rows) as Promise<unknown[]> & {
          limit: (n: number) => Promise<unknown[]>
        }
        chain.limit = async () => rows
        return chain
      },
    }),
  }),
}

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  or: (...args: unknown[]) => ({ or: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  ilike: (...args: unknown[]) => ({ ilike: args }),
  asc: (x: unknown) => x,
  inArray: (...args: unknown[]) => ({ inArray: args }),
  isNull: (x: unknown) => ({ isNull: x }),
  count: () => ({ count: true }),
  sql: Object.assign((strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals }), {
    raw: (s: string) => ({ raw: s }),
    join: (...args: unknown[]) => ({ join: args }),
  }),
}))

vi.mock('@auxx/database', async () => ({
  ...(await (await import('~/test/database-mock')).mockAuxxDatabase()),
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

vi.mock('@auxx/database/enums', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ParticipantRole: { FROM: 'FROM', TO: 'TO', CC: 'CC' },
}))

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

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

vi.mock('@auxx/lib/resources', () => ({ listAll: vi.fn(async () => ({ items: [] })) }))
vi.mock('@auxx/lib/members', () => ({ listMembersWithUser: vi.fn(async () => []) }))
vi.mock('@auxx/lib/inboxes', () => ({
  InboxService: class {
    listInboxes = vi.fn(async () => [])
  },
}))

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
// The repair itself stays REAL — the assertions below pin the router to the
// same label `getParticipantMetaBatch` computes for the same row.
const { generateVisitorName } = await import('@auxx/lib/chat/visitor-naming')
const { searchRouter } = await import('./search')

type Caps = InstanceType<typeof CapabilitySet>

function capabilities(): Caps {
  const toSlug = (id: string) => id
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.inboxes]: Level.Read, [Area.records]: Level.Edit })),
    {},
    'MEMBER',
    'full',
    toSlug,
    undefined,
    toSlug,
    {},
    new Set(),
    {},
    new Set()
  )
}

function caller() {
  return searchRouter.createCaller({
    db,
    capabilities: capabilities(),
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID, isAdmin: false },
    },
  } as never)
}

const SESSION_UUID = '7c0e8605-4a2b-4c3d-9e1f-d1a566d4354b'

function participantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prt_cuid00000000000000000a',
    identifier: 'someone@example.com',
    name: null,
    displayName: null,
    identifierType: 'EMAIL',
    entityInstanceId: null,
    ...overrides,
  }
}

beforeEach(() => {
  dbRows = []
})

// ─────────────────────────────────────────────────────────────────────────────

describe('search.participants — read-time label repair', () => {
  it('repairs a NULL displayName to the identifier', async () => {
    dbRows = [[participantRow()]]

    const [row] = await caller().participants({ query: 'someone' })

    expect(row?.displayName).toBe('someone@example.com')
  })

  it('repairs a legacy CHAT_VISITOR row storing its raw session uuid', async () => {
    dbRows = [
      [
        participantRow({
          identifier: SESSION_UUID,
          displayName: SESSION_UUID,
          identifierType: 'CHAT_VISITOR',
        }),
      ],
    ]

    const [row] = await caller().participants({ query: 'turtle' })

    expect(row?.displayName).toBe(generateVisitorName(SESSION_UUID))
    expect(row?.displayName).not.toContain(SESSION_UUID)
  })

  it('a linked (non-archived) contact name still wins over the repair', async () => {
    dbRows = [
      [participantRow({ entityInstanceId: 'ent_c1', name: 'Old Header Name' })],
      [{ id: 'ent_c1', displayName: 'Bruno Klooth' }],
    ]

    const [row] = await caller().participants({ query: 'bruno' })

    expect(row?.displayName).toBe('Bruno Klooth')
  })

  it('a stored name still beats the identifier', async () => {
    dbRows = [[participantRow({ name: 'Someone', displayName: 'Someone' })]]

    const [row] = await caller().participants({ query: 'someone' })

    expect(row?.displayName).toBe('Someone')
  })
})

describe('search.suggestions — participant operator labels stay consistent', () => {
  it('the suggestion label goes through the SAME repair', async () => {
    dbRows = [
      [
        participantRow({
          identifier: SESSION_UUID,
          displayName: SESSION_UUID,
          identifierType: 'CHAT_VISITOR',
        }),
      ],
    ]

    const [suggestion] = (await caller().suggestions({ operator: 'from', query: 'turtle' })) as [
      { label: string },
    ]

    expect(suggestion?.label).toBe(generateVisitorName(SESSION_UUID))
  })
})

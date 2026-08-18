// packages/lib/src/threads/__tests__/personal-inbox-recordid-minting.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40a §5.1 — the thread-layer inbox RecordId minting sites.
 *
 * `thread-query.service` (the list read) and `thread-mutation.service` (the
 * realtime patch) both used a definition constant. 78% of dev threads live in a
 * personal mailbox, so this is the MAJORITY path, not an edge case.
 *
 * Note the two surfaces use DIFFERENT keyspaces on purpose:
 *  - `thread-query` mints `EntityDefinition.id`-keyed RecordIds, because the FE
 *    resolves `ThreadMeta.inboxId` through `useInbox` → `inboxMap`, whose keys
 *    come from `record.listAll` (`toRecordId(entityDefId, …)`);
 *  - the realtime patch mints the SLUG keyspace, the one `ResourceAccess` mail
 *    rows use.
 * Both must pick the right DEFINITION per inbox; neither may pick a batch
 * constant.
 */

const h = vi.hoisted(() => ({
  /** entityType → EntityDefinition.id, as the `entityDefs` org cache holds it. */
  defIds: {} as Record<string, string | undefined>,
  /** The merged `inboxes` org-cache list — the def discriminator seam. */
  cachedInboxes: [] as Array<{ id: string; entityDefinitionKey?: string; isPersonal?: boolean }>,
  threads: [] as Array<Record<string, unknown>>,
  publishedPatches: [] as Array<Record<string, unknown>>,
  updateReturning: [] as Array<Record<string, unknown>>,
}))

// Partial mock: `@auxx/logger/run-log` imports sink-registration helpers from this
// barrel at module load, so a full replacement breaks whichever test file happens
// to load it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@auxx/database', () => ({
  schema: new Proxy(
    {},
    { get: (_t, table) => new Proxy({}, { get: (_t2, col) => `${String(table)}.${String(col)}` }) }
  ),
}))

vi.mock('drizzle-orm', () => {
  const passthrough = (...a: unknown[]) => a
  return {
    and: passthrough,
    asc: passthrough,
    count: () => 'count',
    desc: passthrough,
    eq: passthrough,
    exists: passthrough,
    gt: passthrough,
    ilike: passthrough,
    inArray: passthrough,
    isNotNull: passthrough,
    isNull: passthrough,
    lt: passthrough,
    notExists: passthrough,
    notInArray: passthrough,
    or: passthrough,
    sql: Object.assign(passthrough, { raw: passthrough }),
  }
})

// ── org cache: the two reads both services make ──────────────────────────────
vi.mock('../../cache', () => ({
  getCachedEntityDefId: async (_org: string, type: string) => h.defIds[type],
  requireCachedEntityDefId: async (_org: string, type: string) => {
    const id = h.defIds[type]
    if (!id) throw new Error(`EntityDefinition not found for entityType: ${type}`)
    return id
  },
  getOrgCache: () => ({ get: async () => h.cachedInboxes }),
}))

vi.mock('../../field-values/relationship-queries', () => ({
  batchGetThreadTagIds: async () => new Map(),
}))
vi.mock('../../messages/participant-ids', () => ({
  getParticipantIdsByMessage: async () => new Map(),
}))
vi.mock('../../mail-views/mail-view-service', () => ({
  MailViewService: class {
    getMailView = vi.fn().mockResolvedValue(null)
  },
}))
vi.mock('../../mail-query/condition-query-builder', () => ({ buildConditionGroupsQuery: vi.fn() }))
vi.mock('../../mail-query/draft-condition-builder', () => ({
  buildDraftConditions: vi.fn(),
  hasUnsupportedDraftConditions: vi.fn(() => true),
  isDraftsContextQuery: vi.fn(() => false),
}))
vi.mock('../../mail-query/visibility-scope', () => ({ buildMailVisibilityPredicate: vi.fn() }))
vi.mock('../../conditions/resolve-context', () => ({ resolveConditionContext: (c: unknown) => c }))

// ── thread-mutation collaborators ────────────────────────────────────────────
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishThreadDeleted: vi.fn(),
  publishThreadUpdated: vi.fn(async (_svc: unknown, _org: string, payload: any) => {
    h.publishedPatches.push(payload.patch)
  }),
}))
vi.mock('../../events/publisher', () => ({ publisher: { publishLater: vi.fn() } }))
vi.mock('../../field-values', () => ({ FieldValueService: class {} }))
vi.mock('../thread-action-access', () => ({ assertCanActOnThreads: async () => {} }))
vi.mock('../thread-merge.service', () => ({ ThreadMergeService: class {} }))
vi.mock('../mail-counts', () => ({ markMailCountsStale: vi.fn() }))

import { ThreadQueryService } from '../thread-query.service'

const ORG = 'org_1'
const SHARED_DEF = 'def_inbox_cuid'
const PERSONAL_DEF = 'def_personal_inbox_cuid'

/** Chainable query double: every terminal await resolves to `[]`. */
function chain(): any {
  const obj: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown[]) => unknown) => Promise.resolve(res([]))
        }
        return () => obj
      },
    }
  )
  return obj
}

const db = {
  query: { Thread: { findMany: async () => h.threads } },
  select: () => chain(),
  selectDistinct: () => chain(),
  update: () => ({
    set: () => ({
      where: () => ({ returning: async () => h.updateReturning }),
    }),
  }),
} as any

beforeEach(() => {
  h.defIds = { inbox: SHARED_DEF, personal_inbox: PERSONAL_DEF, ticket: 'def_ticket_cuid' }
  h.cachedInboxes = []
  h.threads = []
  h.publishedPatches = []
  h.updateReturning = []
})

/** A system viewer skips visibility evaluation — every thread reads at `full`. */
const systemViewer = { kind: 'system' } as any

function thread(id: string, inboxId: string | null) {
  return {
    id,
    inboxId,
    subject: `s-${id}`,
    status: 'OPEN',
    lastMessageAt: new Date('2026-01-01T00:00:00.000Z'),
    firstMessageAt: new Date('2026-01-01T00:00:00.000Z'),
    messageCount: 1,
    participantCount: 1,
    integrationId: null,
    assigneeId: null,
    latestMessageId: null,
    latestCommentId: null,
    primaryEntityInstanceId: null,
    primaryEntityDefinitionId: null,
    externalId: null,
    handoffState: null,
    metadata: null,
    mergedIntoThreadId: null,
    mergeData: null,
  }
}

describe('thread-query getThreadMetaBatch — per-thread inbox definition', () => {
  it('resolves a MIXED batch to each thread’s own definition', async () => {
    h.cachedInboxes = [
      { id: 'i_shared', entityDefinitionKey: 'inbox' },
      { id: 'i_personal', entityDefinitionKey: 'personal_inbox' },
    ]
    h.threads = [
      thread('t_1', 'i_shared'),
      thread('t_2', 'i_personal'),
      thread('t_3', 'i_shared'),
      thread('t_4', null),
    ]

    const svc = new ThreadQueryService(ORG, db, systemViewer)
    const metas = await svc.getThreadMetaBatch(['t_1', 't_2', 't_3', 't_4'], 'user_1')

    expect(metas.map((m) => m.inboxId)).toEqual([
      `${SHARED_DEF}:i_shared`,
      `${PERSONAL_DEF}:i_personal`,
      `${SHARED_DEF}:i_shared`,
      null,
    ])
  })

  it('keeps the shared definition for a shared-only batch (negative control)', async () => {
    h.cachedInboxes = [{ id: 'i_shared', entityDefinitionKey: 'inbox' }]
    h.threads = [thread('t_1', 'i_shared')]

    const svc = new ThreadQueryService(ORG, db, systemViewer)
    const metas = await svc.getThreadMetaBatch(['t_1'], 'user_1')

    expect(metas[0]?.inboxId).toBe(`${SHARED_DEF}:i_shared`)
  })

  it('follows the definition, not the `isPersonal` marker (059 → 060 window)', async () => {
    h.cachedInboxes = [{ id: 'i_legacy', entityDefinitionKey: 'inbox', isPersonal: true }]
    h.threads = [thread('t_1', 'i_legacy')]

    const svc = new ThreadQueryService(ORG, db, systemViewer)
    const metas = await svc.getThreadMetaBatch(['t_1'], 'user_1')

    expect(metas[0]?.inboxId).toBe(`${SHARED_DEF}:i_legacy`)
  })

  it('degrades to the shared definition for an org that has not run migration 059', async () => {
    h.defIds = { inbox: SHARED_DEF, personal_inbox: undefined, ticket: 'def_ticket_cuid' }
    h.cachedInboxes = [{ id: 'i_personal', entityDefinitionKey: 'personal_inbox' }]
    h.threads = [thread('t_1', 'i_personal')]

    const svc = new ThreadQueryService(ORG, db, systemViewer)
    const metas = await svc.getThreadMetaBatch(['t_1'], 'user_1')

    expect(metas[0]?.inboxId).toBe(`${SHARED_DEF}:i_personal`)
  })
})

describe('thread-mutation realtime patch — inbox definition', () => {
  async function updateInto(inboxId: string, bulk: boolean) {
    const { ThreadMutationService } = await import('../thread-mutation.service')
    const svc = new ThreadMutationService(
      ORG,
      db,
      undefined,
      { kind: 'user', id: 'user_1' },
      systemViewer
    )
    h.updateReturning = [{ id: 't_1', inboxId, assigneeId: null }]
    if (bulk) {
      await svc.updateBulk(['thread:t_1' as never], { inboxId: `inbox:${inboxId}` as never })
    } else {
      await svc.update('thread:t_1' as never, { inboxId: `inbox:${inboxId}` as never })
    }
    return h.publishedPatches.at(-1)?.inboxId
  }

  it('mints `personal_inbox:` when the destination is a personal mailbox', async () => {
    h.cachedInboxes = [{ id: 'i_personal', entityDefinitionKey: 'personal_inbox' }]

    expect(await updateInto('i_personal', false)).toBe('personal_inbox:i_personal')
  })

  it('mints `inbox:` when the destination is shared (negative control)', async () => {
    h.cachedInboxes = [{ id: 'i_shared', entityDefinitionKey: 'inbox' }]

    expect(await updateInto('i_shared', false)).toBe('inbox:i_shared')
  })

  it('resolves the definition on the BULK path too', async () => {
    h.cachedInboxes = [{ id: 'i_personal', entityDefinitionKey: 'personal_inbox' }]

    expect(await updateInto('i_personal', true)).toBe('personal_inbox:i_personal')
  })
})

// packages/lib/src/ingest/__tests__/participant-interaction-stamps.test.ts
//
// records/interaction-fields plan Phase 3 — participant interaction stamps must
// carry the MESSAGE's timestamp, not processing time (`new Date()` dated every
// backfilled correspondent's "first interaction" as connect day), and the
// conflict path must guard first-wins / last-wins so out-of-order backfill
// batches can neither forward-date a first nor rewind a last. Drizzle's `sql`
// tag is mocked to a capture object, so the assertions inspect the bound
// parameters the upsert would send.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  insertValues: null as Record<string, unknown> | null,
  conflictSet: null as Record<string, unknown> | null,
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishParticipantUpdated: vi.fn(),
}))
vi.mock('../contacts/find-or-create', () => ({
  findOrCreateContactForParticipant: vi.fn(async () => null),
}))
vi.mock('../domain/classifier', () => ({
  extractRegistrableDomain: () => null,
  getOwnDomains: async () => new Set<string>(),
  normalizeDomain: (d: string) => d,
}))
vi.mock('../inbox-meta', () => ({ getInboxMeta: async () => null }))

vi.mock('drizzle-orm', () => {
  const passthrough = (...a: unknown[]) => a
  return {
    and: passthrough,
    eq: passthrough,
    sql: Object.assign(
      (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: true, strings, vals }),
      { raw: (s: string) => s }
    ),
  }
})

vi.mock('@auxx/database', async () => {
  const { createSchemaMock } = await import('../../test/database-mock')
  return { schema: createSchemaMock() }
})

import { findOrCreateParticipantRecord } from '../participants/find-or-create'

const SENT_AT = new Date('2024-11-03T08:30:00.000Z')

function makeCtx() {
  const selectChain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (res: (v: unknown[]) => unknown) => Promise.resolve(res([]))
        return () => selectChain
      },
    }
  )
  const db = {
    select: () => selectChain,
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        h.insertValues = vals
        return {
          onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
            h.conflictSet = cfg.set
            return {
              returning: async () => [
                {
                  id: 'p_1',
                  identifier: 'anna@example.com',
                  name: 'Anna',
                  displayName: 'Anna',
                  hasReceivedMessage: false,
                  lastSentMessageAt: null,
                  isInternal: false,
                  entityInstanceId: 'c_1',
                },
              ],
            }
          },
        }
      },
    }),
  }
  return {
    db,
    organizationId: 'org_1',
    ownEmails: new Set<string>(),
    ownDomainsByOrg: new Map<string, Set<string>>(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    socketId: undefined,
  } as any
}

/** Deep-collect the params bound inside captured `sql` fragments. */
function boundParams(fragment: unknown): unknown[] {
  if (!fragment || typeof fragment !== 'object') return []
  const record = fragment as Record<string, unknown>
  if (record.__sql && Array.isArray(record.vals)) {
    return (record.vals as unknown[]).flatMap((v) => [v, ...boundParams(v)])
  }
  return Object.values(record).flatMap((v) => boundParams(v))
}

beforeEach(() => {
  h.insertValues = null
  h.conflictSet = null
})

describe('participant interaction stamps (Phase 3)', () => {
  it('stamps the insert path with the message sentAt, not processing time', async () => {
    await findOrCreateParticipantRecord(
      makeCtx(),
      { identifier: 'anna@example.com', name: 'Anna' } as any,
      'EMAIL' as any,
      { isInbound: false, role: 'TO' as any, sentAt: SENT_AT }
    )
    expect(h.insertValues?.firstInteractionDate).toEqual(SENT_AT)
    // Outbound recipient → lastSentMessageAt also carries the message time.
    expect(h.insertValues?.lastSentMessageAt).toEqual(SENT_AT)
  })

  it('guards the conflict path: first/last become guarded SQL bound to sentAt', async () => {
    await findOrCreateParticipantRecord(
      makeCtx(),
      { identifier: 'anna@example.com', name: 'Anna' } as any,
      'EMAIL' as any,
      { isInbound: false, role: 'TO' as any, sentAt: SENT_AT }
    )
    const set = h.conflictSet!
    // Guarded CASE expressions, not plain Date writes — an out-of-order batch
    // must not rewind lastSentMessageAt or forward-date firstInteractionDate.
    for (const key of ['firstInteractionDate', 'firstInteractionType', 'lastSentMessageAt']) {
      expect(set[key], key).toBeTruthy()
      expect((set[key] as Record<string, unknown>).__sql, `${key} is guarded sql`).toBe(true)
      expect(boundParams(set[key]), `${key} binds sentAt`).toContainEqual(SENT_AT)
    }
    expect(set.hasReceivedMessage).toBe(true)
  })

  it('keeps interaction columns untouched on the conflict path for a FROM-role message without sentAt', async () => {
    await findOrCreateParticipantRecord(
      makeCtx(),
      { identifier: 'anna@example.com', name: 'Anna' } as any,
      'EMAIL' as any,
      { isInbound: true, role: 'FROM' as any }
    )
    const set = h.conflictSet!
    // No sentAt → legacy behavior (no guarded rewrite), and an inbound FROM is
    // not an outbound recipient, so lastSentMessageAt must not move at all.
    expect(set.firstInteractionDate).toBeUndefined()
    expect(set.lastSentMessageAt).toBeUndefined()
  })
})

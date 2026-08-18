// packages/lib/src/events/handlers/publish-thread-event-to-realtime.test.ts
// Plan 45 §3.5 — the two unshaped sinks of the thread-lifecycle publish — plus
// the thread-events §13.3.2 visitor-set gate.
//
// The negative assertions are the valuable ones. `rooms.visitor(...)` is a PUBLIC
// Pusher channel, so the visitor payload must carry no internal principal id and
// no handoff state, and non-visitor-facing types (`thread:tagged`, …) must never
// be published there at all; `rooms.chatThread(...)` admits a `metadata`-lens
// member, and its payload deliberately DOES carry `visitorEmail` — the tier
// decision from §1.5, pinned here so changing it is a deliberate act rather than
// a refactor.
//
// Schema is a Proxy (Drizzle-columns-undefined-under-vitest gotcha — see project
// memory), which is fine: this handler's DB use is one insert (via
// `recordThreadEvent`) whose return value is all the assertions need.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  publish: vi.fn<(room: string, event: string, payload: any) => Promise<void>>(async () => {}),
  insertReturning: [{ id: 'evt_1', createdAt: new Date('2026-07-29T10:00:00.000Z') }] as any[],
  threadMetadataRows: [] as any[],
}))

vi.mock('@auxx/database', () => ({
  schema: new Proxy(
    {},
    {
      get: (_t, table) => new Proxy({}, { get: (_x, col) => `${String(table)}.${String(col)}` }),
    }
  ),
  database: {
    insert: () => ({
      values: () => ({ returning: async () => h.insertReturning }),
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => h.threadMetadataRows }) }),
    }),
  },
}))

vi.mock('drizzle-orm', () => ({ eq: (col: any, val: any) => ({ col, val }) }))

// Partial mock: `@auxx/logger/run-log` imports sink-registration helpers from this
// barrel at module load, so a full replacement breaks whichever test file happens
// to load it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() }),
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({ publish: h.publish }),
  rooms: {
    chatThread: (id: string) => `thread-${id}`,
    visitor: (id: string) => `visitor-${id}`,
  },
}))

const { publishThreadEventToRealtime } = await import('./publish-thread-event-to-realtime')

const job = (type: string, data: Record<string, unknown>) => ({ data: { type, data } }) as any

/** The payload published to the room whose key starts with `prefix`. */
const payloadFor = (prefix: string) =>
  h.publish.mock.calls.find(([room]) => room.startsWith(prefix))?.[2]

beforeEach(() => {
  h.publish.mockClear()
  h.threadMetadataRows = []
})

describe('§3.5 — the public visitor channel', () => {
  it('carries no internal user id and no handoff state on thread:taken_over', async () => {
    await publishThreadEventToRealtime(
      job('thread:taken_over', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        userId: 'usr_agent',
        previousState: 'ai',
        visitorParticipantId: 'part_v',
      })
    )

    const visitor = payloadFor('visitor-')
    expect(visitor).toBeDefined()
    expect(visitor).not.toHaveProperty('userId')
    expect(visitor).not.toHaveProperty('previousState')
    expect(visitor).not.toHaveProperty('organizationId')
    // Exactly the allowlist, so a field added to the event payload later cannot
    // ride along: this is the assertion that fails if someone spreads `data` back.
    expect(Object.keys(visitor as object).sort()).toEqual(['createdAt', 'id', 'threadId'])
  })

  it('carries neither assignee id on thread:assignee:changed', async () => {
    await publishThreadEventToRealtime(
      job('thread:assignee:changed', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        fromUserId: 'usr_a',
        toUserId: 'usr_b',
        visitorParticipantId: 'part_v',
      })
    )

    const visitor = payloadFor('visitor-')
    expect(visitor).not.toHaveProperty('fromUserId')
    expect(visitor).not.toHaveProperty('toUserId')
  })

  it('does not leak the visitor email back over the public channel either', async () => {
    await publishThreadEventToRealtime(
      job('thread:visitor:identified', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        visitorEmail: 'someone@example.com',
        participantId: 'part_v',
      })
    )

    const visitor = payloadFor('visitor-')
    expect(visitor).toBeDefined()
    expect(visitor).not.toHaveProperty('visitorEmail')
  })

  it('keeps threadId, id and createdAt — the widget dedupes and scopes on them', async () => {
    await publishThreadEventToRealtime(
      job('thread:reopened', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        userId: 'usr_agent',
        visitorParticipantId: 'part_v',
      })
    )

    expect(payloadFor('visitor-')).toEqual({
      threadId: 'thr_1',
      id: 'evt_1',
      createdAt: '2026-07-29T10:00:00.000Z',
    })
  })

  it('publishes nothing to a visitor room for an email thread (no visitor participant)', async () => {
    await publishThreadEventToRealtime(
      job('thread:archived', { threadId: 'thr_1', organizationId: 'org_1', userId: 'usr_agent' })
    )

    expect(payloadFor('visitor-')).toBeUndefined()
    expect(payloadFor('thread-')).toBeDefined()
  })

  // thread-events §13.3.2: the visitor fan-out is gated on the FROZEN visitor
  // set, not on membership in the handler's owned-type set. A non-visitor-facing
  // type reaches the admin thread room but never the public visitor channel —
  // even with a visitorParticipantId in hand, and even type + timestamp would be
  // an activity leak.
  it("keeps a non-visitor-facing type ('thread:tagged') off the visitor channel", async () => {
    await publishThreadEventToRealtime(
      job('thread:tagged', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        tagIds: ['tag_1'],
        tagNames: ['VIP'],
        visitorParticipantId: 'part_v',
      })
    )

    expect(payloadFor('thread-')).toBeDefined()
    expect(payloadFor('visitor-')).toBeUndefined()
  })
})

describe('§3.5 — the metadata-lens member channel keeps the full payload', () => {
  // The DELIBERATE positive. `rooms.chatThread` admits `satisfiesLens(lens,
  // 'metadata')`, and participant email is metadata-visible: `participants` is a
  // `THREAD_METADATA_FIELDS` entry and hydrates through the ungated
  // `participant.getByIds` into `ParticipantMeta.identifier`. If that hydration
  // ever gains a lens gate, THIS is the assertion that must be revisited and the
  // publish routed through `shapeMailEventForLens`.
  it('carries visitorEmail on thread:visitor:identified', async () => {
    await publishThreadEventToRealtime(
      job('thread:visitor:identified', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        visitorEmail: 'someone@example.com',
        participantId: 'part_v',
      })
    )

    expect(payloadFor('thread-')).toMatchObject({ visitorEmail: 'someone@example.com' })
  })

  it('carries actor identity and handoff state', async () => {
    await publishThreadEventToRealtime(
      job('thread:taken_over', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        userId: 'usr_agent',
        previousState: 'ai',
      })
    )

    expect(payloadFor('thread-')).toMatchObject({ userId: 'usr_agent', previousState: 'ai' })
  })

  // Phase 2: `actorId` is resolved at write time as a branded ActorId string and
  // rides on the member payload (the visitor allowlist drops it, pinned above by
  // the exact-keys assertion).
  it('carries the branded actorId — acting user for taken_over', async () => {
    await publishThreadEventToRealtime(
      job('thread:taken_over', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        userId: 'usr_agent',
        previousState: 'ai',
      })
    )

    expect(payloadFor('thread-')).toMatchObject({ actorId: 'user:usr_agent' })
  })

  it('carries the branded actorId — the NEW assignee for assignee:changed', async () => {
    await publishThreadEventToRealtime(
      job('thread:assignee:changed', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        fromUserId: 'usr_a',
        toUserId: 'usr_b',
      })
    )

    expect(payloadFor('thread-')).toMatchObject({ actorId: 'user:usr_b' })
  })

  it('carries a null actorId when the payload has no addressable actor', async () => {
    await publishThreadEventToRealtime(
      job('thread:visitor:identified', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        visitorEmail: 'someone@example.com',
        participantId: 'part_v',
      })
    )

    expect(payloadFor('thread-')).toMatchObject({ actorId: null })
  })

  // Phase 5 (thread-events §5.5): emitters that know their principal write an
  // explicit `data.actorId`, and the handler must PREFER it over the legacy
  // userId/toUserId derivation — an agent take-over carries a meaningless
  // synthetic userId, and deriving from it would resurrect the misattribution.
  it('prefers an explicit data.actorId over the userId derivation', async () => {
    await publishThreadEventToRealtime(
      job('thread:taken_over', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        userId: 'usr_synthetic',
        actorId: 'agent:agt_1',
        previousState: 'ai',
      })
    )

    expect(payloadFor('thread-')).toMatchObject({ actorId: 'agent:agt_1' })
  })

  it('respects an explicit null actorId (automation) and keeps the source provenance', async () => {
    await publishThreadEventToRealtime(
      job('thread:archived', {
        threadId: 'thr_1',
        organizationId: 'org_1',
        actorId: null,
        source: { kind: 'mail_filter', id: 'flt_1', runId: 'run_1', name: 'Auto-close' },
      })
    )

    expect(payloadFor('thread-')).toMatchObject({
      actorId: null,
      source: { kind: 'mail_filter', id: 'flt_1', runId: 'run_1', name: 'Auto-close' },
    })
  })
})

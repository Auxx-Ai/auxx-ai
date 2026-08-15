// packages/lib/src/ingest/__tests__/participant-own-channel-identity.test.ts
//
// channel-identity-and-is-internal plan §7. Two things ingest has to get right
// on a channel that isn't email:
//
//  1. The org's own channel number must classify as INTERNAL. It didn't:
//     `classifyIsInternal` opened with `if (identifierType !== EMAIL) return
//     false`, and since Quo channels provision with `recordCreation.mode: 'all'`
//     the `isInternal` guard in `contacts/find-or-create.ts` was the ONLY thing
//     standing between ingest and a Contact record for the org's own support
//     line — minted off the first SMS in either direction.
//
//  2. `isInternal` must be RECOMPUTED on the conflict path. It was in the
//     `.values()` of the upsert and the `set` of neither, so the column was
//     write-once: connecting a second channel or adding an org domain silently
//     never took effect on rows that already existed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  insertValues: null as Record<string, unknown> | null,
  conflictSet: null as Record<string, unknown> | null,
  contactCalls: [] as Array<Record<string, unknown>>,
  channels: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishParticipantUpdated: vi.fn(),
}))
vi.mock('../contacts/find-or-create', () => ({
  findOrCreateContactForParticipant: vi.fn(async (_ctx: unknown, participant: any) => {
    h.contactCalls.push(participant)
    return null
  }),
}))
vi.mock('../domain/classifier', () => ({
  extractRegistrableDomain: (id: string) => id.split('@')[1] ?? null,
  getOwnDomains: async () => new Set(['auxx.ai']),
  normalizeDomain: (d: string) => d.toLowerCase(),
}))
vi.mock('../inbox-meta', () => ({ getInboxMeta: async () => null }))
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: async () => h.channels }),
  getCachedMembers: async () => [],
}))

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

const QUO_CHANNEL = {
  id: 'int_quo',
  provider: 'openphone',
  email: null,
  inboxId: null,
  metadata: { phoneNumberId: 'PN1', phoneNumber: '+18889155797' },
}

/**
 * @param previous the row a conflicting upsert would find, or null for an insert
 */
function makeCtx(previous: Record<string, unknown> | null = null) {
  const selectChain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown[]) => unknown) =>
            Promise.resolve(res(previous ? [previous] : []))
        }
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
              // `entityInstanceId: null` on purpose — that is what makes
              // `findOrCreateParticipantRecord` attempt contact resolution,
              // which is the path this file is asserting on.
              returning: async () => [{ id: 'p_1', ...vals, entityInstanceId: null }],
            }
          },
        }
      },
    }),
  }
  return {
    db,
    organizationId: 'org_1',
    ownIdentities: {},
    ownIdentitiesByOrg: new Map(),
    ownDomainsByOrg: new Map<string, Set<string>>(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    socketId: undefined,
  } as any
}

beforeEach(() => {
  h.insertValues = null
  h.conflictSet = null
  h.contactCalls = []
  h.channels = [QUO_CHANNEL]
})

describe("the org's own channel number", () => {
  it('is stored isInternal: true — the regression this plan exists for', async () => {
    await findOrCreateParticipantRecord(
      makeCtx(),
      { identifier: '+18889155797' } as any,
      'PHONE' as any,
      { isInbound: true, role: 'TO' as any }
    )
    expect(h.insertValues?.isInternal).toBe(true)
  })

  it('never reaches contact creation, which is what mode `all` would otherwise do', async () => {
    await findOrCreateParticipantRecord(
      makeCtx(),
      { identifier: '+18889155797' } as any,
      'PHONE' as any,
      { isInbound: true, role: 'TO' as any }
    )
    // `findOrCreateContactForParticipant` bails on `participant.isInternal`, so
    // what matters is the flag it is handed.
    expect(h.contactCalls).toHaveLength(1)
    expect(h.contactCalls[0]?.isInternal).toBe(true)
  })

  it('matches however ingest normalized the stored identifier', async () => {
    // `normalizeIdentifier(x, PHONE)` digit-strips without adding a country
    // code, so the stored form need not equal `metadata.phoneNumber`.
    await findOrCreateParticipantRecord(
      makeCtx(),
      { identifier: '(888) 915-5797' } as any,
      'PHONE' as any
    )
    expect(h.insertValues?.isInternal).toBe(true)
  })
})

describe('the counterparty on the same channel', () => {
  it('stays external', async () => {
    await findOrCreateParticipantRecord(
      makeCtx(),
      { identifier: '+15102055536', name: 'Anna' } as any,
      'PHONE' as any,
      { isInbound: true, role: 'FROM' as any }
    )
    expect(h.insertValues?.isInternal).toBe(false)
  })

  it('is not rescued by sharing an area code with our own line', async () => {
    await findOrCreateParticipantRecord(
      makeCtx(),
      { identifier: '+18889155798' } as any,
      'PHONE' as any
    )
    expect(h.insertValues?.isInternal).toBe(false)
  })
})

describe('email is unchanged', () => {
  it('still classifies the org domain as internal', async () => {
    await findOrCreateParticipantRecord(
      makeCtx(),
      { identifier: 'someone@auxx.ai' } as any,
      'EMAIL' as any
    )
    expect(h.insertValues?.isInternal).toBe(true)
  })

  it('still classifies a customer address as external', async () => {
    await findOrCreateParticipantRecord(
      makeCtx(),
      { identifier: 'buyer@example.com' } as any,
      'EMAIL' as any
    )
    expect(h.insertValues?.isInternal).toBe(false)
  })
})

describe('isInternal is recomputed, not frozen at first write', () => {
  it('is present in the conflict set so org-config changes converge', async () => {
    // Fails before the fix: `isInternal` was in `.values()` only, so a row
    // written before the channel was connected stayed external forever — and
    // the `participant:updated` isInternal patch could never fire.
    await findOrCreateParticipantRecord(
      makeCtx({
        id: 'p_1',
        identifier: '+18889155797',
        name: null,
        displayName: '+18889155797',
        hasReceivedMessage: false,
        lastSentMessageAt: null,
        isInternal: false,
      }),
      { identifier: '+18889155797' } as any,
      'PHONE' as any
    )
    expect(h.conflictSet).toHaveProperty('isInternal', true)
  })

  it('recomputes downward too when a channel is disconnected', async () => {
    h.channels = []
    await findOrCreateParticipantRecord(
      makeCtx({
        id: 'p_1',
        identifier: '+18889155797',
        name: null,
        displayName: '+18889155797',
        hasReceivedMessage: false,
        lastSentMessageAt: null,
        isInternal: true,
      }),
      { identifier: '+18889155797' } as any,
      'PHONE' as any
    )
    expect(h.conflictSet).toHaveProperty('isInternal', false)
  })
})

// packages/lib/src/participants/__tests__/participant-for-integration.test.ts
//
// channel-identity-and-is-internal plan §4.4 — the outbound FROM identity.
//
// `findOrCreateParticipantForIntegration` used to select only
// `Integration.email` and hardcode `EMAIL`. A Quo channel stores its identity in
// `metadata.phoneNumber` and leaves `email` NULL, so it returned null,
// `message-sender.service.ts` fell through its `??` to
// `findOrCreateParticipantForUser`, and every Auxx-composed SMS recorded the
// operator's EMAIL ADDRESS as its sender — permanently, since the reconciler
// never rewrites participants. Verified against the dev DB: one SMS thread whose
// outbound FROM participant is a gmail address, and no Participant row for the
// channel's own number at all.

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  integrationRow: null as Record<string, unknown> | null,
  created: [] as Array<{ identifier: string; identifierType: string; name?: string | null }>,
}))

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  // `database` must be chainable, not `{}` — modules in this graph build
  // prepared statements at module scope and would throw during collection.
  return { schema: createSchemaMock(), database: createChainableDatabaseMock() }
})

// Partial mock, never a full replacement: the module graph behind
// `participant-service` reaches `getTableColumns` (media-asset-service via the
// cache providers), and a full replacement dies at COLLECTION rather than at an
// assertion.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  const passthrough = (...a: unknown[]) => a as never
  return { ...actual, and: passthrough, eq: passthrough, inArray: passthrough }
})

import { ParticipantService } from '../participant-service'

function makeService() {
  const selectChain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown[]) => unknown) =>
            Promise.resolve(res(h.integrationRow ? [h.integrationRow] : []))
        }
        return () => selectChain
      },
    }
  )
  const db = { select: () => selectChain } as any
  const service = new ParticipantService('org_1', db)
  // The identity resolution is what's under test; the upsert underneath is
  // covered by `classify-internal.test.ts` and the ingest suites.
  ;(service as any).findOrCreateParticipant = vi.fn(async (input: any) => {
    h.created.push(input)
    return { id: 'part_1', ...input }
  })
  return service
}

describe('findOrCreateParticipantForIntegration', () => {
  it('resolves a phone channel to its own NUMBER, typed PHONE', async () => {
    h.integrationRow = {
      provider: 'openphone',
      email: null,
      name: 'Support Line',
      metadata: { phoneNumberId: 'PN1', phoneNumber: '+18889155797' },
      organizationId: 'org_1',
    }
    h.created = []

    const participant = await makeService().findOrCreateParticipantForIntegration('int_quo')

    expect(participant).not.toBeNull()
    expect(h.created).toEqual([
      { identifier: '+18889155797', identifierType: 'PHONE', name: 'Support Line' },
    ])
  })

  it('does NOT fall back to the operator email on a phone channel', async () => {
    // The whole bug in one assertion: `email: null` must not mean "no identity".
    h.integrationRow = {
      provider: 'openphone',
      email: null,
      name: 'Support Line',
      metadata: { phoneNumber: '+18889155797' },
      organizationId: 'org_1',
    }
    h.created = []

    await makeService().findOrCreateParticipantForIntegration('int_quo')

    expect(h.created[0]?.identifierType).not.toBe('EMAIL')
    expect(h.created[0]?.identifier).not.toContain('@')
  })

  it('still resolves an email channel to its mailbox, typed EMAIL', async () => {
    h.integrationRow = {
      provider: 'google',
      email: 'support@auxx.ai',
      name: 'Support',
      metadata: {},
      organizationId: 'org_1',
    }
    h.created = []

    await makeService().findOrCreateParticipantForIntegration('int_gmail')

    expect(h.created).toEqual([
      { identifier: 'support@auxx.ai', identifierType: 'EMAIL', name: 'Support' },
    ])
  })

  it('returns null for chat so the caller falls back to the agent user', async () => {
    // A CHAT_VISITOR identifier only ever names the customer — there is no
    // org-side identity to mint in that id space.
    h.integrationRow = {
      provider: 'chat',
      email: null,
      name: 'Website Widget',
      metadata: {},
      organizationId: 'org_1',
    }
    h.created = []

    expect(await makeService().findOrCreateParticipantForIntegration('int_chat')).toBeNull()
    expect(h.created).toEqual([])
  })

  it('never falls back to the channel display name as an identifier', async () => {
    // A display name is not routable and must never become a Participant
    // identifier. `getIdentifier` no longer reads `channel.name` at all (display
    // labelling moved to `getChannelLabel`), so this is now structural — the
    // test stays as the regression guard for that split.
    h.integrationRow = {
      provider: 'openphone',
      email: null,
      name: 'Support Line',
      metadata: {},
      organizationId: 'org_1',
    }
    h.created = []

    expect(await makeService().findOrCreateParticipantForIntegration('int_quo')).toBeNull()
    expect(h.created).toEqual([])
  })

  it('returns null for a provider with no participants at all', async () => {
    h.integrationRow = {
      provider: 'shopify',
      email: null,
      name: 'Shop',
      metadata: {},
      organizationId: 'org_1',
    }
    h.created = []

    expect(await makeService().findOrCreateParticipantForIntegration('int_shop')).toBeNull()
  })

  it('returns null when the integration is not in this org', async () => {
    h.integrationRow = null
    h.created = []

    expect(await makeService().findOrCreateParticipantForIntegration('int_missing')).toBeNull()
  })
})

// packages/lib/src/ingest/contacts/__tests__/find-or-create-names.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a new contact is NAMED — FB/IG follow-up, Aug 2026.
 *
 * `Participant.displayName` restates the identifier when no name is known, and
 * `full_name` is the contact's primary display field, so the old unconditional
 * fallback wrote a 17-digit PSID into First Name and made it the record's
 * `EntityInstance.displayName`. Downstream nothing could tell it from a real
 * name, and nothing ever revisited it.
 *
 * The rule pinned here is per identifier type, not blanket: an address and a
 * phone number are labels a human reads and the contacts list has always shown
 * them, so only the opaque types lose the fallback.
 */

vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../../companies/link-contact', () => ({
  linkContactToCompanyByDomain: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../domain/classifier', () => ({
  getOwnDomains: vi.fn().mockResolvedValue(new Set<string>()),
}))

vi.mock('../has-sent-to', () => ({
  hasOrganizationSentToParticipant: vi.fn().mockResolvedValue(true),
}))

import { findOrCreateContactForParticipant } from '../find-or-create'

const create = vi.fn()
const findOrCreate = vi.fn()
const findByField = vi.fn()

function makeCtx() {
  return {
    organizationId: 'org_1',
    db: {} as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    crudHandler: { create, findOrCreate, findByField },
    integrationSettings: { recordCreation: { mode: 'all' } },
    ownDomainsByOrg: new Map(),
    companyIdByDomain: new Map(),
  } as never
}

/** A participant the way ingest writes one before any name is known. */
function nameless(identifierType: string, identifier: string) {
  return {
    id: 'participant_1',
    identifier,
    identifierType,
    name: null,
    // What `calculateDisplayName` produces with no name: the identifier itself.
    displayName: identifier,
    isInternal: false,
  } as never
}

const inbound = { isInbound: true, role: 'FROM' as never }

/** The create payload, whichever arm minted the contact. */
function createdValues(): Record<string, unknown> {
  const viaFindOrCreate = findOrCreate.mock.calls[0]?.[2]
  return (viaFindOrCreate ?? create.mock.calls[0]?.[1]) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  create.mockResolvedValue({ instance: { id: 'contact_new' } })
  findOrCreate.mockResolvedValue({ instance: { id: 'contact_new' } })
  findByField.mockResolvedValue(null)
})

describe('findOrCreateContactForParticipant — naming a nameless participant', () => {
  for (const [type, identifier] of [
    ['FACEBOOK_PSID', '27893553143563440'],
    ['INSTAGRAM_IGSID', '17841448440510270'],
    ['CHAT_VISITOR', 'cm4x9visitorsessioncuid'],
  ] as const) {
    it(`never launders a ${type} into the contact's first name`, async () => {
      await findOrCreateContactForParticipant(makeCtx(), nameless(type, identifier), inbound)

      const values = createdValues()
      expect(values.first_name).toBeNull()
      expect(values.last_name).toBeNull()
      // Blank is the point: the profile lookup fills the participant in within
      // seconds and `repairContactNameFromParticipant` patches the record. A
      // laundered id would have been indistinguishable from a real name forever.
      expect(Object.values(values)).not.toContain(identifier)
    })
  }

  it('still names an EMAIL contact after its address', async () => {
    await findOrCreateContactForParticipant(
      makeCtx(),
      nameless('EMAIL', 'jane@example.com'),
      inbound
    )

    expect(createdValues().first_name).toBe('jane@example.com')
  })

  it('still names a PHONE contact after its number', async () => {
    await findOrCreateContactForParticipant(makeCtx(), nameless('PHONE', '+14056121542'), inbound)

    expect(createdValues().first_name).toBe('+14056121542')
  })

  it('splits a resolved name normally, whatever the identifier type', async () => {
    const participant = {
      ...(nameless('FACEBOOK_PSID', '27893553143563440') as object),
      name: 'Markus Klooth',
      displayName: 'Markus Klooth',
    } as never

    await findOrCreateContactForParticipant(makeCtx(), participant, inbound)

    const values = createdValues()
    expect(values.first_name).toBe('Markus')
    expect(values.last_name).toBe('Klooth')
  })
})

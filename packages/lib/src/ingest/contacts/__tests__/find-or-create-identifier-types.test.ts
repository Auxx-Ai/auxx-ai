// packages/lib/src/ingest/contacts/__tests__/find-or-create-identifier-types.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- mocks -----------------------------------------------------------------

// Partial mock: `@auxx/logger/run-log` imports sink-registration helpers from
// this barrel at module load, so a full replacement breaks whichever test file
// happens to load it first.
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

function participant(identifierType: string, identifier: string) {
  return {
    id: 'participant_1',
    identifier,
    identifierType,
    displayName: 'Sender',
    isInternal: false,
  } as never
}

const inbound = { isInbound: true, role: 'FROM' as never }

beforeEach(() => {
  vi.clearAllMocks()
  create.mockResolvedValue({ instance: { id: 'contact_new' } })
  findOrCreate.mockResolvedValue({ instance: { id: 'contact_new' } })
  findByField.mockResolvedValue(null)
})

describe('findOrCreateContactForParticipant — which identifier dedupes on which field', () => {
  it('dedupes an EMAIL participant on primary_email', async () => {
    const contactId = await findOrCreateContactForParticipant(
      makeCtx(),
      participant('EMAIL', 'jane@example.com'),
      inbound
    )

    expect(contactId).toBe('contact_new')
    expect(findOrCreate).toHaveBeenCalledWith(
      'contact',
      { primary_email: 'jane@example.com' },
      expect.objectContaining({ primary_email: ['jane@example.com'] })
    )
  })

  // Regression: the type ladder used to END in `primary_email`, so every
  // identifier that was not a chat visitor or a phone was treated as an email
  // address. A Meta PSID went into `findByField('primary_email', '9990197…')`
  // and into the create payload, where the write validator rejected it as an
  // uncoercible value — leaving a contact with NO identifier and therefore no
  // dedupe key, so each conversation minted another one.
  for (const [type, source, identifier] of [
    ['FACEBOOK_PSID', 'facebook', '9990197041092280'],
    ['INSTAGRAM_IGSID', 'instagram', '17841400000000000'],
  ] as const) {
    it(`dedupes a ${type} through the identity index, never primary_email`, async () => {
      const contactId = await findOrCreateContactForParticipant(
        makeCtx(),
        participant(type, identifier),
        inbound
      )

      expect(contactId).toBe('contact_new')
      // Namespaced, and looked up on `external_id` — which the lookup core
      // routes to `RecordIdentity`, not to a FieldValue cell.
      expect(findOrCreate).toHaveBeenCalledWith(
        'contact',
        { external_id: `${source}:${identifier}` },
        // ARRAY-valued on the create side: that is what makes
        // `UnifiedCrudHandler.create` mirror it into the index.
        expect.objectContaining({ external_id: [`${source}:${identifier}`] })
      )
      const created = findOrCreate.mock.calls[0]?.[2] as Record<string, unknown>
      expect(created).not.toHaveProperty('primary_email')
      expect(created).not.toHaveProperty('phone')
      expect(create).not.toHaveBeenCalled()
    })

    it(`reuses the contact an existing ${type} identity already points at`, async () => {
      // Selective mode is where the lookup is explicit; in mode `all` the same
      // dedupe happens one level down, inside `handler.findOrCreate`.
      const ctx = makeCtx() as unknown as { integrationSettings: unknown }
      ctx.integrationSettings = { recordCreation: { mode: 'selective' } }
      findByField.mockResolvedValue({ id: 'contact_existing' })

      const contactId = await findOrCreateContactForParticipant(
        ctx as never,
        participant(type, identifier),
        inbound
      )

      expect(contactId).toBe('contact_existing')
      expect(findByField).toHaveBeenCalledWith('contact', 'external_id', `${source}:${identifier}`)
      expect(create).not.toHaveBeenCalled()
      expect(findOrCreate).not.toHaveBeenCalled()
    })
  }

  it('looks a social participant up on external_id in mode "none", and never creates', async () => {
    const ctx = makeCtx() as unknown as { integrationSettings: unknown }
    ctx.integrationSettings = { recordCreation: { mode: 'none' } }

    const contactId = await findOrCreateContactForParticipant(
      ctx as never,
      participant('FACEBOOK_PSID', '9990197041092280'),
      inbound
    )

    expect(contactId).toBeNull()
    expect(findByField).toHaveBeenCalledWith('contact', 'external_id', 'facebook:9990197041092280')
    expect(create).not.toHaveBeenCalled()
    expect(findOrCreate).not.toHaveBeenCalled()
  })

  it('has no dedupe key at all for a chat visitor or a short code — those create every time', async () => {
    // The `null` arm is deliberate, not an oversight: neither value is an
    // identity another system issues, so `Participant.entityInstanceId` is the
    // only stable link and the caller writes it back.
    for (const p of [participant('CHAT_VISITOR', 'sess_abc123'), participant('PHONE', '12345')]) {
      vi.clearAllMocks()
      create.mockResolvedValue({ instance: { id: 'contact_new' } })

      await findOrCreateContactForParticipant(makeCtx(), p, inbound)

      expect(findByField).not.toHaveBeenCalled()
      expect(findOrCreate).not.toHaveBeenCalled()
      expect(create).toHaveBeenCalledTimes(1)
    }
  })
})

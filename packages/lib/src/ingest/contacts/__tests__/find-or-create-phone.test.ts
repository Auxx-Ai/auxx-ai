// packages/lib/src/ingest/contacts/__tests__/find-or-create-phone.test.ts

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

function phoneParticipant(identifier: string) {
  return {
    id: 'participant_1',
    identifier,
    identifierType: 'PHONE',
    displayName: 'Sender',
    isInternal: false,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  create.mockResolvedValue({ instance: { id: 'contact_new' } })
  findOrCreate.mockResolvedValue({ instance: { id: 'contact_new' } })
  findByField.mockResolvedValue(null)
})

describe('findOrCreateContactForParticipant — PHONE identifiers', () => {
  it('writes a dialable number and dedupes on it', async () => {
    const contactId = await findOrCreateContactForParticipant(
      makeCtx(),
      phoneParticipant('+14155551234'),
      { isInbound: true, role: 'FROM' as never }
    )

    expect(contactId).toBe('contact_new')
    expect(findOrCreate).toHaveBeenCalledWith(
      'contact',
      { phone: '+14155551234' },
      expect.objectContaining({ phone: ['+14155551234'] })
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('creates without a phone value for an SMS short code (validator would reject it)', async () => {
    // Ingest must never throw: a short code is not a dialable number, so the
    // contact is created with no phone and no identifier-keyed dedupe.
    const contactId = await findOrCreateContactForParticipant(
      makeCtx(),
      phoneParticipant('12345'),
      { isInbound: true, role: 'FROM' as never }
    )

    expect(contactId).toBe('contact_new')
    expect(findOrCreate).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith('contact', expect.any(Object))
    expect(create.mock.calls[0]?.[1]).not.toHaveProperty('phone')
  })

  it('creates without a phone value for an alphanumeric sender id', async () => {
    const contactId = await findOrCreateContactForParticipant(makeCtx(), phoneParticipant('AUXX'), {
      isInbound: true,
      role: 'FROM' as never,
    })

    expect(contactId).toBe('contact_new')
    expect(create.mock.calls[0]?.[1]).not.toHaveProperty('phone')
  })
})

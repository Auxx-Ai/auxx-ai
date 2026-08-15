// packages/lib/src/participants/__tests__/participant-queries.test.ts
// B6 (multi-email plan): the chat "promote to contact" claimed-email copy must
// APPEND on a multi-value `primary_email` field (never replace the alias list)
// and must SURFACE uniqueness conflicts to the clicking user instead of
// silently promoting with no email.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UniqueValueConflictError } from '../../errors'

// Partial mock: `@auxx/logger/run-log` imports sink-registration helpers from
// this barrel at module load, so a full replacement breaks whichever test file
// happens to load it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const crudUpdate = vi.fn()
const findOrCreateContactForParticipant = vi.fn()
vi.mock('../../ingest', () => ({
  createIngestContext: vi.fn(async () => ({ crudHandler: { update: crudUpdate } })),
  extractRegistrableDomain: vi.fn(() => null),
  findOrCreateContactForParticipant: (...args: unknown[]) =>
    findOrCreateContactForParticipant(...args),
  getOwnDomains: vi.fn(async () => new Set<string>()),
  normalizeDomain: (d: string) => d,
}))

const getChatThreadMetadata = vi.fn()
vi.mock('../../chat/metadata', () => ({
  getChatThreadMetadata: (...args: unknown[]) => getChatThreadMetadata(...args),
}))

const getCachedEntityDefId = vi.fn()
const getCachedCustomFields = vi.fn()
vi.mock('../../cache', () => ({
  getCachedEntityDefId: (...args: unknown[]) => getCachedEntityDefId(...args),
  getCachedCustomFields: (...args: unknown[]) => getCachedCustomFields(...args),
  // The own-channel-identity guard reads the `channels` cache. No channels =
  // no own identities, so every fixture participant stays promotable.
  getOrgCache: () => ({ get: async () => [] }),
}))

import { ensureContactForParticipant } from '../participant-queries'

const ORG = 'org_1'
const PARTICIPANT = {
  id: 'part_1',
  organizationId: ORG,
  entityInstanceId: null,
  isSpammer: false,
  isInternal: false,
  identifier: 'visitor_cookie',
  identifierType: 'CHAT_VISITOR',
}

/** Minimal `Database` stand-in for the participant read + link-back write. */
// biome-ignore lint/suspicious/noExplicitAny: test double
function makeDb(participantRow: unknown): any {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (participantRow ? [participantRow] : []) }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }
}

const emailField = (multi: boolean) => ({
  id: 'fld_email',
  systemAttribute: 'primary_email',
  type: 'EMAIL',
  options: multi ? { multi: true } : {},
})

beforeEach(() => {
  vi.clearAllMocks()
  findOrCreateContactForParticipant.mockResolvedValue('contact_1')
  crudUpdate.mockResolvedValue(undefined)
  getCachedEntityDefId.mockResolvedValue('def_contact')
  getCachedCustomFields.mockResolvedValue([emailField(true)])
  getChatThreadMetadata.mockResolvedValue({
    claimedVisitorName: 'Jane Doe',
    claimedVisitorEmail: 'jane@example.com',
    visit: null,
  })
})

describe('ensureContactForParticipant — claimed email copy', () => {
  it('APPENDS the claimed email on a multi-value field (mode add, never a replace)', async () => {
    const result = await ensureContactForParticipant(ORG, 'part_1', makeDb(PARTICIPANT), {
      sourceThreadId: 'thread_1',
    })

    expect(result).toEqual({ entityInstanceId: 'contact_1', created: true })
    // Name attrs and the email ride separate writes; the email write is an
    // append so an existing contact's alias list is never replaced.
    expect(crudUpdate).toHaveBeenCalledWith(
      'contact:contact_1',
      { primary_email: ['jane@example.com'] },
      { primary_email: 'add' }
    )
    // No write may carry the email as a whole-value set.
    for (const call of crudUpdate.mock.calls) {
      const [, values, modes] = call as [string, Record<string, unknown>, unknown]
      if ('primary_email' in values) {
        expect(modes).toEqual({ primary_email: 'add' })
      }
    }
  })

  it('keeps the whole-value set while the field is still single-value (pre-flip)', async () => {
    getCachedCustomFields.mockResolvedValue([emailField(false)])

    await ensureContactForParticipant(ORG, 'part_1', makeDb(PARTICIPANT), {
      sourceThreadId: 'thread_1',
    })

    expect(crudUpdate).toHaveBeenCalledWith('contact:contact_1', {
      primary_email: 'jane@example.com',
    })
  })

  it('surfaces a uniqueness conflict on the claimed email to the caller', async () => {
    crudUpdate.mockImplementation(async (_recordId: string, values: Record<string, unknown>) => {
      if ('primary_email' in values) {
        throw new UniqueValueConflictError({
          message: 'Value already in use',
          conflictingValue: 'jane@example.com',
          existingEntityId: 'contact_other',
        })
      }
    })

    await expect(
      ensureContactForParticipant(ORG, 'part_1', makeDb(PARTICIPANT), {
        sourceThreadId: 'thread_1',
      })
    ).rejects.toBeInstanceOf(UniqueValueConflictError)
  })

  it('stays best-effort for non-conflict email copy failures', async () => {
    crudUpdate.mockImplementation(async (_recordId: string, values: Record<string, unknown>) => {
      if ('primary_email' in values) throw new Error('transient')
    })

    await expect(
      ensureContactForParticipant(ORG, 'part_1', makeDb(PARTICIPANT), {
        sourceThreadId: 'thread_1',
      })
    ).resolves.toEqual({ entityInstanceId: 'contact_1', created: true })
  })

  it('still writes the claimed email when the name/geo copy fails', async () => {
    crudUpdate.mockImplementation(async (_recordId: string, values: Record<string, unknown>) => {
      if (!('primary_email' in values)) throw new Error('attrs write failed')
    })

    await ensureContactForParticipant(ORG, 'part_1', makeDb(PARTICIPANT), {
      sourceThreadId: 'thread_1',
    })

    expect(crudUpdate).toHaveBeenCalledWith(
      'contact:contact_1',
      { primary_email: ['jane@example.com'] },
      { primary_email: 'add' }
    )
  })
})

// packages/lib/src/participants/__tests__/get-participant-meta-batch.test.ts
//
// contact-name-precedence plan §Phase 1 — the read-time contact projection.
//
// `getParticipantMetaBatch` used to select only Participant columns and
// hardcode `avatarUrl: null`; a renamed contact never surfaced on mail. Now it
// batch-resolves non-archived linked contacts and stamps `contactName`
// (normalized by `usableContactName`) + the contact's `avatarUrl` onto every
// meta. Read-time, never write-through: `Participant.name` stays untouched.

import { describe, expect, it, vi } from 'vitest'

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
  return { ...actual, and: passthrough, eq: passthrough, inArray: passthrough, isNull: passthrough }
})

import { ParticipantService } from '../participant-service'

interface ParticipantRow {
  id: string
  name: string | null
  identifier: string
  identifierType: string
  displayName: string | null
  initials: string | null
  entityInstanceId: string | null
  isSpammer: boolean
  isInternal: boolean
}

interface ContactRow {
  id: string
  displayName: string | null
  avatarUrl: string | null
}

function makeService(participants: ParticipantRow[], contacts: ContactRow[]) {
  const findManyParticipants = vi.fn(async () => participants)
  const findManyContacts = vi.fn(async () => contacts)
  const db = {
    query: {
      Participant: { findMany: findManyParticipants },
      EntityInstance: { findMany: findManyContacts },
    },
  } as any
  return { service: new ParticipantService('org_1', db), findManyContacts }
}

function participantRow(overrides: Partial<ParticipantRow> = {}): ParticipantRow {
  return {
    id: 'part_1',
    name: null,
    identifier: '+18889155797',
    identifierType: 'PHONE',
    displayName: '+18889155797',
    initials: null,
    entityInstanceId: 'contact_1',
    isSpammer: false,
    isInternal: false,
    ...overrides,
  }
}

describe('getParticipantMetaBatch contact enrichment', () => {
  it('stamps contactName + avatarUrl from the linked contact', async () => {
    const { service } = makeService(
      [participantRow()],
      [{ id: 'contact_1', displayName: 'Bruno Klooth', avatarUrl: 'https://cdn/x.png' }]
    )

    const [meta] = await service.getParticipantMetaBatch(['part_1'])

    expect(meta?.contactName).toBe('Bruno Klooth')
    expect(meta?.avatarUrl).toBe('https://cdn/x.png')
    // Read-time projection only — the participant's own label fields survive.
    expect(meta?.displayName).toBe('+18889155797')
    expect(meta?.name).toBeNull()
  })

  it('nulls contactName when the contact display value IS the identifier', async () => {
    // A contact whose display value is just the phone/email echoed back must
    // not masquerade as a name (case-insensitive, trimmed).
    const { service } = makeService(
      [participantRow({ identifier: 'ada@acme.io', identifierType: 'EMAIL' })],
      [{ id: 'contact_1', displayName: '  ADA@ACME.IO ', avatarUrl: null }]
    )

    const [meta] = await service.getParticipantMetaBatch(['part_1'])

    expect(meta?.contactName).toBeNull()
  })

  it('nulls contactName for a blank contact display value', async () => {
    const { service } = makeService(
      [participantRow()],
      [{ id: 'contact_1', displayName: '   ', avatarUrl: null }]
    )

    const [meta] = await service.getParticipantMetaBatch(['part_1'])

    expect(meta?.contactName).toBeNull()
  })

  it('falls back when the contact is not returned (archived / deleted)', async () => {
    // The enrichment query filters `archivedAt IS NULL`; an archived contact's
    // participant reverts to the header/identifier label.
    const { service } = makeService([participantRow()], [])

    const [meta] = await service.getParticipantMetaBatch(['part_1'])

    expect(meta?.contactName).toBeNull()
    expect(meta?.avatarUrl).toBeNull()
  })

  it('skips the contact query entirely when no participant links a contact', async () => {
    const { service, findManyContacts } = makeService(
      [participantRow({ entityInstanceId: null })],
      []
    )

    const [meta] = await service.getParticipantMetaBatch(['part_1'])

    expect(meta?.contactName).toBeNull()
    expect(findManyContacts).not.toHaveBeenCalled()
  })

  it('still returns metas in input order with misses excluded', async () => {
    const { service } = makeService(
      [participantRow({ id: 'part_2', identifier: 'b@x.io' }), participantRow({ id: 'part_1' })],
      [{ id: 'contact_1', displayName: 'Bruno Klooth', avatarUrl: null }]
    )

    const metas = await service.getParticipantMetaBatch(['part_1', 'part_missing', 'part_2'])

    expect(metas.map((m) => m.id)).toEqual(['part_1', 'part_2'])
  })
})

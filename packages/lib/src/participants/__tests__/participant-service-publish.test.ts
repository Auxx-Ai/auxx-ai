// packages/lib/src/participants/__tests__/participant-service-publish.test.ts
//
// contact-name-precedence plan Phase 5 — the composer/outbound write path.
// `ParticipantService.findOrCreateParticipant` used to mutate tracked name
// columns silently; with a publish context it now diffs old vs new (ingest's
// `findOrCreateParticipantRecord` precedent) and emits `participant:updated`
// on the triggering inbox's lens channels — and ONLY on a real change.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  previousRow: null as Record<string, unknown> | null,
  returnedRow: {} as Record<string, unknown>,
  selectCalls: 0,
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
  return { ...actual, and: passthrough, eq: passthrough, inArray: passthrough, isNull: passthrough }
})

// Keep the classifier away from the org cache — internal/external is not what
// is under test, and the real one lazy-imports `../cache`.
vi.mock('../classify-internal', () => ({
  classifyIsInternal: vi.fn(async () => false),
}))

// Same full replacement the ingest publish tests use — the realtime barrel is
// reached lazily from `publishParticipantPatch`.
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishParticipantUpdated: vi.fn(),
}))

import { publishParticipantUpdated } from '../../realtime'
import { ParticipantService } from '../participant-service'

const publishSpy = vi.mocked(publishParticipantUpdated)

function makeService() {
  const db = {
    select: () => {
      h.selectCalls += 1
      return {
        from: () => ({
          where: () => ({
            limit: async () => (h.previousRow ? [h.previousRow] : []),
          }),
        }),
      }
    },
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({ returning: async () => [h.returnedRow] }),
      }),
    }),
  } as any
  return new ParticipantService('org_1', db)
}

function returnedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'part_1',
    identifier: 'anna@example.com',
    identifierType: 'EMAIL',
    name: 'Anna Klooth',
    displayName: 'Anna Klooth',
    initials: 'AK',
    isInternal: false,
    entityInstanceId: 'contact_1',
    ...overrides,
  }
}

beforeEach(() => {
  publishSpy.mockReset()
  h.previousRow = null
  h.returnedRow = returnedRow()
  h.selectCalls = 0
})

const INPUT = {
  identifier: 'anna@example.com',
  identifierType: 'EMAIL' as never,
  name: 'Anna Klooth',
}

describe('findOrCreateParticipant participant:updated emission', () => {
  it('publishes the changed columns on the given inbox when a tracked column changed', async () => {
    h.previousRow = { name: 'Anna', displayName: 'Anna', isInternal: false }

    const participant = await makeService().findOrCreateParticipant(INPUT, {
      inboxId: 'inbox_1',
      excludeSocketId: 'sock_1',
    })

    expect(participant.id).toBe('part_1')
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      {
        participantId: 'part_1',
        patch: { name: 'Anna Klooth', displayName: 'Anna Klooth' },
        inboxId: 'inbox_1',
      },
      { excludeSocketId: 'sock_1' }
    )
  })

  it('does NOT publish when nothing changed', async () => {
    h.previousRow = { name: 'Anna Klooth', displayName: 'Anna Klooth', isInternal: false }

    await makeService().findOrCreateParticipant(INPUT, { inboxId: 'inbox_1' })

    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('does NOT publish for a brand-new row (no previous state)', async () => {
    h.previousRow = null

    await makeService().findOrCreateParticipant(INPUT, { inboxId: 'inbox_1' })

    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('stays fully silent without a publish context — no pre-select, no event', async () => {
    h.previousRow = { name: 'Anna', displayName: 'Anna', isInternal: false }

    await makeService().findOrCreateParticipant(INPUT)

    expect(h.selectCalls).toBe(0)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('publishes an isInternal flip even when the label is unchanged', async () => {
    h.previousRow = { name: 'Anna Klooth', displayName: 'Anna Klooth', isInternal: true }
    h.returnedRow = returnedRow({ isInternal: false })

    await makeService().findOrCreateParticipant(INPUT, { inboxId: 'inbox_1' })

    expect(publishSpy).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      expect.objectContaining({ patch: { isInternal: false } }),
      undefined
    )
  })

  it('a publish failure never fails the upsert', async () => {
    h.previousRow = { name: 'Anna', displayName: 'Anna', isInternal: false }
    publishSpy.mockRejectedValueOnce(new Error('realtime down'))

    const participant = await makeService().findOrCreateParticipant(INPUT, { inboxId: 'inbox_1' })

    expect(participant.id).toBe('part_1')
  })
})

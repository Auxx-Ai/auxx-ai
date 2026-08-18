// packages/lib/src/chat/visitor-identity.test.ts
//
// contact-name-precedence plan Phase 5 — the visitor claimed-identity write
// path. `updateVisitorClaimedIdentity` used to overwrite the synthetic
// `Cyan Turtle` label silently; it now diffs the tracked columns and emits
// `participant:updated` on the thread's inbox — and only on a real change.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../test/database-mock')
  return { schema: createSchemaMock(), database: createChainableDatabaseMock() }
})

// Partial mock, never a full replacement (a full one dies at collection).
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  const passthrough = (...a: unknown[]) => a as never
  return { ...actual, and: passthrough, eq: passthrough }
})

// Partial mock of our own publish module: the diff stays REAL (it decides
// whether an event fires at all), only the fanout is spied.
vi.mock('../participants/publish-participant-changes', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../participants/publish-participant-changes')>()
  return { ...actual, publishParticipantPatch: vi.fn(async () => {}) }
})

import { publishParticipantPatch } from '../participants/publish-participant-changes'
import { updateVisitorClaimedIdentity } from './visitor-identity'

const publishSpy = vi.mocked(publishParticipantPatch)

const h = {
  previousRow: null as { name: string | null; displayName: string | null } | null,
  setValues: null as Record<string, unknown> | null,
  updateCalls: 0,
}

function makeCtx() {
  const db = {
    query: {
      Participant: { findFirst: vi.fn(async () => h.previousRow ?? undefined) },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        h.setValues = values
        h.updateCalls += 1
        return { where: async () => undefined }
      },
    }),
  } as any
  return { db, organizationId: 'org_1' } as any
}

beforeEach(() => {
  publishSpy.mockReset()
  publishSpy.mockResolvedValue(undefined)
  h.previousRow = null
  h.setValues = null
  h.updateCalls = 0
})

describe('updateVisitorClaimedIdentity participant:updated emission', () => {
  it('publishes name + displayName on the thread inbox when a name is claimed', async () => {
    h.previousRow = { name: 'Cyan Turtle', displayName: 'Cyan Turtle' }

    const result = await updateVisitorClaimedIdentity(makeCtx(), 'part_1', {
      name: 'Bruno Klooth',
      inboxId: 'inbox_1',
    })

    expect(result.ok).toBe(true)
    expect(h.setValues).toMatchObject({ name: 'Bruno Klooth', displayName: 'Bruno Klooth' })
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy).toHaveBeenCalledWith({
      organizationId: 'org_1',
      participantId: 'part_1',
      patch: { name: 'Bruno Klooth', displayName: 'Bruno Klooth' },
      inboxId: 'inbox_1',
    })
  })

  it('does NOT publish when the claimed name is already stored', async () => {
    h.previousRow = { name: 'Bruno Klooth', displayName: 'Bruno Klooth' }

    const result = await updateVisitorClaimedIdentity(makeCtx(), 'part_1', {
      name: 'Bruno Klooth',
      inboxId: 'inbox_1',
    })

    expect(result.ok).toBe(true)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('email-only claim patches displayName but never name', async () => {
    h.previousRow = { name: null, displayName: 'Cyan Turtle' }

    await updateVisitorClaimedIdentity(makeCtx(), 'part_1', {
      email: 'bruno@example.com',
      inboxId: 'inbox_1',
    })

    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { displayName: 'bruno@example.com' } })
    )
  })

  it('does NOT publish when the scoped row does not exist', async () => {
    h.previousRow = null

    const result = await updateVisitorClaimedIdentity(makeCtx(), 'part_missing', {
      name: 'Bruno',
      inboxId: 'inbox_1',
    })

    expect(result.ok).toBe(true)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('stays a no-op (no db write, no publish) without name or email', async () => {
    const ctx = makeCtx()
    const result = await updateVisitorClaimedIdentity(ctx, 'part_1', { inboxId: 'inbox_1' })

    expect(result.ok).toBe(true)
    expect(h.updateCalls).toBe(0)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('a db failure still returns a Result.error, unchanged behavior', async () => {
    const ctx = makeCtx()
    ctx.db.query.Participant.findFirst = vi.fn(async () => {
      throw new Error('db down')
    })

    const result = await updateVisitorClaimedIdentity(ctx, 'part_1', { name: 'Bruno' })

    expect(result.ok).toBe(false)
    expect(publishSpy).not.toHaveBeenCalled()
  })
})

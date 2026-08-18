// packages/lib/src/participants/__tests__/publish-participant-changes.test.ts
//
// contact-name-precedence plan Phase 5 — the shared diff-then-publish contract
// for the non-ingest participant write paths. The diff decides WHAT changed;
// `publishParticipantPatch` reuses the existing inbox-lens fanout
// (`publishParticipantUpdated`) and must never throw into the caller's path.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishParticipantUpdated: vi.fn(),
}))

import { publishParticipantUpdated } from '../../realtime'
import { diffParticipantNamePatch, publishParticipantPatch } from '../publish-participant-changes'

const publishSpy = vi.mocked(publishParticipantUpdated)

beforeEach(() => {
  publishSpy.mockReset()
})

describe('diffParticipantNamePatch', () => {
  it('returns an empty patch when nothing changed', () => {
    const row = { name: 'Anna', displayName: 'Anna', isInternal: false }
    expect(diffParticipantNamePatch(row, { ...row })).toEqual({})
  })

  it('carries only the columns that actually changed', () => {
    const patch = diffParticipantNamePatch(
      { name: null, displayName: '+18889155797', isInternal: false },
      { name: 'Bruno', displayName: 'Bruno', isInternal: false }
    )
    expect(patch).toEqual({ name: 'Bruno', displayName: 'Bruno' })
  })

  it('maps a null next displayName to undefined (realtime field shape)', () => {
    const patch = diffParticipantNamePatch(
      { name: null, displayName: 'x' },
      { name: null, displayName: null }
    )
    expect(patch).toEqual({ displayName: undefined })
    expect('displayName' in patch).toBe(true)
  })

  it('compares isInternal only when the write recomputed it', () => {
    // Callers that never touch isInternal (visitor identity, passport) omit it.
    expect(
      diffParticipantNamePatch(
        { name: 'A', displayName: 'A', isInternal: true },
        { name: 'A', displayName: 'A' }
      )
    ).toEqual({})
    expect(
      diffParticipantNamePatch(
        { name: 'A', displayName: 'A', isInternal: false },
        { name: 'A', displayName: 'A', isInternal: true }
      )
    ).toEqual({ isInternal: true })
  })
})

describe('publishParticipantPatch', () => {
  it('publishes through the shared inbox-lens fanout', async () => {
    await publishParticipantPatch({
      organizationId: 'org_1',
      participantId: 'part_1',
      patch: { name: 'Bruno' },
      inboxId: 'inbox_1',
      excludeSocketId: 'sock_1',
    })

    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      { participantId: 'part_1', patch: { name: 'Bruno' }, inboxId: 'inbox_1' },
      { excludeSocketId: 'sock_1' }
    )
  })

  it('defaults a missing inboxId to null (admin-only `none` channel)', async () => {
    await publishParticipantPatch({
      organizationId: 'org_1',
      participantId: 'part_1',
      patch: { displayName: 'Bruno' },
    })

    expect(publishSpy).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      expect.objectContaining({ inboxId: null }),
      undefined
    )
  })

  it('no-ops on an empty patch', async () => {
    await publishParticipantPatch({ organizationId: 'org_1', participantId: 'part_1', patch: {} })
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('never throws when the underlying publish fails', async () => {
    publishSpy.mockRejectedValueOnce(new Error('realtime down'))
    await expect(
      publishParticipantPatch({
        organizationId: 'org_1',
        participantId: 'part_1',
        patch: { name: 'Bruno' },
      })
    ).resolves.toBeUndefined()
  })
})

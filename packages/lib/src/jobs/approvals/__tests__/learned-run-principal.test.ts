// packages/lib/src/jobs/approvals/__tests__/learned-run-principal.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Capture-mode runs refuse to run for anyone who isn't an ACTIVE human member,
 * so this chain is what decides whether a thread can be learned from at all —
 * and the org fallback is what keeps unassigned threads (nearly all of them)
 * from being permanently skipped.
 */

const state = vi.hoisted(() => ({
  members: [] as Array<Record<string, unknown>>,
  lastOutboundAuthorId: null as string | null,
}))

vi.mock('../../../cache/org-cache-helpers', () => ({
  getCachedMembers: async () => state.members,
}))

const { resolveLearnedRunPrincipal } = await import('../learned-run-principal')

const member = (
  userId: string,
  overrides: { role?: string; status?: string; userType?: string } = {}
) => ({
  userId,
  role: overrides.role ?? 'USER',
  status: overrides.status ?? 'ACTIVE',
  user: { userType: overrides.userType ?? 'USER' },
})

/** Minimal db stand-in: only the last-outbound-author query is reached. */
const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () =>
            state.lastOutboundAuthorId ? [{ createdById: state.lastOutboundAuthorId }] : [],
        }),
      }),
    }),
  }),
} as never

const resolve = (params: { assigneeId?: string | null; requestedByUserId?: string }) =>
  resolveLearnedRunPrincipal({
    db,
    organizationId: 'org-1',
    threadId: 'thread-1',
    assigneeId: params.assigneeId ?? null,
    requestedByUserId: params.requestedByUserId,
  })

describe('resolveLearnedRunPrincipal', () => {
  beforeEach(() => {
    state.members = [
      member('owner-1', { role: 'OWNER' }),
      member('admin-1', { role: 'ADMIN' }),
      member('human-1'),
      member('agent-1', { userType: 'AGENT' }),
      member('inactive-1', { status: 'INVITED' }),
    ]
    state.lastOutboundAuthorId = null
  })

  it('prefers the member who explicitly asked, and gives them the bundle', async () => {
    state.lastOutboundAuthorId = 'human-1'
    await expect(resolve({ assigneeId: 'admin-1', requestedByUserId: 'human-1' })).resolves.toEqual(
      {
        runAsUserId: 'human-1',
        ownerUserId: 'human-1',
      }
    )
  })

  it('falls to the assignee when nobody asked', async () => {
    await expect(resolve({ assigneeId: 'human-1' })).resolves.toEqual({
      runAsUserId: 'human-1',
      ownerUserId: 'human-1',
    })
  })

  it('skips an agent assignee — a pseudo-user is not a principal', async () => {
    state.lastOutboundAuthorId = 'human-1'
    await expect(resolve({ assigneeId: 'agent-1' })).resolves.toEqual({
      runAsUserId: 'human-1',
      ownerUserId: 'human-1',
    })
  })

  it('skips a non-ACTIVE requester', async () => {
    await expect(resolve({ requestedByUserId: 'inactive-1' })).resolves.toEqual({
      runAsUserId: 'owner-1',
      ownerUserId: null,
    })
  })

  it('uses the last outbound human author when the thread is unassigned', async () => {
    state.lastOutboundAuthorId = 'human-1'
    await expect(resolve({})).resolves.toEqual({
      runAsUserId: 'human-1',
      ownerUserId: 'human-1',
    })
  })

  it('falls back to the org owner, leaving the bundle unassigned', async () => {
    await expect(resolve({})).resolves.toEqual({
      runAsUserId: 'owner-1',
      ownerUserId: null,
    })
  })

  it('falls back to an admin when there is no human owner', async () => {
    state.members = [
      member('owner-bot', { role: 'OWNER', userType: 'AGENT' }),
      member('admin-1', { role: 'ADMIN' }),
    ]
    await expect(resolve({})).resolves.toEqual({
      runAsUserId: 'admin-1',
      ownerUserId: null,
    })
  })

  it('returns null when the org has no ACTIVE human member', async () => {
    state.members = [member('agent-1', { userType: 'AGENT' }), member('x', { status: 'INVITED' })]
    await expect(resolve({})).resolves.toBeNull()
  })
})

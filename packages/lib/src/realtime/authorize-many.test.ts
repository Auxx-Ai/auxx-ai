// packages/lib/src/realtime/authorize-many.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeService } from './realtime-service'
import type { AuthorizeCtx } from './rooms'
import { rooms, toPusherChannel } from './rooms'
import type { RealtimeProvider } from './types'

/**
 * `authorizeMany` is a TRANSPORT optimization (plan v3/05) — it must agree with
 * `authorize` on every channel, always. That equivalence is the whole test:
 * the batch route is the only caller, and the moment the two disagree the ACL
 * has two answers depending on which endpoint the client happened to use.
 */

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const VIEWABLE_DEF = 'i5aezsg4bc6n8gof2uan3wcf'
const RESTRICTED_DEF = 'xrbtfl7syi3sm4mqf5wiayuz'
const USER = '0D5csE1ejLpyv3rKq3wLQm33dCPNslir'

const hooks = vi.hoisted(() => ({
  roleMap: {} as Record<string, { role?: string } | undefined>,
  viewable: new Set<string>(),
}))

vi.mock('../cache', () => ({
  getOrgCache: () => ({
    get: async (_orgId: string, key: string) => (key === 'memberRoleMap' ? hooks.roleMap : {}),
  }),
}))

vi.mock('../permissions/capabilities/get-capabilities', () => ({
  getCapabilities: async () => ({ canViewEntity: (defId: string) => hooks.viewable.has(defId) }),
}))

vi.mock('../members', () => ({ findMemberByUser: async () => ({ id: 'member-1' }) }))

/** Signs anything it is handed — the ACL decides, not the provider. */
function fakeProvider(): RealtimeProvider {
  return {
    publish: vi.fn(async () => true),
    authenticate: vi.fn((socketId: string, channel: string) => ({
      auth: `key:${socketId}:${channel}`,
    })),
  } as unknown as RealtimeProvider
}

const SOCKET = '6189518247.123456'
const ctx: AuthorizeCtx = { session: { userId: USER, organizationId: ORG } }

const channel = (roomKey: string): string => toPusherChannel(roomKey) as string

beforeEach(() => {
  hooks.roleMap = { [USER]: { role: 'USER' } }
  // `getCapabilities` is faked to a bare predicate, so the mail-infra
  // short-circuit that the real `CapabilitySet.canViewEntity` applies to
  // `thread` is not modelled here — it is stated explicitly instead. What this
  // file tests is that `authorizeMany` returns whatever `authorize` returns,
  // for slug-keyed and CUID-keyed record rooms alike.
  hooks.viewable = new Set([VIEWABLE_DEF, 'thread'])
})

describe('RealtimeService.authorizeMany', () => {
  it('returns the same verdict per channel as N authorize() calls', async () => {
    const service = new RealtimeService(fakeProvider())
    const viewable = channel(rooms.orgRecords(ORG, VIEWABLE_DEF))
    const restricted = channel(rooms.orgRecords(ORG, RESTRICTED_DEF))
    const slugKeyedDef = channel(rooms.orgRecords(ORG, 'thread'))
    const presence = channel(rooms.orgPresence(ORG))
    const ownUser = channel(rooms.user(USER))
    const otherUser = channel(rooms.user('someone-else'))
    const unknownKey = 'private-not-a-room-key-at-all'
    // Prefix/kind mismatch: a presence room asked for as a private channel.
    const wrongPrefix = `private-${rooms.orgPresence(ORG)}`
    const names = [
      viewable,
      restricted,
      slugKeyedDef,
      presence,
      ownUser,
      otherUser,
      unknownKey,
      wrongPrefix,
    ]

    const batch = await service.authorizeMany(SOCKET, names, ctx)

    const single: Record<string, unknown> = {}
    for (const name of names) {
      single[name] = await service.authorize(SOCKET, name, ctx)
    }

    expect(batch).toEqual(single)
    // Sanity — the set is genuinely mixed, not all-allow or all-deny.
    expect(batch[viewable]).not.toBeNull()
    expect(batch[slugKeyedDef]).not.toBeNull()
    expect(batch[restricted]).toBeNull()
    expect(batch[otherUser]).toBeNull()
    expect(batch[unknownKey]).toBeNull()
    expect(batch[wrongPrefix]).toBeNull()
  })

  it('answers every requested channel, denials included', async () => {
    const service = new RealtimeService(fakeProvider())
    const names = [
      channel(rooms.orgRecords(ORG, VIEWABLE_DEF)),
      channel(rooms.orgRecords(ORG, RESTRICTED_DEF)),
    ]

    const results = await service.authorizeMany(SOCKET, names, ctx)

    expect(Object.keys(results).sort()).toEqual([...names].sort())
  })

  it('signs each channel against the socket it was asked for', async () => {
    const service = new RealtimeService(fakeProvider())
    const name = channel(rooms.orgRecords(ORG, VIEWABLE_DEF))

    const results = await service.authorizeMany(SOCKET, [name], ctx)

    expect(results[name]).toEqual({ auth: `key:${SOCKET}:${name}` })
  })

  it('collapses duplicates to one authorization', async () => {
    const provider = fakeProvider()
    const service = new RealtimeService(provider)
    const name = channel(rooms.orgRecords(ORG, VIEWABLE_DEF))

    const results = await service.authorizeMany(SOCKET, [name, name, name], ctx)

    expect(Object.keys(results)).toEqual([name])
    expect(provider.authenticate).toHaveBeenCalledTimes(1)
  })

  it('denies everything for a session-less caller', async () => {
    const service = new RealtimeService(fakeProvider())
    const names = [
      channel(rooms.orgRecords(ORG, VIEWABLE_DEF)),
      channel(rooms.orgPresence(ORG)),
      channel(rooms.user(USER)),
    ]

    const results = await service.authorizeMany(SOCKET, names, { session: null })

    expect(Object.values(results)).toEqual([null, null, null])
  })

  it('returns an empty sheet for an empty request', async () => {
    const service = new RealtimeService(fakeProvider())
    expect(await service.authorizeMany(SOCKET, [], ctx)).toEqual({})
  })
})

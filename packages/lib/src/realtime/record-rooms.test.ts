// packages/lib/src/realtime/record-rooms.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizeCtx, RoomDef } from './rooms'
import { findRoom, parseRecordRoomKey, roomKindFor, rooms, toPusherChannel } from './rooms'

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const DEF_A = 'xrbtfl7syi3sm4mqf5wiayuz'
const DEF_B = 'elppl4chr8dhnjfibwryu5to'
const USER = 'JR28eYz582CHqZN5SFlVrEnXErXmunaj'

// Hoisted so the `vi.mock` factories below (which run before the module body)
// can close over mutable state each test tweaks.
const hooks = vi.hoisted(() => ({
  roleMap: {} as Record<string, { role?: string } | undefined>,
  roleMapThrows: false,
  capsThrows: false,
  viewable: new Set<string>(),
}))

// `../cache` is only lazy-imported by the ACL (plus one static `getOrgCache`
// in `members/member-queries.ts`, which the partial mock covers).
vi.mock('../cache', () => ({
  getOrgCache: () => ({
    get: async (_orgId: string, key: string) => {
      if (key !== 'memberRoleMap') return {}
      if (hooks.roleMapThrows) throw new Error('cache down')
      return hooks.roleMap
    },
  }),
}))

vi.mock('../permissions/capabilities/get-capabilities', () => ({
  getCapabilities: async () => {
    if (hooks.capsThrows) throw new Error('capability composition failed')
    return { canViewEntity: (defId: string) => hooks.viewable.has(defId) }
  },
}))

const session: AuthorizeCtx = { session: { userId: USER, organizationId: ORG } }

function recordRoomDef(roomKey: string): RoomDef {
  const def = findRoom(roomKey)
  expect(def).not.toBeNull()
  return def as RoomDef
}

beforeEach(() => {
  hooks.roleMap = { [USER]: { role: 'USER' } }
  hooks.roleMapThrows = false
  hooks.capsThrows = false
  hooks.viewable = new Set([DEF_A])
})

describe('per-def record room keys', () => {
  it('builds and parses round-trip', () => {
    const key = rooms.orgRecords(ORG, DEF_A)
    expect(key).toBe(`org-${ORG}-records-${DEF_A}`)
    expect(parseRecordRoomKey(key)).toEqual({
      organizationId: ORG,
      entityDefinitionId: DEF_A,
    })
  })

  it('parses a table-backed resource slug as the def part', () => {
    expect(parseRecordRoomKey(rooms.orgRecords(ORG, 'line_item'))).toEqual({
      organizationId: ORG,
      entityDefinitionId: 'line_item',
    })
  })

  it('rejects keys with no def part and other org room families', () => {
    expect(parseRecordRoomKey(`org-${ORG}-records-`)).toBeNull()
    expect(parseRecordRoomKey(`org-${ORG}`)).toBeNull()
    expect(parseRecordRoomKey(`org-${ORG}-events`)).toBeNull()
    expect(parseRecordRoomKey(rooms.orgInbox(ORG, 'none', 'read'))).toBeNull()
  })

  it('is a private (plain) channel, not the presence channel', () => {
    const key = rooms.orgRecords(ORG, DEF_A)
    expect(roomKindFor(key)).toBe('plain')
    expect(toPusherChannel(key)).toBe(`private-${key}`)
  })

  it('carves itself out of the greedy `org-` presence matcher', () => {
    // Registry order + the `-records-` exclusion both have to hold, or the
    // presence entry (bare `isOrgMember`, dev-open) would swallow the key.
    expect(recordRoomDef(rooms.orgRecords(ORG, DEF_A)).kind).toBe('plain')
    expect(recordRoomDef(rooms.orgPresence(ORG)).kind).toBe('presence')
    expect(recordRoomDef(rooms.orgEvents(ORG)).kind).toBe('plain')
  })
})

describe('record room ACL', () => {
  it('grants a member whose capability set can view the def', async () => {
    const key = rooms.orgRecords(ORG, DEF_A)
    await expect(recordRoomDef(key).authorize(key, session)).resolves.toBe(true)
  })

  it('denies with no session', async () => {
    const key = rooms.orgRecords(ORG, DEF_A)
    await expect(recordRoomDef(key).authorize(key, { session: null })).resolves.toBe(false)
  })

  it('denies an unparseable key', async () => {
    const key = rooms.orgRecords(ORG, DEF_A)
    await expect(recordRoomDef(key).authorize('org-records-', session)).resolves.toBe(false)
    await expect(recordRoomDef(key).authorize('nonsense', session)).resolves.toBe(false)
  })

  it('denies a non-member of the room org', async () => {
    hooks.roleMap = {}
    const key = rooms.orgRecords(ORG, DEF_A)
    await expect(recordRoomDef(key).authorize(key, session)).resolves.toBe(false)
  })

  it('denies when the def is not viewable', async () => {
    const key = rooms.orgRecords(ORG, DEF_B)
    await expect(recordRoomDef(key).authorize(key, session)).resolves.toBe(false)
  })

  it('denies when the role-map read throws', async () => {
    hooks.roleMapThrows = true
    const key = rooms.orgRecords(ORG, DEF_A)
    await expect(recordRoomDef(key).authorize(key, session)).resolves.toBe(false)
  })

  it('denies when capability resolution throws', async () => {
    hooks.capsThrows = true
    const key = rooms.orgRecords(ORG, DEF_A)
    await expect(recordRoomDef(key).authorize(key, session)).resolves.toBe(false)
  })

  it('has no dev bypass — a non-member is still denied in development', async () => {
    // `DEV` is captured at module load, so the module has to be re-evaluated
    // with NODE_ENV=development to exercise the branch `isOrgMember` opens.
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    try {
      const fresh = await import('./rooms')
      hooks.roleMap = {}
      const key = fresh.rooms.orgRecords(ORG, DEF_A)
      const def = fresh.findRoom(key)
      expect(def).not.toBeNull()
      await expect(def?.authorize(key, session)).resolves.toBe(false)

      // Control: the presence room DOES fail open in dev — the exact behaviour
      // the record channel must not inherit.
      const presenceKey = fresh.rooms.orgPresence(ORG)
      const presenceDef = fresh.findRoom(presenceKey)
      await expect(presenceDef?.authorize(presenceKey, session)).resolves.toBe(true)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})

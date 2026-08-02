// packages/lib/src/realtime/record-rooms.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizeCtx, RoomDef } from './rooms'
import { findRoom, parseRecordRoomKey, roomKindFor, rooms, toPusherChannel } from './rooms'

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const DEF_A = 'xrbtfl7syi3sm4mqf5wiayuz'
const DEF_B = 'elppl4chr8dhnjfibwryu5to'
/** The org's `article` EntityDefinition id — the one def that needs a KB clamp. */
const ARTICLE_DEF = 'qkmgvfi61m4ubmfrxg7y3mzc'
const USER = 'JR28eYz582CHqZN5SFlVrEnXErXmunaj'

// Hoisted so the `vi.mock` factories below (which run before the module body)
// can close over mutable state each test tweaks.
const hooks = vi.hoisted(() => ({
  roleMap: {} as Record<string, { role?: string } | undefined>,
  roleMapThrows: false,
  capsThrows: false,
  viewable: new Set<string>(),
  articleDefId: undefined as string | undefined,
  viewableKbIds: [] as string[] | 'all',
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
  getCachedEntityDefId: async () => hooks.articleDefId,
}))

// Lazy-imported by the ACL for the article clamp only (plan v3/06 §3.1 R10).
vi.mock('../permissions/capabilities/article-visibility-scope', () => ({
  viewableKnowledgeBaseIds: vi.fn(async () => hooks.viewableKbIds),
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
  hooks.viewable = new Set([DEF_A, ARTICLE_DEF])
  hooks.articleDefId = ARTICLE_DEF
  hooks.viewableKbIds = ['r7gncj0m9f88home9kp8j1s7']
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

/**
 * `canViewEntity('article')` is unconditionally `true` — `article` is in
 * `NON_RECORD_DEF_SLUGS` and must STAY there (plan v3/06 §4.3: routing it
 * through the Records area would make KB access depend on a records rung it has
 * nothing to do with). So the def-level ACL admits every member to the article
 * def's channel, which carries `fieldValues:updated` (RAW stored values) and
 * `records:invalidated`. §3.1 R10's clamp is the second predicate.
 */
describe('record room ACL — the article KB clamp (plan v3/06 §3.1 R10)', () => {
  it('denies the article def channel to a member with NO viewable KB', async () => {
    hooks.viewableKbIds = []
    const key = rooms.orgRecords(ORG, ARTICLE_DEF)
    // The def gate itself passes — this is exactly the hole being closed.
    expect(hooks.viewable.has(ARTICLE_DEF)).toBe(true)
    await expect(recordRoomDef(key).authorize(key, session)).resolves.toBe(false)
  })

  it('grants the article def channel on ≥1 viewable KB — the clamp is COARSE', async () => {
    // Per-KB fanout is explicitly out of scope (§11 item 4), matching descoped
    // P6: one viewable KB admits the whole def channel, including events for
    // articles in KBs this member cannot open. This test states that rather than
    // pretending otherwise.
    hooks.viewableKbIds = ['r7gncj0m9f88home9kp8j1s7']
    const key = rooms.orgRecords(ORG, ARTICLE_DEF)
    await expect(recordRoomDef(key).authorize(key, session)).resolves.toBe(true)
  })

  it('leaves every OTHER def on the def gate alone', async () => {
    // An empty KB allow-list must not dark unrelated record channels.
    hooks.viewableKbIds = []
    const key = rooms.orgRecords(ORG, DEF_A)
    await expect(recordRoomDef(key).authorize(key, session)).resolves.toBe(true)
  })

  it('still denies the article def when the def gate itself says no', async () => {
    hooks.viewable = new Set([DEF_A])
    hooks.viewableKbIds = ['r7gncj0m9f88home9kp8j1s7']
    const key = rooms.orgRecords(ORG, ARTICLE_DEF)
    await expect(recordRoomDef(key).authorize(key, session)).resolves.toBe(false)
  })

  it('does not clamp when the org has no article def at all', async () => {
    hooks.articleDefId = undefined
    hooks.viewableKbIds = []
    const key = rooms.orgRecords(ORG, ARTICLE_DEF)
    await expect(recordRoomDef(key).authorize(key, session)).resolves.toBe(true)
  })
})

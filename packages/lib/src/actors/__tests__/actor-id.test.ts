// packages/lib/src/actors/__tests__/actor-id.test.ts

import type { ActorId } from '@auxx/types/actor'
import {
  ACTOR_ID_TYPES,
  getActorRawId,
  getActorType,
  isActorId,
  isActorIdType,
  parseActorId,
  safeParseActorId,
  toActorId,
} from '@auxx/types/actor'
import { describe, expect, it } from 'vitest'

/**
 * `@auxx/types` is not a vitest project, so the ActorId vocabulary is pinned from
 * here — its nearest consumer. 19a finding 5: the whitelist used to be written out
 * three times (the type alias plus a literal array in `parseActorId` and in
 * `isActorId`), which is how a kind ends up type-legal but rejected at runtime.
 */
describe('ActorId vocabulary', () => {
  it('covers every grantee kind the actor system addresses, including profile', () => {
    expect([...ACTOR_ID_TYPES]).toEqual(['user', 'group', 'agent', 'worker', 'profile'])
  })

  it('round-trips every supported kind through toActorId/parseActorId', () => {
    for (const type of ACTOR_ID_TYPES) {
      const actorId = toActorId(type, 'abc123')
      expect(actorId).toBe(`${type}:abc123`)
      expect(parseActorId(actorId)).toEqual({ type, id: 'abc123' })
      expect(safeParseActorId(actorId)).toEqual({ type, id: 'abc123' })
      expect(isActorId(actorId)).toBe(true)
      expect(isActorIdType(type)).toBe(true)
      expect(getActorType(actorId)).toBe(type)
      expect(getActorRawId(actorId)).toBe('abc123')
    }
  })

  it('rejects a kind that is not in the vocabulary', () => {
    expect(isActorIdType('team')).toBe(false)
    expect(isActorIdType('role')).toBe(false)
    expect(isActorId('team:t1')).toBe(false)
    expect(isActorId('role:org_member')).toBe(false)
  })
})

describe('safeParseActorId — degrade, never throw', () => {
  // Render paths (actor-badge, grantee-list) must degrade to a generic row rather
  // than white-screen when a grant carries a kind this build does not know.
  const malformed = [
    'nope:abc123', // unknown prefix — the forward-compat case
    'abc123', // no colon
    'user:', // empty id half
    '', // empty string
    null,
    undefined,
    42,
    {},
  ]

  it('returns null for anything malformed or of an unknown kind', () => {
    for (const value of malformed) {
      expect(safeParseActorId(value)).toBeNull()
    }
  })

  it('is the same parse as parseActorId, minus the throw', () => {
    for (const value of malformed) {
      expect(() => parseActorId(value as ActorId)).toThrow(/Invalid ActorId/)
    }
    expect(safeParseActorId('user:u1')).toEqual(parseActorId('user:u1' as ActorId))
  })

  it('splits on the FIRST colon, so an id containing a colon survives', () => {
    expect(safeParseActorId('group:a:b')).toEqual({ type: 'group', id: 'a:b' })
    // isActorId stays stricter on purpose — it is what rejects malformed agent
    // tool-call arguments, where a 3-part shape is a caller bug.
    expect(isActorId('group:a:b')).toBe(false)
  })
})

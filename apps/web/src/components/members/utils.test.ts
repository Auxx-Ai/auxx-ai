// apps/web/src/components/members/utils.test.ts

import { describe, expect, it } from 'vitest'
import type { Member } from './types'
import { canRemoveMember } from './utils'

/**
 * Plan 39 §3.2 #2/#3 — `canRemoveMember` is the CLIENT mirror of
 * `canManageTarget` in `@auxx/lib/members`' guards. There is no client-safe
 * subpath for that module, so the rule is duplicated; these cases exist so the
 * duplicate cannot drift.
 *
 * The row that matters is the last one. `canRemoveMember` used to require
 * OWNER/ADMIN outright, so a member delegated `members.manage` saw a page with
 * every action hidden — while `requireMemberManage` + `canManageTarget` on the
 * server would have let them act on another USER-rank member. The client was
 * strictly stricter than the server, which reads as "the grant does nothing".
 *
 * Authority (`members.manage`) is deliberately NOT checked here: this answers
 * "who may act on whom", and the callers check the capability separately.
 */

function member(role: 'OWNER' | 'ADMIN' | 'USER', userId = 'u_target'): Member {
  return { userId, role } as Member
}

describe('canRemoveMember', () => {
  it('never allows acting on yourself, at any rank', () => {
    expect(canRemoveMember(member('OWNER', 'u_me'), 'OWNER', 'u_me')).toBe(false)
    expect(canRemoveMember(member('ADMIN', 'u_me'), 'ADMIN', 'u_me')).toBe(false)
    expect(canRemoveMember(member('USER', 'u_me'), 'USER', 'u_me')).toBe(false)
  })

  it('lets an OWNER act on anyone else', () => {
    expect(canRemoveMember(member('OWNER'), 'OWNER', 'u_me')).toBe(true)
    expect(canRemoveMember(member('ADMIN'), 'OWNER', 'u_me')).toBe(true)
    expect(canRemoveMember(member('USER'), 'OWNER', 'u_me')).toBe(true)
  })

  it('stops an ADMIN at owners and at admin peers', () => {
    expect(canRemoveMember(member('OWNER'), 'ADMIN', 'u_me')).toBe(false)
    expect(canRemoveMember(member('ADMIN'), 'ADMIN', 'u_me')).toBe(false)
    expect(canRemoveMember(member('USER'), 'ADMIN', 'u_me')).toBe(true)
  })

  it('lets a USER-rank grantee act on other USER-rank members, and no higher', () => {
    // guards.ts: "a `members.manage` grantee (role USER, rank 1) acts only on
    // other USER-rank members". Hiding this row is what made the grant inert.
    expect(canRemoveMember(member('USER'), 'USER', 'u_me')).toBe(true)
    expect(canRemoveMember(member('ADMIN'), 'USER', 'u_me')).toBe(false)
    expect(canRemoveMember(member('OWNER'), 'USER', 'u_me')).toBe(false)
  })

  it('denies when the viewer has no resolved role or id yet', () => {
    expect(canRemoveMember(member('USER'), null, 'u_me')).toBe(false)
    expect(canRemoveMember(member('USER'), 'OWNER', null)).toBe(false)
  })
})

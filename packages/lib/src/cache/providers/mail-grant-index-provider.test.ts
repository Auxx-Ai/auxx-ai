// packages/lib/src/cache/providers/mail-grant-index-provider.test.ts

import { describe, expect, it } from 'vitest'
import { composeMailGrantIndex } from './mail-grant-index-provider'

const row = (over: Partial<Parameters<typeof composeMailGrantIndex>[0]['rows'][number]>) => ({
  entityDefinitionId: 'thread',
  entityInstanceId: 't_1',
  granteeType: 'user',
  granteeId: 'u_1',
  permission: 'view',
  lens: 'full' as const,
  ...over,
})

describe('composeMailGrantIndex', () => {
  it('inverts user grants into per-thread and per-contact audiences', () => {
    const index = composeMailGrantIndex({
      rows: [
        row({ entityInstanceId: 't_1', granteeId: 'u_1', lens: 'metadata' }),
        row({ entityDefinitionId: 'contact', entityInstanceId: 'c_1', granteeId: 'u_2' }),
      ],
      memberUserIds: ['u_1', 'u_2'],
      groupIdsByUser: {},
    })
    expect(index.threads).toEqual({ t_1: [{ userId: 'u_1', lens: 'metadata' }] })
    expect(index.contacts).toEqual({ c_1: [{ userId: 'u_2', lens: 'full' }] })
  })

  it('expands group grants to member user ids', () => {
    const index = composeMailGrantIndex({
      rows: [row({ granteeType: 'group', granteeId: 'g_1', lens: 'subject' })],
      memberUserIds: ['u_1', 'u_2', 'u_3'],
      groupIdsByUser: { u_1: ['g_1'], u_2: ['g_1', 'g_2'], u_3: ['g_2'] },
    })
    expect(index.threads.t_1).toEqual([
      { userId: 'u_1', lens: 'subject' },
      { userId: 'u_2', lens: 'subject' },
    ])
  })

  it('expands org_member role grants to all members', () => {
    const index = composeMailGrantIndex({
      rows: [row({ granteeType: 'role', granteeId: 'org_member' })],
      memberUserIds: ['u_1', 'u_2'],
      groupIdsByUser: {},
    })
    expect(index.threads.t_1?.map((e) => e.userId).sort()).toEqual(['u_1', 'u_2'])
  })

  it('dedupes overlapping grants per user keeping the max lens', () => {
    const index = composeMailGrantIndex({
      rows: [
        row({ granteeType: 'group', granteeId: 'g_1', lens: 'metadata' }),
        row({ granteeId: 'u_1', lens: 'full' }),
      ],
      memberUserIds: ['u_1'],
      groupIdsByUser: { u_1: ['g_1'] },
    })
    expect(index.threads.t_1).toEqual([{ userId: 'u_1', lens: 'full' }])
  })

  it('treats edit/admin permission as full', () => {
    const index = composeMailGrantIndex({
      rows: [row({ permission: 'admin', lens: null })],
      memberUserIds: ['u_1'],
      groupIdsByUser: {},
    })
    expect(index.threads.t_1).toEqual([{ userId: 'u_1', lens: 'full' }])
  })

  it('expands profile grants to the profile’s holders (19a #11)', () => {
    const index = composeMailGrantIndex({
      rows: [row({ granteeType: 'profile', granteeId: 'prof_member', lens: 'subject' })],
      memberUserIds: ['u_1', 'u_2', 'u_3'],
      groupIdsByUser: {},
      // u_1 bound explicitly, u_2 null-bound and resolved to the same system
      // profile, u_3 on a different profile.
      profileIdByUser: { u_1: 'prof_member', u_2: 'prof_member', u_3: 'prof_field' },
    })
    expect(index.threads.t_1).toEqual([
      { userId: 'u_1', lens: 'subject' },
      { userId: 'u_2', lens: 'subject' },
    ])
  })

  it('does not reinterpret a profile grantee id as a group id (19a finding 4)', () => {
    // The pre-step-9 ternary fell through to `usersByGroup.get(granteeId)`. If a
    // group and a profile ever shared an id, the grant would have expanded to
    // the WRONG audience instead of merely being dropped.
    const index = composeMailGrantIndex({
      rows: [row({ granteeType: 'profile', granteeId: 'collision' })],
      memberUserIds: ['u_1', 'u_2'],
      groupIdsByUser: { u_2: ['collision'] },
      profileIdByUser: { u_1: 'collision' },
    })
    expect(index.threads.t_1).toEqual([{ userId: 'u_1', lens: 'full' }])
  })

  it('drops an unknown grantee kind instead of treating it as a group', () => {
    const index = composeMailGrantIndex({
      rows: [row({ granteeType: 'future_kind', granteeId: 'g_1' })],
      memberUserIds: ['u_1'],
      groupIdsByUser: { u_1: ['g_1'] },
    })
    expect(index.threads).toEqual({})
  })

  it('ignores a role grantee that is not the org_member baseline', () => {
    const index = composeMailGrantIndex({
      rows: [row({ granteeType: 'role', granteeId: 'org_admin' })],
      memberUserIds: ['u_1', 'u_2'],
      groupIdsByUser: {},
    })
    expect(index.threads).toEqual({})
  })

  it('buckets inbox grants into the inboxes index (§10.1 delta audience)', () => {
    const index = composeMailGrantIndex({
      rows: [
        row({ entityDefinitionId: 'inbox', entityInstanceId: 'i_1', granteeId: 'u_1' }),
        row({
          entityDefinitionId: 'inbox',
          entityInstanceId: 'i_1',
          granteeType: 'group',
          granteeId: 'g_1',
          lens: 'metadata',
        }),
      ],
      memberUserIds: ['u_1', 'u_2'],
      groupIdsByUser: { u_2: ['g_1'] },
    })
    expect(index.inboxes.i_1).toEqual([
      { userId: 'u_1', lens: 'full' },
      { userId: 'u_2', lens: 'metadata' },
    ])
    expect(index.threads).toEqual({})
  })
})

// packages/lib/src/cache/providers/mail-grant-index-provider.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The bucket router logs (rather than throws) on an unrecognised mail def — it
// runs inside a cache provider, so one bad row must not take the org's whole
// realtime fanout down. Capture the log so "loud" is actually asserted.
const logError = vi.hoisted(() => vi.fn())
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    error: logError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { composeMailGrantIndex } from './mail-grant-index-provider'

const row = (over: Partial<Parameters<typeof composeMailGrantIndex>[0]['rows'][number]>) => ({
  entityDefinitionId: 'thread',
  entityInstanceId: 't_1',
  granteeType: 'user',
  granteeId: 'u_1',
  rung: 'read' as const,
  ...over,
})

describe('composeMailGrantIndex', () => {
  it('inverts user grants into per-thread and per-contact audiences', () => {
    const index = composeMailGrantIndex({
      rows: [
        row({ entityInstanceId: 't_1', granteeId: 'u_1', rung: 'metadata' }),
        row({ entityDefinitionId: 'contact', entityInstanceId: 'c_1', granteeId: 'u_2' }),
      ],
      memberUserIds: ['u_1', 'u_2'],
      groupIdsByUser: {},
    })
    expect(index.threads).toEqual({ t_1: [{ userId: 'u_1', lens: 'metadata' }] })
    expect(index.contacts).toEqual({ c_1: [{ userId: 'u_2', lens: 'read' }] })
  })

  // Plan 40 §4.1/§4.2 — migration 060 writes `role:org_member @ none` on a
  // restricted shared inbox. The old `permission !== 'view' ⇒ full` shorthand
  // inverted that row into a FULL-lens entry for EVERY member, i.e. the widest
  // possible reading of a row whose entire job is to close the inbox — and this
  // index is what the ingest count-delta audience reads.
  it('drops `none` rows entirely — the restriction marker is not a grant', () => {
    const index = composeMailGrantIndex({
      rows: [
        row({
          entityDefinitionId: 'inbox',
          entityInstanceId: 'ibx_1',
          granteeType: 'role',
          granteeId: 'org_member',
          rung: 'none' as never,
        }),
      ],
      memberUserIds: ['u_1', 'u_2'],
      groupIdsByUser: {},
    })
    expect(index.inboxes).toEqual({})
  })

  it('still indexes a real grant on the same restricted inbox (positive control)', () => {
    const index = composeMailGrantIndex({
      rows: [
        row({
          entityDefinitionId: 'inbox',
          entityInstanceId: 'ibx_1',
          granteeType: 'role',
          granteeId: 'org_member',
          rung: 'none' as never,
        }),
        row({ entityDefinitionId: 'inbox', entityInstanceId: 'ibx_1', granteeId: 'u_2' }),
      ],
      memberUserIds: ['u_1', 'u_2'],
      groupIdsByUser: {},
    })
    expect(index.inboxes).toEqual({ ibx_1: [{ userId: 'u_2', lens: 'read' }] })
  })

  it('expands group grants to member user ids', () => {
    const index = composeMailGrantIndex({
      rows: [row({ granteeType: 'group', granteeId: 'g_1', rung: 'identity' })],
      memberUserIds: ['u_1', 'u_2', 'u_3'],
      groupIdsByUser: { u_1: ['g_1'], u_2: ['g_1', 'g_2'], u_3: ['g_2'] },
    })
    expect(index.threads.t_1).toEqual([
      { userId: 'u_1', lens: 'identity' },
      { userId: 'u_2', lens: 'identity' },
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
        row({ granteeType: 'group', granteeId: 'g_1', rung: 'metadata' }),
        row({ granteeId: 'u_1', rung: 'read' }),
      ],
      memberUserIds: ['u_1'],
      groupIdsByUser: { u_1: ['g_1'] },
    })
    expect(index.threads.t_1).toEqual([{ userId: 'u_1', lens: 'read' }])
  })

  it('treats edit/admin permission as full', () => {
    const index = composeMailGrantIndex({
      rows: [row({ rung: 'admin' })],
      memberUserIds: ['u_1'],
      groupIdsByUser: {},
    })
    expect(index.threads.t_1).toEqual([{ userId: 'u_1', lens: 'read' }])
  })

  it('expands profile grants to the profile’s holders (19a #11)', () => {
    const index = composeMailGrantIndex({
      rows: [row({ granteeType: 'profile', granteeId: 'prof_member', rung: 'identity' })],
      memberUserIds: ['u_1', 'u_2', 'u_3'],
      groupIdsByUser: {},
      // u_1 bound explicitly, u_2 null-bound and resolved to the same system
      // profile, u_3 on a different profile.
      profileIdByUser: { u_1: 'prof_member', u_2: 'prof_member', u_3: 'prof_field' },
    })
    expect(index.threads.t_1).toEqual([
      { userId: 'u_1', lens: 'identity' },
      { userId: 'u_2', lens: 'identity' },
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
    expect(index.threads.t_1).toEqual([{ userId: 'u_1', lens: 'read' }])
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
          rung: 'metadata',
        }),
      ],
      memberUserIds: ['u_1', 'u_2'],
      groupIdsByUser: { u_2: ['g_1'] },
    })
    expect(index.inboxes.i_1).toEqual([
      { userId: 'u_1', lens: 'read' },
      { userId: 'u_2', lens: 'metadata' },
    ])
    expect(index.threads).toEqual({})
  })

  // Plan 40 §3 / 40a §0 risk 2 — the bucket router's else-branch used to be
  // `index.contacts`, so a grant re-keyed to `'personal_inbox'` by migration 060
  // would have been published as a CONTACT audience: wrong fanout, no throw, no
  // log. This is the mutation the plan names by file:line.
  describe('personal_inbox bucketing (the 060 lockstep)', () => {
    beforeEach(() => logError.mockReset())

    it('routes a personal_inbox grant into the INBOX bucket', () => {
      const index = composeMailGrantIndex({
        rows: [
          row({
            entityDefinitionId: 'personal_inbox',
            entityInstanceId: 'pi_1',
            granteeId: 'u_owner',
            rung: 'admin',
          }),
        ],
        memberUserIds: ['u_owner'],
        groupIdsByUser: {},
      })
      expect(index.inboxes).toEqual({ pi_1: [{ userId: 'u_owner', lens: 'read' }] })
      expect(index.contacts).toEqual({})
      expect(index.threads).toEqual({})
      expect(logError).not.toHaveBeenCalled()
    })

    it('indexes both keyspaces identically — the re-key is invisible downstream', () => {
      const build = (entityDefinitionId: string) =>
        composeMailGrantIndex({
          rows: [row({ entityDefinitionId, entityInstanceId: 'pi_1', rung: 'metadata' })],
          memberUserIds: ['u_1'],
          groupIdsByUser: {},
        })
      expect(build('personal_inbox')).toEqual(build('inbox'))
    })

    it('drops an unrecognised mail def loudly instead of defaulting it into contacts', () => {
      const index = composeMailGrantIndex({
        rows: [row({ entityDefinitionId: 'future_mailbox', entityInstanceId: 'x_1' })],
        memberUserIds: ['u_1'],
        groupIdsByUser: {},
      })
      expect(index).toEqual({ threads: {}, contacts: {}, inboxes: {} })
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('Unrecognised mail definition'),
        expect.objectContaining({ entityDefinitionId: 'future_mailbox' })
      )
    })

    it('still buckets a real contact grant into contacts (negative control)', () => {
      const index = composeMailGrantIndex({
        rows: [row({ entityDefinitionId: 'contact', entityInstanceId: 'c_1' })],
        memberUserIds: ['u_1'],
        groupIdsByUser: {},
      })
      expect(index.contacts).toEqual({ c_1: [{ userId: 'u_1', lens: 'read' }] })
      expect(logError).not.toHaveBeenCalled()
    })
  })
})

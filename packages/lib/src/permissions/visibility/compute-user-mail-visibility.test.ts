// packages/lib/src/permissions/visibility/compute-user-mail-visibility.test.ts

import { describe, expect, it } from 'vitest'
import { composeUserMailVisibility, type VisibilityGrantRow } from './compute-user-mail-visibility'

const USER = 'u_1'

const grant = (over: Partial<VisibilityGrantRow>): VisibilityGrantRow => ({
  entityDefinitionId: 'inbox',
  entityInstanceId: 'i_1',
  permission: 'view',
  lens: 'full',
  ...over,
})

describe('composeUserMailVisibility', () => {
  it('marks OWNER/ADMIN as admin, USER as not', () => {
    for (const [role, isAdmin] of [
      ['OWNER', true],
      ['ADMIN', true],
      ['USER', false],
    ] as const) {
      const vis = composeUserMailVisibility({ userId: USER, role, inboxes: [], grants: [] })
      expect(vis.isAdmin).toBe(isAdmin)
      expect(vis.userId).toBe(USER)
    }
  })

  it('exposes inbox floors above none and omits none-floor inboxes', () => {
    const vis = composeUserMailVisibility({
      userId: USER,
      role: 'USER',
      inboxes: [
        { id: 'open', defaultLens: 'full' },
        { id: 'peek', defaultLens: 'metadata' },
        { id: 'closed', defaultLens: 'none' },
      ],
      grants: [],
    })
    expect(vis.inboxLens).toEqual({ open: 'full', peek: 'metadata' })
  })

  it('raises an inbox floor with a grant but never lowers it', () => {
    const vis = composeUserMailVisibility({
      userId: USER,
      role: 'USER',
      inboxes: [
        { id: 'closed', defaultLens: 'none' },
        { id: 'open', defaultLens: 'full' },
      ],
      grants: [
        grant({ entityInstanceId: 'closed', lens: 'subject' }),
        grant({ entityInstanceId: 'open', lens: 'metadata' }),
      ],
    })
    expect(vis.inboxLens).toEqual({ closed: 'subject', open: 'full' })
  })

  it('treats edit/admin permission as full and view without lens as full', () => {
    const vis = composeUserMailVisibility({
      userId: USER,
      role: 'USER',
      inboxes: [
        { id: 'a', defaultLens: 'none' },
        { id: 'b', defaultLens: 'none' },
      ],
      grants: [
        grant({ entityInstanceId: 'a', permission: 'admin', lens: null }),
        grant({ entityInstanceId: 'b', permission: 'view', lens: null }),
      ],
    })
    expect(vis.inboxLens).toEqual({ a: 'full', b: 'full' })
  })

  it('buckets thread/contact/entity grants and skips non-mail built-ins', () => {
    const vis = composeUserMailVisibility({
      userId: USER,
      role: 'USER',
      inboxes: [],
      grants: [
        grant({ entityDefinitionId: 'thread', entityInstanceId: 't_1', lens: 'metadata' }),
        grant({ entityDefinitionId: 'contact', entityInstanceId: 'c_1', lens: 'full' }),
        grant({ entityDefinitionId: 'ysd5fhcustomdef', entityInstanceId: 'e_1', lens: 'subject' }),
        grant({ entityDefinitionId: 'snippet', entityInstanceId: 's_1' }),
        grant({ entityDefinitionId: 'folder', entityInstanceId: 'f_1' }),
      ],
    })
    expect(vis.threadGrants).toEqual({ t_1: 'metadata' })
    expect(vis.contactGrants).toEqual({ c_1: 'full' })
    expect(vis.entityGrants).toEqual({ e_1: 'subject' })
  })

  it('keeps the max lens when the same instance is granted twice', () => {
    const vis = composeUserMailVisibility({
      userId: USER,
      role: 'USER',
      inboxes: [],
      grants: [
        grant({ entityDefinitionId: 'thread', entityInstanceId: 't_1', lens: 'metadata' }),
        grant({ entityDefinitionId: 'thread', entityInstanceId: 't_1', lens: 'full' }),
      ],
    })
    expect(vis.threadGrants).toEqual({ t_1: 'full' })
  })

  it("collects OTHERS' personal inboxes into personalInboxIds, never the viewer's own", () => {
    const vis = composeUserMailVisibility({
      userId: USER,
      role: 'ADMIN',
      inboxes: [
        { id: 'mine', defaultLens: 'none', isPersonal: true, ownerUserId: USER },
        { id: 'bobs', defaultLens: 'none', isPersonal: true, ownerUserId: 'u_bob' },
        { id: 'shared', defaultLens: 'full', isPersonal: false, ownerUserId: null },
      ],
      grants: [],
    })
    expect(vis.personalInboxIds).toEqual({ bobs: true })
  })

  it('leaves personalInboxIds empty for a non-member (fail closed, no floors)', () => {
    const vis = composeUserMailVisibility({
      userId: USER,
      role: undefined,
      inboxes: [{ id: 'bobs', defaultLens: 'none', isPersonal: true, ownerUserId: 'u_bob' }],
      grants: [],
    })
    expect(vis.personalInboxIds).toEqual({})
    expect(vis.inboxLens).toEqual({})
  })

  it('fails closed for a non-member: no floors, no admin', () => {
    const vis = composeUserMailVisibility({
      userId: USER,
      role: undefined,
      inboxes: [{ id: 'open', defaultLens: 'full' }],
      grants: [],
    })
    expect(vis.isAdmin).toBe(false)
    expect(vis.inboxLens).toEqual({})
  })

  it('is JSON-serializable (cache round-trip)', () => {
    const vis = composeUserMailVisibility({
      userId: USER,
      role: 'ADMIN',
      inboxes: [{ id: 'open', defaultLens: 'subject' }],
      grants: [grant({ entityDefinitionId: 'thread', entityInstanceId: 't_1' })],
    })
    expect(JSON.parse(JSON.stringify(vis))).toEqual(vis)
  })
})

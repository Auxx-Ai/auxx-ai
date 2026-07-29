// apps/web/src/server/lib/inbox-settings-access.test.ts

import type { Inbox } from '@auxx/lib/inboxes'
import { toRecordId } from '@auxx/types/resource'
import { describe, expect, it } from 'vitest'
import { settingsInboxesForUser } from './inbox-settings-access'

const USER_ID = 'user_1'

function inbox(
  id: string,
  options: Partial<Inbox> & Pick<Inbox, 'entityDefinitionKey' | 'isPersonal'>
): Inbox {
  return {
    id,
    recordId: toRecordId(options.entityDefinitionKey, id),
    name: id,
    description: null,
    color: 'indigo',
    status: 'ACTIVE',
    defaultLens: options.isPersonal ? 'none' : 'full',
    ownerUserId: null,
    settings: {},
    organizationId: 'org_1',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: null,
    ...options,
  }
}

function access(levels: Record<string, 'view' | 'admin'>) {
  return {
    canViewInstance: (_key: string, id: string) => id in levels,
    canAdminInstance: (_key: string, id: string) => levels[id] === 'admin',
  }
}

describe('settingsInboxesForUser', () => {
  it('returns only accessible shared inboxes with effective actions', () => {
    const result = settingsInboxesForUser({
      inboxes: [
        inbox('shared_view', { entityDefinitionKey: 'inbox', isPersonal: false }),
        inbox('shared_admin', { entityDefinitionKey: 'inbox', isPersonal: false }),
        inbox('shared_hidden', { entityDefinitionKey: 'inbox', isPersonal: false }),
      ],
      userId: USER_ID,
      canManageChannels: true,
      access: access({ shared_view: 'view', shared_admin: 'admin' }) as never,
    })

    expect(result.map((item) => item.id)).toEqual(['shared_view', 'shared_admin'])
    expect(result[0]).toMatchObject({ canManage: false, canDelete: false })
    expect(result[1]).toMatchObject({ canManage: true, canDelete: true })
  })

  it("does not return another member's personal inbox without explicit access", () => {
    const result = settingsInboxesForUser({
      inboxes: [
        inbox('mine', {
          entityDefinitionKey: 'personal_inbox',
          isPersonal: true,
          ownerUserId: USER_ID,
        }),
        inbox('theirs', {
          entityDefinitionKey: 'personal_inbox',
          isPersonal: true,
          ownerUserId: 'user_2',
        }),
      ],
      userId: USER_ID,
      canManageChannels: true,
      access: access({ mine: 'admin' }) as never,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'mine',
      canManage: true,
      // Own personal mailbox: deletable, and NOT because of `canManageChannels`
      // — the next case proves the owner needs no coarse key at all.
      canDelete: true,
    })
  })

  it('lets the owner delete their own personal inbox without channels.manage', () => {
    const result = settingsInboxesForUser({
      inboxes: [
        inbox('mine', {
          entityDefinitionKey: 'personal_inbox',
          isPersonal: true,
          ownerUserId: USER_ID,
        }),
        inbox('shared', { entityDefinitionKey: 'inbox', isPersonal: false }),
      ],
      userId: USER_ID,
      canManageChannels: false,
      access: access({ mine: 'admin', shared: 'admin' }) as never,
    })

    expect(result.find((i) => i.id === 'mine')).toMatchObject({ canDelete: true })
    // The shared inbox still needs the inventory key, admin grant or not.
    expect(result.find((i) => i.id === 'shared')).toMatchObject({ canDelete: false })
  })

  it("never offers delete on another member's personal inbox that was shared with them", () => {
    const result = settingsInboxesForUser({
      inboxes: [
        inbox('theirs', {
          entityDefinitionKey: 'personal_inbox',
          isPersonal: true,
          ownerUserId: 'user_2',
        }),
      ],
      userId: USER_ID,
      canManageChannels: true,
      // A Manager grant handed out by the owner — enough to manage, never
      // enough to destroy their mail (`deleteOwnPersonalInbox` asserts the same
      // thing server-side).
      access: access({ theirs: 'admin' }) as never,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'theirs', canManage: true, canDelete: false })
  })

  it('fails closed for another personal inbox still on the shared definition', () => {
    const result = settingsInboxesForUser({
      inboxes: [
        inbox('legacy_personal', {
          entityDefinitionKey: 'inbox',
          isPersonal: true,
          ownerUserId: 'user_2',
        }),
      ],
      userId: USER_ID,
      canManageChannels: true,
      // Simulates the shared-def area fallback saying admin.
      access: access({ legacy_personal: 'admin' }) as never,
    })

    expect(result).toEqual([])
  })
})

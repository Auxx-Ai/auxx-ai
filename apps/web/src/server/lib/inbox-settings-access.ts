// apps/web/src/server/lib/inbox-settings-access.ts

import type { Inbox } from '@auxx/lib/inboxes'
import type { InstanceAccessKey } from '@auxx/lib/permissions'

type InboxAccessEvaluator = {
  canViewInstance: (key: InstanceAccessKey, instanceId: string) => boolean
  canAdminInstance: (key: InstanceAccessKey, instanceId: string) => boolean
}

/** Inbox metadata safe to return to the scoped settings list. */
export type SettingsInbox = Pick<
  Inbox,
  | 'id'
  | 'recordId'
  | 'entityDefinitionKey'
  | 'name'
  | 'description'
  | 'color'
  | 'status'
  | 'defaultLens'
  | 'isPersonal'
  | 'ownerUserId'
> & {
  canManage: boolean
  canDelete: boolean
}

/**
 * Scope the combined inbox settings page to instances the caller may open.
 *
 * Shared inboxes follow normal instance access. Personal inboxes additionally
 * fail closed during the legacy-marker migration window: while a personal
 * mailbox still lives on the shared definition, the shared area fallback must
 * not make it visible to anyone except its owner.
 */
export function settingsInboxesForUser(args: {
  inboxes: Inbox[]
  userId: string
  canManageChannels: boolean
  access: InboxAccessEvaluator
}): SettingsInbox[] {
  const { inboxes, userId, canManageChannels, access } = args

  return inboxes.flatMap((inbox) => {
    const key = inbox.entityDefinitionKey
    const legacyPersonalVisible =
      !inbox.isPersonal || key === 'personal_inbox' || inbox.ownerUserId === userId

    if (!legacyPersonalVisible || !access.canViewInstance(key, inbox.id)) return []

    const canManage = access.canAdminInstance(key, inbox.id)
    return [
      {
        id: inbox.id,
        recordId: inbox.recordId,
        entityDefinitionKey: inbox.entityDefinitionKey,
        name: inbox.name,
        description: inbox.description,
        color: inbox.color,
        status: inbox.status,
        defaultLens: inbox.defaultLens,
        isPersonal: inbox.isPersonal,
        ownerUserId: inbox.ownerUserId,
        canManage,
        // `inbox.delete` branches on the definition, so the affordance mirrors
        // the two authorities it applies. A personal mailbox answers to its
        // OWNER (not `channels.manage`, which its owner never holds, and not an
        // `admin` grant, which they can hand out by sharing) and deleting it
        // disconnects its account. A shared one is org inventory.
        canDelete: inbox.isPersonal ? inbox.ownerUserId === userId : canManage && canManageChannels,
      },
    ]
  })
}

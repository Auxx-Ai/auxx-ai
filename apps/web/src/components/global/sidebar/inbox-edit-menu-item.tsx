// ~/components/global/sidebar/inbox-edit-menu-item.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { PencilIcon } from 'lucide-react'
import Link from 'next/link'
import type { Inbox } from '~/components/global/sidebar/shared-inbox-group'
import { useAccess } from '~/providers/capabilities-provider'

/**
 * The sidebar row's "Edit Inbox" entry, rendered only for members who may
 * actually manage that mailbox.
 *
 * **A sidebar row is not evidence of authority.** The list comes from
 * `record.listAll` on the two inbox definitions, which are exempt from the
 * instance-access routing on the READ arm — so every inbox in the org is
 * returned to any member holding the def's view rung, including inboxes whose
 * only reach into the viewer's world is a thread somebody shared with them.
 * The gate here is the same `admin` rung the server enforces on every inbox
 * mutation (`requireInboxManageAccess` → `InboxService.canManageInboxAccess`
 * → `hasPermission(recordId, 'admin')`), read off the instance lane. It also
 * matches the Edit affordance on the inbox detail page and the `canManage`
 * flag `inbox.settingsList` computes, so the three cannot disagree.
 *
 * A personal mailbox's owner is granted `admin` on it at provisioning
 * (`provisionPersonalInbox`), so their own inbox keeps the affordance without
 * a second branch.
 *
 * ⚠ The RecordId MUST be minted from the inbox's own definition. A personal
 * mailbox still sitting on the shared def during the 060 migration window
 * carries its grant rows in the `inbox` keyspace; deriving the key from
 * `isPersonal` would look them up under `personal_inbox` and find nothing.
 * An inbox with no definition discriminator is treated as unknown, not as
 * allowed.
 */
export function InboxEditMenuItem({ inbox }: { inbox: Inbox }) {
  const { canAdminInstance } = useAccess()

  if (!inbox.entityDefinitionKey) return null
  if (!canAdminInstance(toRecordId(inbox.entityDefinitionKey, inbox.id))) return null

  return (
    <DropdownMenuItem asChild>
      <Link href={`/app/settings/inbox/${inbox.id}?tab=settings`}>
        <PencilIcon />
        Edit Inbox
      </Link>
    </DropdownMenuItem>
  )
}

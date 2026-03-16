// packages/lib/src/cache/providers/inboxes-provider.ts

import { InboxService } from '../../inboxes/inbox-service'
import type { Inbox } from '../../inboxes/types'
import type { CacheProvider } from '../org-cache-provider'

/** Computes all inboxes for an organization */
export const inboxesProvider: CacheProvider<Inbox[]> = {
  async compute(orgId, db) {
    const inboxService = new InboxService(db, orgId)
    return inboxService.getInboxes()
  },
}

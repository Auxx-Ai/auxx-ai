// packages/lib/src/cache/providers/inboxes-provider.ts

import { InboxService } from '../../inboxes/inbox-service'
import type { Inbox } from '../../inboxes/types'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Computes all inboxes for an organization.
 *
 * ONE merged list across BOTH inbox definitions (`inbox` + `personal_inbox`,
 * plan 40 §3.4) — the union lives in {@link InboxService.getInboxes}, which is
 * the single place it is allowed to live. Each entry carries
 * `entityDefinitionKey` as the def discriminator and a derived `isPersonal`, so
 * the ~20 consumers of this key keep their existing shape.
 */
export const inboxesProvider: CacheProvider<Inbox[]> = {
  async compute(orgId, db) {
    const inboxService = new InboxService(db, orgId)
    return inboxService.getInboxes()
  },
}

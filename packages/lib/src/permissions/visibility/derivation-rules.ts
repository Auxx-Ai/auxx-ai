// packages/lib/src/permissions/visibility/derivation-rules.ts

import type { ThreadVisibilityInput, UserMailVisibility } from './context'
import { type Lens, maxLens } from './lens'

/**
 * One way a thread's lens can be raised for a viewer. The evaluator folds the
 * registry with `maxLens` on top of the role/assignee framing. Keeping this a
 * registry (rather than inlining the branches) means "share via tag/project"
 * is an added entry, not a rewrite (§4).
 */
export interface DerivationRule {
  id: string
  /** Lens this rule grants for the thread, or `'none'` if it doesn't apply. */
  lens: (vis: UserMailVisibility, t: ThreadVisibilityInput) => Lens
}

export const DERIVATION_RULES: readonly DerivationRule[] = [
  // Inbox floor: max(defaultLens, user/group/role grants on the inbox), already
  // composed into `inboxLens` by the provider (only entries > 'none').
  {
    id: 'inbox-floor',
    lens: (vis, t) => (t.inboxId ? (vis.inboxLens[t.inboxId] ?? 'none') : 'none'),
  },
  // Explicit per-thread share.
  {
    id: 'thread-grant',
    lens: (vis, t) => vis.threadGrants[t.threadId] ?? 'none',
  },
  // Grant on the thread's primary entity (ticket/deal/…).
  {
    id: 'entity-grant',
    lens: (vis, t) =>
      t.primaryEntityInstanceId ? (vis.entityGrants[t.primaryEntityInstanceId] ?? 'none') : 'none',
  },
  // Contact-derived: any participant contact the viewer has a grant on.
  {
    id: 'contact-grant',
    lens: (vis, t) => {
      let lens: Lens = 'none'
      for (const contactId of t.participantContactIds) {
        lens = maxLens(lens, vis.contactGrants[contactId] ?? 'none')
      }
      return lens
    },
  },
]

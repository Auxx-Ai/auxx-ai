// packages/lib/src/permissions/visibility/derivation-rules.ts

import { maxRung } from '../capabilities/rung'
import type { ThreadVisibilityInput, UserInstanceGrants } from './context'
import { contactGrants, primaryEntityThreadRung, threadGrants } from './context'
import type { Lens } from './lens'
import { rungAsLens } from './lens'

/**
 * One way a thread's lens can be raised for a viewer. The evaluator folds the
 * registry with `maxRung` on top of the role/assignee framing. Keeping this a
 * registry (rather than inlining the branches) means "share via tag/project"
 * is an added entry, not a rewrite (§4).
 */
export interface DerivationRule {
  id: string
  /** Lens this rule grants for the thread, or `'none'` if it doesn't apply. */
  lens: (vis: UserInstanceGrants, t: ThreadVisibilityInput) => Lens
}

export const DERIVATION_RULES: readonly DerivationRule[] = [
  // Inbox floor: max(defaultLens, user/group/role grants on the inbox), already
  // composed into `inboxLens` by the provider (only entries > 'none').
  {
    id: 'inbox-floor',
    lens: (vis, t) => (t.inboxId ? (vis.inboxLens[t.inboxId] ?? 'none') : 'none'),
  },
  // Explicit per-thread share. `rungAsLens` clamps the stored rung onto the
  // thread ladder — the blob carries raw `Rung`s since plan v3/03 P4, and the
  // `Lens` narrowing makes forgetting the clamp a compile error here.
  {
    id: 'thread-grant',
    lens: (vis, t) => rungAsLens(threadGrants(vis)[t.threadId] ?? 'none'),
  },
  // Grant on the thread's primary entity (ticket/deal/…), **capped per def**
  // (plan v3/03 §13.1, decided 2026-07-29): a ticket-like def derives thread
  // `read` — the conversation IS the ticket — and a generic record def derives
  // NOTHING. Sharing a deal row shares the row, not its email history.
  //
  // The cap lives inside `primaryEntityThreadRung` because it must be applied
  // per DEF before the fold; this rule then only clamps the result onto the
  // thread ladder, which `deriveThreadRungFromRecordGrant`'s `read` ceiling
  // already guarantees. `rungAsLens` stays as the type-level proof of that.
  {
    id: 'entity-grant',
    lens: (vis, t) =>
      t.primaryEntityInstanceId
        ? rungAsLens(primaryEntityThreadRung(vis, t.primaryEntityInstanceId))
        : 'none',
  },
  // Contact-derived: any participant contact the viewer has a grant on.
  {
    id: 'contact-grant',
    lens: (vis, t) => {
      let lens: Lens = 'none'
      const grants = contactGrants(vis)
      for (const contactId of t.participantContactIds) {
        lens = maxRung(lens, rungAsLens(grants[contactId] ?? 'none'))
      }
      return lens
    },
  },
]

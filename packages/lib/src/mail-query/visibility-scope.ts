// packages/lib/src/mail-query/visibility-scope.ts

import { database as db, schema } from '@auxx/database'
import { and, eq, exists, inArray, isNull, not, or, type SQL, sql } from 'drizzle-orm'
import type {
  AutomationVisibility,
  MailViewer,
  UserMailVisibility,
} from '../permissions/visibility/context'
import { isAutomationViewer, isSystemViewer } from '../permissions/visibility/context'
import { type Lens, satisfiesLens } from '../permissions/visibility/lens'

const { Thread, ThreadParticipant } = schema

/** Ids whose lens in `map` is at or above `need`. */
function idsAtOrAbove(map: Record<string, Lens>, need: Lens): string[] {
  const ids: string[] = []
  for (const [id, lens] of Object.entries(map)) {
    if (satisfiesLens(lens, need)) ids.push(id)
  }
  return ids
}

/**
 * The grant-derived OR-branches of a visibility scope at tier `need`:
 * assignment (always `full`), per-thread grants, primary-entity grants, and
 * contact grants derived via ThreadParticipant. Empty sets are omitted.
 */
function grantScopeParts(vis: UserMailVisibility, need: Lens): SQL<unknown>[] {
  const parts: SQL<unknown>[] = [eq(Thread.assigneeId, vis.userId)]

  const threadIds = idsAtOrAbove(vis.threadGrants, need)
  if (threadIds.length > 0) parts.push(inArray(Thread.id, threadIds))

  const entityIds = idsAtOrAbove(vis.entityGrants, need)
  if (entityIds.length > 0) parts.push(inArray(Thread.primaryEntityInstanceId, entityIds))

  const contactIds = idsAtOrAbove(vis.contactGrants, need)
  if (contactIds.length > 0) {
    parts.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(ThreadParticipant)
          .where(
            and(
              eq(ThreadParticipant.threadId, Thread.id),
              inArray(ThreadParticipant.entityInstanceId, contactIds)
            )
          )
      )
    )
  }

  return parts
}

/**
 * The §8.2 automation scope: everything except threads in personal inboxes
 * (§11). `undefined` when no personal inboxes exist — automation then reads
 * exactly like SYSTEM. Null-inbox threads pass (residual org data).
 */
function automationScope(vis: AutomationVisibility): SQL<unknown> | undefined {
  const personalIds = Object.keys(vis.personalInboxIds)
  if (personalIds.length === 0) return undefined
  return or(isNull(Thread.inboxId), not(inArray(Thread.inboxId, personalIds)))!
}

/**
 * The mandatory §5.1 list predicate: which threads exist at all (≥ metadata)
 * for this viewer. `undefined` means unrestricted — SYSTEM skips, and admins
 * see every thread at ≥ metadata (personal inboxes included, capped at
 * metadata by redaction, §11). Null-inbox threads fail closed: visible only
 * via assignment or an explicit grant.
 */
export function buildMailVisibilityPredicate(viewer: MailViewer): SQL<unknown> | undefined {
  if (isSystemViewer(viewer)) return undefined
  if (isAutomationViewer(viewer)) return automationScope(viewer)
  if (viewer.isAdmin) return undefined

  const parts = grantScopeParts(viewer, 'metadata')
  const inboxIds = idsAtOrAbove(viewer.inboxLens, 'metadata')
  if (inboxIds.length > 0) parts.unshift(inArray(Thread.inboxId, inboxIds))

  return or(...parts)!
}

/**
 * The §5.3 search scope for content-bearing conditions. Subject predicates
 * require `need='subject'`, body/content predicates `need='full'`. Grant sets
 * are included at exactly `need` (conservative — a `metadata` thread grant
 * never widens a subject search). `undefined` means unscoped.
 *
 * Admins are NOT exempt (§5.1): their subject/body search sets exclude others'
 * personal inboxes below the tier — with no personal inboxes (pre-Phase-8) the
 * exclusion set is empty and the scope collapses to `undefined`.
 */
export function buildSearchScope(
  viewer: MailViewer,
  need: 'subject' | 'full'
): SQL<unknown> | undefined {
  if (isSystemViewer(viewer)) return undefined
  // Automation (§8.2): personal inboxes are zero-access at every tier.
  if (isAutomationViewer(viewer)) return automationScope(viewer)

  if (viewer.isAdmin) {
    const excluded = Object.keys(viewer.personalInboxIds).filter(
      (id) => !satisfiesLens(viewer.inboxLens[id] ?? 'none', need)
    )
    if (excluded.length === 0) return undefined
    return or(
      isNull(Thread.inboxId),
      not(inArray(Thread.inboxId, excluded)),
      ...grantScopeParts(viewer, need)
    )!
  }

  const parts = grantScopeParts(viewer, need)
  const inboxIds = idsAtOrAbove(viewer.inboxLens, need)
  if (inboxIds.length > 0) parts.unshift(inArray(Thread.inboxId, inboxIds))

  return or(...parts)!
}

/** Both search scopes, precomputed once per query build. */
export interface MailSearchScopes {
  subject: SQL<unknown> | undefined
  body: SQL<unknown> | undefined
}

export function buildSearchScopes(viewer: MailViewer): MailSearchScopes {
  return {
    subject: buildSearchScope(viewer, 'subject'),
    body: buildSearchScope(viewer, 'full'),
  }
}

// packages/lib/src/mail-query/visibility-scope.ts

import { database as db, schema } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import { and, eq, exists, inArray, isNull, not, or, type SQL, sql } from 'drizzle-orm'
import { satisfiesRung } from '../permissions/capabilities/rung'
import type {
  AutomationVisibility,
  MailViewer,
  UserInstanceGrants,
} from '../permissions/visibility/context'
import {
  contactGrants,
  isAutomationViewer,
  isSystemViewer,
  primaryEntityThreadIdsAtOrAbove,
  threadGrants,
} from '../permissions/visibility/context'
import type { Lens } from '../permissions/visibility/lens'

const { Thread, ThreadParticipant } = schema

/**
 * Ids whose rung in `map` is at or above `need`.
 *
 * Generic over {@link Rung} rather than {@link Lens}: since plan v3/03 P4 the
 * grant maps carry the STORED rung, so a `edit` grant on a thread's primary
 * entity is a legal value here. No clamp is needed — `need` is never above
 * `read`, and `satisfiesRung` is monotone, so an above-`read` rung includes the
 * id exactly as a clamped `read` would.
 */
function idsAtOrAbove(map: Readonly<Record<string, Rung>>, need: Lens): string[] {
  const ids: string[] = []
  for (const [id, rung] of Object.entries(map)) {
    if (satisfiesRung(rung, need)) ids.push(id)
  }
  return ids
}

/**
 * Thread ids explicitly granted to this viewer at metadata or above.
 * System and automation viewers do not hold user-specific grants.
 */
export function sharedThreadIds(viewer: MailViewer): string[] {
  if (isSystemViewer(viewer) || isAutomationViewer(viewer)) return []
  return idsAtOrAbove(threadGrants(viewer), 'metadata')
}

/**
 * The grant-derived OR-branches of a visibility scope at tier `need`:
 * assignment (always `read`), per-thread grants, primary-entity grants, and
 * contact grants derived via ThreadParticipant. Empty sets are omitted.
 */
function grantScopeParts(vis: UserInstanceGrants, need: Lens): SQL<unknown>[] {
  const parts: SQL<unknown>[] = [eq(Thread.assigneeId, vis.userId)]

  // Residual null-`inboxId` threads belong to no inbox and so inherit no floor.
  // They used to reach admins through the `viewer.isAdmin` bypasses this file
  // dropped in plan 40 §4.2; re-keyed onto the mail-operations rung they keep the
  // documented "admins + assignee only" triage view
  // (`plans/mail-permissions/02-architecture.md` §2.3) without reading rank.
  // Nobody else gains anything: `inboxes: Full` already means Manager of every
  // shared inbox (§1.2).
  if (vis.isMailAdmin) parts.push(isNull(Thread.inboxId))

  const threadIds = idsAtOrAbove(threadGrants(vis), need)
  if (threadIds.length > 0) parts.push(inArray(Thread.id, threadIds))

  // CAPPED per def (plan v3/03 §13.1) — a generic record def contributes no ids
  // at all, so a deal share no longer lists that deal's whole email history.
  const entityIds = primaryEntityThreadIdsAtOrAbove(vis, need)
  if (entityIds.length > 0) parts.push(inArray(Thread.primaryEntityInstanceId, entityIds))

  const contactIds = idsAtOrAbove(contactGrants(vis), need)
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
 * for this viewer. `undefined` means unrestricted — SYSTEM only.
 *
 * **Every user viewer is scoped since plan 40 §4.2**, including admins: the
 * `if (viewer.isAdmin) return undefined` bypass is deleted, so an admin's reach
 * is exactly their composed `inboxLens` — the area fallback on row-less shared
 * inboxes (`full` for any open rung), their explicit rows, and `metadata` on
 * others' personal mailboxes when they hold the mail-operations rung. An inbox
 * carrying `role:org_member @ none` that they hold no row on is now genuinely
 * excluded from their lists, which is the change §4.2 is for.
 *
 * Null-inbox threads fail closed: assignment, an explicit grant, or the
 * mail-admin triage branch in {@link grantScopeParts}.
 */
export function buildMailVisibilityPredicate(viewer: MailViewer): SQL<unknown> | undefined {
  if (isSystemViewer(viewer)) return undefined
  if (isAutomationViewer(viewer)) return automationScope(viewer)

  const parts = grantScopeParts(viewer, 'metadata')
  const inboxIds = idsAtOrAbove(viewer.inboxLens, 'metadata')
  if (inboxIds.length > 0) parts.unshift(inArray(Thread.inboxId, inboxIds))

  return or(...parts)!
}

/**
 * The §5.3 search scope for content-bearing conditions. Subject predicates
 * require `need='identity'`, body/content predicates `need='read'`. Grant sets
 * are included at exactly `need` (conservative — a `metadata` thread grant
 * never widens a subject search). `undefined` means unscoped.
 *
 * Admins take the same path as everyone else since plan 40 §4.2: their
 * inclusion-list bypass is deleted along with the one in
 * {@link buildMailVisibilityPredicate}. The §11 promise it used to implement by
 * subtraction — never search subjects/bodies in others' personal mailboxes —
 * now holds by construction: a mail admin's composed floor on such a mailbox is
 * `metadata`, which satisfies neither `identity` nor `read`, so the id never
 * enters the set in the first place.
 */
export function buildSearchScope(
  viewer: MailViewer,
  need: 'identity' | 'read'
): SQL<unknown> | undefined {
  if (isSystemViewer(viewer)) return undefined
  // Automation (§8.2): personal inboxes are zero-access at every tier.
  if (isAutomationViewer(viewer)) return automationScope(viewer)

  const parts = grantScopeParts(viewer, need)
  const inboxIds = idsAtOrAbove(viewer.inboxLens, need)
  if (inboxIds.length > 0) parts.unshift(inArray(Thread.inboxId, inboxIds))

  return or(...parts)!
}

/** Both search scopes, precomputed once per query build. */
export interface MailSearchScopes {
  subject: SQL<unknown> | undefined
  body: SQL<unknown> | undefined
  /** Thread ids explicitly granted to the viewer. */
  sharedThreadIds: string[]
}

export function buildSearchScopes(viewer: MailViewer): MailSearchScopes {
  return {
    subject: buildSearchScope(viewer, 'identity'),
    body: buildSearchScope(viewer, 'read'),
    sharedThreadIds: sharedThreadIds(viewer),
  }
}

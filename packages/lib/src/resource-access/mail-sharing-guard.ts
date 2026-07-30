// packages/lib/src/resource-access/mail-sharing-guard.ts

import { schema } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getCachedUserInstanceGrants, getOrgCache } from '../cache'
import { ForbiddenError } from '../errors'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { FeatureKey } from '../permissions/types'
import { getLoadedThreadLens, type LoadedThreadFacts } from '../permissions/visibility'
import { isInboxDef, isMailSharingDef } from './mail-sharing-defs'
import { hasPermission } from './resource-access-service'
import type { ResourceAccessContext } from './types'

/**
 * `MAIL_SHARING_DEFS` / {@link isMailSharingDef} live in `./mail-sharing-defs`
 * (a dependency-free leaf) so the `resource-access-service` write funnels can
 * reuse the predicate for their keyspace backstop without an import cycle back
 * through this module's `hasPermission` dependency. Re-exported here so the
 * barrel and every existing consumer keep the same import path.
 */
export { isMailSharingDef } from './mail-sharing-defs'

/**
 * The RecordId a mailbox instance's grant rows are keyed by, taken from the
 * instance's ACTUAL definition (plan 40 §3 / 40a §4).
 *
 * A mailbox lives on `inbox` or, after data migration 060, on `personal_inbox` —
 * and 060 re-keys its `ResourceAccess` rows in the same transaction. Reading the
 * def off the instance is what keeps this lookup in lockstep with the rows: the
 * two move together, so the answer is right before, during and after the split.
 *
 * Deliberately NOT derived from the `inbox_is_personal` marker or the cached
 * `Inbox.isPersonal` flag. Those say "this is a personal mailbox", which is true
 * of today's mailboxes while their rows are still keyed `'inbox'` — a
 * marker-derived lookup would start missing the owner's own Manager row the
 * moment it shipped, before 060 ever ran. `entityDefinitionKey` is the merged
 * `inboxes` org-cache list's def discriminator, added for exactly this
 * (`inboxes/types.ts`).
 *
 * Falls back to `'inbox'` when the inbox is not in the cache, which is the
 * pre-split behaviour for every input and fails CLOSED for a personal mailbox
 * (its slug-keyed rows simply don't match).
 */
export async function inboxAccessRecordId(
  organizationId: string,
  inboxId: string
): Promise<RecordId> {
  const inboxes = await getOrgCache().get(organizationId, 'inboxes')
  const defKey = inboxes.find((i) => i.id === inboxId)?.entityDefinitionKey
  return toRecordId(defKey && isInboxDef(defKey) ? defKey : 'inbox', inboxId)
}

/**
 * The org-scoped thread facts the `thread` branch needs, in ONE select — the
 * fallback for a caller that has not already loaded them.
 *
 * Selects exactly {@link LoadedThreadFacts}: previously the branch got
 * `inboxId`/`assigneeId`/`primaryEntityInstanceId` implicitly via `getThreadLens`
 * and then re-selected `inboxId` on its own, so the columns were split across two
 * reads of the same row for no reason.
 */
async function loadThreadFacts(
  db: ResourceAccessContext['db'],
  organizationId: string,
  threadId: string
): Promise<LoadedThreadFacts | null> {
  const [thread] = await db
    .select({
      id: schema.Thread.id,
      inboxId: schema.Thread.inboxId,
      assigneeId: schema.Thread.assigneeId,
      primaryEntityInstanceId: schema.Thread.primaryEntityInstanceId,
    })
    .from(schema.Thread)
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .limit(1)
  if (!thread) return null
  return {
    threadId: thread.id,
    inboxId: thread.inboxId ?? null,
    assigneeId: thread.assigneeId ?? null,
    primaryEntityInstanceId: thread.primaryEntityInstanceId ?? null,
  }
}

/**
 * Authorization for mutating mail-visibility grants (§7):
 * - `inbox` / `personal_inbox`: inbox Managers (instance `admin` grant) may
 *   manage their inbox — **and nobody else, not even an org admin** (plan 40
 *   §4.2 deletes the rank short-circuit for this branch ONLY). An OWNER still
 *   passes, through `checkAccess`'s owner→`admin` short-circuit inside
 *   `hasPermission`, so the org is never locked out;
 * - org admins may manage thread/contact sharing anywhere (plan 40 §2 keeps
 *   those two branches exactly as they are — they are question 4's, not v2's);
 * - `thread`: viewers at `read` on the thread who are also a Manager of the
 *   thread's inbox (admins short-circuit above) — a sub-`read` viewer must never
 *   self-raise, and `read`-lens members don't get to re-share by default;
 * - `contact`: org admins only in v1 (contact shares derive to every thread
 *   the contact participates in — the widest blast radius in the model).
 *
 * `selfRevokeGranteeId` allows a user to remove their OWN user grant (leave a
 * shared thread) without manager rights. No-op for non-mail definitions.
 *
 * `preloadedThread` lets a caller that has already loaded the org-scoped thread
 * hand it in. The `thread` branch otherwise reads that one row TWICE — once
 * through `getThreadLens` and once for its `inboxId` — on top of whatever the
 * caller already did, which is how the access-request decision path reached three
 * reads of the same row. A caller must only pass a row it loaded org-scoped, since
 * that scoping is what the branch relies on for "invisible ≍ nonexistent".
 */
export async function assertCanManageMailSharing(
  ctx: ResourceAccessContext,
  recordId: RecordId,
  opts?: {
    selfRevokeGranteeId?: string
    selfRevokeGranteeType?: string
    preloadedThread?: LoadedThreadFacts
  }
): Promise<void> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (!isMailSharingDef(entityDefinitionId)) return

  const { organizationId, userId } = ctx
  // DELIBERATELY `'user'` ONLY — do not widen to the other grantee kinds when
  // teaching the codebase a new one (doc 19 step 9 / 19a #13). Self-revoke means
  // "remove the grant that names ME"; a group/profile/role row is shared policy,
  // and letting one holder delete it would silently revoke everyone else. This
  // fails closed on purpose: a member who wants out of a profile-scoped share
  // needs an admin, not a leave button.
  if (
    opts?.selfRevokeGranteeType === 'user' &&
    opts.selfRevokeGranteeId &&
    opts.selfRevokeGranteeId === userId
  ) {
    return
  }

  // Both mailbox defs (plan 40 §3): a personal mailbox's owner holds the same
  // instance `admin` row, keyed `personal_inbox` after migration 060.
  //
  // FIRST, above the rank read below, and that ordering is the whole edit: an
  // inbox is now managed through rows only. Phase 3 replaces this branch with
  // `assertAdminInstance` (§5.3), which resolves the same rows through the v2
  // capability layer.
  if (isInboxDef(entityDefinitionId)) {
    if (await hasPermission(ctx, recordId, 'admin')) return
    throw new ForbiddenError('Only inbox managers can change inbox access')
  }

  const vis = await getCachedUserInstanceGrants(userId, organizationId)
  if (vis.isAdmin) return

  if (entityDefinitionId === 'thread') {
    // `ctx.db`, not the module-level `database`: a transactional caller expects
    // the guard it runs INSIDE its transaction to read through that transaction,
    // and `hasPermission` below already does.
    const thread =
      opts?.preloadedThread ?? (await loadThreadFacts(ctx.db, organizationId, entityInstanceId))
    const lens = thread
      ? await getLoadedThreadLens(ctx.db, vis, thread)
      : // No row: "invisible ≍ nonexistent", the same answer `getThreadLens`
        // returns for a nonexistent or cross-org id.
        'none'
    if (lens === 'read' && thread?.inboxId) {
      if (
        await hasPermission(
          ctx,
          // The thread's inbox may be a personal mailbox — resolve its def
          // rather than assuming `'inbox'`.
          await inboxAccessRecordId(organizationId, thread.inboxId),
          'admin'
        )
      ) {
        return
      }
    }
    throw new ForbiddenError('Only admins or inbox managers can share this conversation')
  }

  // contact
  throw new ForbiddenError('Only admins can share a contact’s conversations')
}

/**
 * Authorization for TYPE-level grant mutations on mail definitions: org
 * admins only. The evaluator deliberately ignores type-level view grants
 * (April decision), but a type-level `admin` grant on `inbox` would make the
 * grantee a Manager of every inbox — never something a non-admin may set up.
 * No-op for non-mail definitions.
 */
export async function assertCanManageMailTypeAccess(
  ctx: ResourceAccessContext,
  entityDefinitionId: string
): Promise<void> {
  if (!isMailSharingDef(entityDefinitionId)) return
  const vis = await getCachedUserInstanceGrants(ctx.userId, ctx.organizationId)
  if (vis.isAdmin) return
  throw new ForbiddenError('Only admins can manage type-level access')
}

/**
 * Plan gate for tiered sharing (§7.1 / plan decision 4). Throws unless the org
 * has `FeatureKey.granularPermissions` when the mutation:
 * - grants a sub-`read` rung (metadata/identity shares), or
 * - adds a NEW inbox Manager (`admin` rung) — delegation. Re-submitting an
 *   existing Manager row (the inbox form's replace-all save includes the
 *   non-removable creator row) stays ungated so free-plan saves don't trip.
 *
 * `read` grants stay ungated: they only widen access, which assignment already
 * does on every plan. No-op for non-mail definitions.
 *
 * ⚠ `'none'` is NOT gated here and must not become so. It is a RESTRICTION, and
 * the plan gate exists to paywall added capability — paywalling a restriction
 * would mean a downgraded org cannot close an inbox it had already closed. The
 * `none` floor is gated separately, on authoring, by `assertInboxFloorFeature`.
 *
 * **The key was `FeatureKey.mailPermissions` until plan v3/03 §7.6 (D9) deleted
 * it.** One key now gates the entire permission layer, so record sharing rides
 * the same paywall as mail sharing instead of a parallel one. The plan matrix
 * became Demo + Growth + Enterprise (Growth gains mail sharing; it already had
 * profiles and grants).
 */
export async function assertMailSharingFeature(
  ctx: ResourceAccessContext,
  recordId: RecordId,
  grants: Array<{ granteeId: string; rung: string }>
): Promise<void> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (!isMailSharingDef(entityDefinitionId)) return

  let gated = grants.some((g) => g.rung === 'metadata' || g.rung === 'identity')

  // Both mailbox defs (plan 40 §3) — delegation on a personal mailbox is the
  // same Enterprise-gated new-Manager write, just keyed `personal_inbox`.
  if (!gated && isInboxDef(entityDefinitionId)) {
    const newManagers = grants.filter((g) => g.rung === 'admin')
    if (newManagers.length > 0) {
      const existing = await ctx.db
        .select({ granteeId: schema.ResourceAccess.granteeId })
        .from(schema.ResourceAccess)
        .where(
          and(
            eq(schema.ResourceAccess.organizationId, ctx.organizationId),
            eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
            eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
            eq(schema.ResourceAccess.rung, 'admin')
          )
        )
      const existingIds = new Set(existing.map((r: { granteeId: string }) => r.granteeId))
      gated = newManagers.some((g) => !existingIds.has(g.granteeId))
    }
  }

  if (gated) {
    await new FeaturePermissionService(ctx.db).requireAccess(
      ctx.organizationId,
      FeatureKey.granularPermissions
    )
  }
}

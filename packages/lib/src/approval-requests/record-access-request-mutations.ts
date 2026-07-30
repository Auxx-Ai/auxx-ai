// packages/lib/src/approval-requests/record-access-request-mutations.ts
//
// Writes for the RECORD access-request lane (plan v3/04 §3).
//
// Two guards in here ARE authorization asserts, deliberately (module guide §6's
// identity/integrity carve-out):
//
//  - {@link applyRecordAccessDecision} re-runs `assertCanManageRecordSharing`
//    for the ACTING approver INSIDE the winning decision claim. It cannot live
//    in the router — the point is that it runs in the same transaction as the
//    grant, so a member who lost sharing authority after the request was filed
//    gets a 403 and writes nothing, instead of a 14-day-old `assigneeUsers`
//    snapshot becoming lasting authorization.
//  - `assertRecordSharingFeature` runs before `grantInstanceAccess` for the same
//    structural reason (§3.5): with the gate only in the `resourceAccess` router,
//    a non-Enterprise org could not share a record through the share dialog but
//    COULD through an approved request.

import { type Database, schema } from '@auxx/database'
import { ApprovalStatus, ResourceGranteeType, type Rung } from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { getCapabilities } from '../permissions/capabilities/get-capabilities'
import { satisfiesRung } from '../permissions/capabilities/rung'
import {
  assertCanManageRecordSharing,
  assertRecordSharingFeature,
} from '../resource-access/record-sharing-guard'
import { grantInstanceAccess } from '../resource-access/resource-access-service'
import { notifyAccessApprovers, notifyRequesterDecided } from './access-request-notifications'
import {
  accessRequestExpiresAt,
  findInstanceDenyCooldown,
  findPendingInstanceAccessRequest,
} from './access-request-shared'
import { type AccessRequestMetadata, RECORD_ACCESS_REFUSAL_COPY } from './client'
import { guard } from './guard'
import {
  buildRecordSubjectLabel,
  loadRecordAuthorityContext,
  nextRecordRung,
  recordRungFor,
  resolveRecordApprovers,
  resolveRecordFrontDoor,
} from './record-access-request-queries'
import type {
  ApprovalResolveContext,
  CreateAccessRequestResult,
  CreateRecordAccessRequestInput,
} from './types'

/**
 * File (or re-raise) a request for the NEXT rung on one record.
 *
 * Shape notes that are decisions, not incidentals:
 *
 * - 🔴 **The rung is DERIVED, never supplied.** `{ entityDefinitionId,
 *   entityInstanceId, message? }` is the whole input; the ask is
 *   `nextRecordRung(currentRung)`. See {@link CreateRecordAccessRequestInput} for
 *   why, and note it is recomputed again at the DECISION — the requester's
 *   access may have moved between opening the popover and the approver clicking
 *   Grant.
 * - **The def id persisted is the CANONICAL `EntityDefinition.id`**, resolved by
 *   `loadRecordAuthorityContext`. `ResourceAccess`, `defAccess` and
 *   `grantedDefIds` are all keyed on it; persisting an apiSlug would file a
 *   request whose approval writes a grant nothing reads.
 * - **`requestedLevel` / `grantedLevel` stay NULL.** Rung is authoritative for
 *   the instance lane, and populating them via `rungToPermission` would buy a
 *   third `Rung ↔ ResourcePermission` crossing point for a redundant column
 *   (§2.2).
 * - **`expiresAt` is always set** (14 days), swept by `cleanupExpiredApprovals`.
 * - **Both assignee arrays are always written**, possibly empty, never NULL
 *   (plan 28 H3): NULL throws at the `canUserApprove` read site.
 * - **The insert is an atomic upsert.** `ApprovalRequest_access_instance_pending_key`
 *   is the race arbiter; a bare `ON CONFLICT DO NOTHING` turns a losing
 *   concurrent create into an empty `returning()` rather than a leaked unique
 *   violation, and the re-request path then updates that one row. Two
 *   simultaneous identical creates therefore yield ONE pending row and no error.
 */
export async function createRecordAccessRequest(
  db: Database,
  organizationId: string,
  userId: string,
  input: CreateRecordAccessRequestInput
): Promise<Result<CreateAccessRequestResult, Error>> {
  return guard(
    async () => {
      // Covers the deleted row, the cross-org row AND the def this lane does not
      // own — a thread, a dataset, a CONTACT (§3.3 / Invariant #7). All three are
      // "there is nothing here for you to ask about".
      const ctx = await loadRecordAuthorityContext(
        db,
        organizationId,
        input.entityDefinitionId,
        input.entityInstanceId
      )
      if (!ctx) throw new NotFoundError(RECORD_ACCESS_REFUSAL_COPY.target_unavailable)

      const capabilities = await getCapabilities(userId, organizationId)
      const currentRung = await recordRungFor(db, organizationId, userId, capabilities, ctx)

      // The seat, before anything else that costs a query: unliftable by any
      // permission change, so there is nothing further to compute.
      const frontDoor = resolveRecordFrontDoor(capabilities, ctx.entityDefinitionId)
      if (!frontDoor.open) {
        throw new ForbiddenError(RECORD_ACCESS_REFUSAL_COPY[frontDoor.reason])
      }

      // `already_at_ceiling` IS the "could they just grant it to themselves?"
      // test (§4): `canEditEntity(def)` means the def rung reaches `edit`, and a
      // row-`admin` holder is at `admin`, so both land here by construction.
      const requestedRung = nextRecordRung(currentRung)
      if (!requestedRung) {
        throw new BadRequestError(RECORD_ACCESS_REFUSAL_COPY.already_at_ceiling)
      }

      const recordId = toRecordId(ctx.entityDefinitionId, ctx.entityInstanceId)
      // §3.5, half one of two. Refusing at CREATION is presentation — it stops an
      // org that cannot honour the grant from accumulating requests nobody can
      // approve. The GATE is the identical call in the decision handler.
      await assertRecordSharingFeature({ db, organizationId }, recordId)

      // D3 — org admins + owners, a cache read. An org always has an owner, so
      // mail's empty-approver assertion is unreachable here and is not ported.
      const approvers = await resolveRecordApprovers(organizationId)

      const existing = await findPendingInstanceAccessRequest(
        db,
        organizationId,
        userId,
        ctx.entityDefinitionId,
        ctx.entityInstanceId
      )
      if (!existing) {
        const cooldown = await findInstanceDenyCooldown(
          db,
          organizationId,
          userId,
          ctx.entityDefinitionId,
          ctx.entityInstanceId
        )
        if (cooldown) throw new ForbiddenError(RECORD_ACCESS_REFUSAL_COPY.deny_cooldown)
      }

      const subjectLabel = buildRecordSubjectLabel(ctx, currentRung)
      const expiresAt = accessRequestExpiresAt()

      if (!existing) {
        const [inserted] = await db
          .insert(schema.ApprovalRequest)
          .values({
            organizationId,
            kind: 'access',
            status: ApprovalStatus.pending,
            subjectLabel,
            createdById: userId,
            requesterId: userId,
            targetKind: 'instance',
            entityDefinitionId: ctx.entityDefinitionId,
            entityInstanceId: ctx.entityInstanceId,
            // NULL deliberately — see the JSDoc above and schema §2.2.
            requestedLevel: null,
            requestedLens: requestedRung,
            message: input.message ?? null,
            assigneeUsers: approvers.userIds,
            assigneeGroups: [],
            expiresAt,
            metadata: {} satisfies AccessRequestMetadata,
          })
          .onConflictDoNothing()
          .returning({ id: schema.ApprovalRequest.id })

        if (inserted) {
          await notifyAccessApprovers(db, {
            organizationId,
            requesterId: userId,
            approvalRequestId: inserted.id,
            approverUserIds: approvers.userIds,
            subjectLabel,
            resourceKey: ctx.entityDefinitionId,
            requestedRung,
            reRequest: false,
          })
          return { requestId: inserted.id, reRequested: false, approverUserIds: approvers.userIds }
        }
      }

      // ── RE-REQUEST ──
      //
      // A second ask UPDATES the existing row and re-notifies rather than
      // inserting. `requestedLens` is deliberately absent from the dedup identity
      // precisely so this is an UPGRADE: with the derived rung, a `read → edit`
      // ask following a `none → read` ask is genuinely a different rung, and
      // without the exclusion it would open a second pending row.
      const row =
        existing ??
        (await findPendingInstanceAccessRequest(
          db,
          organizationId,
          userId,
          ctx.entityDefinitionId,
          ctx.entityInstanceId
        ))
      if (!row) {
        // The conflicting row went terminal between the insert and this read.
        throw new BadRequestError('Your request could not be filed just now. Please try again.')
      }

      const metadata = (row.metadata as AccessRequestMetadata | null) ?? {}
      await db
        .update(schema.ApprovalRequest)
        .set({
          // Upward only. The stored value can only ever move `read → edit`,
          // because the derivation itself is monotone in the requester's rung.
          requestedLens: requestedRung,
          message: input.message ?? row.message,
          subjectLabel,
          assigneeUsers: approvers.userIds,
          assigneeGroups: [],
          expiresAt,
          metadata: {
            ...metadata,
            remindedAt: new Date().toISOString(),
            remindCount: (metadata.remindCount ?? 0) + 1,
          } satisfies AccessRequestMetadata,
        })
        .where(eq(schema.ApprovalRequest.id, row.id))

      await notifyAccessApprovers(db, {
        organizationId,
        requesterId: userId,
        approvalRequestId: row.id,
        approverUserIds: approvers.userIds,
        subjectLabel,
        resourceKey: ctx.entityDefinitionId,
        requestedRung,
        reRequest: true,
      })

      return { requestId: row.id, reRequested: true, approverUserIds: approvers.userIds }
    },
    'Failed to create record access request',
    {
      organizationId,
      userId,
      entityDefinitionId: input.entityDefinitionId,
      entityInstanceId: input.entityInstanceId,
    }
  )
}

/**
 * The RECORD arm of the `access` kind handler (§3.4) — invoked inside the winning
 * decision claim by `applyAccessDecision`'s target-kind dispatch.
 *
 * Mail's step order is kept, because the ORDER is the design:
 *
 * 1. **Reload the target org-scoped.** A deleted or cross-org record refuses the
 *    decision — the refusal falls out of the same load the label needs, so there
 *    is no separate existence probe.
 * 2. **Revalidate the ACTING APPROVER's current authority.** `assigneeUsers` is
 *    an audience/history snapshot, never an authorization token: a member who
 *    lost sharing rights after the request was filed may neither grant NOR block
 *    it. Throwing here rolls the claim back, so Approve writes no grant and Deny
 *    does not stick.
 *    ⚠ The rule is `assertCanManageRecordSharing`'s — `canEditEntity(def) OR
 *    row-effective admin` (§10.1). HANDOFF §5 correction #1 says otherwise and is
 *    WRONG: it attributes a CLIENT-side test's assertion to the server. A handler
 *    that copied that prose would deny every def-`Edit` approver.
 * 3. **Front door.** The seat, re-checked: a grant the requester cannot use is
 *    worse than an honest refusal, because it looks like it worked.
 * 4. **Supersede if access already arrived** another way.
 * 5. **Dispatch to `grantInstanceAccess`**, never a direct `ResourceAccess` write.
 */
export async function applyRecordAccessDecision(
  ctx: ApprovalResolveContext
): Promise<{ message: string; afterCommit?: (db: Database) => Promise<void> }> {
  const { request, approverUserId, action } = ctx
  const tx = ctx.tx as Database
  const organizationId = request.organizationId
  const requesterId = request.requesterId
  const entityDefinitionId = request.entityDefinitionId
  const entityInstanceId = request.entityInstanceId

  if (!entityDefinitionId || !entityInstanceId || !requesterId) {
    throw new BadRequestError('Access request is missing its target or requester')
  }

  // 1. Org-scoped reload — deleted, cross-org, or a def this lane does not own.
  const recordCtx = await loadRecordAuthorityContext(
    tx,
    organizationId,
    entityDefinitionId,
    entityInstanceId
  )
  if (!recordCtx) throw new NotFoundError(RECORD_ACCESS_REFUSAL_COPY.target_unavailable)

  const recordId = toRecordId(recordCtx.entityDefinitionId, recordCtx.entityInstanceId)

  // 2. CURRENT authority of the acting approver, on BOTH decisions.
  const approverCaps = await getCapabilities(approverUserId, organizationId)
  await assertCanManageRecordSharing(
    { db: tx, organizationId, userId: approverUserId },
    approverCaps,
    recordId
  )

  if (action === 'deny') {
    const metadata = (request.metadata as AccessRequestMetadata | null) ?? {}
    await tx
      .update(schema.ApprovalRequest)
      .set({
        metadata: {
          ...metadata,
          // The cooldown window is measured from here, not from `createdAt`.
          deniedAt: new Date().toISOString(),
          decidedById: approverUserId,
        } satisfies AccessRequestMetadata,
      })
      .where(eq(schema.ApprovalRequest.id, request.id))

    return {
      message: 'Access request denied',
      afterCommit: (outerDb) =>
        notifyRequesterDecided(outerDb, {
          organizationId,
          requesterId,
          approverUserId,
          approvalRequestId: request.id,
          subjectLabel: request.subjectLabel,
          resourceKey: recordCtx.entityDefinitionId,
          decision: 'denied',
        }),
    }
  }

  // §3.5, half two of two — THE gate. Without this an approved request is a
  // paywall bypass: `grantInstanceAccess` called from here would otherwise write
  // a gated grant on an org that cannot buy it through any other door.
  await assertRecordSharingFeature({ db: tx, organizationId }, recordId)

  // 3. Front door (the seat), re-checked at Accept.
  const requesterCaps = await getCapabilities(requesterId, organizationId)
  const frontDoor = resolveRecordFrontDoor(requesterCaps, recordCtx.entityDefinitionId)
  if (!frontDoor.open) {
    throw new BadRequestError(RECORD_ACCESS_REFUSAL_COPY[frontDoor.reason])
  }

  // 4. Supersede when access already arrived by another route.
  //
  // ⚠ Computed from the requester's CURRENT state, NEVER by folding the proposed
  // grant in. `foldRecordAccess` is `max(defRung, grantRank)`, so folding the
  // grant we are about to write always satisfies the request — for every
  // requester, on every record. That is a tautology, and it is the same trap the
  // thread lane documents for `maxLens`.
  const requestedRung = (request.requestedLens as Rung | null) ?? null

  // Invariant #6, restated as a runtime backstop rather than a comment: the only
  // producer of `requestedLens` on this lane is `nextRecordRung`, which can emit
  // `read` or `edit` and nothing else — but a hand-written row, a future lane or
  // a bad migration could put `none` or `admin` here, and a grant is not the
  // place to find out. `none` is a RESTRICTION marker and `admin` is delegated
  // sharing authority; neither is requestable, so refuse rather than write.
  if (!requestedRung || requestedRung === 'none' || requestedRung === 'admin') {
    throw new BadRequestError('This access request does not name a grantable level.')
  }

  const requesterRung = await recordRungFor(
    tx,
    organizationId,
    requesterId,
    requesterCaps,
    recordCtx
  )
  if (satisfiesRung(requesterRung, requestedRung)) {
    const metadata = (request.metadata as AccessRequestMetadata | null) ?? {}
    await tx
      .update(schema.ApprovalRequest)
      .set({
        status: 'superseded',
        metadata: {
          ...metadata,
          decidedById: approverUserId,
          supersededReason: 'already_at_ceiling',
        } satisfies AccessRequestMetadata,
      })
      .where(eq(schema.ApprovalRequest.id, request.id))
    return {
      message: 'They already have this level of access to the record',
      afterCommit: (outerDb) =>
        notifyRequesterDecided(outerDb, {
          organizationId,
          requesterId,
          approverUserId,
          approvalRequestId: request.id,
          subjectLabel: request.subjectLabel,
          resourceKey: recordCtx.entityDefinitionId,
          decision: 'superseded',
        }),
    }
  }

  // `deferEmits` because this runs INSIDE the decision transaction (module guide
  // §8). The grant row must land atomically with the decision, but its cache
  // invalidation and `capabilities:changed` publish must not: firing them here
  // drops the requester's cached blob while the grant is still invisible to every
  // other connection, so a reader racing the commit repopulates from PRE-grant
  // state and the requester stares at a stale blob. `flushEmits` runs in
  // `afterCommit` below.
  const { flushEmits } = await grantInstanceAccess(
    { db: tx, organizationId, userId: approverUserId },
    {
      recordId,
      granteeType: ResourceGranteeType.user,
      granteeId: requesterId,
      rung: requestedRung,
      origin: 'approval',
      deferEmits: true,
    }
  )

  await tx
    .update(schema.ApprovalRequest)
    .set({
      // `grantedLevel` stays NULL for the same reason `requestedLevel` does.
      grantedLens: requestedRung,
      metadata: {
        ...((request.metadata as AccessRequestMetadata | null) ?? {}),
        decidedById: approverUserId,
      } satisfies AccessRequestMetadata,
    })
    .where(eq(schema.ApprovalRequest.id, request.id))

  return {
    message: 'Access granted',
    // Emits BEFORE the notification: the requester should not be told their
    // access arrived until the cache that decides whether they actually have it
    // has been busted.
    afterCommit: async (outerDb) => {
      await flushEmits()
      await notifyRequesterDecided(outerDb, {
        organizationId,
        requesterId,
        approverUserId,
        approvalRequestId: request.id,
        subjectLabel: request.subjectLabel,
        resourceKey: recordCtx.entityDefinitionId,
        decision: 'approved',
        grantedRung: requestedRung,
      })
    },
  }
}

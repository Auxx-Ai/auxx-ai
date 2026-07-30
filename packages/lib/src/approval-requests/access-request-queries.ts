// packages/lib/src/approval-requests/access-request-queries.ts
//
// Reads for the THREAD access-request lane (plan 42).
//
// **No permission checks live here** (module guide §6). `resolveThreadFrontDoor`
// and `preflightThreadAccessRequest` REPORT eligibility — they are the server's
// answer to "would this ask be honourable?", which is data the UI renders and the
// creation path re-derives. The authorization asserts are in
// `access-request-mutations.ts`'s decision handler and in the router.

import { type Database, schema } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getCachedMembersByUserIds, getCachedUserMailVisibility, getOrgCache } from '../cache'
import { getCapabilities } from '../permissions/capabilities/get-capabilities'
import { PermissionKey } from '../permissions/capabilities/registry'
import type { UserMailVisibility } from '../permissions/visibility/context'
import { effectiveLens } from '../permissions/visibility/effective-lens'
import type { Lens } from '../permissions/visibility/lens'
import { redactThreadMeta } from '../permissions/visibility/redact'
import { expandGranteeToUserIds } from '../resource-access/grantee-resolution'
import { inboxAccessRecordId } from '../resource-access/mail-sharing-guard'
import type { ThreadMeta } from '../threads/types'
import {
  ACCESS_DENY_COOLDOWN_DAYS,
  type AccessRefusalReason,
  type AccessRequestMetadata,
} from './client'
import type {
  AccessRequestPreflight,
  ThreadApproverResolution,
  ThreadAuthorityContext,
} from './types'

/**
 * Load the org-scoped thread facts every mail-authority read needs, ONCE
 * (plan 42 §3).
 *
 * The guard path already fetched the thread row twice — `getThreadLensBatch`
 * selects `inboxId`/`assigneeId`/`primaryEntityInstanceId`, then
 * `assertCanManageMailSharing` re-selects `inboxId` on the row it just implicitly
 * loaded. This is the "load once and pass in" shape: the approver resolver, the
 * lens computation and the subject label all consume this one read instead of
 * adding a third.
 *
 * Returns `null` for a nonexistent OR cross-org id — "invisible ≍ nonexistent",
 * the same reading `getThreadLens` takes, so the refusal falls out of the load
 * rather than needing a separate existence probe.
 */
export async function loadThreadAuthorityContext(
  db: Database,
  organizationId: string,
  threadId: string
): Promise<ThreadAuthorityContext | null> {
  const [thread] = await db
    .select({
      id: schema.Thread.id,
      inboxId: schema.Thread.inboxId,
      assigneeId: schema.Thread.assigneeId,
      primaryEntityInstanceId: schema.Thread.primaryEntityInstanceId,
      subject: schema.Thread.subject,
      messageCount: schema.Thread.messageCount,
      participantCount: schema.Thread.participantCount,
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
    subject: thread.subject ?? null,
    messageCount: thread.messageCount ?? 0,
    participantCount: thread.participantCount ?? 0,
  }
}

/**
 * The viewer's composed lens on an ALREADY-LOADED thread — `effectiveLens` over the
 * context from {@link loadThreadAuthorityContext}, with the `ThreadParticipant`
 * query only when the viewer actually holds contact grants (the same conditional
 * `getThreadLensBatch` uses).
 *
 * Exists so the request/decision paths do not re-read the thread through
 * `getThreadLens` after this module already has it.
 */
export async function threadLensFromContext(
  db: Database,
  vis: UserMailVisibility,
  ctx: ThreadAuthorityContext
): Promise<Lens> {
  let participantContactIds: string[] = []
  if (Object.keys(vis.contactGrants).length > 0) {
    const rows = await db
      .select({ entityInstanceId: schema.ThreadParticipant.entityInstanceId })
      .from(schema.ThreadParticipant)
      .where(
        and(
          eq(schema.ThreadParticipant.threadId, ctx.threadId),
          isNotNull(schema.ThreadParticipant.entityInstanceId)
        )
      )
    participantContactIds = rows
      .map((r) => r.entityInstanceId)
      .filter((id): id is string => id !== null)
  }
  return effectiveLens(vis, {
    threadId: ctx.threadId,
    inboxId: ctx.inboxId,
    assigneeId: ctx.assigneeId,
    primaryEntityInstanceId: ctx.primaryEntityInstanceId,
    participantContactIds,
  })
}

/**
 * Who may decide a thread access request (plan 42 §3).
 *
 * Threads essentially never carry `admin` rows — thread sharing writes
 * `permission: view` + a lens — so resolving against the THREAD returns an empty
 * set and trips the non-empty assertion on every request. The real authority is
 * what `assertCanManageMailSharing` enforces, resolved from the thread's INBOX:
 *
 * 1. **Inbox Managers** — holders of instance `admin` on the inbox's ACTUAL
 *    RecordId. `inboxAccessRecordId` resolves `'inbox'` vs `'personal_inbox'` off
 *    the instance's def; hardcoding `'inbox'` yields an EMPTY approver set on every
 *    personal-mailbox thread (plan 42 §3, the plan-40 interaction).
 * 2. **Org admins** — whom the thread branch of the guard admits independently of
 *    their mail lens. Also the null-`inboxId` path: triage threads belong to no
 *    inbox, so they have no Manager, and `automationLens` already treats them as
 *    org data.
 *
 * Owners are ALWAYS added to `userIds` as silent recovery approvers — so removing
 * the last snapshotted Manager cannot black-hole a request — but deliberately not
 * to `primaryUserIds`, which would put every admin in every Manager-owned
 * request's notification stream.
 *
 * Group- and profile-derived Manager authority is expanded to concrete user ids
 * HERE, at creation, through the ONE shared expansion (§3.1). Two reasons:
 * `assigneeGroups` would let a later group-membership change silently rewrite what
 * is supposed to be a snapshot, and a profile grantee has no compatible
 * approval-assignee id at all.
 *
 * Agent / system principals are dropped (`humansOnly`): a synthetic user holding an
 * inbox `admin` row would otherwise satisfy the non-empty assertion while being
 * unable to decide anything.
 *
 * Deliberately NOT `getFullLensAudienceForInbox` — that is labelled a non-enforcement
 * OVER-APPROXIMATION and returns every org member on a `defaultLens: 'full'` inbox.
 * Deliberately NOT `mailGrantIndex` either: it keeps `{ userId, lens }` and drops
 * `permission`, so it cannot tell a Manager (`admin`) from a `view` holder.
 */
export async function resolveThreadApprovers(
  db: Database,
  organizationId: string,
  ctx: ThreadAuthorityContext
): Promise<ThreadApproverResolution> {
  const roleMap = await getOrgCache().get(organizationId, 'memberRoleMap')
  const humanEntries = Object.entries(roleMap).filter(([, e]) => e.userType === 'USER')
  const adminUserIds = humanEntries
    .filter(([, e]) => e.role === 'ADMIN' || e.role === 'OWNER')
    .map(([userId]) => userId)
  const ownerUserIds = humanEntries.filter(([, e]) => e.role === 'OWNER').map(([userId]) => userId)

  let managerUserIds: string[] = []
  if (ctx.inboxId) {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(
      await inboxAccessRecordId(organizationId, ctx.inboxId)
    )
    const rows = await db
      .select({
        granteeType: schema.ResourceAccess.granteeType,
        granteeId: schema.ResourceAccess.granteeId,
      })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, organizationId),
          eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
          eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
          eq(schema.ResourceAccess.permission, ResourcePermission.admin)
        )
      )
    const seen = new Set<string>()
    for (const row of rows) {
      const { userIds } = await expandGranteeToUserIds(db, organizationId, row, {
        humansOnly: true,
      })
      for (const userId of userIds) seen.add(userId)
    }
    managerUserIds = Array.from(seen)
  }

  const hasManagers = managerUserIds.length > 0
  const primaryUserIds = hasManagers ? managerUserIds : adminUserIds
  const userIds = Array.from(new Set([...primaryUserIds, ...ownerUserIds]))

  return { userIds, primaryUserIds, hasManagers }
}

/**
 * Whether the requester could USE a thread grant at all (plan 42 §5.3) — the one
 * refusal case that is real.
 *
 * `inboxes.view` is the coarse gate on every `thread.*` procedure, and a thread
 * grant changes the lens without synthesizing that key (`thread` is not an
 * instance-access resource). Without the front door, Accept writes a `full` lens no
 * thread procedure lets them use.
 *
 * **`can(inboxesView)`, NOT `areaLevel(Area.inboxes) === None`.** `areaLevel`
 * deliberately ignores `instanceDerivedKeys` while `can` includes them, so a member
 * whose profile says `Inboxes: None` but who holds one explicit inbox `view` row
 * DOES get the derived front-door key and can use a thread grant in exactly that
 * inbox. Refusing from the area level rejects a valid request.
 *
 * The seat is read off the `CapabilitySet` (`caps.seatType`), which has ALREADY
 * applied the ceiling as its last clamp — importing `SEAT_CEILINGS` here to
 * re-derive it would open a second source of truth for a value the blob resolved.
 */
export async function resolveThreadFrontDoor(
  organizationId: string,
  userId: string
): Promise<
  | { open: true }
  | { open: false; reason: Extract<AccessRefusalReason, 'worker_seat' | 'front_door_closed'> }
> {
  const caps = await getCapabilities(userId, organizationId)
  if (caps.can(PermissionKey.inboxesView)) return { open: true }
  // Worker seats hit this UNLIFTABLY: `Area.inboxes` is absent from `WORKER_AREAS`
  // and the seat ceiling clamps last, so no inbox-instance row derives the key and
  // no permission change helps. Name the seat, not the profile — pointing an
  // approver at a lever they cannot pull is worse than naming none.
  return { open: false, reason: caps.seatType === 'worker' ? 'worker_seat' : 'front_door_closed' }
}

/** The existing pending `access` request for one (requester, thread), if any. */
export async function findPendingThreadAccessRequest(
  db: Database,
  organizationId: string,
  requesterId: string,
  threadId: string
) {
  return db.query.ApprovalRequest.findFirst({
    where: and(
      eq(schema.ApprovalRequest.organizationId, organizationId),
      eq(schema.ApprovalRequest.kind, 'access'),
      eq(schema.ApprovalRequest.status, 'pending'),
      eq(schema.ApprovalRequest.requesterId, requesterId),
      eq(schema.ApprovalRequest.targetKind, 'instance'),
      eq(schema.ApprovalRequest.entityDefinitionId, 'thread'),
      eq(schema.ApprovalRequest.entityInstanceId, threadId)
    ),
  })
}

/**
 * Whether a DENY on this exact target is still inside its cooldown window
 * (plan 28 §4.5). Without this the deny button does not actually stop anything —
 * and with a one-click, picker-less trigger every re-click is byte-identical.
 *
 * The window is measured from `metadata.deniedAt` (written by the decision
 * handler), falling back to `createdAt` for a row that predates the field.
 */
export async function findThreadDenyCooldown(
  db: Database,
  organizationId: string,
  requesterId: string,
  threadId: string
): Promise<{ until: Date } | null> {
  const rows = await db
    .select({
      createdAt: schema.ApprovalRequest.createdAt,
      metadata: schema.ApprovalRequest.metadata,
    })
    .from(schema.ApprovalRequest)
    .where(
      and(
        eq(schema.ApprovalRequest.organizationId, organizationId),
        eq(schema.ApprovalRequest.kind, 'access'),
        eq(schema.ApprovalRequest.status, 'denied'),
        eq(schema.ApprovalRequest.requesterId, requesterId),
        eq(schema.ApprovalRequest.targetKind, 'instance'),
        eq(schema.ApprovalRequest.entityDefinitionId, 'thread'),
        eq(schema.ApprovalRequest.entityInstanceId, threadId)
      )
    )
  const cooldownMs = ACCESS_DENY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  let latest: Date | null = null
  for (const row of rows) {
    const deniedAtRaw = (row.metadata as AccessRequestMetadata | null)?.deniedAt
    const deniedAt = deniedAtRaw ? new Date(deniedAtRaw) : row.createdAt
    if (!latest || deniedAt > latest) latest = deniedAt
  }
  if (!latest) return null
  const until = new Date(latest.getTime() + cooldownMs)
  return until > new Date() ? { until } : null
}

/**
 * The durable display label for a thread access request (plan 42 §7).
 *
 * Built SERVER-SIDE at creation from the requester's already-redacted view, never
 * accepted as client input. It is the only way a DENIED requester — who cannot
 * hydrate the target at all — sees what they asked for, and the fallback for an
 * approver whose own lens is `metadata`/`none`.
 *
 * Composed from the EXISTING redaction vocabulary rather than a hand-written field
 * list: {@link redactThreadMeta} — and behind it `SUBJECT_TIER_THREAD_FIELDS` /
 * `THREAD_METADATA_FIELDS` in `visibility/redact.ts` — is already what decides that
 * `subject` is subject-tier. A hand-rolled list would be a fourth place to edit
 * when a field changes tier, and it would silently DISAGREE with the redactor
 * rather than fail.
 *
 * At `metadata` the redactor blanks `subject` to `''`, so the label degrades to
 * inbox + participants + message count. It must NEVER render an empty subject:
 * that is the copy case most likely to ship looking broken.
 */
export async function buildThreadSubjectLabel(
  organizationId: string,
  ctx: ThreadAuthorityContext,
  lens: Lens
): Promise<string> {
  const inboxName = ctx.inboxId
    ? ((await getOrgCache().get(organizationId, 'inboxes')).find((i) => i.id === ctx.inboxId)
        ?.name ?? 'Inbox')
    : 'Unassigned'

  // Only the fields this label reads are populated; every other `ThreadMeta` key
  // is irrelevant to the projection, which is key-wise. Running it through the real
  // redactor (rather than an `if (lens === 'metadata')` here) is what keeps the
  // tier decision in ONE place.
  const projected = redactThreadMeta(
    {
      id: ctx.threadId,
      subject: ctx.subject ?? '',
      messageCount: ctx.messageCount,
      participantCount: ctx.participantCount,
    } as unknown as ThreadMeta,
    lens
  )

  const summary = `${inboxName} · ${ctx.participantCount} participant${
    ctx.participantCount === 1 ? '' : 's'
  } · ${ctx.messageCount} message${ctx.messageCount === 1 ? '' : 's'}`

  const subject = projected.subject?.trim()
  return subject ? `${inboxName} · ${subject}` : summary
}

/**
 * Server-authoritative eligibility + approver display for the request trigger
 * (plan 42 §6.2/§6.3).
 *
 * Display names are a CACHE read (`getCachedMembersByUserIds`), never a `User`
 * join: the cached member shape already projects `{ id, name, image, email,
 * userType }`. Naming the approver is load-bearing — it is the difference between
 * "sent into the void" and "Sarah will see this" — and resolving Managers in the
 * client would be a second authority implementation free to drift.
 */
export async function preflightThreadAccessRequest(
  db: Database,
  organizationId: string,
  userId: string,
  threadId: string
): Promise<AccessRequestPreflight> {
  const empty = {
    approvers: [] as AccessRequestPreflight['approvers'],
    pending: null,
  }

  const ctx = await loadThreadAuthorityContext(db, organizationId, threadId)
  if (!ctx) {
    return { eligible: false, currentLens: 'none', refusalReason: 'target_unavailable', ...empty }
  }

  const vis = await getCachedUserMailVisibility(userId, organizationId)
  const currentLens = await threadLensFromContext(db, vis, ctx)

  const pendingRow = await findPendingThreadAccessRequest(db, organizationId, userId, threadId)
  const pending = pendingRow
    ? {
        id: pendingRow.id,
        createdAt: pendingRow.createdAt,
        remindedAt: (pendingRow.metadata as AccessRequestMetadata | null)?.remindedAt ?? null,
      }
    : null

  const approverResolution = await resolveThreadApprovers(db, organizationId, ctx)
  const members = await getCachedMembersByUserIds(organizationId, approverResolution.primaryUserIds)
  const approvers = members.map((m) => ({
    userId: m.userId,
    name: m.user?.name ?? null,
    image: m.user?.image ?? null,
  }))

  const refuse = (refusalReason: AccessRefusalReason): AccessRequestPreflight => ({
    eligible: false,
    currentLens,
    pending,
    approvers,
    refusalReason,
  })

  if (currentLens === 'full') return refuse('already_full')

  const frontDoor = await resolveThreadFrontDoor(organizationId, userId)
  if (!frontDoor.open) return refuse(frontDoor.reason)

  // A pending request is not a refusal — the UI swaps the trigger for a status
  // view (§6.4). Only a fresh deny blocks.
  if (!pending) {
    const cooldown = await findThreadDenyCooldown(db, organizationId, userId, threadId)
    if (cooldown) return refuse('deny_cooldown')
  }

  return { eligible: true, currentLens, pending, approvers, refusalReason: null }
}

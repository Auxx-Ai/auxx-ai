// packages/lib/src/approval-requests/record-access-request-queries.ts
//
// Reads for the RECORD access-request lane (plan v3/04).
//
// **No permission checks live here** (module guide §6). `resolveRecordFrontDoor`
// and `preflightRecordAccessRequest` REPORT eligibility — they are the server's
// answer to "would this ask be honourable?", which is data the UI renders and the
// creation path re-derives. The authorization asserts are in
// `record-access-request-mutations.ts`'s decision handler and in the router.
//
// ── Why this is not `access-request-queries.ts` with a `domain` flag ──
//
// Mail has a partial-visibility tier and records do not (§1). A thread held at
// `metadata` is *visible and redacted*; a record held at nothing is GONE —
// filtered out of `listFiltered` in SQL, absent from `getByIds`, rendered as a
// not-found page. Every mail authority function leans on that redaction
// vocabulary, and there is nothing here for them to lean on. The shared parts —
// the two `ApprovalRequest` reads and the expiry — live in
// `access-request-shared.ts`; the seam between the lanes is the target-kind
// dispatch in `applyAccessDecision`, not a switch inside each body (§3.1).

import { type Database, schema } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getCachedMembersByUserIds, getCachedResources, getOrgCache } from '../cache'
import { ForbiddenError } from '../errors'
import type { CapabilitySet } from '../permissions/capabilities/capability-set'
import { getCapabilities } from '../permissions/capabilities/get-capabilities'
import { isDeclaredInstanceDomain } from '../permissions/capabilities/instance-access'
import {
  recordAccessRankSql,
  resolveRecordVisibilityScope,
} from '../permissions/capabilities/record-visibility-scope'
import { RUNG_ORDER, satisfiesRung } from '../permissions/capabilities/rung'
import { isMailSharingDef } from '../resource-access/mail-sharing-defs'
import { assertRecordSharingFeature } from '../resource-access/record-sharing-guard'
import { findInstanceDenyCooldown, findPendingInstanceAccessRequest } from './access-request-shared'
import type { AccessRequestMetadata, RecordAccessRefusalReason } from './client'
import type {
  RecordAccessRequestApproverView,
  RecordAccessRequestPreflight,
  RecordApproverResolution,
  RecordAuthorityContext,
} from './types'

/**
 * The next rung an ask can be for, given what the requester holds today (D1).
 *
 * ```
 * none → read      read → edit      edit → (nothing)      admin → (nothing)
 * ```
 *
 * 🔴 **`admin` is absent from the RANGE on purpose, and `none` from both sides.**
 * `admin` is sharing authority; a request lane that can produce it lets a member
 * bootstrap themselves into re-sharing a row their grantor scoped to one person.
 * `none` is the RESTRICTION marker, never a grant — this lane must never write
 * one (Invariant #6, the most repeated fail-open shape in this codebase's
 * history).
 *
 * `metadata` / `identity` are absent because `RECORD_DEF_RUNGS` does not declare
 * them; a record row carrying one is a data bug, and mapping it to `undefined`
 * is how that bug stays inert rather than becoming an escalation.
 */
const NEXT_RUNG: Partial<Record<Rung, Rung>> = { none: 'read', read: 'edit' }

/** {@link NEXT_RUNG} as a function. `null` ⇒ there is nothing left to ask for. */
export function nextRecordRung(current: Rung): Rung | null {
  return NEXT_RUNG[current] ?? null
}

/**
 * Whether a definition belongs to the RECORD request lane — Invariant #4's
 * predicate, verbatim (§3.3).
 *
 * ```ts
 * !isDeclaredInstanceDomain(defId) && !isMailSharingDef(defId)
 * ```
 *
 * 🔴 **Both exclusions are required and neither is sufficient.**
 * `!isInstanceAccessKey(defId)` alone reads `true` for `thread` and `sequence`,
 * which puts mail threads into the record front door; the mail registry alone
 * misses `dataset` / `kb` / `dashboard`. Getting this wrong here is worse than on
 * a read path, because this lane WRITES a row.
 *
 * 🔴 **Contacts must refuse, and this is what refuses them.** A record-level
 * contact grant canonicalizes into the MAIL keyspace and fans a full lens across
 * that contact's entire conversation history (Invariant #7). `isMailSharingDef`
 * covers `contact`, so the second clause is what stands between this lane and
 * that fan-out — it is pinned by its own named test rather than left to the
 * predicate's transitive correctness.
 */
export function isRecordRequestDef(entityDefinitionId: string): boolean {
  return !isDeclaredInstanceDomain(entityDefinitionId) && !isMailSharingDef(entityDefinitionId)
}

/**
 * Load the org-scoped record facts every record-lane read needs, ONCE.
 *
 * Two things happen here and both matter:
 *
 * 1. **The def key is CANONICALIZED** through the `resources` cache. Callers hand
 *    in a slug, an apiSlug or a CUID; `ResourceAccess`, `defAccess` and
 *    `grantedDefIds` are all keyed on `EntityDefinition.id`, so a request row
 *    persisted under the wrong one would be a grant nothing reads — the exact
 *    keyspace hazard #1388 fixed for mail.
 * 2. **The instance is read org-scoped**, projecting only `displayName`. That is
 *    a denormalized column (`entity-instance.ts`), so the label costs one row and
 *    no field-value resolution — deliberately NOT `UnifiedCrudHandler.getByIds`,
 *    which would drag the dataset/connector service graph in behind it.
 *
 * Returns `null` for a nonexistent OR cross-org id, so the refusal falls out of
 * the load the label needs anyway rather than needing a separate existence probe.
 * A def outside the record lane also returns `null`: a caller must not be able to
 * name a thread here and have it treated as a record.
 */
export async function loadRecordAuthorityContext(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  entityInstanceId: string
): Promise<RecordAuthorityContext | null> {
  if (!isRecordRequestDef(entityDefinitionId)) return null

  const resources = await getCachedResources(organizationId)
  const resource = resources.find(
    (r) =>
      r.id === entityDefinitionId ||
      r.entityDefinitionId === entityDefinitionId ||
      r.entityType === entityDefinitionId ||
      r.apiSlug === entityDefinitionId
  )
  const defId = resource?.entityDefinitionId ?? resource?.id ?? entityDefinitionId
  // Re-checked on the RESOLVED id: a caller could name a mail def by apiSlug and
  // land on a canonical id the first check never saw.
  if (!isRecordRequestDef(defId)) return null

  const [instance] = await db
    .select({
      id: schema.EntityInstance.id,
      entityDefinitionId: schema.EntityInstance.entityDefinitionId,
      displayName: schema.EntityInstance.displayName,
    })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, entityInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!instance) return null

  return {
    entityDefinitionId: instance.entityDefinitionId ?? defId,
    entityInstanceId: instance.id,
    defLabel: resource?.label ?? 'Record',
    displayName: instance.displayName ?? null,
  }
}

/**
 * The requester's ROW-EFFECTIVE rung on one record — `_access`, computed the
 * same way every other read path computes it.
 *
 * **This is `assertCanManageRecordSharing`'s query shape, copied deliberately
 * rather than re-invented** (§3.2): the §5.1 visibility predicate in the `WHERE`,
 * the grantee-union `max(rung)` aggregate in the projection, one query. A second
 * shape for the same question is how the two answers start disagreeing.
 *
 * `recordAccessAt` takes the RANK (`number | null`), not a rung — the fold and
 * the seat ceiling both live inside it, so nothing here re-derives either.
 *
 * A row the visibility predicate hides comes back empty, which reads as rank
 * `null` and folds to the def rung alone. For a member the def is also invisible
 * to, that is `'none'` — the fail-closed direction and the same non-enumeration
 * answer `getById` gives.
 */
export async function recordRungFor(
  db: Database,
  organizationId: string,
  userId: string,
  capabilities: CapabilitySet,
  ctx: RecordAuthorityContext
): Promise<Rung> {
  const scope = await resolveRecordVisibilityScope({
    organizationId,
    userId,
    entityDefinitionId: ctx.entityDefinitionId,
    capabilities,
  })
  // Arm 4 — the member can reach no row of this def at all. Answer without querying.
  if (scope.arm === 'none') return capabilities.recordAccessAt(ctx.entityDefinitionId, null)

  const rows = await db
    .select({
      grantRank: recordAccessRankSql({
        organizationId,
        entityDefinitionId: ctx.entityDefinitionId,
        grantees: scope.grantees,
      }),
    })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, ctx.entityInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId),
        scope.where
      )
    )
    .limit(1)

  return capabilities.recordAccessAt(ctx.entityDefinitionId, rows[0]?.grantRank ?? null)
}

/**
 * Whether the requester's SEAT can hold a record grant at all (§4).
 *
 * `WORKER_AREAS` is `{recordsLinked, dispatchMySchedule, dispatchVisitReports}` —
 * `Area.records` is absent — and the seat ceiling clamps LAST, so
 * `recordAccessAt` returns `'none'` unconditionally for a worker seat, checked
 * ABOVE any row branch. No permission change and no share lifts it. Name the
 * SEAT, not the profile.
 *
 * ⚠ The probe is `recordAccessAt(def, RUNG_ORDER.admin)` — "what would even a
 * MAXIMAL grant on this row produce?" — deliberately rather than importing
 * `SEAT_CEILINGS` and re-deriving the clamp here. `foldRecordAccess` can only
 * ever return `admin` for that rank, so the single way this answers `'none'` is
 * the ceiling itself: one source of truth, read through the real implementation.
 *
 * **There is no `front_door_closed` twin.** A record grant at `read` or better
 * populates `grantedDefIds` itself, which is what `RecordRouteGuard` gates on, so
 * unlike a thread grant there is no separate key to be missing (§4).
 */
export function resolveRecordFrontDoor(
  capabilities: CapabilitySet,
  entityDefinitionId: string
): { open: true } | { open: false; reason: Extract<RecordAccessRefusalReason, 'worker_seat'> } {
  if (capabilities.recordAccessAt(entityDefinitionId, RUNG_ORDER.admin) === 'none') {
    return { open: false, reason: 'worker_seat' }
  }
  return { open: true }
}

/**
 * Who may decide a record access request — org ADMIN + OWNER (D3).
 *
 * That is the whole resolver: `resolveThreadApprovers` with rule 1 deleted. Mail
 * NEEDS its rule 1 because threads essentially never carry `admin` rows, so the
 * real authority lives on the inbox and had to be resolved from it. Records have
 * no such indirection — the org-admin fallback is already an authority on every
 * row — so rule 1 would buy nothing structural and only change who gets notified.
 * Deleting it removes a `ResourceAccess` query and the grantee-expansion loop
 * from every preflight, and makes the empty-approver assertion unreachable (an
 * org always has an owner).
 *
 * Agent / system principals are dropped (`userType === 'USER'`): a synthetic user
 * cannot decide anything.
 *
 * ⚠ **Two authorized groups are deliberately NOT snapshotted. Do not "fix" this.**
 *
 * 1. **Row-`admin` holders** — the person explicitly given sharing rights over
 *    this exact record, i.e. the one most likely to have context. Under D3 they
 *    are not notified and, because `canUserApprove` reads `assigneeUsers`, cannot
 *    decide the request even if they see it. That is the stated cost of D3.
 * 2. **Def-`Edit` members** — anyone with `canEditEntity(def)` may share the row
 *    (§10.1), so on a def where a hundred members hold Edit, snapshotting them
 *    would put every record request in every editor's approvals tab.
 *
 * Neither exclusion is a security problem: `assigneeUsers` is an
 * audience/history snapshot, NEVER an authorization token, and the decision
 * handler revalidates live authority regardless.
 */
export async function resolveRecordApprovers(
  organizationId: string
): Promise<RecordApproverResolution> {
  const roleMap = await getOrgCache().get(organizationId, 'memberRoleMap')
  const userIds = Object.entries(roleMap)
    .filter(([, e]) => e.userType === 'USER' && (e.role === 'ADMIN' || e.role === 'OWNER'))
    .map(([userId]) => userId)
  return { userIds }
}

/**
 * The durable display label for a record access request (§6).
 *
 * ```
 * rung >= read  →  "Ticket · ACME onboarding"
 * rung === none →  "Ticket"
 * ```
 *
 * 🔴 **The `none` case is the def noun ALONE, and that is not a cosmetic
 * choice.** Mail's `buildThreadSubjectLabel` can degrade to inbox + participant
 * count + message count because a thread has a `metadata` tier to project from.
 * A record has no tier below `read`, so there is nothing requester-safe to say
 * about a record they cannot see except what KIND of thing it is. Rendering the
 * display name here would turn mount 4's accepted existence oracle (§9) into a
 * content leak, which is not what was accepted.
 *
 * 🔴 **Never compose this in the client.** `subjectLabel` is `NOT NULL` and is
 * the only thing a DENIED requester ever sees of what they asked for; a client
 * holding the row in its store would happily render a display name the server
 * withheld.
 */
export function buildRecordSubjectLabel(ctx: RecordAuthorityContext, rung: Rung): string {
  const displayName = ctx.displayName?.trim()
  if (satisfiesRung(rung, 'read') && displayName) return `${ctx.defLabel} · ${displayName}`
  return ctx.defLabel
}

/**
 * Server-authoritative eligibility + approver display for the record request
 * trigger (§7).
 *
 * **Ordered cheapest-refusal-first**, as mail is: pending state and the deny
 * cooldown are a query each and NO refusal renders either. D3 already removed
 * the expensive half — approver resolution is a `memberRoleMap` cache read now —
 * so it can ride along on any path.
 *
 * ⚠ `already_at_ceiling` IS the "could they just grant it to themselves?" test
 * (§4). It is not a separate check because it cannot be: `canEditEntity(def)`
 * means the def rung reaches `edit`, and a row-`admin` holder is at `admin`, so
 * both land above the ceiling by construction. Adding the client's
 * `satisfiesRung(access, 'admin')` here instead would render a Request button for
 * a def-Edit member who can already share the row (§10.3).
 */
export async function preflightRecordAccessRequest(
  db: Database,
  organizationId: string,
  userId: string,
  entityDefinitionId: string,
  entityInstanceId: string
): Promise<RecordAccessRequestPreflight> {
  const empty = {
    approvers: [] as RecordAccessRequestPreflight['approvers'],
    requestedRung: null,
    subjectLabel: null,
    pending: null,
  }

  const ctx = await loadRecordAuthorityContext(
    db,
    organizationId,
    entityDefinitionId,
    entityInstanceId
  )
  if (!ctx) {
    // Covers three cases on purpose — a deleted row, a cross-org row, and a def
    // this lane does not own (a thread, a dataset, a contact). All three are
    // "there is nothing here for you to ask about", and distinguishing them in
    // the response would be the existence oracle §9 bounds, unbounded.
    return { ...empty, eligible: false, currentRung: 'none', refusalReason: 'target_unavailable' }
  }

  const capabilities = await getCapabilities(userId, organizationId)
  const currentRung = await recordRungFor(db, organizationId, userId, capabilities, ctx)
  const subjectLabel = buildRecordSubjectLabel(ctx, currentRung)
  const refuseEarly = (refusalReason: RecordAccessRefusalReason): RecordAccessRequestPreflight => ({
    ...empty,
    eligible: false,
    currentRung,
    subjectLabel,
    refusalReason,
  })

  const frontDoor = resolveRecordFrontDoor(capabilities, ctx.entityDefinitionId)
  if (!frontDoor.open) return refuseEarly(frontDoor.reason)

  const requestedRung = nextRecordRung(currentRung)
  if (!requestedRung) return refuseEarly('already_at_ceiling')

  // §3.5 — refuse at PREFLIGHT as well as at the gate, so the trigger never
  // renders on an org that could not honour an approval.
  const recordId = toRecordId(ctx.entityDefinitionId, ctx.entityInstanceId)
  const planned = await recordSharingFeatureAllowed(db, organizationId, recordId)
  if (!planned) return refuseEarly('plan_gated')

  const approverResolution = await resolveRecordApprovers(organizationId)
  const members = await getCachedMembersByUserIds(organizationId, approverResolution.userIds)
  const pendingRow = await findPendingInstanceAccessRequest(
    db,
    organizationId,
    userId,
    ctx.entityDefinitionId,
    ctx.entityInstanceId
  )
  const pending = pendingRow
    ? {
        id: pendingRow.id,
        createdAt: pendingRow.createdAt,
        remindedAt: (pendingRow.metadata as AccessRequestMetadata | null)?.remindedAt ?? null,
      }
    : null

  const base = {
    currentRung,
    requestedRung,
    pending,
    subjectLabel,
    approvers: members.map((m) => ({
      userId: m.userId,
      name: m.user?.name ?? null,
      image: m.user?.image ?? null,
    })),
  }

  // A pending request is not a refusal — the UI swaps the trigger for a status
  // view. Only a fresh deny blocks.
  if (!pending) {
    const cooldown = await findInstanceDenyCooldown(
      db,
      organizationId,
      userId,
      ctx.entityDefinitionId,
      ctx.entityInstanceId
    )
    if (cooldown) return { eligible: false, ...base, refusalReason: 'deny_cooldown' }
  }

  return { eligible: true, ...base, refusalReason: null }
}

/**
 * The plan gate as a BOOLEAN, for the presentation half of §3.5.
 *
 * Deliberately a thin `try`/`catch` over the same `assertRecordSharingFeature`
 * the decision handler throws through, rather than a second `hasAccess` call
 * shaped like it: two plan reads that must never disagree is precisely what §3.5
 * exists to stop, and a preflight that says "eligible" while the gate would
 * refuse is a Send button that 403s.
 */
async function recordSharingFeatureAllowed(
  db: Database,
  organizationId: string,
  recordId: ReturnType<typeof toRecordId>
): Promise<boolean> {
  try {
    await assertRecordSharingFeature({ db, organizationId }, recordId)
    return true
  } catch (error) {
    // ONLY the gate's own 403 becomes a refusal. A cache/Redis failure must not
    // be reported to the user as "your plan does not include this" — that is a
    // wrong answer wearing a confident label, and it would send them to billing
    // over an outage.
    if (error instanceof ForbiddenError) return false
    throw error
  }
}

/**
 * What ONE approver sees of a record access request (§6) — the hydration-gated
 * half of the decision row.
 *
 * **Live wins only when THIS approver can read the record; the snapshot is the
 * fallback.** Under D3 requests route to org admins, who may hold nothing at all
 * on the def — so the label follows the ACTING approver's own row-effective rung,
 * and when it does not reach `read` the row renders the durable snapshot, which
 * was itself built from the REQUESTER's view and therefore cannot leak anything
 * the requester could not already see.
 *
 * Returns `null` for anything that is not a record access request, so the caller
 * falls back to the generic approval details rather than rendering record copy
 * over a workflow row.
 */
export async function getRecordAccessRequestApproverView(
  db: Database,
  organizationId: string,
  approverUserId: string,
  approvalRequestId: string
): Promise<RecordAccessRequestApproverView | null> {
  const request = await db.query.ApprovalRequest.findFirst({
    where: and(
      eq(schema.ApprovalRequest.id, approvalRequestId),
      eq(schema.ApprovalRequest.organizationId, organizationId),
      eq(schema.ApprovalRequest.kind, 'access')
    ),
  })
  if (
    !request ||
    request.targetKind !== 'instance' ||
    !request.entityDefinitionId ||
    !request.entityInstanceId ||
    !request.requesterId ||
    // The thread lane writes the literal slug `'thread'` and never a CUID (plan
    // 42 §2.3), so this predicate is what keeps the two approver views from
    // rendering each other's rows.
    !isRecordRequestDef(request.entityDefinitionId)
  ) {
    return null
  }

  const [member] = await getCachedMembersByUserIds(organizationId, [request.requesterId])
  const requester = member
    ? { userId: member.userId, name: member.user?.name ?? null, image: member.user?.image ?? null }
    : null
  const remindCount = (request.metadata as AccessRequestMetadata | null)?.remindCount ?? 0
  // `requestedLens` holds a `Rung` — the column NAME is a historical residual
  // (§2.2). Reaching for `LENS_LABELS` with this value yields `undefined`.
  const requestedRung = (request.requestedLens as Rung | null) ?? null

  const ctx = await loadRecordAuthorityContext(
    db,
    organizationId,
    request.entityDefinitionId,
    request.entityInstanceId
  )
  if (!ctx) {
    // Deleted or cross-org. The snapshot is the only thing left that says what
    // was asked for, and `targetAvailable: false` is what stops the row offering
    // an Approve the decision handler will refuse.
    return {
      requester,
      label: request.subjectLabel,
      hydrated: false,
      approverRung: 'none',
      requesterRung: 'none',
      requestedRung,
      targetAvailable: false,
      remindCount,
    }
  }

  const approverCaps = await getCapabilities(approverUserId, organizationId)
  const approverRung = await recordRungFor(db, organizationId, approverUserId, approverCaps, ctx)
  const requesterCaps = await getCapabilities(request.requesterId, organizationId)
  const requesterRung = await recordRungFor(
    db,
    organizationId,
    request.requesterId,
    requesterCaps,
    ctx
  )

  const hydrated = satisfiesRung(approverRung, 'read')
  return {
    requester,
    label: hydrated ? buildRecordSubjectLabel(ctx, approverRung) : request.subjectLabel,
    hydrated,
    approverRung,
    requesterRung,
    requestedRung,
    targetAvailable: true,
    remindCount,
  }
}

// packages/lib/src/approval-requests/access-request-shared.ts
//
// The parts of the INSTANCE access-request lane that are provably identical
// across domains (plan v3/04 §3.1).
//
// **Only what is genuinely shared lives here.** The thread lane's
// `resolveThreadApprovers`, `buildThreadSubjectLabel`, `resolveThreadFrontDoor`
// and `threadLensFromContext` are mail AUTHORITY and deliberately stay put:
// unifying them behind a `domain` parameter produces a function with a `switch`
// in every branch, i.e. two implementations wearing one name. The seam between
// the lanes is the target-kind dispatch in `applyAccessDecision`, not the bodies
// (§3.1).
//
// What IS shared is everything keyed on `(org, requester, entityDefinitionId,
// entityInstanceId)` and nothing else — the two `ApprovalRequest` reads and the
// expiry arithmetic. Those were written for threads with `entityDefinitionId`
// hardcoded to the literal `'thread'`; taking the pair as arguments is the whole
// generalization.
//
// **No permission checks live here** (module guide §6). These are reads.

import { type Database, schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'
import {
  ACCESS_DENY_COOLDOWN_DAYS,
  ACCESS_REQUEST_EXPIRY_DAYS,
  type AccessRequestMetadata,
} from './client'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The existing pending `access` request for one `(requester, instance target)`,
 * if any.
 *
 * Served by `ApprovalRequest_access_instance_pending_key`, the partial unique
 * index on `(organizationId, requesterId, entityDefinitionId,
 * entityInstanceId)` — which is also what makes a concurrent duplicate create an
 * empty `ON CONFLICT DO NOTHING` rather than a leaked unique violation.
 *
 * ⚠ The index deliberately EXCLUDES the requested rung
 * (`approval-request.ts`'s note). That matters more for the record lane than for
 * mail: with the derived next rung (§3.2) a `read → edit` ask following a
 * `none → read` ask is genuinely a different rung, and without the exclusion the
 * second one would insert a second pending row instead of upgrading the first.
 */
export async function findPendingInstanceAccessRequest(
  db: Database,
  organizationId: string,
  requesterId: string,
  entityDefinitionId: string,
  entityInstanceId: string
) {
  return db.query.ApprovalRequest.findFirst({
    where: and(
      eq(schema.ApprovalRequest.organizationId, organizationId),
      eq(schema.ApprovalRequest.kind, 'access'),
      eq(schema.ApprovalRequest.status, 'pending'),
      eq(schema.ApprovalRequest.requesterId, requesterId),
      eq(schema.ApprovalRequest.targetKind, 'instance'),
      eq(schema.ApprovalRequest.entityDefinitionId, entityDefinitionId),
      eq(schema.ApprovalRequest.entityInstanceId, entityInstanceId)
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
 *
 * **`ORDER BY createdAt DESC LIMIT 1`, served by
 * `ApprovalRequest_access_instance_denied_idx`.** This previously selected EVERY
 * historical denial for the (requester, target) pair and reduced them in JS,
 * against no usable index — so a target denied repeatedly re-read the whole
 * history on every trigger render.
 *
 * Taking the newest-CREATED row is sound even though the window is measured from
 * `deniedAt`, because the pending unique index serializes the lifecycle: a second
 * request for one target cannot be created while the first is still pending, so a
 * later-created denial was necessarily decided later too.
 *
 * There is deliberately NO `createdAt >= now() - cooldown` predicate. It looks
 * like a free narrowing and is wrong: `deniedAt` can trail `createdAt` by the
 * request's whole 14-day life, so a row created 30 days ago may have been denied
 * yesterday and still be inside a 7-day cooldown. The index ordering is what
 * bounds this read; a date filter on the wrong column would silently drop live
 * cooldowns.
 */
export async function findInstanceDenyCooldown(
  db: Database,
  organizationId: string,
  requesterId: string,
  entityDefinitionId: string,
  entityInstanceId: string
): Promise<{ until: Date } | null> {
  const [row] = await db
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
        eq(schema.ApprovalRequest.entityDefinitionId, entityDefinitionId),
        eq(schema.ApprovalRequest.entityInstanceId, entityInstanceId)
      )
    )
    .orderBy(desc(schema.ApprovalRequest.createdAt))
    .limit(1)
  if (!row) return null

  const deniedAtRaw = (row.metadata as AccessRequestMetadata | null)?.deniedAt
  const latest = deniedAtRaw ? new Date(deniedAtRaw) : row.createdAt
  const until = new Date(latest.getTime() + ACCESS_DENY_COOLDOWN_DAYS * DAY_MS)
  return until > new Date() ? { until } : null
}

/**
 * When a freshly filed (or re-raised) access request stops being live.
 *
 * **Always set, on every lane.** Required by plan 28 H2 and swept by
 * `cleanupExpiredApprovals` — access requests get no scheduled timeout job (H7),
 * whose payload resumes a workflow. Shared rather than re-spelled per lane so a
 * second lane cannot quietly ship a different lifetime.
 */
export function accessRequestExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + ACCESS_REQUEST_EXPIRY_DAYS * DAY_MS)
}

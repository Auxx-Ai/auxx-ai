// packages/lib/src/jobs/approvals/learned-run-principal.ts

import { type Database, schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'
import { getCachedMembers } from '../../cache/org-cache-helpers'

/**
 * Who a learned-KB extraction runs as, and whose Today feed receives its
 * proposal. The two are deliberately different questions — see
 * {@link resolveLearnedRunPrincipal}.
 */
export interface LearnedRunPrincipal {
  /** Human member the capture run binds its capabilities to. Always a real member. */
  runAsUserId: string
  /**
   * Bundle owner. `null` = unassigned, which in the Today feed means "visible
   * to every member" — the right answer when no specific human owns the thread.
   */
  ownerUserId: string | null
}

interface ResolveParams {
  db: Database
  organizationId: string
  threadId: string
  /** Thread assignee, which may be an AI-agent pseudo-user. */
  assigneeId: string | null
  /** Set for forced runs — the member who clicked "Remember this thread". */
  requestedByUserId?: string
}

/**
 * Resolve the human principal a learned extraction runs as.
 *
 * Capture-mode runs bind their capabilities to a human member
 * (`resolveCaptureRunPrincipal`, doc 19 §2.3) and refuse to run at all for a
 * non-member — and `Organization.systemUserId` is deliberately NOT a member.
 * So a chain that fell back to the system user produced a permanent, silent
 * no-op for every thread nobody happened to be assigned to, which in practice
 * is nearly all of them.
 *
 * Order, first ACTIVE human member wins:
 *
 * 1. the member who explicitly asked ("Remember this thread"),
 * 2. the thread's assignee (skipped when it's an agent pseudo-user),
 * 3. whoever sent the last outbound message on the thread,
 * 4. the org's owner (else an admin) — the standing principal for memory that
 *    belongs to the org rather than to a person.
 *
 * `ownerUserId` only follows 1–3: a bundle produced under the org fallback has
 * no personal owner, so it stays unassigned and every member sees it.
 *
 * Returns `null` when the org has no ACTIVE human member at all, which the job
 * treats as a skip — NOT as a reason to stamp the thread.
 *
 * Running under an owner/admin view is safe here because the extractor's
 * registry is three capabilities wide (knowledge search, KB read, and the
 * approval-gated learned write door), so the widened view is KB and dataset
 * reads, and every write it proposes still faces a human approval card.
 */
export async function resolveLearnedRunPrincipal(
  params: ResolveParams
): Promise<LearnedRunPrincipal | null> {
  const { db, organizationId, threadId, assigneeId, requestedByUserId } = params
  const members = await getCachedMembers(organizationId)
  const isHuman = (userId: string | null | undefined): boolean => {
    if (!userId) return false
    const member = members.find((m) => m.userId === userId)
    return member?.status === 'ACTIVE' && member.user?.userType === 'USER'
  }

  if (isHuman(requestedByUserId)) {
    return { runAsUserId: requestedByUserId as string, ownerUserId: requestedByUserId as string }
  }
  if (isHuman(assigneeId)) {
    return { runAsUserId: assigneeId as string, ownerUserId: assigneeId as string }
  }

  const lastOutboundAuthorId = await findLastOutboundAuthorId(db, organizationId, threadId)
  if (isHuman(lastOutboundAuthorId)) {
    return {
      runAsUserId: lastOutboundAuthorId as string,
      ownerUserId: lastOutboundAuthorId as string,
    }
  }

  // Org fallback. Sorted by userId purely for stability across runs — it is a
  // deterministic pick, not a meaningful ordering.
  const humanMembers = members
    .filter((m) => m.status === 'ACTIVE' && m.user?.userType === 'USER')
    .sort((a, b) => a.userId.localeCompare(b.userId))
  const orgPrincipal =
    humanMembers.find((m) => m.role === 'OWNER') ?? humanMembers.find((m) => m.role === 'ADMIN')
  if (orgPrincipal) return { runAsUserId: orgPrincipal.userId, ownerUserId: null }

  return null
}

/**
 * The `User` behind the most recent outbound message. Null for provider-synced
 * sends (someone replied from Gmail), which simply falls through to the org
 * principal.
 */
async function findLastOutboundAuthorId(
  db: Database,
  organizationId: string,
  threadId: string
): Promise<string | null> {
  const [row] = await db
    .select({ createdById: schema.Message.createdById })
    .from(schema.Message)
    .where(
      and(
        eq(schema.Message.threadId, threadId),
        eq(schema.Message.organizationId, organizationId),
        eq(schema.Message.isInbound, false)
      )
    )
    .orderBy(desc(schema.Message.sentAt))
    .limit(1)
  return row?.createdById ?? null
}

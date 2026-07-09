// packages/lib/src/jobs/messages/thread-provider-status-sync-job.ts

import { database as db, schema } from '@auxx/database'
import { ThreadStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { getOrgChannelProviderMap } from '../../channels/cache'
import type { ChannelProvider } from '../../providers/channel-provider.interface'
import { MessageStatus } from '../../providers/channel-provider.interface'
import type { MessageProvider } from '../../providers/message-provider-interface'
import { ChannelProviderType } from '../../providers/types'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:thread-provider-status-sync')

/** Max threads per job — keeps jobs retry-sized; the enqueue hooks chunk at this. */
export const THREAD_STATUS_SYNC_CHUNK_SIZE = 100

/** ChannelProvider that may implement the optional thread label ops. */
type ThreadOpsProvider = ChannelProvider &
  Pick<MessageProvider, 'archiveThread' | 'unarchiveThread' | 'markThreadAsSpam'>

export interface ThreadProviderStatusSyncJobData {
  organizationId: string
  /** One job per integration — one token/throttler. */
  integrationId: string
  /** OUR thread ids (not provider ids), ≤ {@link THREAD_STATUS_SYNC_CHUNK_SIZE}. */
  threadIds: string[]
  /** What to reconcile: thread status (default) or the inbox owner's read state. */
  kind?: 'status' | 'read'
}

/**
 * Enqueue a Gmail push for a set of personal-channel threads.
 * The small delay lets a rapid flip settle before the handler reads CURRENT
 * state; duplicate jobs push the same final state and are harmless (just
 * quota-wasteful). Deliberately NO deterministic jobId: BullMQ silently drops
 * an add whose jobId matches a still-active job, which would lose the newest
 * flip — convergence beats dedupe here.
 */
export async function enqueueThreadProviderStatusSync(
  data: ThreadProviderStatusSyncJobData
): Promise<void> {
  const queue = getQueue(Queues.messageSyncQueue)
  await queue.add('threadProviderStatusSyncJob', data, { delay: 2000 })
}

/**
 * Filter to personal-Gmail threads and enqueue reconcile jobs, grouped per
 * integration and chunked. Shared by the status hook (ThreadMutationService)
 * and the read-state hook (UnreadService) — callers apply their own origin /
 * no-op guards first. `requireOwnerUserId` additionally restricts to inboxes
 * owned by that user (read state mirrors only the mailbox owner's).
 */
export async function enqueueProviderSyncForEligibleThreads(args: {
  organizationId: string
  threads: { threadId: string; integrationId: string | null; inboxId: string | null }[]
  kind: 'status' | 'read'
  requireOwnerUserId?: string
}): Promise<void> {
  const { organizationId, threads, kind, requireOwnerUserId } = args
  if (threads.length === 0) return

  const [inboxes, providerMap] = await Promise.all([
    getOrgCache().get(organizationId, 'inboxes'),
    getOrgChannelProviderMap(organizationId, db),
  ])
  const inboxById = new Map(inboxes.map((i) => [i.id, i]))

  const threadIdsByIntegration = new Map<string, string[]>()
  for (const t of threads) {
    if (!t.integrationId || !t.inboxId) continue
    const inbox = inboxById.get(t.inboxId)
    if (!inbox?.isPersonal) continue
    if (requireOwnerUserId && inbox.ownerUserId !== requireOwnerUserId) continue
    if (providerMap.get(t.integrationId) !== ChannelProviderType.google) continue
    const ids = threadIdsByIntegration.get(t.integrationId) ?? []
    ids.push(t.threadId)
    threadIdsByIntegration.set(t.integrationId, ids)
  }

  for (const [integrationId, threadIds] of threadIdsByIntegration) {
    for (let i = 0; i < threadIds.length; i += THREAD_STATUS_SYNC_CHUNK_SIZE) {
      await enqueueThreadProviderStatusSync({
        organizationId,
        integrationId,
        threadIds: threadIds.slice(i, i + THREAD_STATUS_SYNC_CHUNK_SIZE),
        kind,
      })
    }
  }
}

/**
 * Rate-limit / circuit-breaker errors re-thrown typed by the throttler stack.
 * Checked by name to avoid importing the rate-limiter barrel here.
 */
function isThrottleError(error: unknown): boolean {
  const name = (error as Error)?.name
  return name === 'RateLimitError' || name === 'CircuitBreakerError'
}

function errorStatus(error: any): number | undefined {
  const status = error?.status ?? error?.response?.status ?? error?.code
  return typeof status === 'number' ? status : undefined
}

function isAuthError(error: any): boolean {
  const message = String(error?.message ?? '')
  return (
    errorStatus(error) === 401 ||
    message.includes('invalid_grant') ||
    message.includes('unauthorized') ||
    error?.response?.data?.error === 'invalid_grant'
  )
}

/**
 * Per-thread push failure taxonomy: 404 = thread gone in Gmail, skip; auth =
 * terminal for the whole job (channel-health surfaces re-auth — do NOT hammer
 * a dead token with retries); rate-limit / 5xx = THROWN so BullMQ retries;
 * anything else = skip and continue.
 */
function classifyPushError(
  error: unknown,
  ctx: { organizationId: string; integrationId: string; threadId: string }
): 'skip' | 'abort' {
  if (isThrottleError(error)) throw error
  const status = errorStatus(error)
  if (status === 404) {
    logger.debug('Thread gone in Gmail — skipping push', ctx)
    return 'skip'
  }
  if (isAuthError(error)) {
    // Remaining threads stay unpushed — they reconcile on their next change
    // once the channel is re-authed.
    logger.warn('Auth error during provider push — aborting job (no retry)', {
      ...ctx,
      error: (error as Error).message,
    })
    return 'abort'
  }
  if (status === 429 || (status !== undefined && status >= 500)) throw error
  logger.warn('Failed to push thread state to provider', {
    ...ctx,
    status,
    error: (error as Error).message,
  })
  return 'skip'
}

/**
 * Push Auxx thread state to Gmail for personal channels. `kind: 'status'`
 * (default): Done/Trash → remove INBOX, Open → add INBOX + clear SPAM/TRASH,
 * Spam → add SPAM. Trash is archive-on-trash by design — we never call
 * threads.trash, so Gmail never purges because of us. `kind: 'read'`: mirror
 * the inbox owner's read state onto the thread-level UNREAD label.
 *
 * Reconciles to CURRENT state (thread status / owner's read row) rather than
 * replaying the transition that enqueued it — ordering and retries are
 * therefore trivially safe. See
 * plans/mail/inbox/bidirectional-status-sync-impl-plan.md.
 */
export const threadProviderStatusSyncJob = async (
  ctx: JobContext<ThreadProviderStatusSyncJobData>
): Promise<{ pushed: number; skipped: number; failed: number }> => {
  const { organizationId, integrationId, threadIds, kind = 'status' } = ctx.job.data

  const rows = await db
    .select({
      id: schema.Thread.id,
      status: schema.Thread.status,
      externalId: schema.Thread.externalId,
      inboxId: schema.Thread.inboxId,
    })
    .from(schema.Thread)
    .where(
      and(
        eq(schema.Thread.organizationId, organizationId),
        eq(schema.Thread.integrationId, integrationId),
        inArray(schema.Thread.id, threadIds)
      )
    )

  // Re-check eligibility against current state — inbox may have been
  // re-routed or converted since enqueue.
  const inboxes = await getOrgCache().get(organizationId, 'inboxes')
  const inboxById = new Map(inboxes.map((i) => [i.id, i]))
  const eligible = rows.filter(
    (r) => !!r.externalId && !!r.inboxId && (inboxById.get(r.inboxId)?.isPersonal ?? false)
  )

  let pushed = 0
  let skipped = threadIds.length - eligible.length
  let failed = 0

  if (eligible.length === 0) {
    return { pushed, skipped, failed }
  }

  // Lazy import: keeps the provider chain (googleapis) out of the module
  // graph for callers that only need the enqueue helpers.
  const { ProviderRegistryService } = await import('../../providers/provider-registry-service')
  let provider: ThreadOpsProvider
  try {
    provider = (await new ProviderRegistryService(organizationId).getProvider(
      integrationId
    )) as ThreadOpsProvider
  } catch (error) {
    // Re-auth required / integration gone — terminal; channel-health handles surfacing.
    logger.warn('Provider unavailable for status push — skipping job', {
      organizationId,
      integrationId,
      threadCount: eligible.length,
      error: (error as Error).message,
    })
    return { pushed, skipped: skipped + eligible.length, failed }
  }

  if (kind === 'read') {
    // Owner's read state per thread — absent row = unread (same semantics as
    // the unread counts).
    const withOwner = eligible.flatMap((r) => {
      const ownerUserId = inboxById.get(r.inboxId!)?.ownerUserId ?? null
      return ownerUserId ? [{ ...r, ownerUserId }] : []
    })
    skipped += eligible.length - withOwner.length
    if (withOwner.length === 0) return { pushed, skipped, failed }

    const readRows = await db
      .select({
        threadId: schema.ThreadReadStatus.threadId,
        userId: schema.ThreadReadStatus.userId,
        isRead: schema.ThreadReadStatus.isRead,
      })
      .from(schema.ThreadReadStatus)
      .where(
        and(
          inArray(
            schema.ThreadReadStatus.threadId,
            withOwner.map((r) => r.id)
          ),
          inArray(schema.ThreadReadStatus.userId, [...new Set(withOwner.map((r) => r.ownerUserId))])
        )
      )
    const readByThreadUser = new Map(readRows.map((r) => [`${r.threadId}:${r.userId}`, r.isRead]))

    for (const thread of withOwner) {
      const isRead = readByThreadUser.get(`${thread.id}:${thread.ownerUserId}`) === true
      try {
        await provider.updateThreadStatus(
          thread.externalId!,
          isRead ? MessageStatus.READ : MessageStatus.UNREAD
        )
        pushed++
      } catch (error) {
        const outcome = classifyPushError(error, {
          organizationId,
          integrationId,
          threadId: thread.id,
        })
        if (outcome === 'abort') return { pushed, skipped, failed: failed + 1 }
        failed++
      }
    }
  } else {
    const archiveThread = provider.archiveThread?.bind(provider)
    const unarchiveThread = provider.unarchiveThread?.bind(provider)
    const markThreadAsSpam = provider.markThreadAsSpam?.bind(provider)
    if (!archiveThread || !unarchiveThread) {
      return { pushed, skipped: skipped + eligible.length, failed }
    }

    for (const thread of eligible) {
      try {
        switch (thread.status) {
          case ThreadStatus.ARCHIVED:
          // Archive-on-trash: TRASH pushes remove-INBOX only, never threads.trash
          // (Gmail purges Trash after 30 days — Done is not lossy, Trash is).
          case ThreadStatus.TRASH:
            await archiveThread(thread.externalId!)
            pushed++
            break
          case ThreadStatus.OPEN:
            await unarchiveThread(thread.externalId!)
            pushed++
            break
          case ThreadStatus.SPAM:
            if (markThreadAsSpam) {
              await markThreadAsSpam(thread.externalId!)
              pushed++
            } else {
              skipped++
            }
            break
          default:
            // IGNORED (Auxx-only) and helpdesk statuses: no push.
            skipped++
        }
      } catch (error) {
        const outcome = classifyPushError(error, {
          organizationId,
          integrationId,
          threadId: thread.id,
        })
        if (outcome === 'abort') return { pushed, skipped, failed: failed + 1 }
        failed++
      }
    }
  }

  logger.info('Thread provider sync push completed', {
    organizationId,
    integrationId,
    kind,
    pushed,
    skipped,
    failed,
  })
  return { pushed, skipped, failed }
}

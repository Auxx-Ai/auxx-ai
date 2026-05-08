// packages/lib/src/ingest/context.ts

import { type Database, database as defaultDb } from '@auxx/database'
import { createScopedLogger, type Logger } from '@auxx/logger'
import { SelectiveModeCache } from '../cache/selective-mode-cache'
import { MessageReconcilerService } from '../messages/message-reconciler.service'
import { ThreadManagerService } from '../messages/thread-manager.service'
import type { MailSyncEvent } from '../realtime/events'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { SystemUserService } from '../users/system-user-service'
import type { IntegrationSettings } from './types'

/**
 * Per-ingest shared state. One context is created per batch (or per one-shot
 * `storeMessage` call) and discarded afterwards. Every ingest function takes
 * `ctx` as its first argument and mutates the per-batch caches in place.
 *
 * Caches are intentionally per-batch:
 * - `companyIdByDomain` dedupes auto-link calls across all participants of
 *   all messages in a batch (cross-batch races tolerated per plan v1)
 * - `ownDomainsByOrg` avoids repeating the Redis-backed orgProfile read
 * - `providerByIntegrationId` caches integration → provider lookups
 *
 * Per-message participant caching lives inside `storeMessage` itself because
 * the thread's `participantCount` is derived by iterating the cache — sharing
 * it across messages would over-count.
 */
export interface IngestContext {
  readonly organizationId: string
  readonly db: Database
  readonly logger: Logger
  readonly systemUserId: string
  readonly crudHandler: UnifiedCrudHandler
  readonly reconciler: MessageReconcilerService
  readonly threadManager: ThreadManagerService
  readonly selectiveCache: SelectiveModeCache

  integrationSettings?: IntegrationSettings
  isInitialSync: boolean
  /**
   * Normalized email addresses that count as "us" for the active integration —
   * the union of `Integration.email` and `Integration.metadata.userEmails`.
   * Providers populate this on their `MessageStorageService` before dispatching
   * ingest so participants matching any entry are treated as internal even when
   * `Organization.domains` is unset.
   */
  ownEmails: Set<string>

  /**
   * Originating socket id for self-echo suppression on realtime publishes.
   * tRPC routers populate from the `x-realtime-socket-id` header; webhooks /
   * workers / workflow nodes leave it undefined and accept the echo.
   */
  socketId?: string

  /**
   * Buffer for mail realtime events accumulated during initial / polling sync.
   * Per-message publishes append here when `isInitialSync` is true; the
   * batch orchestrator flushes them in chunks at the end of the batch.
   */
  batchedEvents: Array<{ inboxId: string | null; event: MailSyncEvent }>

  readonly companyIdByDomain: Map<string, string | null>
  readonly ownDomainsByOrg: Map<string, Set<string>>
  readonly providerByIntegrationId: Map<string, string>
}

export interface CreateIngestContextOptions {
  db?: Database
  isInitialSync?: boolean
  integrationSettings?: IntegrationSettings
  ownEmails?: Iterable<string>
  selectiveCache?: SelectiveModeCache
  socketId?: string
}

/**
 * Build an IngestContext for an organization. Loads the system user once,
 * instantiates per-org services (crudHandler, reconciler, threadManager),
 * and initializes empty per-batch caches.
 */
export async function createIngestContext(
  organizationId: string,
  opts: CreateIngestContextOptions = {}
): Promise<IngestContext> {
  const db = opts.db ?? defaultDb
  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
  const threadManager = new ThreadManagerService(organizationId, db)
  return {
    organizationId,
    db,
    logger: createScopedLogger(`ingest:${organizationId.slice(0, 8)}`),
    systemUserId,
    crudHandler: new UnifiedCrudHandler(organizationId, systemUserId),
    reconciler: new MessageReconcilerService(organizationId, threadManager, db),
    threadManager,
    selectiveCache: opts.selectiveCache ?? new SelectiveModeCache(),
    integrationSettings: opts.integrationSettings,
    isInitialSync: opts.isInitialSync ?? false,
    ownEmails: normalizeOwnEmails(opts.ownEmails),
    socketId: opts.socketId,
    batchedEvents: [],
    companyIdByDomain: new Map(),
    ownDomainsByOrg: new Map(),
    providerByIntegrationId: new Map(),
  }
}

/** Clear per-batch caches. Call between batches when reusing a context. */
export function resetBatchCaches(ctx: IngestContext): void {
  ctx.companyIdByDomain.clear()
  ctx.ownDomainsByOrg.clear()
  ctx.providerByIntegrationId.clear()
}

/**
 * Normalize a collection of "own" email addresses into a deduped, lowercased
 * set safe for O(1) membership checks. Empty / non-string entries are dropped.
 */
export function normalizeOwnEmails(emails: Iterable<string> | undefined): Set<string> {
  const out = new Set<string>()
  if (!emails) return out
  for (const raw of emails) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim().toLowerCase()
    if (trimmed) out.add(trimmed)
  }
  return out
}

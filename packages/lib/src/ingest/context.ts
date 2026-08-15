// packages/lib/src/ingest/context.ts

import { type Database, database as defaultDb } from '@auxx/database'
import type { IdentifierType as IdentifierTypeValue } from '@auxx/database/types'
import { createScopedLogger, type Logger } from '@auxx/logger'
import { SelectiveModeCache } from '../cache/selective-mode-cache'
import { normalizeOwnIdentifier, type OwnIdentitySets } from '../channels/own-identities'
import { MessageReconcilerService } from '../messages/message-reconciler.service'
import { ThreadManagerService } from '../messages/thread-manager.service'
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
   * Received-time trigger cutoff for a first-connect backfill (webhook-push-migration
   * plan Phase 2.5). When set, `message:received` publishing is suppressed for
   * messages with `receivedAt` before this instant — regardless of which sync walker
   * ingested them. Providers set it (via MessageStorageService.setBackfillCutoff)
   * only while `metadata.backfillCutoffAt` is stamped and
   * `metadata.initialBackfillCompletedAt` is not. Null = no suppression.
   */
  backfillCutoffAt: Date | null
  /**
   * Identifiers that count as "us" for the ACTIVE integration, bucketed by
   * identifier type — `EMAIL` for a mailbox and its send-as aliases, `PHONE`
   * for a channel's own number. Providers populate this on their
   * `MessageStorageService` before dispatching ingest.
   *
   * Overlaps the org-cache-derived sets `classifyIsInternal` falls back to, and
   * is kept because it is FRESHER: a provider fills it straight from the
   * integration it just initialized, so the first sync after a connect doesn't
   * depend on a cache refresh having landed.
   */
  ownIdentities: OwnIdentitySets

  /**
   * Originating socket id for self-echo suppression on realtime publishes.
   * tRPC routers populate from the `x-realtime-socket-id` header; webhooks /
   * workers / workflow nodes leave it undefined and accept the echo.
   */
  socketId?: string

  /**
   * True while a sync orchestrator (batchStoreMessages, gmail / outlook
   * ingestors) is running. Per-message / per-thread realtime publishes are
   * suppressed in this mode — instead each touched inbox is recorded in
   * `touchedInboxIds` and a single `inbox:syncCompleted` event is emitted at
   * the end. Prevents a backfill of N messages from fanning out into N
   * realtime events → N client `getByIds` mutations → tRPC rate limit blowup.
   */
  inSyncBatch: boolean

  /** Inboxes touched during the current sync batch. Null = triage. */
  touchedInboxIds: Set<string | null>

  readonly companyIdByDomain: Map<string, string | null>
  readonly ownDomainsByOrg: Map<string, Set<string>>
  /**
   * Per-batch memo of the org-cache-derived own-identity sets, so a batch of N
   * participants resolves them once rather than N times. Distinct from
   * `ownIdentities` above, which is the ACTIVE integration's own identifiers
   * pushed in by the provider.
   */
  readonly ownIdentitiesByOrg: Map<string, OwnIdentitySets>
  readonly providerByIntegrationId: Map<string, string>
}

export interface CreateIngestContextOptions {
  db?: Database
  isInitialSync?: boolean
  integrationSettings?: IntegrationSettings
  ownIdentities?: OwnIdentitySets
  selectiveCache?: SelectiveModeCache
  socketId?: string
  backfillCutoffAt?: Date | null
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
    backfillCutoffAt: opts.backfillCutoffAt ?? null,
    ownIdentities: opts.ownIdentities ?? {},
    socketId: opts.socketId,
    inSyncBatch: false,
    touchedInboxIds: new Set(),
    companyIdByDomain: new Map(),
    ownDomainsByOrg: new Map(),
    ownIdentitiesByOrg: new Map(),
    providerByIntegrationId: new Map(),
  }
}

/** Clear per-batch caches. Call between batches when reusing a context. */
export function resetBatchCaches(ctx: IngestContext): void {
  ctx.companyIdByDomain.clear()
  ctx.ownDomainsByOrg.clear()
  ctx.ownIdentitiesByOrg.clear()
  ctx.providerByIntegrationId.clear()
}

/**
 * Fold raw provider-supplied identifiers into {@link OwnIdentitySets}.
 *
 * Every entry goes through `normalizeOwnIdentifier` for its type, so the
 * membership test doesn't depend on which normalizer happened to write the
 * stored `Participant.identifier`. Empty / non-string / unparseable entries are
 * dropped, and a bucket that ends up empty is omitted entirely.
 */
export function buildOwnIdentitySets(
  input: Partial<Record<IdentifierTypeValue, Iterable<string> | undefined>> | undefined
): OwnIdentitySets {
  if (!input) return {}
  const out: Partial<Record<IdentifierTypeValue, ReadonlySet<string>>> = {}
  for (const [type, values] of Object.entries(input) as Array<
    [IdentifierTypeValue, Iterable<string> | undefined]
  >) {
    if (!values) continue
    const bucket = new Set<string>()
    for (const raw of values) {
      if (typeof raw !== 'string') continue
      const normalized = normalizeOwnIdentifier(raw, type)
      if (normalized) bucket.add(normalized)
    }
    if (bucket.size > 0) out[type] = bucket
  }
  return out
}

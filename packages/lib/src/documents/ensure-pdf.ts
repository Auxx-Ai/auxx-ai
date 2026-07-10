// packages/lib/src/documents/ensure-pdf.ts

import { database as db, schema } from '@auxx/database'
import { getConnectionOptions, getRedisClient } from '@auxx/redis'
import { extractValue, type TypedFieldValue } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId } from '@auxx/types/resource'
import { QueueEvents } from 'bullmq'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { FieldValueService } from '../field-values/field-value-service'
import { MediaAssetService } from '../files/core/media-asset-service'
import { createStorageManager } from '../files/storage/storage-manager'
import { getQueue, Queues } from '../jobs/queues'
import { UnifiedCrudHandler } from '../resources/crud'
import { buildQuotePdfPayload } from './payload'
import { renderDocumentPdf } from './render'

/** Result of {@link ensureQuotePdf} / {@link ensureQuotePdfViaQueue}. */
export interface EnsureQuotePdfResult {
  assetId: string
  fileName: string
  /** `false` on a content-hash cache hit — no render/upload happened. */
  rendered: boolean
}

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Render-or-reuse service for quote PDFs (money MQ2 build spec §C.2). One `MediaAsset` per
 * quote (`<QUO-number>.pdf`); a new `MediaAssetVersion` per content change, keyed by a
 * `stableHash` of the full render payload (data + resolved document settings) stashed in
 * `MediaAssetVersion.metadata.contentHash`. Unchanged content is a pure cache hit — no
 * render, no new version, no upload. Sent documents snapshot naturally: the version the
 * customer received never changes even if branding/settings are edited afterward.
 */
export async function ensureQuotePdf(params: {
  organizationId: string
  quoteRecordId: RecordId
  actorId: string
}): Promise<EnsureQuotePdfResult> {
  const { organizationId, quoteRecordId, actorId } = params
  const { entityInstanceId: quoteInstanceId } = parseRecordId(quoteRecordId)

  const { payload, hash } = await buildQuotePdfPayload({
    organizationId,
    userId: actorId,
    quoteRecordId,
  })

  const fileName = `${payload.number || quoteInstanceId}.pdf`

  // ─── Step 1/2: read the existing pointer + compare content hashes ──────────
  const cache = getOrgCache()
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['quote_pdf_asset'] as const)
  const handler = new UnifiedCrudHandler(organizationId, actorId)

  let existingAssetId: string | undefined
  if (cf.quote_pdf_asset) {
    const values = await handler.getFieldValues(quoteRecordId, [cf.quote_pdf_asset.id])
    const typed = firstTyped(values.get(cf.quote_pdf_asset.id))
    existingAssetId = typed ? (extractValue(typed) as string) : undefined
  }

  if (existingAssetId) {
    const existingAsset = await db.query.MediaAsset.findFirst({
      where: eq(schema.MediaAsset.id, existingAssetId),
      with: { currentVersion: true },
    })
    const currentHash = (existingAsset?.currentVersion?.metadata as { contentHash?: string } | null)
      ?.contentHash
    if (existingAsset && currentHash === hash) {
      return {
        assetId: existingAsset.id,
        fileName: existingAsset.name ?? fileName,
        rendered: false,
      }
    }
  }

  // ─── Step 3: render + upload ─────────────────────────────────────────────────
  const buffer = await renderDocumentPdf(payload)

  const storageManager = createStorageManager(organizationId)
  const storageKey = `documents/${organizationId}/quote/${quoteInstanceId}/${hash.slice(0, 12)}.pdf`
  const storageLocation = await storageManager.uploadContent({
    provider: 'S3',
    key: storageKey,
    content: buffer,
    mimeType: 'application/pdf',
    size: buffer.length,
    visibility: 'PRIVATE',
    organizationId,
  })

  const mediaAssetService = new MediaAssetService(organizationId, actorId, db)

  let assetId: string
  if (existingAssetId) {
    // Subsequent content change — new version on the SAME asset (sent-doc snapshot: the
    // version a customer already received is immutable, only `currentVersionId` moves).
    await mediaAssetService.createVersion(existingAssetId, storageLocation.id, {
      metadata: { contentHash: hash },
    })
    assetId = existingAssetId
  } else {
    const { asset, version } = await mediaAssetService.createWithVersion(
      {
        kind: 'DOCUMENT',
        purpose: 'ORIGINAL',
        name: fileName,
        mimeType: 'application/pdf',
        size: BigInt(buffer.length),
        isPrivate: true,
        organizationId,
        createdById: actorId,
      },
      storageLocation.id
    )
    assetId = asset.id
    // `createWithVersion` only accepts size/mimeType — stamp the content hash directly
    // onto the version it created rather than immediately spinning a second version.
    await db
      .update(schema.MediaAssetVersion)
      .set({ metadata: { contentHash: hash } })
      .where(eq(schema.MediaAssetVersion.id, version.id))
  }

  // ─── Step 4: write the pointer (new asset only — unchanged on cache hit/reuse) ──
  if (!existingAssetId && cf.quote_pdf_asset) {
    const fieldValueService = new FieldValueService(organizationId, actorId)
    await fieldValueService.setValuesForEntity({
      recordId: quoteRecordId,
      values: [{ fieldId: cf.quote_pdf_asset.id, value: assetId }],
      publishEvents: false,
    })
  }

  return { assetId, fileName, rendered: true }
}

// ─── Queue-backed variant (§C.3) ──────────────────────────────────────────────

let queueEvents: QueueEvents | undefined
function getDocumentPdfQueueEvents(): QueueEvents {
  if (!queueEvents) {
    queueEvents = new QueueEvents(Queues.documentPdfQueue, { connection: getConnectionOptions() })
  }
  return queueEvents
}

/**
 * Enqueue a quote PDF render and await its result via BullMQ's `QueueEvents` (money MQ2
 * build spec §C.3). Used by synchronous callers (prepare-send, Preview PDF, download-on-
 * miss) that need the asset ready before responding — background/bulk callers should
 * enqueue the job directly instead and not await.
 *
 * ⚠️ No existing `QueueEvents`/`waitUntilFinished` precedent was found elsewhere in this
 * repo (all other job producers fire-and-forget or poll DB state) — this is a first, kept
 * deliberately small. If awaiting proves flaky in practice, the documented fallback is
 * calling {@link ensureQuotePdf} inline instead (react-pdf is pure JS; ~0.5–2s render is
 * acceptable per the MQ2 README).
 */
export async function ensureQuotePdfViaQueue(params: {
  organizationId: string
  quoteRecordId: RecordId
  actorId: string
  timeoutMs?: number
}): Promise<EnsureQuotePdfResult> {
  const { organizationId, quoteRecordId, actorId, timeoutMs = 20_000 } = params
  const { entityInstanceId: quoteInstanceId } = parseRecordId(quoteRecordId)

  // Deterministic jobId keeps concurrent callers for the same quote+content de-duped —
  // BullMQ rejects a second `add` with an already-active/waiting jobId.
  const { hash } = await buildQuotePdfPayload({ organizationId, userId: actorId, quoteRecordId })
  const jobId = `doc-pdf-${quoteInstanceId}-${hash.slice(0, 12)}`

  const redis = await getRedisClient(true)
  const guardKey = `processing:${jobId}`
  const cached = await redis.get(guardKey)

  const queue = getQueue(Queues.documentPdfQueue)

  const job =
    (await queue.getJob(jobId)) ??
    (await queue.add(
      'renderQuotePdf',
      { organizationId, quoteRecordId, actorId },
      { jobId, attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
    ))

  if (!cached) {
    await redis.setex(guardKey, 60, job.id!)
  }

  const result = (await job.waitUntilFinished(
    getDocumentPdfQueueEvents(),
    timeoutMs
  )) as EnsureQuotePdfResult
  await redis.del(guardKey)
  return result
}

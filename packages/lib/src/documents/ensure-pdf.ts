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
import type { DocumentPdfPayload } from './payload'
import { getDocumentType, type RegisteredDocumentType } from './registry'
import { renderDocumentPdf } from './render'

/** Which PDF template/pointer-field a render-or-reuse call targets (money MI1 §H.1). Kept as
 * a literal alias for the two callers/back-compat wrappers below — the actual dispatch goes
 * through the document-type registry (`./registry.ts`). */
export type DocumentType = 'quote' | 'invoice'

/** Result of {@link ensureDocumentPdf} / {@link ensureDocumentPdfViaQueue}. */
export interface EnsureDocumentPdfResult {
  assetId: string
  fileName: string
  /** `false` on a content-hash cache hit — no render/upload happened. */
  rendered: boolean
}

/** @deprecated kept as a structural alias for the pre-MI1 name — prefer {@link EnsureDocumentPdfResult}. */
export type EnsureQuotePdfResult = EnsureDocumentPdfResult

/** Look up a registered document type or throw — every `DocumentType` literal is expected to
 * have a registry entry (quote/invoice register in `./registry.ts`). */
function getRegisteredOrThrow(documentType: DocumentType): RegisteredDocumentType {
  const registered = getDocumentType(documentType)
  if (!registered) {
    throw new Error(`Unregistered document type: ${documentType}`)
  }
  return registered
}

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

async function buildPdfPayload(params: {
  documentType: DocumentType
  organizationId: string
  userId: string
  recordId: RecordId
}): Promise<{ payload: DocumentPdfPayload; hash: string }> {
  const { documentType, organizationId, userId, recordId } = params
  return getRegisteredOrThrow(documentType).buildPayload({ organizationId, userId, recordId })
}

/**
 * Render-or-reuse service for quote/invoice PDFs (money MQ2 build spec §C.2; generalized by
 * MI1 §H.1 to dispatch on `documentType`). One `MediaAsset` per document
 * (`<number>.pdf`); a new `MediaAssetVersion` per content change, keyed by a `stableHash` of
 * the full render payload (data + resolved document settings) stashed in
 * `MediaAssetVersion.metadata.contentHash`. Unchanged content is a pure cache hit — no
 * render, no new version, no upload. Sent documents snapshot naturally: the version the
 * customer received never changes even if branding/settings are edited afterward.
 */
export async function ensureDocumentPdf(params: {
  documentType: DocumentType
  organizationId: string
  recordId: RecordId
  actorId: string
}): Promise<EnsureDocumentPdfResult> {
  const { documentType, organizationId, recordId, actorId } = params
  const { entityInstanceId } = parseRecordId(recordId)

  const { payload, hash } = await buildPdfPayload({
    documentType,
    organizationId,
    userId: actorId,
    recordId,
  })

  const fileName = `${payload.number || entityInstanceId}.pdf`
  const pointerAttr = getRegisteredOrThrow(documentType).pointerAttr

  // ─── Step 1/2: read the existing pointer + compare content hashes ──────────
  const cache = getOrgCache()
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([pointerAttr] as const)
  const handler = new UnifiedCrudHandler(organizationId, actorId)
  const pointerField = cf[pointerAttr]

  let existingAssetId: string | undefined
  if (pointerField) {
    const values = await handler.getFieldValues(recordId, [pointerField.id])
    const typed = firstTyped(values.get(pointerField.id))
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
  const storageKey = `documents/${organizationId}/${documentType}/${entityInstanceId}/${hash.slice(0, 12)}.pdf`
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
  if (!existingAssetId && pointerField) {
    const fieldValueService = new FieldValueService(organizationId, actorId)
    await fieldValueService.setValuesForEntity({
      recordId,
      values: [{ fieldId: pointerField.id, value: assetId }],
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
 * Enqueue a quote/invoice PDF render and await its result via BullMQ's `QueueEvents` (money
 * MQ2 build spec §C.3). Used by synchronous callers (prepare-send, Preview PDF, download-on-
 * miss) that need the asset ready before responding — background/bulk callers should
 * enqueue the job directly instead and not await.
 *
 * ⚠️ No existing `QueueEvents`/`waitUntilFinished` precedent was found elsewhere in this
 * repo (all other job producers fire-and-forget or poll DB state) — this is a first, kept
 * deliberately small. If awaiting proves flaky in practice, the documented fallback is
 * calling {@link ensureDocumentPdf} inline instead (react-pdf is pure JS; ~0.5–2s render is
 * acceptable per the MQ2 README).
 */
export async function ensureDocumentPdfViaQueue(params: {
  documentType: DocumentType
  organizationId: string
  recordId: RecordId
  actorId: string
  timeoutMs?: number
}): Promise<EnsureDocumentPdfResult> {
  const { documentType, organizationId, recordId, actorId, timeoutMs = 20_000 } = params
  const { entityInstanceId } = parseRecordId(recordId)

  // Deterministic jobId keeps concurrent callers for the same document+content de-duped —
  // BullMQ rejects a second `add` with an already-active/waiting jobId.
  const { hash } = await buildPdfPayload({
    documentType,
    organizationId,
    userId: actorId,
    recordId,
  })
  const jobId = `doc-pdf-${documentType}-${entityInstanceId}-${hash.slice(0, 12)}`

  const redis = await getRedisClient(true)
  const guardKey = `processing:${jobId}`
  const cached = await redis.get(guardKey)

  const queue = getQueue(Queues.documentPdfQueue)

  const job =
    (await queue.getJob(jobId)) ??
    (await queue.add(
      'renderDocumentPdf',
      { documentType, organizationId, recordId, actorId },
      { jobId, attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
    ))

  if (!cached) {
    await redis.setex(guardKey, 60, job.id!)
  }

  const result = (await job.waitUntilFinished(
    getDocumentPdfQueueEvents(),
    timeoutMs
  )) as EnsureDocumentPdfResult
  await redis.del(guardKey)
  return result
}

// ─── Back-compat quote-only wrappers ──────────────────────────────────────────
// Kept so the existing MQ2 call sites (`money/send-email.ts`'s `ensureQuoteDocumentPdf`,
// `apps/worker/scripts/verify-money-mq2-pdf.ts`) don't need touching — they pin
// `documentType: 'quote'` over the generalized engine above.

/** @deprecated prefer {@link ensureDocumentPdf} with `documentType: 'quote'`. */
export async function ensureQuotePdf(params: {
  organizationId: string
  quoteRecordId: RecordId
  actorId: string
}): Promise<EnsureDocumentPdfResult> {
  const { organizationId, quoteRecordId, actorId } = params
  return ensureDocumentPdf({
    documentType: 'quote',
    organizationId,
    recordId: quoteRecordId,
    actorId,
  })
}

/** @deprecated prefer {@link ensureDocumentPdfViaQueue} with `documentType: 'quote'`. */
export async function ensureQuotePdfViaQueue(params: {
  organizationId: string
  quoteRecordId: RecordId
  actorId: string
  timeoutMs?: number
}): Promise<EnsureDocumentPdfResult> {
  const { organizationId, quoteRecordId, actorId, timeoutMs } = params
  return ensureDocumentPdfViaQueue({
    documentType: 'quote',
    organizationId,
    recordId: quoteRecordId,
    actorId,
    timeoutMs,
  })
}

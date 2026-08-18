// packages/lib/src/providers/social/attachments.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { InboundAttachmentIngestService } from '../../email/inbound/attachment-ingest.service'
import type { AttachmentIngestInput } from '../../email/inbound/ingest-types'
import { assertPublicHost } from '../../files/fetch-remote-image'
import type { GraphConversationMessage } from './api'
import type { MetaWebhookMessage, SocialPlatform } from './types'

const logger = createScopedLogger('social-attachments')

/**
 * Hard cap on a single downloaded attachment.
 *
 * 25 MB is Meta's own ceiling on what a person can send through Messenger, so a
 * larger response is not a big photo — it is a redirect to something that is not
 * the attachment. Enforced twice: on `content-length` before reading a byte, and
 * again on the buffer for the responses that carry no length header.
 */
export const SOCIAL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

/** Attachments ingested per message. A Messenger message carries a handful. */
export const SOCIAL_ATTACHMENTS_PER_MESSAGE = 10

/** Download timeout. Generous because the cap admits 25 MB videos. */
const FETCH_TIMEOUT_MS = 20_000

/**
 * Meta attachment types that carry bytes worth storing.
 *
 * The excluded types are not oversights: `template` and `fallback` are UI
 * payloads with no file behind them, `location` is a coordinate pair, and
 * `share` points at whatever was shared — usually an external page, so
 * downloading it stores someone else's HTML as a customer's attachment.
 */
const INGESTIBLE_TYPES = new Set(['image', 'video', 'audio', 'file', 'story_mention'])

/** Content types that mean "you were served a page, not a file". */
const REFUSED_MIME_PREFIXES = ['text/html', 'application/xhtml']

/**
 * One downloadable attachment, normalized across the two doors.
 *
 * The webhook and the Graph conversation edge describe attachments completely
 * differently — `{type, payload:{url}}` versus `{mime_type, name, size,
 * image_data{url}}` — and only one of them knows the mime type up front. Both
 * collapse to this, so the fetch-and-ingest half is written once.
 */
export interface SocialAttachmentRef {
  /** Direct download URL. Meta's CDN links are signed and expire. */
  url: string
  /** Meta's own type word, kept for the derived filename and for logging. */
  type: string
  /** Only the Graph edge supplies these; the webhook never does. */
  name?: string
  mimeType?: string
  size?: number
}

/**
 * The attachments on a webhook `message` payload.
 *
 * Order is the wire order, and it is load-bearing: `attachmentOrder` feeds
 * `deriveAttachmentId`, which is what makes a re-delivered webhook (Meta retries
 * freely) ingest onto the same rows instead of duplicating them.
 */
export function webhookAttachmentRefs(
  message: MetaWebhookMessage | undefined | null
): SocialAttachmentRef[] {
  const refs: SocialAttachmentRef[] = []
  for (const attachment of message?.attachments ?? []) {
    const url = attachment.payload?.url
    const type = attachment.type ?? 'file'
    if (!url) continue
    if (!INGESTIBLE_TYPES.has(type)) continue
    refs.push({ url, type, name: attachment.payload?.title ?? undefined })
  }
  return refs
}

/**
 * The attachments on a Graph conversation-message node.
 *
 * Three URL fields, because Graph splits by media kind rather than answering one
 * `url`: `image_data.url` for photos and stickers, `video_data.url` for video,
 * `file_url` for everything else. The node is typed loosely on purpose — this
 * edge is the one shape in this channel nobody has captured live (see
 * `conversation-message.ts`), so an absent `attachments` connection must read as
 * "no attachments", never as an error.
 */
export function conversationAttachmentRefs(
  message: Pick<GraphConversationMessage, 'attachments'> | undefined | null
): SocialAttachmentRef[] {
  const refs: SocialAttachmentRef[] = []
  for (const attachment of message?.attachments?.data ?? []) {
    const url = attachment.image_data?.url ?? attachment.video_data?.url ?? attachment.file_url
    if (!url) continue
    refs.push({
      url,
      type: attachment.video_data ? 'video' : attachment.image_data ? 'image' : 'file',
      name: attachment.name ?? undefined,
      mimeType: attachment.mime_type ?? undefined,
      size: typeof attachment.size === 'number' ? attachment.size : undefined,
    })
  }
  return refs
}

export interface IngestSocialAttachmentsArgs {
  refs: SocialAttachmentRef[]
  organizationId: string
  /** The stored `Message.id` the `Attachment` rows hang off. */
  messageId: string
  /** `Message.externalId` (the `mid`) — scopes the object keys and the derived ids. */
  contentScopeId: string
  platform: SocialPlatform
  /** Publishes `message:updated` so an open thread shows the file without a refetch. */
  publish?: { threadId: string; inboxId: string | null; excludeSocketId?: string }
  db?: Database
}

/**
 * Downloads a Meta message's attachments and stores them as canonical
 * `Attachment` rows, reusing the inbound-email ingest pipeline unchanged.
 *
 * **Never throws.** Every caller is on a path where the message is already
 * stored: the webhook has answered 200 and is inside `after()`, and the backfill
 * has committed the batch. A CDN link that expired between delivery and download
 * must cost one photo, not a retried webhook or an aborted backfill.
 *
 * Idempotent twice over — it returns early when the message already carries as
 * many attachments as the payload declares, and `deriveAttachmentId` collapses a
 * repeat ingest onto the same rows even when it does not.
 *
 * @returns how many attachments were stored.
 */
export async function ingestSocialAttachments(args: IngestSocialAttachmentsArgs): Promise<number> {
  const { organizationId, messageId, contentScopeId, platform } = args
  const db = args.db ?? defaultDb
  const refs = args.refs.slice(0, SOCIAL_ATTACHMENTS_PER_MESSAGE)
  if (refs.length === 0) return 0

  if (args.refs.length > refs.length) {
    logger.warn(
      'Meta message declares more attachments than the per-message cap; ingesting a prefix',
      {
        platform,
        messageId,
        declared: args.refs.length,
        cap: SOCIAL_ATTACHMENTS_PER_MESSAGE,
      }
    )
  }

  try {
    const existing = await db
      .select({ id: schema.Attachment.id })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, organizationId),
          eq(schema.Attachment.entityType, 'MESSAGE'),
          eq(schema.Attachment.entityId, messageId)
        )
      )
    if (existing.length >= refs.length) {
      logger.debug('Meta message attachments already ingested; skipping download', {
        platform,
        messageId,
        existing: existing.length,
      })
      return 0
    }

    const inputs: AttachmentIngestInput[] = []
    let failed = 0
    for (let order = 0; order < refs.length; order++) {
      const ref = refs[order]!
      const downloaded = await fetchSocialAttachment(ref, { platform, messageId })
      if (!downloaded) {
        failed++
        continue
      }
      inputs.push({
        content: downloaded.content,
        filename: attachmentFilename(ref, order, downloaded.mimeType),
        mimeType: downloaded.mimeType,
        // Meta DMs have no HTML body, so nothing can reference an attachment by
        // `cid:`. Marking these inline would hide them: the chat bubble renders
        // non-inline attachments only.
        inline: false,
        contentId: null,
        attachmentOrder: order,
      })
    }

    if (inputs.length === 0) return 0

    const stored = await new InboundAttachmentIngestService(db).ingestAll(
      inputs,
      { organizationId, messageId, contentScopeId },
      // A partial set must not reconcile: reconciliation deletes the rows it did
      // not just write, so one expired CDN link would wipe the attachments a
      // previous run stored successfully.
      { skipReconciliation: failed > 0 }
    )

    logger.info('Ingested Meta message attachments', {
      platform,
      messageId,
      stored: stored.length,
      failed,
    })

    if (args.publish) {
      await publishAttachmentsPatch({
        organizationId,
        messageId,
        threadId: args.publish.threadId,
        inboxId: args.publish.inboxId,
        excludeSocketId: args.publish.excludeSocketId,
        attachments: stored.map((meta) => ({
          id: meta.attachmentId,
          name: meta.filename,
          mimeType: meta.mimeType,
          size: meta.size,
          url: null,
          inline: meta.inline,
          contentId: meta.contentId,
        })),
      })
    }

    return stored.length
  } catch (error) {
    logger.error('Meta attachment ingest failed (ignored)', {
      platform,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

/**
 * Fetches one attachment's bytes.
 *
 * @returns `null` on any refusal — a dead link, an oversized body, or an HTML
 * error page served with a 200. All of those are one missing file, not a
 * failure of the message.
 */
export async function fetchSocialAttachment(
  ref: SocialAttachmentRef,
  context: { platform: SocialPlatform; messageId: string }
): Promise<{ content: Buffer; mimeType: string } | null> {
  try {
    // Meta's CDN hostnames are fixed, but the URL arrives over the wire and
    // `fetch` follows redirects, so the same guard the enrichment fetcher uses
    // applies here.
    assertPublicHost(ref.url)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(ref.url, { signal: controller.signal, redirect: 'follow' })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      logger.warn('Meta attachment download refused', {
        ...context,
        type: ref.type,
        status: response.status,
      })
      return null
    }

    const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declaredLength) && declaredLength > SOCIAL_ATTACHMENT_MAX_BYTES) {
      logger.warn('Meta attachment exceeds the size cap; skipping', {
        ...context,
        type: ref.type,
        size: declaredLength,
        cap: SOCIAL_ATTACHMENT_MAX_BYTES,
      })
      return null
    }

    const mimeType = normalizeMimeType(response.headers.get('content-type'), ref.mimeType)
    if (REFUSED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
      logger.warn('Meta attachment URL served a document, not a file; skipping', {
        ...context,
        type: ref.type,
        mimeType,
      })
      return null
    }

    const content = Buffer.from(await response.arrayBuffer())
    if (content.byteLength === 0) return null
    if (content.byteLength > SOCIAL_ATTACHMENT_MAX_BYTES) {
      logger.warn('Meta attachment exceeded the size cap after download; discarding', {
        ...context,
        type: ref.type,
        size: content.byteLength,
      })
      return null
    }

    return { content, mimeType }
  } catch (error) {
    logger.warn('Meta attachment download failed (ignored)', {
      ...context,
      type: ref.type,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** `content-type` minus its parameters, falling back to what Graph declared. */
function normalizeMimeType(header: string | null, declared: string | undefined): string {
  const fromHeader = header?.split(';')[0]?.trim().toLowerCase()
  if (fromHeader) return fromHeader
  return declared?.trim().toLowerCase() || 'application/octet-stream'
}

/**
 * The filename an attachment is stored and displayed under.
 *
 * Derived, never taken raw: Meta's webhook supplies no name at all and its CDN
 * URLs carry no path filename, so the honest default is the media type plus its
 * position. The result feeds `deriveAttachmentId`, so it has to be a pure
 * function of inputs that do not change between two deliveries of the same
 * message — which is why the position, and not a timestamp, disambiguates.
 */
export function attachmentFilename(
  ref: SocialAttachmentRef,
  order: number,
  mimeType: string
): string {
  const base = ref.name?.trim() || `${ref.type}-${order + 1}`
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_')
  if (/\.[a-zA-Z0-9]{2,5}$/.test(safe)) return safe
  const extension = extensionForMimeType(mimeType)
  return extension ? `${safe}${extension}` : safe
}

/** Extension for the handful of types Messenger and Instagram actually deliver. */
function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    case 'video/mp4':
      return '.mp4'
    case 'video/quicktime':
      return '.mov'
    case 'audio/mpeg':
      return '.mp3'
    case 'audio/mp4':
    case 'audio/aac':
      return '.m4a'
    case 'audio/ogg':
      return '.ogg'
    case 'application/pdf':
      return '.pdf'
    default:
      return ''
  }
}

/**
 * Fire-and-forget `message:updated` carrying the freshly stored attachments.
 *
 * Ingest runs after the message row exists, so `message:created` has already
 * gone out with an empty attachment list — without this patch a photo shows up
 * as an empty bubble until something refetches the thread.
 *
 * The realtime barrel is imported lazily for the reason documented on
 * `publishParticipantPatch`: a static import from a provider module widens the
 * graph into the cache cycle and breaks `vi.mock` interception in lib tests.
 */
async function publishAttachmentsPatch(args: {
  organizationId: string
  messageId: string
  threadId: string
  inboxId: string | null
  excludeSocketId?: string
  attachments: Array<{
    id: string
    name: string
    mimeType: string | null
    size: number | null
    url: string | null
    inline: boolean
    contentId: string | null
  }>
}): Promise<void> {
  try {
    const { getRealtimeService, publishMessageUpdated } = await import('../../realtime')
    await publishMessageUpdated(
      getRealtimeService(),
      args.organizationId,
      {
        messageId: args.messageId,
        threadId: args.threadId,
        inboxId: args.inboxId,
        patch: { hasAttachments: true, attachments: args.attachments },
      },
      args.excludeSocketId ? { excludeSocketId: args.excludeSocketId } : undefined
    )
  } catch (error) {
    logger.warn('message:updated attachment publish failed (ignored)', {
      messageId: args.messageId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Ingest a stored message's attachments and patch every open view of its thread.
 *
 * The webhook door's entry point: it holds only the `Message.id` `storeMessage`
 * handed back, so the thread and inbox the realtime patch has to route to are
 * looked up here. Call it from `after()`, never before the 200 — a 25 MB video
 * download inside the request would have Meta retrying the delivery and, on
 * repeat, disabling the subscription.
 */
export async function ingestStoredMessageAttachments(
  db: Database,
  args: {
    refs: SocialAttachmentRef[]
    organizationId: string
    messageId: string
    contentScopeId: string
    platform: SocialPlatform
  }
): Promise<number> {
  if (args.refs.length === 0) return 0
  const target = await resolveMessagePublishTarget(db, args.messageId).catch(() => null)
  return ingestSocialAttachments({
    ...args,
    db,
    publish: target ?? undefined,
  })
}

/**
 * Looks up the routing a `message:updated` publish needs.
 *
 * The webhook door only holds the id `storeMessage` handed back, and the patch
 * has to reach the thread's inbox lens channels — publishing to `null` would
 * route it to the admin-only channel and nobody watching the thread would see it.
 */
export async function resolveMessagePublishTarget(
  db: Database,
  messageId: string
): Promise<{ threadId: string; inboxId: string | null } | null> {
  const [row] = await db
    .select({ threadId: schema.Message.threadId, inboxId: schema.Thread.inboxId })
    .from(schema.Message)
    .innerJoin(schema.Thread, eq(schema.Message.threadId, schema.Thread.id))
    .where(eq(schema.Message.id, messageId))
    .limit(1)
  return row ? { threadId: row.threadId, inboxId: row.inboxId ?? null } : null
}

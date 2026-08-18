// packages/lib/src/messages/split-send.ts

import type { ProviderCapabilities } from '../providers/types'
import type { SendMessageInput } from './types/message-sending.types'

/** The two capability fields that decide whether one send fits in one message. */
export type SendShapeCapabilities = Pick<
  ProviderCapabilities,
  'maxAttachmentsPerMessage' | 'canSendTextWithAttachment'
>

/**
 * Split one composer send into the messages a provider can actually carry.
 *
 * **Why this exists rather than a loop inside the provider.** Meta's Send API
 * takes `text` OR one `attachment`, so a caption with two photos is three Graph
 * calls and three `mid`s — but a `Message` row holds ONE `externalId`, and that
 * is the key ingest dedupes on. A provider that sent three and reported one
 * would leave two ids belonging to no row of ours, and the next scheduled sync
 * (FB/IG are in `sync-all-messages-job`) would re-import them as duplicate
 * outbound messages. Splitting up here gives every provider id a row.
 *
 * It also matches what the customer sees: Messenger renders three bubbles
 * whatever we do, so three rows is the honest model, not a workaround.
 *
 * The parts are ordered text-first, then one message per attachment in composer
 * order.
 *
 * Field ownership across parts, all for the same reason — these belong to the
 * *send*, not to each message, so only the first part may claim them:
 * `messageId` (a duplicated RFC Message-ID would collide), `draftMessageId` (one
 * draft is consumed once), `signatureId` and `includePreviousMessage` (a
 * signature appended to an attachment-only message becomes that message's body).
 *
 * @returns `[input]` unchanged when the provider can carry it in one message —
 * which is every email provider, and every send with no attachments.
 */
export function splitSendForProvider(
  input: SendMessageInput,
  capabilities: SendShapeCapabilities
): SendMessageInput[] {
  const attachmentIds = input.attachmentIds ?? []
  if (attachmentIds.length === 0) return [input]

  const maxPerMessage = capabilities.maxAttachmentsPerMessage ?? Number.POSITIVE_INFINITY
  const canCombine = capabilities.canSendTextWithAttachment !== false
  const hasText = !!(input.textHtml?.trim() || input.textPlain?.trim())

  const fitsInOne = attachmentIds.length <= maxPerMessage && (canCombine || !hasText)
  if (fitsInOne) return [input]

  const parts: SendMessageInput[] = []
  if (hasText) {
    parts.push({ ...input, attachmentIds: undefined })
  }

  const chunkSize = Number.isFinite(maxPerMessage)
    ? Math.max(1, maxPerMessage)
    : attachmentIds.length
  for (let index = 0; index < attachmentIds.length; index += chunkSize) {
    parts.push({
      ...input,
      attachmentIds: attachmentIds.slice(index, index + chunkSize),
      // An attachment-only message. Carrying the text again would send it twice —
      // the whole point of the text part above.
      textHtml: null,
      textPlain: null,
      messageId: undefined,
      draftMessageId: null,
      signatureId: null,
      includePreviousMessage: false,
    })
  }

  // The first part keeps whatever the caller passed; everything after it gives up
  // the send-level fields. When there is no text the first ATTACHMENT part is the
  // one that inherits them.
  const [first, ...rest] = parts
  if (!first) return [input]
  const head = hasText
    ? first
    : {
        ...first,
        messageId: input.messageId,
        draftMessageId: input.draftMessageId,
        signatureId: input.signatureId,
        includePreviousMessage: input.includePreviousMessage,
      }

  return [head, ...rest]
}

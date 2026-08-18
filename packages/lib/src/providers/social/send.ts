// packages/lib/src/providers/social/send.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq } from 'drizzle-orm'
import { BadRequestError } from '../../errors'
import { type MessagingType, sendMessage } from './api'
import type { SocialPlatform } from './types'

const logger = createScopedLogger('social-send')

/**
 * Meta's standard messaging window. A page may reply freely for 24 hours after
 * the user's last message; outside it, a plain `RESPONSE` send is rejected.
 */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The only tag we use outside the window.
 *
 * `HUMAN_AGENT` buys 7 days and means exactly what it says: a human is typing.
 * The three legacy tags (`ACCOUNT_UPDATE`, `CONFIRMED_EVENT_UPDATE`,
 * `POST_PURCHASE_UPDATE`) were retired 2026-04-27 and now fail with error 100.
 *
 * Requires the Human Agent feature at App Review; in development mode it works
 * for people who hold a role on the app.
 */
const HUMAN_AGENT_TAG = 'HUMAN_AGENT'

export interface SocialSendPolicy {
  messagingType: MessagingType
  tag?: string
  lastInboundAt: Date | null
  withinWindow: boolean
}

/**
 * When did this conversation last hear from the customer?
 *
 * Read off `Message` rather than `ThreadMeta` so it stays correct for a thread
 * whose meta has not been recomputed yet — the window is a compliance boundary,
 * not a display value.
 */
export async function getLastInboundAt(
  integrationId: string,
  externalThreadId: string
): Promise<Date | null> {
  const [row] = await db
    .select({ receivedAt: schema.Message.receivedAt })
    .from(schema.Message)
    .where(
      and(
        eq(schema.Message.integrationId, integrationId),
        eq(schema.Message.externalThreadId, externalThreadId),
        eq(schema.Message.isInbound, true)
      )
    )
    .orderBy(desc(schema.Message.receivedAt))
    .limit(1)

  return row?.receivedAt ?? null
}

/**
 * Decide how a send may leave the building.
 *
 * Three outcomes, and the third is the one that matters:
 *
 * - inside the 24h window → ordinary `RESPONSE`
 * - outside, sent by a human → `MESSAGE_TAG` + `HUMAN_AGENT`
 * - outside, sent by automation → **blocked**
 *
 * Tagging automated traffic as `HUMAN_AGENT` is a policy violation Meta detects
 * and acts on, and the cost lands on the page, not on us. An agent or workflow
 * that wants to reach a customer after 24 hours of silence needs a different
 * channel, not a dishonest tag.
 *
 * @param automated whether this send originates from an agent/workflow rather
 * than a person in the composer (`MessageSenderService.isAutomatedSend`).
 */
export function resolveSendPolicy(args: {
  lastInboundAt: Date | null
  automated: boolean
  now?: Date
}): SocialSendPolicy {
  const { lastInboundAt, automated, now = new Date() } = args

  const withinWindow =
    lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < MESSAGING_WINDOW_MS

  if (withinWindow) {
    return { messagingType: 'RESPONSE', lastInboundAt, withinWindow }
  }

  if (automated) {
    throw new BadRequestError(
      lastInboundAt
        ? 'This conversation is outside Meta’s 24-hour messaging window. Automated replies cannot be sent; a teammate can still reply manually.'
        : 'Meta only allows a page to message someone who messaged first. There is no inbound message on this conversation to reply to.'
    )
  }

  // A first-contact send (no inbound at all) is not something a tag can rescue —
  // Meta requires the user to have messaged the page. Let it go out tagged
  // anyway so the API's own rejection is what surfaces, with the real reason,
  // rather than us guessing at policy we cannot fully model.
  return { messagingType: 'MESSAGE_TAG', tag: HUMAN_AGENT_TAG, lastInboundAt, withinWindow }
}

export interface SendSocialMessageArgs {
  platform: SocialPlatform
  integrationId: string
  /** Page id (Messenger) or IG business account id. */
  pageId: string
  pageAccessToken: string
  recipientId: string
  text: string
  externalThreadId?: string
  automated?: boolean
}

/**
 * Send one DM, applying the messaging-window policy.
 *
 * @returns the `mid` Meta assigned, stamped as the message's `externalId` so a
 * webhook echo or a later REST sync of the same message dedupes against it.
 */
export async function sendSocialMessage(
  args: SendSocialMessageArgs
): Promise<{ messageId?: string; policy: SocialSendPolicy }> {
  const { platform, integrationId, pageId, pageAccessToken, recipientId, text } = args

  const lastInboundAt = args.externalThreadId
    ? await getLastInboundAt(integrationId, args.externalThreadId)
    : null

  const policy = resolveSendPolicy({ lastInboundAt, automated: args.automated === true })

  logger.info('Sending social message', {
    platform,
    integrationId,
    messagingType: policy.messagingType,
    withinWindow: policy.withinWindow,
  })

  const { messageId } = await sendMessage({
    pageId,
    pageAccessToken,
    recipientId,
    text,
    messagingType: policy.messagingType,
    tag: policy.tag,
  })

  return { messageId, policy }
}

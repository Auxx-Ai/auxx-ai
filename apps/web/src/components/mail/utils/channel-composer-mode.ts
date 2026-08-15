// apps/web/src/components/mail/utils/channel-composer-mode.ts

import { getComposerCapabilities } from '@auxx/lib/channels/client'

/**
 * Whether a channel's threads present an always-on composer instead of the
 * email "click Reply to reveal" flow.
 *
 * Every non-`email` channel does. A conversational thread (web chat, SMS/Quo,
 * WhatsApp, Facebook/Instagram DMs) has one counterparty and one obvious next
 * action, so hiding the input behind a Reply click is friction email earns —
 * because email has forwarding, reply-all, and a per-message choice of who you
 * are answering — and messaging does not.
 *
 * Reads `PlatformCapabilities.channel` from the single capability map in
 * `@auxx/lib/channels/client` rather than a local provider list. The previous
 * `provider === 'chat'` check is exactly why SMS threads shipped with no
 * reachable composer at all: the affordance was keyed to one provider name
 * instead of to the property that actually motivates it.
 *
 * Unknown or absent providers read as email, so anything not yet in the
 * capability map keeps today's click-to-reveal behaviour.
 *
 * @param provider Raw `Integration.provider` value (lowercase enum, e.g. `'google'`, `'openphone'`).
 */
export function channelUsesAlwaysOnComposer(provider: string | null | undefined): boolean {
  if (!provider) return false
  const capabilities = getComposerCapabilities(provider)
  if (!capabilities) return false
  return capabilities.channel !== 'email'
}

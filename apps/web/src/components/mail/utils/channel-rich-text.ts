// apps/web/src/components/mail/utils/channel-rich-text.ts

import { getComposerCapabilities } from '@auxx/lib/channels/client'

/**
 * Whether a channel provider can carry sender-authored rich text (HTML).
 *
 * Only `email`-channel providers do. Every `messaging` provider (SMS, Quo,
 * WhatsApp, Facebook/Instagram DMs, web chat) is a plain-text transport: the
 * body arrives as `textPlain`, there is no untrusted sender markup, and
 * rendering it through `SandboxedEmailHtml` wraps a 13-character text message
 * in a CSP iframe — wrong, fragile, and the reason a plain SMS could render as
 * invisible text.
 *
 * Reads `PlatformCapabilities.richText` — the single capability map in
 * `@auxx/lib/channels/client` — rather than a local provider list, so a new
 * channel is described in exactly one place. It is the same flag the composer
 * reads to send `textHtml: null`, which is precisely what the thread view then
 * has to render.
 *
 * Unknown or absent providers fall back to `true` — email is the default shape
 * and a message with real HTML must never be dumped as raw markup.
 *
 * @param provider Raw `Integration.provider` value (lowercase enum, e.g. `'google'`, `'openphone'`).
 */
export function supportsRichText(provider: string | null | undefined): boolean {
  if (!provider) return true
  const capabilities = getComposerCapabilities(provider)
  if (!capabilities) return true
  return capabilities.richText
}

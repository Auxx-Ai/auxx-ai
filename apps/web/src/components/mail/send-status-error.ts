// apps/web/src/components/mail/send-status-error.ts

/**
 * Provider errors are persisted verbatim on `Message.providerError`, and the
 * provider registry embeds the raw integration id in its copy (see
 * `packages/lib/src/providers/provider-registry-service.ts`). That id is
 * meaningless to an agent reading the thread list, so the id is swapped for the
 * channel's display name at render time — the channel store already holds every
 * channel, so no extra fetch is needed to resolve it.
 */

/** Cuid-ish token following the literal word `Integration` in a provider error. */
const INTEGRATION_ID_PATTERN = 'Integration ([A-Za-z0-9_-]{16,})'

/**
 * Pulls the integration id out of a provider error so the caller can look the
 * channel up. Returns undefined when the error doesn't name one.
 */
export function extractIntegrationId(error?: string | null): string | undefined {
  if (!error) return undefined
  return new RegExp(INTEGRATION_ID_PATTERN).exec(error)?.[1]
}

/**
 * Rewrites a raw provider error into copy an agent can act on, naming the
 * channel instead of its id. Falls back to a generic noun when the channel
 * isn't in the store (deleted, or another member's personal channel).
 */
export function humanizeSendError(
  error: string | null | undefined,
  channelName?: string | null
): string | null {
  if (!error) return null

  const name = channelName?.trim() || 'This channel'

  // The re-auth error is the common one and reads like a stack trace
  // ("User must re-connect the integration") — replace it wholesale.
  if (/requires re-authentication/i.test(error)) {
    return `${name} needs to be reconnected. Its authorization has expired.`
  }

  return error.replace(new RegExp(INTEGRATION_ID_PATTERN, 'g'), name)
}

// packages/lib/src/ingest/filtering/echoed-message-id.ts

/** Custom `x-` header outbound sends stamp with our own `Message.id`. */
const ECHOED_MESSAGE_ID_HEADER = 'x-auxxai-message-id'

/**
 * Reads our own `Message.id` back off a provider's raw header list — the
 * `X-AuxxAi-Message-Id` header an outbound send stamped (Gmail, SES/Nodemailer,
 * Outlook — see `channel-provider.interface.ts:50-56`).
 *
 * Shared by the postal-mime-backed ingest doors (SES, IMAP), which hand back
 * headers as `{ key, value }` pairs. Outlook has its own local copy of this
 * same logic over Graph's `{ name, value }` shape
 * (`providers/outlook/outlook-provider.ts`) — not unified here because Graph's
 * `internetMessageHeaders` never flow through this module.
 *
 * Deliberately case-insensitive: header casing is not guaranteed to round-trip
 * through every transport, only that the `x-` prefixed name itself survives.
 * First occurrence wins.
 *
 * Transient only — this value is used at ingest time to resolve a suppression
 * (`store-message.ts`) or reconciliation (`message-reconciler.service.ts`)
 * target and is never itself persisted into `Message.metadata.headers`.
 */
export function pickEchoedMessageId(
  entries: Array<{ key?: string | null; value?: string | null }> | undefined
): string | null {
  if (!entries?.length) return null
  for (const entry of entries) {
    if (entry?.key?.toLowerCase().trim() !== ECHOED_MESSAGE_ID_HEADER) continue
    const value = entry.value?.trim()
    if (value) return value
  }
  return null
}

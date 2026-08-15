// packages/lib/src/ingest/threads/default-subject.ts

import { PLATFORM_CAPABILITIES, type PlatformCapabilities } from '../../channels/client'

/**
 * The value to store in `Thread.subject` when a message carries none.
 *
 * `Thread.subject` is NOT NULL, so something has to go in. For email that has always been the
 * literal `'No Subject'`, and it renders as the thread title.
 *
 * **On a channel with no concept of a subject, that placeholder is actively harmful.** SMS,
 * WhatsApp and DMs are titled at render time from the thread's participant
 * (`resolveThreadTitle`), and that fallback only runs when the stored subject is *blank* — a
 * non-empty `'No Subject'` wins over it and pins every ingested SMS thread to a meaningless
 * title. The compose path already stores `''` here, which is why an outbound-first SMS thread
 * titled correctly while the ingested one next to it did not.
 *
 * So: blank on subject-less channels, `'No Subject'` everywhere else. The choice keys off
 * `PlatformCapabilities.subject` — the same flag the composer uses to decide whether to render a
 * subject field, and the same one `channelCarriesSubject` reads on the render side, so the two
 * ends cannot drift.
 *
 * A provider we do not recognise is treated as subject-carrying: email is the default and
 * changing thousands of existing threads' titles is not something an unknown key should do.
 *
 * Deliberately NOT a synthetic participant-derived title. `Thread.subject` is a search index
 * (GIN full-text + trigram) and the mail lens grants subject separately from participant
 * identity, so writing a name in here would leak it into a tier that is only supposed to see
 * that a thread exists.
 */
export function defaultThreadSubject(
  subject: string | null | undefined,
  provider: string | null | undefined
): string {
  if (subject != null && subject !== '') return subject

  const caps = PLATFORM_CAPABILITIES[provider as keyof typeof PLATFORM_CAPABILITIES] as
    | PlatformCapabilities
    | undefined

  return caps?.subject === false ? '' : 'No Subject'
}

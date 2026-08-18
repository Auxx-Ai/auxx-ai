// apps/web/src/components/threads/utils/participant-label.ts

import { initialsFor } from '~/components/mail/utils/participant-initials'
import type { ParticipantMeta } from '../store'
import { formatParticipantIdentifier } from './thread-title'

/**
 * The slice of a participant label resolution needs. A `Pick` so any surface
 * holding a full {@link ParticipantMeta} can pass it straight through;
 * `contactName`/`isInternal` are optional so narrower slices (and pre-Phase-1
 * payloads) still resolve.
 */
export type LabelParticipant = Pick<
  ParticipantMeta,
  'name' | 'identifier' | 'identifierType' | 'displayName' | 'initials'
> &
  Partial<Pick<ParticipantMeta, 'contactName' | 'isInternal'>>

/**
 * The contact name for a participant, when it should win the label.
 *
 * Internal participants ignore `contactName`: their name is pinned to the org
 * member profile at ingest, and a stray auto-created contact must not rename a
 * teammate. `contactName` itself is already normalized server-side (never
 * empty, never the identifier echoed back).
 */
function winningContactName(meta: LabelParticipant): string | null {
  if (meta.isInternal) return null
  return meta.contactName?.trim() || null
}

/**
 * The ONE label precedence for mail/chat participant surfaces:
 *
 *   linked contact name > header-derived name > formatted identifier
 *
 * The formatted-identifier rung renders phones as PHONE_INTL
 * (`+1 888 915 5797`) instead of raw E.164 — previously only thread titles and
 * the details line formatted them. Chat visitors fall through to the server's
 * friendly `Chat user #xxxx` handle in `displayName`.
 */
export function participantLabel(meta: LabelParticipant): string {
  const contactName = winningContactName(meta)
  if (contactName) return contactName

  if (meta.name?.trim()) return meta.displayName?.trim() || meta.name.trim()

  const formatted = formatParticipantIdentifier(meta)
  if (formatted) return formatted

  return meta.displayName?.trim() || meta.identifier
}

/**
 * Avatar initials for a participant, following the WINNING label: when the
 * contact name wins, initials derive from it (a stored `BS` from headers must
 * not pair with a renamed contact label); otherwise the server-persisted
 * `initials` keep working (preserves the CHAT_VISITOR `#xxxx` handling).
 */
export function participantInitials(meta?: LabelParticipant | null): string {
  if (!meta) return '?'
  const contactName = winningContactName(meta)
  if (contactName) {
    return initialsFor({ initials: '', displayName: contactName })
  }
  return initialsFor(meta)
}

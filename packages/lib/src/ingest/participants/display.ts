// packages/lib/src/ingest/participants/display.ts

import { IdentifierType as IdentifierTypeEnum } from '@auxx/database/enums'

/**
 * Up-to-2 initials from a name string, uppercased. Letters only.
 *
 * Takes the FIRST letter *within* each word (scanning past leading
 * punctuation), not `charAt(0)` — so a punctuation-led word like
 * `(Shopify)` still contributes `S`. Words with no letters are skipped.
 */
export function calculateInitials(name?: string | null): string | undefined {
  if (!name) return undefined
  return (
    name
      .trim()
      .split(/\s+/)
      .map((word) => word.match(/[a-zA-Z]/)?.[0] ?? '')
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || undefined
  )
}

/** Display name preference: trimmed name → identifier (truncated if very long) → undefined. */
export function calculateDisplayName(
  name?: string | null,
  identifier?: string | null
): string | undefined {
  const trimmedName = name?.trim()
  if (trimmedName) return trimmedName
  const trimmedIdentifier = identifier?.trim()
  if (trimmedIdentifier) {
    if (trimmedIdentifier.includes('@')) return trimmedIdentifier
    if (trimmedIdentifier.match(/^\+?\d+$/)) return trimmedIdentifier
    if (trimmedIdentifier.length > 20) return `${trimmedIdentifier.substring(0, 15)}...`
    return trimmedIdentifier
  }
  return undefined
}

/**
 * Identifier types whose value is an opaque platform id rather than a label a
 * person would recognise — a Meta PSID/IGSID and a chat visitor's session cuid.
 *
 * These are excluded from the `displayName` fallback below, and that exclusion
 * is the whole point of it. `calculateDisplayName` restates the identifier when
 * no name is known, and `full_name` is the contact's PRIMARY DISPLAY FIELD — so
 * the fallback wrote a 17-digit PSID into First Name and made it the record's
 * `EntityInstance.displayName`, where nothing downstream can tell it apart from
 * a real name. An empty name is recoverable: `resolveSocialCounterpartName`
 * fills the participant in within seconds of the first inbound message, and
 * `repairContactNameFromParticipant` patches a contact minted inside that
 * window.
 *
 * EMAIL and PHONE deliberately KEEP the fallback. An address and a number are
 * labels a human reads, they are what the contacts list has always shown for a
 * nameless sender, and blanking them would leave the whole mail path nameless.
 */
const OPAQUE_IDENTIFIER_TYPES: ReadonlySet<string> = new Set([
  IdentifierTypeEnum.FACEBOOK_PSID,
  IdentifierTypeEnum.INSTAGRAM_IGSID,
  IdentifierTypeEnum.CHAT_VISITOR,
])

/**
 * Split a participant's name into first/last parts.
 *
 * Falls back to `displayName` when there is no usable name — but only for the
 * identifier types whose displayName is a human-readable label. See
 * {@link OPAQUE_IDENTIFIER_TYPES}. An absent `identifierType` is treated as
 * non-opaque, preserving the historical behaviour for callers that do not know
 * it.
 */
export function getNamesFromParticipant(p: {
  name?: string | null
  displayName?: string | null
  identifierType?: string | null
}): {
  firstName?: string | null
  lastName?: string | null
} {
  const fallback =
    p.identifierType && OPAQUE_IDENTIFIER_TYPES.has(p.identifierType) ? null : p.displayName
  const name = p.name?.trim()
  if (!name) return { firstName: fallback, lastName: null }
  const parts = name.split(' ').filter(Boolean)
  if (parts.length <= 1) return { firstName: parts[0] || fallback, lastName: null }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

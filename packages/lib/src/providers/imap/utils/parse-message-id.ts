// packages/lib/src/providers/imap/utils/parse-message-id.ts

/**
 * Parses "folder:uid" format — handles folder names that may contain colons
 * by matching from the end (UID is always the last segment).
 */
export function parseMessageId(externalId: string): { folder: string; uid: number } | null {
  const lastColonIndex = externalId.lastIndexOf(':')

  if (lastColonIndex === -1 || lastColonIndex === 0) {
    return null
  }

  const folder = externalId.substring(0, lastColonIndex)
  const uidStr = externalId.substring(lastColonIndex + 1)
  const uid = parseInt(uidStr, 10)

  if (!folder || isNaN(uid) || uid <= 0) {
    return null
  }

  return { folder, uid }
}

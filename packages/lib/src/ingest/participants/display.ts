// packages/lib/src/ingest/participants/display.ts

/** Up-to-2 initials from a name string, uppercased. Letters only. */
export function calculateInitials(name?: string | null): string | undefined {
  if (!name) return undefined
  return (
    name
      .trim()
      .split(/\s+/)
      .map((word) => word.charAt(0))
      .filter((char) => char.match(/[a-zA-Z]/))
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
 * Split a participant's name into first/last parts. Falls back to displayName
 * if no usable name is present.
 */
export function getNamesFromParticipant(p: { name?: string | null; displayName?: string | null }): {
  firstName?: string | null
  lastName?: string | null
} {
  const name = p.name?.trim()
  if (!name) return { firstName: p.displayName, lastName: null }
  const parts = name.split(' ').filter(Boolean)
  if (parts.length <= 1) return { firstName: parts[0] || p.displayName, lastName: null }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

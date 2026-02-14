// src/lib/providers/provider-utils.ts
import { createScopedLogger } from '@auxx/logger'
import addressparser from 'addressparser'

const logger = createScopedLogger('provider-utils')

/**
 * Structure for participant info extracted by providers before sending to storage service.
 */
export interface ParticipantInputData {
  identifier: string // The raw identifier (email, phone, PSID, etc.)
  name?: string
  raw?: string // Original raw string if available
}

/**
 * Parses a single participant string (commonly an email format like "Name <addr>" or just "addr").
 * @param participantStr The raw string from the message header (e.g., From, To, Cc).
 * @returns ParticipantInputData object or null if parsing fails.
 */
export function parseParticipantString(participantStr: string): ParticipantInputData | null {
  if (!participantStr) return null
  const trimmedStr = participantStr.trim()

  try {
    const parsed = addressparser(trimmedStr)

    if (parsed && parsed.length > 0) {
      const { address, name } = parsed[0]

      if (address) {
        return { identifier: address, name: name || undefined, raw: trimmedStr }
      }
    }
  } catch (e) {
    logger.debug(`Error parsing participant with addressparser: ${e}`)
    // Continue to fallbacks
  }

  // Fallback: If it looks like an email address but didn't parse correctly
  if (trimmedStr.includes('@') && trimmedStr.includes('.')) {
    logger.debug(`Participant string "${trimmedStr}" matched fallback email pattern.`)
    return { identifier: trimmedStr, name: undefined, raw: trimmedStr }
  }

  // Fallback for non-email identifiers
  logger.warn(
    `Could not parse participant string as standard email format: "${trimmedStr}". Treating as identifier only.`
  )
  return { identifier: trimmedStr, name: undefined, raw: trimmedStr }
}

/**
 * Parses a string containing multiple comma-separated participants.
 * @param participantsStr The raw string from headers like To, Cc.
 * @returns An array of ParticipantInputData objects.
 */
export function parseMultipleParticipants(participantsStr: string): ParticipantInputData[] {
  if (!participantsStr) return []

  try {
    // addressparser natively handles comma-separated addresses per RFC specification
    const parsedAddresses = addressparser(participantsStr)

    return parsedAddresses
      .map(({ address, name }) => {
        if (!address) {
          logger.debug(
            `Skipping invalid address in multiple participants: ${JSON.stringify({ address, name })}`
          )
          return null
        }

        return {
          identifier: address,
          name: name || undefined,
          raw: name ? `${name} <${address}>` : address,
        }
      })
      .filter((p): p is ParticipantInputData => p !== null)
  } catch (e) {
    logger.warn(`Error parsing multiple participants: ${e}`)

    // Fallback to the old method if addressparser fails
    return participantsStr
      .split(',')
      .map((part) => parseParticipantString(part))
      .filter((p): p is ParticipantInputData => p !== null)
  }
}

/**
 * Calculates initials from a name (max 2 chars).
 * @param name The full name string.
 * @returns Uppercase initials or undefined.
 */
export function calculateInitials(name?: string | null): string | undefined {
  if (!name) return undefined
  return name
    .trim()
    .split(/\s+/) // Split by whitespace
    .map((word) => word.charAt(0))
    .filter((char) => char.match(/[a-zA-Z]/)) // Keep only letters
    .slice(0, 2) // Max 2 initials
    .join('')
    .toUpperCase()
}

/**
 * Calculates a display name (prioritizes name, falls back to identifier).
 * @param name The full name.
 * @param identifier The participant's identifier.
 * @returns The display name string or undefined.
 */
export function calculateDisplayName(
  name?: string | null,
  identifier?: string | null
): string | undefined {
  const trimmedName = name?.trim()
  if (trimmedName) return trimmedName

  const trimmedIdentifier = identifier?.trim()
  if (trimmedIdentifier) {
    // Basic formatting for display
    if (trimmedIdentifier.includes('@')) return trimmedIdentifier // Email
    if (trimmedIdentifier.match(/^\+?\d+$/)) return trimmedIdentifier // Phone
    // Truncate long opaque IDs for display
    if (trimmedIdentifier.length > 20) return trimmedIdentifier.substring(0, 15) + '...'
    return trimmedIdentifier
  }
  return undefined
}

/**
 * Checks if a value is defined (not null or undefined). Type guard.
 * @param value The value to check.
 */
export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null
}

/**
 * Checks if a batch response item is an error structure. Type guard.
 * @param response The item from a batch response array.
 */
export interface BatchError {
  error: { code: number; message: string; errors?: any[] }
}
export function isBatchError(response: any): response is BatchError {
  return response?.error && typeof response.error.code === 'number'
}

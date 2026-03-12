// packages/lib/src/email/inbound/sender-allowlist-guard.ts

import { PermanentProcessingError } from './errors'

/**
 * publicMailboxDomains lists public mailbox providers that cannot be wildcard-allowlisted.
 */
const publicMailboxDomains = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
])

/**
 * normalizeEmail normalizes an email-ish string for comparison.
 */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * extractDomain extracts the domain portion of an email address or pattern.
 */
function extractDomain(value: string): string {
  const atIndex = value.lastIndexOf('@')
  return atIndex >= 0 ? value.slice(atIndex + 1) : value
}

/**
 * isWildcardEntry checks whether an allowlist entry is a wildcard pattern.
 */
function isWildcardEntry(value: string): boolean {
  return value.startsWith('*@')
}

/**
 * isSenderMatch checks one sender against one allowlist entry.
 */
function isSenderMatch(sender: string, allowlistEntry: string): boolean {
  if (isWildcardEntry(allowlistEntry)) {
    return extractDomain(sender) === extractDomain(allowlistEntry)
  }

  return sender === allowlistEntry
}

/**
 * validateAllowedSenderEntry validates an allowlist entry and throws on invalid patterns.
 */
function validateAllowedSenderEntry(entry: string): void {
  if (!entry.includes('*')) return

  if (!isWildcardEntry(entry)) {
    throw new Error(`Invalid sender allowlist wildcard pattern: ${entry}`)
  }

  const domain = extractDomain(entry)
  if (publicMailboxDomains.has(domain)) {
    throw new Error(
      `Wildcard sender allowlist entries are not allowed for public mailbox domains: ${entry}`
    )
  }
}

/**
 * assertSenderAllowed enforces an integration sender allowlist.
 */
export function assertSenderAllowed(sender: string, allowlist: string[]): void {
  const normalizedSender = normalizeEmail(sender)
  const normalizedAllowlist = allowlist.map(normalizeEmail).filter(Boolean)

  for (const entry of normalizedAllowlist) {
    validateAllowedSenderEntry(entry)
  }

  if (normalizedAllowlist.length === 0) return

  const isAllowed = normalizedAllowlist.some((entry) => isSenderMatch(normalizedSender, entry))

  if (!isAllowed) {
    throw new PermanentProcessingError(
      `Sender ${normalizedSender} is not allowed for this forwarding integration`,
      'sender_rejected'
    )
  }
}

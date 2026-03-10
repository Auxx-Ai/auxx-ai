// packages/lib/src/providers/imap/constants.ts

/** IMAP connection timeout in milliseconds */
export const IMAP_CONNECTION_TIMEOUT_MS = 30_000

/** IMAP greeting timeout in milliseconds */
export const IMAP_GREETING_TIMEOUT_MS = 16_000

/** SMTP connection timeout in milliseconds */
export const SMTP_CONNECTION_TIMEOUT_MS = 30_000

/** SMTP greeting timeout in milliseconds */
export const SMTP_GREETING_TIMEOUT_MS = 15_000

/** SMTP socket timeout in milliseconds */
export const SMTP_SOCKET_TIMEOUT_MS = 120_000

/** LDAP operation timeout in milliseconds */
export const LDAP_TIMEOUT_MS = 15_000

/** Common sent folder name patterns across languages */
export const SENT_FOLDER_PATTERNS = [
  /^sent$/i,
  /^sent\s*(items|mail|messages)?$/i,
  /^envoy[eé]s?$/i, // French
  /^gesendet$/i, // German
  /^enviados$/i, // Spanish/Portuguese
  /^inviati$/i, // Italian
  /^verzonden$/i, // Dutch
  /^skickade?$/i, // Swedish
  /^sendt$/i, // Norwegian/Danish
  /^l[aä]hetetyt$/i, // Finnish
  /^\[gmail\]\/sent\s*mail$/i, // Gmail IMAP
]

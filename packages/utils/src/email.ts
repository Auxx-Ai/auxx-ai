/**
 *
 * @param input Markus Klooth<M4rkuskk@gmail.com>, "John Doe" <jon@description.com>, LALA@gmail.com
 * @returns [{name: 'Markus Klooth', address: 'm4rkuskk@gmail.com', raw: 'Markus Klooth <M4rkuskk@gmail.com>}]
 */
export function parseEmailString(input: string | undefined) {
  if (!input) return []

  // const emailRegex =
  //   /(?:"?([^"<]*)"?)?\s*<?([\w._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/gi
  return input.split(',').map((email) => {
    email = email.trim()

    const regex =
      /^(?:\s*"?([^"<>\r\n]+?)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>\s*$|^\s*([^<>@\s]+@[^<>@\s]+)\s*$/
    const match = email.match(regex)
    if (!match) return

    return {
      name: match[1] ? match[1].trim() : null,
      address: match[2] ? match[2].trim().toLowerCase() : match[3]?.trim().toLowerCase(),
      raw: email,
    }
  })
  // const emailRegex = /(?:"?([^"<]*)"?)?\s*<?([\w.-]+@[\w.-]+\.\w+)>?/gi

  // let match
  // while ((match = emailRegex.exec(input)) !== null) {
  //   const name = match[1]?.trim() || null
  //   let address = match[2]?.trim() || null
  //   let raw = match[0]?.trim()
  //   if (address) address = address.toLowerCase()
  //   result.push({ name, address, raw: match[0] })
  // }

  // return result
}

type Address = { name: string; address: string; raw: string }
export function formatEmailAddress(addresses?: Address | Address[]) {
  if (!addresses) return
  if (!Array.isArray(addresses)) addresses = [addresses]

  return addresses
    .map((address) => {
      if (!address.name) return address.address
      return `${address.name} <${address.address}>`
    })
    .join(', ')
}

// Converts "Name <hey@domain.com>" to "domain.com"
export function extractDomainFromEmail(email: string) {
  if (!email) return ''

  // Extract clean email address from formatted strings like "Name <email@domain.com>"
  const emailAddress = email.includes('<') ? extractEmailAddress(email) : email

  // Validate email has exactly one @ symbol
  if ((emailAddress.match(/@/g) || []).length !== 1) return ''

  // Extract domain using regex that supports:
  // - International characters (via \p{L})
  // - Multiple subdomains (e.g. sub1.sub2.domain.com)
  // - Common domain characters (letters, numbers, dots, hyphens)
  // - TLDs of 2 or more characters
  const domain = emailAddress.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)?.[1]
  return domain || ''
}

// Converts "John Doe <john.doe@gmail>" to "john.doe@gmail"
export function extractEmailAddress(email: string): string {
  // Standard email pattern that matches common email formats
  // Allows:
  // - Letters, numbers, dots, and plus signs in local part
  // - Standard domain formats
  // - Case insensitive
  // - Emails anywhere within text
  const emailPattern = /[a-zA-Z0-9.+]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i

  // Try last bracketed content first
  const match = email.match(/<([^<>]+)>$/)
  const matchContent = match?.[1]
  if (matchContent && emailPattern.test(matchContent.trim())) {
    return matchContent.trim()
  }

  // Fall back to finding any email in the string
  const rawMatch = email.match(emailPattern)
  return rawMatch ? rawMatch[0] : ''
}

export const formatEmail = (email: string | null): string | null => {
  if (!email) return null
  return email.trim().toLowerCase()
}

/**
 * Normalizes an email address for comparison
 * - Converts to lowercase
 * - For Gmail: removes dots and handles plus addressing
 * @param email The email address to normalize
 * @returns Normalized email address
 */
export function normalizeEmail(email: string): string {
  const lower = email.toLowerCase().trim();
  
  // For Gmail addresses, dots don't matter and + aliases should match
  if (lower.includes('@gmail.com') || lower.includes('@googlemail.com')) {
    const [localPart, domain] = lower.split('@');
    if (!localPart) return lower;
    // Remove plus addressing and dots from local part
    const baseLocal = localPart.split('+')[0] ?? localPart;
    return `${baseLocal.replace(/\./g, '')}@${domain}`;
  }
  
  // For other email providers, just lowercase and trim
  return lower;
}

/**
 * Checks if an email address belongs to a user
 * @param email Email address to check
 * @param userEmails Array of user's email addresses
 * @returns True if email belongs to user
 */
export function isUserEmail(email: string, userEmails: string[]): boolean {
  if (!email || !userEmails || userEmails.length === 0) {
    return false;
  }
  
  const normalizedEmail = normalizeEmail(email);
  return userEmails.some(userEmail => normalizeEmail(userEmail) === normalizedEmail);
}

/**
 * Extracts name from email header string
 * @param headerValue Email header like "John Doe <john@example.com>"
 * @returns Extracted name or undefined
 */
export function extractNameFromHeader(headerValue: string): string | undefined {
  if (!headerValue) return undefined;
  
  // Extract name from "Name <email>" format
  const match = headerValue.match(/^([^<]+)</);
  if (match && match[1]) {
    return match[1].trim();
  }
  
  // If no angle brackets, it might be just an email
  if (headerValue.includes('@')) {
    return undefined;
  }
  
  // Otherwise, the whole string might be a name
  return headerValue.trim();
}

/**
 * Validates if a string is a valid email address
 * @param email The string to validate
 * @returns True if valid email format
 */
export function isValidEmail(email: string): boolean {
  if (!email) return false;
  
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email.trim());
}

/**
 * Compares two email addresses accounting for provider-specific rules
 * @param email1 First email address
 * @param email2 Second email address
 * @returns True if emails are equivalent
 */
export function emailsAreEquivalent(email1: string, email2: string): boolean {
  if (!email1 || !email2) return false;
  return normalizeEmail(email1) === normalizeEmail(email2);
}

/**
 * Normalize Message-ID headers with angle brackets
 * Ensures proper format: <id@domain>
 */
export function normalizeMessageId(messageId: string | undefined): string | undefined {
  if (!messageId) return undefined
  
  // Ensure angle brackets for Message-ID
  if (!messageId.startsWith('<')) {
    messageId = '<' + messageId
  }
  if (!messageId.endsWith('>')) {
    messageId = messageId + '>'
  }
  
  return messageId
}

/**
 * Simple HTML to plain text converter
 * Converts basic HTML tags to text equivalents
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim()
}

/**
 * Format multiple email addresses for headers
 * Joins array of addresses with proper comma separation
 */
export function formatEmailList(emails: string[]): string {
  if (!emails || emails.length === 0) return ''
  return emails.filter(Boolean).join(', ')
}

/**
 * Encode non-ASCII text for email headers (RFC 2047)
 * Handles subjects and other headers with Unicode
 */
export function encodeEmailHeader(text: string): string {
  if (!text) return ''
  
  // Check if encoding is needed
  if (!/[^\x20-\x7E]/.test(text)) {
    return text
  }
  
  // RFC 2047 base64 encoding for non-ASCII
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`
}

/**
 * Validate email address against send-as list
 * Pure utility that validates from against allowlist
 */
export function validateSendAsAddress(
  from: string, 
  authorizedAddresses: string[]
): { valid: boolean; fallback?: string } {
  if (!from || !authorizedAddresses || authorizedAddresses.length === 0) {
    return { valid: false, fallback: authorizedAddresses?.[0] }
  }
  
  const normalizedFrom = normalizeEmail(from)
  const isValid = authorizedAddresses.some(addr => 
    normalizeEmail(addr) === normalizedFrom
  )
  
  return {
    valid: isValid,
    fallback: isValid ? undefined : authorizedAddresses[0]
  }
}

/**
 * Sanitize header value to prevent injection
 * Strips/escapes CR/LF and null bytes
 */
export function sanitizeHeaderValue(value: string): string {
  if (!value) return ''
  
  // Remove any control characters including CR, LF, and null bytes
  return value
    .replace(/[\r\n\0]/g, '')
    .trim()
}

/**
 * Build threading headers for email replies
 * Creates Message-ID, In-Reply-To, and References headers
 */
export function buildThreadingHeaders(options: {
  messageId?: string
  inReplyTo?: string
  references?: string | string[]
}): {
  'Message-ID'?: string
  'In-Reply-To'?: string
  'References'?: string
} {
  const headers: {
    'Message-ID'?: string
    'In-Reply-To'?: string
    'References'?: string
  } = {}
  
  if (options.messageId) {
    headers['Message-ID'] = normalizeMessageId(options.messageId)
  }
  
  if (options.inReplyTo) {
    headers['In-Reply-To'] = normalizeMessageId(options.inReplyTo)
  }
  
  if (options.references) {
    const refs = Array.isArray(options.references) 
      ? options.references 
      : options.references.split(/\s+/)
    
    headers['References'] = refs
      .map(ref => normalizeMessageId(ref))
      .filter(Boolean)
      .join(' ')
  }
  
  return headers
}

/**
 * Convert email list to Graph API recipient format
 * Maps string[] to Outlook Graph recipient objects
 */
export function toGraphRecipients(
  emails: string[]
): Array<{ emailAddress: { address: string } }> {
  if (!emails || emails.length === 0) return []
  
  return emails
    .filter(Boolean)
    .map(email => ({
      emailAddress: { address: email.trim() }
    }))
}

/**
 * Build Graph API file attachment object
 * Creates Outlook-compatible attachment structure
 */
export function buildGraphFileAttachment(attachment: {
  filename: string
  content: Buffer | string
  contentId?: string
  isInline?: boolean
}): Record<string, any> {
  const base64Content = Buffer.isBuffer(attachment.content)
    ? attachment.content.toString('base64')
    : Buffer.from(attachment.content).toString('base64')
  
  const fileAttachment: Record<string, any> = {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: attachment.filename,
    contentBytes: base64Content
  }
  
  if (attachment.isInline && attachment.contentId) {
    fileAttachment.contentId = attachment.contentId
    fileAttachment.isInline = true
  }
  
  return fileAttachment
}

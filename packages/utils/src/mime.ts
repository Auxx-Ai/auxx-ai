// packages/lib/src/utils/mime.ts

/**
 * RFC 2822 compliant header folding (998 character limit)
 * Folds long headers at whitespace boundaries
 */
export function foldMimeHeader(header: string, maxLength: number = 998): string {
  if (header.length <= maxLength) return header
  
  // Fold long headers at whitespace boundaries
  const parts: string[] = []
  let current = header
  
  while (current.length > maxLength) {
    // Find last whitespace before maxLength
    let splitPoint = current.lastIndexOf(' ', maxLength)
    if (splitPoint === -1) splitPoint = maxLength // Force split if no whitespace
    
    parts.push(current.substring(0, splitPoint))
    current = ' ' + current.substring(splitPoint + 1) // Continue with space
  }
  
  if (current) parts.push(current)
  return parts.join('\r\n')
}

/**
 * RFC 2231 compliant filename encoding for MIME headers
 * Handles non-ASCII characters in attachment filenames
 */
export function encodeRFC2231Filename(filename: string): string {
  // Check if filename needs encoding
  if (/^[a-zA-Z0-9._-]+$/.test(filename)) {
    return `filename="${filename}"`
  }
  
  // Encode using RFC 2231 for non-ASCII
  const asciiSafe = filename.replace(/[^\x20-\x7E]/g, '_')
  return `filename="${asciiSafe}"; filename*=utf-8''${encodeURIComponent(filename)}`
}

/**
 * RFC 2045 compliant quoted-printable encoding
 * Encodes text for MIME message bodies with 76-char line limits
 */
export function encodeQuotedPrintable(text: string): string {
  // RFC 2045 compliant quoted-printable encoding
  const lines: string[] = []
  const textLines = text.split(/\r?\n/)
  
  for (const line of textLines) {
    let encoded = ''
    let column = 0
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (!char) continue
      const charCode = char.charCodeAt(0)
      
      // Characters that need encoding
      if (charCode < 0x20 || charCode > 0x7E || char === '=' ||
          (char === ' ' && i === line.length - 1)) { // Trailing space
        const hex = charCode.toString(16).toUpperCase().padStart(2, '0')
        const encodedChar = `=${hex}`
        
        // Check if we need a soft line break
        if (column + encodedChar.length > 75) {
          encoded += '=\r\n'
          column = 0
        }
        
        encoded += encodedChar
        column += encodedChar.length
      } else {
        // Regular character
        if (column >= 75) {
          encoded += '=\r\n'
          column = 0
        }
        
        encoded += char
        column++
      }
    }
    
    lines.push(encoded)
  }
  
  return lines.join('\r\n')
}

/**
 * RFC 2045 compliant base64 encoding with line breaks
 * Wraps base64 content at 76 characters per line
 */
export function encodeBase64WithLineBreaks(
  content: Buffer | string, 
  lineLength: number = 76
): string {
  const base64Content = Buffer.isBuffer(content)
    ? content.toString('base64')
    : Buffer.from(content).toString('base64')
  
  const lines: string[] = []
  for (let i = 0; i < base64Content.length; i += lineLength) {
    lines.push(base64Content.slice(i, Math.min(i + lineLength, base64Content.length)))
  }
  
  return lines.join('\r\n')
}

/**
 * Generate a safe MIME boundary string
 * Creates random boundary that won't conflict with content
 */
export function generateMimeBoundary(): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let boundary = 'boundary_'
  for (let i = 0; i < 16; i++) {
    boundary += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return boundary
}

/**
 * Validate MIME message structure
 * Checks for proper boundaries, headers, and line limits
 */
export function validateMimeStructure(message: string): { 
  valid: boolean
  errors: string[]
  lineLengthViolations?: Array<{ line: number; length: number }>
} {
  const errors: string[] = []
  const lineLengthViolations: Array<{ line: number; length: number }> = []
  
  // Split into lines and check lengths
  const lines = message.split('\r\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line && line.length > 998) {
      lineLengthViolations.push({ line: i + 1, length: line.length })
    }
  }
  
  if (lineLengthViolations.length > 0) {
    errors.push(`Found ${lineLengthViolations.length} lines exceeding RFC 822 limit of 998 characters`)
  }
  
  // Check for proper CRLF line endings
  if (message.includes('\n') && !message.includes('\r\n')) {
    errors.push('Message contains LF without CR (should be CRLF)')
  }
  
  // Check for headers
  const headerEndIndex = message.indexOf('\r\n\r\n')
  if (headerEndIndex === -1) {
    errors.push('No header/body separator (double CRLF) found')
  }
  
  // Check for required headers
  const headers = headerEndIndex > -1 ? message.substring(0, headerEndIndex) : message
  if (!headers.match(/^MIME-Version:/mi)) {
    errors.push('Missing required MIME-Version header')
  }
  
  // Check multipart boundaries
  const contentTypeMatch = headers.match(/^Content-Type:\s*multipart\/(.*?);\s*boundary="?([^";\r\n]+)"?/mi)
  if (contentTypeMatch?.[2]) {
    const boundary = contentTypeMatch[2]
    const boundaryRegex = new RegExp(`^--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gm')
    const boundaryMatches = message.match(boundaryRegex)
    
    if (!boundaryMatches || boundaryMatches.length < 2) {
      errors.push('Multipart message missing proper boundary markers')
    }
    
    const endBoundary = `--${boundary}--`
    if (!message.includes(endBoundary)) {
      errors.push('Multipart message missing end boundary')
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    lineLengthViolations: lineLengthViolations.length > 0 ? lineLengthViolations : undefined
  }
}

/**
 * Ensure CRLF line endings in MIME message
 * Normalizes line endings to \r\n per RFC standards
 */
export function ensureCRLF(message: string): string {
  // Replace all line ending variations with CRLF
  return message
    .replace(/\r\n/g, '\n')  // Normalize CRLF to LF first
    .replace(/\r/g, '\n')     // Normalize CR to LF
    .replace(/\n/g, '\r\n')   // Convert all LF to CRLF
}

/**
 * Parse multipart/mixed response
 * Generic MIME parsing for batch responses
 */
export function parseMultipartMixedResponse(
  text: string, 
  contentType: string
): Array<{ headers: Record<string, string>; body: string }> {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/)
  if (!boundaryMatch?.[1]) {
    throw new Error('No boundary found in Content-Type header')
  }

  const boundary = boundaryMatch[1].replace(/^"|"$/g, '')
  const parts = text.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  
  const responses: Array<{ headers: Record<string, string>; body: string }> = []
  
  for (const part of parts) {
    if (!part.trim() || part.trim() === '--') continue
    
    const headerEndIndex = part.indexOf('\r\n\r\n')
    if (headerEndIndex === -1) continue
    
    const headerSection = part.substring(0, headerEndIndex)
    const body = part.substring(headerEndIndex + 4)
    
    const headers: Record<string, string> = {}
    const headerLines = headerSection.split(/\r?\n/)
    
    for (const line of headerLines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex > -1) {
        const key = line.substring(0, colonIndex).trim()
        const value = line.substring(colonIndex + 1).trim()
        headers[key] = value
      }
    }
    
    responses.push({ headers, body: body.trim() })
  }
  
  return responses
}

/**
 * Validate line lengths per RFC 822 (998 char limit)
 * Returns violations for lines exceeding limits
 */
export function validateLineLengths(
  message: string, 
  maxLength: number = 998
): Array<{ line: number; length: number }> {
  const violations: Array<{ line: number; length: number }> = []
  const lines = message.split('\r\n')
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line && line.length > maxLength) {
      violations.push({ line: i + 1, length: line.length })
    }
  }
  
  return violations
}
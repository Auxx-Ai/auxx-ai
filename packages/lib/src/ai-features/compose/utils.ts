// packages/lib/src/ai-features/compose/utils.ts

/**
 * Truncate text to specified length
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text

  // Find last complete word before limit
  const truncated = text.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')

  if (lastSpace > 0) {
    return truncated.substring(0, lastSpace) + '...'
  }

  return truncated + '...'
}

/**
 * Estimate token count for text
 * Rough estimate: 1 token ≈ 4 characters
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Validate and sanitize email content
 */
export function validateEmailContent(content: string): {
  isValid: boolean
  error?: string
} {
  if (!content || content.trim().length === 0) {
    return { isValid: false, error: 'Content is empty' }
  }

  if (content.length > 100000) {
    return { isValid: false, error: 'Content exceeds maximum length' }
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // Event handlers
    /<iframe/i,
    /<embed/i,
    /<object/i,
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(content)) {
      return { isValid: false, error: 'Content contains potentially unsafe elements' }
    }
  }

  return { isValid: true }
}

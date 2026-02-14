// packages/lib/src/ai-features/compose/utils.ts

/**
 * Strip HTML tags from content
 */
export function stripHtml(html: string): string {
  // Remove script and style tags with their content
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

  // Replace br tags with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n')

  // Replace p and div tags with newlines
  text = text.replace(/<\/(p|div)>/gi, '\n')

  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')

  // Clean up whitespace
  text = text
    .replace(/\n\s*\n+/g, '\n\n') // Multiple newlines to double
    .replace(/[ \t]+/g, ' ') // Multiple spaces to single
    .trim()

  return text
}

/**
 * Convert HTML to TipTap JSON format
 * This is a simplified version that creates basic TipTap structure
 */
export function convertHtmlToTiptap(html: string): any {
  // Clean the HTML first
  const cleanHtml = sanitizeHtml(html)

  // Parse HTML into paragraphs
  const paragraphs = cleanHtml
    .split(/<\/p>|<\/div>/)
    .map((p) => p.replace(/<p[^>]*>|<div[^>]*>/gi, ''))
    .filter((p) => p.trim())

  // Build TipTap document structure
  const doc = {
    type: 'doc',
    content: paragraphs.map((paragraph) => {
      const content = parseInlineElements(paragraph)
      return {
        type: 'paragraph',
        content: content.length > 0 ? content : [{ type: 'text', text: paragraph }],
      }
    }),
  }

  return doc
}

/**
 * Parse inline elements like bold, italic, links
 */
function parseInlineElements(text: string): any[] {
  const elements: any[] = []
  let remaining = text

  // Simple regex patterns for inline elements
  const patterns = [
    { regex: /<strong>(.*?)<\/strong>/gi, mark: 'bold' },
    { regex: /<b>(.*?)<\/b>/gi, mark: 'bold' },
    { regex: /<em>(.*?)<\/em>/gi, mark: 'italic' },
    { regex: /<i>(.*?)<\/i>/gi, mark: 'italic' },
    { regex: /<u>(.*?)<\/u>/gi, mark: 'underline' },
  ]

  // Process each pattern
  for (const pattern of patterns) {
    remaining = remaining.replace(pattern.regex, (match, content) => {
      elements.push({
        type: 'text',
        text: content,
        marks: [{ type: pattern.mark }],
      })
      return `__PROCESSED_${elements.length - 1}__`
    })
  }

  // Handle links
  remaining = remaining.replace(
    /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi,
    (match, href, content) => {
      elements.push({
        type: 'text',
        text: content,
        marks: [{ type: 'link', attrs: { href } }],
      })
      return `__PROCESSED_${elements.length - 1}__`
    }
  )

  // Process remaining text
  const parts = remaining.split(/__PROCESSED_\d+__/)
  const processedParts: any[] = []
  let elementIndex = 0

  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) {
      processedParts.push({ type: 'text', text: parts[i] })
    }
    if (i < parts.length - 1 && elementIndex < elements.length) {
      processedParts.push(elements[elementIndex++])
    }
  }

  return processedParts.length > 0 ? processedParts : [{ type: 'text', text: text }]
}

/**
 * Convert TipTap JSON to HTML
 * This is a simplified version that handles basic TipTap structure
 */
export function convertTiptapToHtml(json: any): string {
  if (!json || !json.content) {
    return ''
  }

  return json.content
    .map((node: any) => {
      switch (node.type) {
        case 'paragraph':
          return `<p>${renderContent(node.content)}</p>`
        case 'heading': {
          const level = node.attrs?.level || 1
          return `<h${level}>${renderContent(node.content)}</h${level}>`
        }
        case 'bulletList':
          return `<ul>${node.content
            .map((item: any) => `<li>${renderContent(item.content?.[0]?.content)}</li>`)
            .join('')}</ul>`
        case 'orderedList':
          return `<ol>${node.content
            .map((item: any) => `<li>${renderContent(item.content?.[0]?.content)}</li>`)
            .join('')}</ol>`
        case 'blockquote':
          return `<blockquote>${renderContent(node.content)}</blockquote>`
        case 'codeBlock':
          return `<pre><code>${renderContent(node.content)}</code></pre>`
        case 'horizontalRule':
          return '<hr>'
        default:
          return renderContent(node.content)
      }
    })
    .join('\n')
}

/**
 * Render content with marks (bold, italic, etc)
 */
function renderContent(content: any[]): string {
  if (!content) return ''

  return content
    .map((node: any) => {
      if (node.type === 'text') {
        let text = node.text || ''

        // Apply marks
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case 'bold':
                text = `<strong>${text}</strong>`
                break
              case 'italic':
                text = `<em>${text}</em>`
                break
              case 'underline':
                text = `<u>${text}</u>`
                break
              case 'strike':
                text = `<s>${text}</s>`
                break
              case 'code':
                text = `<code>${text}</code>`
                break
              case 'link':
                text = `<a href="${mark.attrs?.href || '#'}">${text}</a>`
                break
            }
          }
        }

        return text
      }

      return ''
    })
    .join('')
}

/**
 * Basic HTML sanitization
 */
function sanitizeHtml(html: string): string {
  // Remove script and style tags
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

  // Remove dangerous attributes
  clean = clean.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
  clean = clean.replace(/javascript:/gi, '')

  return clean
}

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

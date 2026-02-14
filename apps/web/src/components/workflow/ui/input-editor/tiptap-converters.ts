import type { JSONContent } from '@tiptap/core'

// .insertContent({ type: 'variable-node', attrs: { variableId: variable.id } })

// Convert TipTap JSON content to string with {{varId}} placeholders
export function tiptapToString(content: JSONContent): string {
  if (!content) return ''

  function processNode(node: JSONContent): string {
    if (node.type === 'text') {
      return node.text || ''
    }

    if (node.type === 'variable-node') {
      return `{{${node.attrs?.variableId || ''}}}`
    }

    if (node.type === 'paragraph') {
      const text = node.content?.map(processNode).join('') || ''
      return text
    }

    if (node.type === 'doc') {
      return node.content?.map(processNode).join('\n').trim() || ''
    }

    // Handle other block elements
    if (node.content) {
      return node.content.map(processNode).join('')
    }

    return ''
  }

  return processNode(content)
}

/**
 * Check if a string is valid JSON.
 * @param str - The string to check.
 * @returns True if the string is valid JSON, false otherwise.
 */
export function isJson(str: string): boolean {
  if (typeof str !== 'string') return false
  try {
    const parsed = JSON.parse(str)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

/**
 * Check if a value is a plain JSON object (not an array, function, etc).
 * @param value - The value to check.
 * @returns True if the value is a plain object, false otherwise.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Convert string with {{varId}} placeholders to TipTap JSON content
export function stringToTiptap(
  text: string,
  varData?: Record<string, { label: string }>
): JSONContent {
  if (isJsonObject(text)) {
    return text as JSONContent
  }

  if (!text) {
    return { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
  }

  const lines = (text + '').split('\n')
  const paragraphs: JSONContent[] = []

  for (const line of lines) {
    const content: JSONContent[] = []
    const tagPattern = /\{\{([^}]+)\}\}/g
    let lastIndex = 0
    let match

    while ((match = tagPattern.exec(line)) !== null) {
      // Add text before the tag
      if (match.index > lastIndex) {
        const textBefore = line.slice(lastIndex, match.index)
        if (textBefore) {
          content.push({ type: 'text', text: textBefore })
        }
      }

      // Add the tag
      const varId = match[1]
      content.push({ type: 'variable-node', attrs: { variableId: varId } })

      lastIndex = match.index + match[0].length
    }

    // Add remaining text
    if (lastIndex < line.length) {
      const remainingText = line.slice(lastIndex)
      if (remainingText) {
        content.push({ type: 'text', text: remainingText })
      }
    }

    // Create paragraph
    paragraphs.push({ type: 'paragraph', content: content.length > 0 ? content : [] })
  }

  return {
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph', content: [] }],
  }
}

// Extract all varIds from TipTap content
export function extractVarIds(content: JSONContent): string[] {
  const varIds: string[] = []

  function traverse(node: JSONContent) {
    if (node.type === 'variable-node' && node.attrs?.variableId) {
      varIds.push(node.attrs.variableId)
    }

    if (node.content) {
      node.content.forEach(traverse)
    }
  }

  traverse(content)
  return [...new Set(varIds)] // Remove duplicates
}

// Extract all tag varIds from string content ({{varId}} format)
export function extractVarIdsFromString(text: string): string[] {
  if (!text) return []

  const varIds: string[] = []
  const varPattern = /\{\{([^}]+)\}\}/g
  let match

  while ((match = varPattern.exec(text)) !== null) {
    const varId = match[1].trim()
    if (varId) {
      varIds.push(varId)
    }
  }

  return [...new Set(varIds)] // Remove duplicates
}

// Insert a variable tag at current cursor position
export function insertTag(editor: any, variableId: string, label?: string) {
  editor.chain().focus().insertContent({ type: 'variable-node', attrs: { variableId } }).run()
}

// Replace text selection with variable tag
export function replaceSelectionWithTag(editor: any, variableId: string, label?: string) {
  editor
    .chain()
    .focus()
    .deleteSelection()
    .insertContent({ type: 'variable-node', attrs: { variableId } })
    .run()
}

// Utility to validate tag pattern in string
export function validateTagPattern(text: string): { isValid: boolean; invalidTags: string[] } {
  const tagPattern = /\{\{([^}]*)\}\}/g
  const invalidTags: string[] = []
  let match

  while ((match = tagPattern.exec(text)) !== null) {
    const varId = match[1]
    if (!varId.trim()) {
      invalidTags.push(match[0])
    }
  }

  return { isValid: invalidTags.length === 0, invalidTags }
}

// apps/web/src/components/custom-fields/ui/calc-editor/formula-converters.ts

import type { JSONContent } from '@tiptap/core'

/**
 * Convert TipTap JSON content to formula string with {fieldId} placeholders.
 */
export function formulaToString(content: JSONContent): string {
  if (!content) return ''

  function processNode(node: JSONContent): string {
    if (node.type === 'text') {
      return node.text || ''
    }

    if (node.type === 'field') {
      return `{${node.attrs?.id || ''}}`
    }

    if (node.type === 'paragraph') {
      return node.content?.map(processNode).join('') || ''
    }

    if (node.type === 'doc') {
      return node.content?.map(processNode).join('').trim() || ''
    }

    if (node.content) {
      return node.content.map(processNode).join('')
    }

    return ''
  }

  return processNode(content)
}

/**
 * Convert formula string with {fieldId} to TipTap JSON content.
 */
export function stringToFormula(text: string): JSONContent {
  if (!text) {
    return { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
  }

  const content: JSONContent[] = []
  const fieldPattern = /\{([^{}]+)\}/g
  let lastIndex = 0
  let match

  while ((match = fieldPattern.exec(text)) !== null) {
    // Add text before the field
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index)
      if (textBefore) {
        content.push({ type: 'text', text: textBefore })
      }
    }

    // Add the field node
    const id = match[1]
    content.push({ type: 'field', attrs: { id } })

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex)
    if (remainingText) {
      content.push({ type: 'text', text: remainingText })
    }
  }

  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: content.length > 0 ? content : [] }],
  }
}

/**
 * Extract all field IDs from TipTap content.
 */
export function extractFieldIds(content: JSONContent): string[] {
  const fieldIds: string[] = []

  function traverse(node: JSONContent) {
    if (node.type === 'field' && node.attrs?.id) {
      fieldIds.push(node.attrs.id)
    }

    if (node.content) {
      node.content.forEach(traverse)
    }
  }

  traverse(content)
  return [...new Set(fieldIds)]
}

/**
 * Extract field IDs from formula string.
 */
export function extractFieldIdsFromString(text: string): string[] {
  if (!text) return []

  const fieldIds: string[] = []
  const fieldPattern = /\{([^{}]+)\}/g
  let match

  while ((match = fieldPattern.exec(text)) !== null) {
    const fieldId = match[1].trim()
    if (fieldId) {
      fieldIds.push(fieldId)
    }
  }

  return [...new Set(fieldIds)]
}

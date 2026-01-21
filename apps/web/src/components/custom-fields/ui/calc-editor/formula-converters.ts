// apps/web/src/components/custom-fields/ui/calc-editor/formula-converters.ts

import type { JSONContent } from '@tiptap/core'

/**
 * Convert TipTap JSON content to formula string with {{fieldKey}} placeholders.
 */
export function formulaToString(content: JSONContent): string {
  if (!content) return ''

  function processNode(node: JSONContent): string {
    if (node.type === 'text') {
      return node.text || ''
    }

    if (node.type === 'field-node') {
      return `{{${node.attrs?.fieldKey || ''}}}`
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
 * Convert formula string with {{fieldKey}} to TipTap JSON content.
 */
export function stringToFormula(text: string): JSONContent {
  if (!text) {
    return { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
  }

  const content: JSONContent[] = []
  const fieldPattern = /\{\{([^}]+)\}\}/g
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
    const fieldKey = match[1]
    content.push({ type: 'field-node', attrs: { fieldKey } })

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
 * Extract all field keys from TipTap content.
 */
export function extractFieldKeys(content: JSONContent): string[] {
  const fieldKeys: string[] = []

  function traverse(node: JSONContent) {
    if (node.type === 'field-node' && node.attrs?.fieldKey) {
      fieldKeys.push(node.attrs.fieldKey)
    }

    if (node.content) {
      node.content.forEach(traverse)
    }
  }

  traverse(content)
  return [...new Set(fieldKeys)]
}

/**
 * Extract field keys from formula string.
 */
export function extractFieldKeysFromString(text: string): string[] {
  if (!text) return []

  const fieldKeys: string[] = []
  const fieldPattern = /\{\{([^}]+)\}\}/g
  let match

  while ((match = fieldPattern.exec(text)) !== null) {
    const fieldKey = match[1].trim()
    if (fieldKey) {
      fieldKeys.push(fieldKey)
    }
  }

  return [...new Set(fieldKeys)]
}

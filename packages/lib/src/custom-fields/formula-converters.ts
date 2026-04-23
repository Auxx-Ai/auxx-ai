// packages/lib/src/custom-fields/formula-converters.ts

/**
 * Structural TipTap node shape used by the formula/reference editor.
 * Kept deliberately permissive so lib doesn't need a @tiptap/core dep —
 * any TipTap `JSONContent` is assignment-compatible with this type.
 */
export interface FormulaNode {
  type?: string
  text?: string
  content?: FormulaNode[]
  attrs?: { id?: string; [key: string]: unknown }
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  [key: string]: unknown
}

/**
 * Convert TipTap JSON content to formula/reference string with `{fieldId}`
 * placeholders. Field badge nodes carry the id in `attrs.id`.
 */
export function formulaToString(content: FormulaNode | null | undefined): string {
  if (!content) return ''

  function processNode(node: FormulaNode): string {
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

/** Convert a formula/reference string with `{fieldId}` into TipTap JSON content. */
export function stringToFormula(text: string): FormulaNode {
  if (!text) {
    return { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
  }

  const content: FormulaNode[] = []
  const fieldPattern = /\{([^{}]+)\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null = fieldPattern.exec(text)

  while (match !== null) {
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index)
      if (textBefore) {
        content.push({ type: 'text', text: textBefore })
      }
    }

    const id = match[1]
    content.push({ type: 'field', attrs: { id } })

    lastIndex = match.index + match[0].length
    match = fieldPattern.exec(text)
  }

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

/** Walk a TipTap JSON tree and collect every `{fieldId}` badge id. Deduplicated. */
export function extractFieldIds(content: FormulaNode | null | undefined): string[] {
  if (!content) return []
  const fieldIds: string[] = []

  function traverse(node: FormulaNode) {
    if (node.type === 'field' && node.attrs?.id) {
      fieldIds.push(node.attrs.id)
    }
    if (node.content) {
      for (const child of node.content) traverse(child)
    }
  }

  traverse(content)
  return [...new Set(fieldIds)]
}

/** Extract field ids from a flat formula string (already rendered via `formulaToString`). */
export function extractFieldIdsFromString(text: string): string[] {
  if (!text) return []

  const fieldIds: string[] = []
  const fieldPattern = /\{([^{}]+)\}/g
  let match: RegExpExecArray | null = fieldPattern.exec(text)

  while (match !== null) {
    const fieldId = match[1].trim()
    if (fieldId) {
      fieldIds.push(fieldId)
    }
    match = fieldPattern.exec(text)
  }

  return [...new Set(fieldIds)]
}

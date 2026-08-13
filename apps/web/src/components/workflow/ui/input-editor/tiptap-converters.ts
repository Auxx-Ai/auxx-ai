// apps/web/src/components/workflow/ui/input-editor/tiptap-converters.ts

/**
 * Legacy variable-editor helpers used by the 9 non-AI workflow nodes that
 * persist prompt content as `text: string` with `{{var}}` placeholders.
 *
 * The Tiptap-doc-aware helpers (`stringToTiptap`, `tiptapToString`,
 * `extractVarIds`) moved to `@auxx/lib/tiptap` as
 * `textToDoc({ parseVariables: true })`, `docToText`, and
 * `collectVariableIds` respectively (see Phase 0 + Phase 4 plans).
 *
 * What remains here is the string-shape regex scan + validator — both
 * editor-layer concerns operating on the legacy `text: string` shape,
 * not Tiptap docs.
 */

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

// Extract all tag varIds from string content ({{varId}} format) — used by
// the 9 non-AI workflow nodes that still persist as `text: string`.
// Relocated to lib with the node catalog so manifests can extract variables;
// re-exported here so no web import churns.
export { extractVarIdsFromString } from '@auxx/lib/workflow-engine/client'

// Insert a variable tag at current cursor position
export function insertTag(editor: any, variableId: string, _label?: string) {
  editor.chain().focus().insertContent({ type: 'variable-node', attrs: { variableId } }).run()
}

// Replace text selection with variable tag
export function replaceSelectionWithTag(editor: any, variableId: string, _label?: string) {
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
    if (!varId?.trim()) {
      invalidTags.push(match[0])
    }
  }

  return { isValid: invalidTags.length === 0, invalidTags }
}

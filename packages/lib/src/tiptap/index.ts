// packages/lib/src/tiptap/index.ts

/**
 * Pure-JSON helpers for Tiptap (ProseMirror) doc walking and building.
 *
 * Constraint: this module must not import from any non-client-safe
 * `@auxx/lib/*` module. Only type-only imports from
 * `../resources/resource-id` are permitted. See plans/tiptap/plan.md §2.3.
 */

export { collectReferenceIds } from './collect-references'
export { collectVariableIds } from './collect-variable-ids'
export { isNonEmptyDoc, trimTrailingEmptyParagraphs } from './doc-shape'
export { docToText } from './doc-to-text'
export { docToHtml, htmlToDoc, stripHtml } from './html'
export { type TextToDocOptions, textToDoc } from './text-to-doc'
export type { TiptapDoc, TiptapMark, TiptapNode } from './types'

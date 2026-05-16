// packages/lib/src/tiptap/types.ts

/**
 * Minimal structural types for walking Tiptap (ProseMirror) JSON docs.
 *
 * `@auxx/lib` cannot depend on `@tiptap/*` runtime, so these types are
 * structural duplicates of `@tiptap/react`'s `JSONContent`. The shared
 * interface lets every walker in this module reuse the same shape.
 */

export interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface TiptapNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: TiptapMark[]
  content?: TiptapNode[]
}

export interface TiptapDoc extends TiptapNode {
  type: 'doc'
  content?: TiptapNode[]
}

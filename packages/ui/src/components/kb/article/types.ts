// packages/ui/src/components/kb/article/types.ts

export type BlockType =
  | 'text'
  | 'heading'
  | 'bulletListItem'
  | 'numberedListItem'
  | 'todoListItem'
  | 'quote'
  | 'image'
  | 'divider'
  | 'codeBlock'
  | 'callout'
  | 'embed'
  | 'cards'

export type ImageAlign = 'left' | 'center' | 'right'
export type CalloutVariant = 'info' | 'warn' | 'error' | 'tip' | 'success'
export type EmbedProvider = 'youtube' | 'loom' | 'vimeo'
export type EmbedAspect = '16:9' | '4:3' | '1:1'

export interface CardData {
  /** Stable id used for drag-reorder + React keys (`@auxx/utils` `generateId`). */
  id: string
  title: string
  /** Markdown-lite (`*bold*`, `_italic_`, `` `code` ``, `[label](url)`). */
  description?: string
  /** Either an `auxx://kb/article/{id}` ref or a raw URL. Empty = non-interactive. */
  href?: string
  /** EntityIcon registry id. */
  iconId?: string
}

export interface BlockAttrs {
  blockType: BlockType
  level?: number | null
  checked?: boolean
  imageUrl?: string | null
  imageWidth?: number
  imageAlign?: ImageAlign
  calloutVariant?: CalloutVariant
  codeLanguage?: string
  codeHighlightedHtml?: string
  embedUrl?: string
  embedProvider?: EmbedProvider
  embedAspect?: EmbedAspect
  cards?: CardData[]
}

export interface BlockJSON {
  type: 'block'
  attrs: BlockAttrs
  content?: InlineJSON[]
}

export type InlineMarkType =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'link'
  | 'highlight'

export interface MarkJSON {
  type: InlineMarkType
  attrs?: Record<string, unknown>
}

export interface InlineJSON {
  type: 'text' | 'placeholder'
  text?: string
  marks?: MarkJSON[]
  attrs?: Record<string, unknown>
}

export interface DocJSON {
  type: 'doc'
  content: BlockJSON[]
}

/**
 * Map an `auxx://kb/article/{id}` reference to the href the renderer should
 * emit. Defaults to `/r/{id}` so the public KB app can host a redirect
 * route at that path; preview/embed contexts override this to nest under
 * their own URL prefix.
 */
export type ResolveAuxxHref = (articleId: string) => string

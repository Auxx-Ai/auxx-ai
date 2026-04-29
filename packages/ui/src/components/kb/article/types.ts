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

export type ImageAlign = 'left' | 'center' | 'right'
export type CalloutVariant = 'info' | 'warn' | 'error' | 'tip' | 'success'
export type EmbedProvider = 'youtube' | 'loom' | 'vimeo'
export type EmbedAspect = '16:9' | '4:3' | '1:1'

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

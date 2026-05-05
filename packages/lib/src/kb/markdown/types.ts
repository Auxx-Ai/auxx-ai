// packages/lib/src/kb/markdown/types.ts
//
// Local mirror of the canonical KB block schema declared in
// packages/ui/src/components/kb/article/types.ts. We can't import that here
// because @auxx/ui sits above @auxx/lib in the dependency graph. The shapes
// are kept structurally identical so consumers can pass either type in.

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
  id: string
  title: string
  description?: string
  href?: string
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
  type: 'text' | 'placeholder' | 'hardBreak'
  text?: string
  marks?: MarkJSON[]
  attrs?: Record<string, unknown>
}

export interface BlockJSON {
  type: 'block'
  attrs: BlockAttrs
  content?: InlineJSON[]
}

export interface PanelJSON {
  type: 'panel'
  attrs: {
    id: string
    label: string
    iconId?: string
  }
  content: BlockJSON[]
}

export interface TabsJSON {
  type: 'tabs'
  attrs: { activeTab?: string | null }
  content: PanelJSON[]
}

export interface AccordionJSON {
  type: 'accordion'
  attrs: { allowMultiple: boolean }
  content: PanelJSON[]
}

export type ContainerBlockJSON = TabsJSON | AccordionJSON

export type ArticleNodeJSON = BlockJSON | ContainerBlockJSON

export interface DocJSON {
  type: 'doc'
  content: ArticleNodeJSON[]
}

export const CALLOUT_VARIANTS: ReadonlySet<CalloutVariant> = new Set([
  'info',
  'tip',
  'warn',
  'error',
  'success',
])

export const EMBED_PROVIDERS: ReadonlySet<EmbedProvider> = new Set(['youtube', 'loom', 'vimeo'])

export const EMBED_ASPECTS: ReadonlySet<EmbedAspect> = new Set(['16:9', '4:3', '1:1'])

export const IMAGE_ALIGNS: ReadonlySet<ImageAlign> = new Set(['left', 'center', 'right'])

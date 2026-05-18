// packages/lib/src/prompt-templates/types.ts

import type { DocJSON } from '../kb/markdown'

/** Definition shape for built-in prompt templates compiled from .md sources */
export interface PromptTemplateDefinition {
  id: string
  name: string
  description: string
  /** Tiptap doc in KB block schema. Flattened to text at composer send time. */
  prompt: DocJSON
  categories: string[]
  icon: { iconId: string; color: string }
}

/** Unified type returned by the list endpoint — user/installed templates only */
export interface PromptTemplateItem {
  id: string
  name: string
  description: string
  prompt: DocJSON
  categories: string[]
  icon: { iconId: string; color: string } | null
  type: 'user'
}

/** System template with install status — returned by listSystem for the gallery */
export interface SystemTemplateGalleryItem extends PromptTemplateDefinition {
  installed: boolean
}

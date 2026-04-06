// packages/lib/src/prompt-templates/types.ts

/** Definition shape for built-in prompt templates stored in JSON */
export interface PromptTemplateDefinition {
  id: string
  name: string
  description: string
  prompt: string
  categories: string[]
  icon: { iconId: string; color: string }
}

/** Unified type returned by the list endpoint — user/installed templates only */
export interface PromptTemplateItem {
  id: string
  name: string
  description: string
  prompt: string
  categories: string[]
  icon: { iconId: string; color: string } | null
  type: 'user'
}

/** System template with install status — returned by listSystem for the gallery */
export interface SystemTemplateGalleryItem extends PromptTemplateDefinition {
  installed: boolean
}

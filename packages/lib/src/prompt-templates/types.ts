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

/** Unified type returned by the list endpoint — merges system + user templates */
export interface PromptTemplateItem {
  id: string
  name: string
  description: string
  prompt: string
  categories: string[]
  icon: { iconId: string; color: string } | null
  type: 'system' | 'user'
}

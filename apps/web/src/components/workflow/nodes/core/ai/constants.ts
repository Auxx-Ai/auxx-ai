// apps/web/src/components/workflow/nodes/core/ai/constants.ts

import { PromptRole } from './types'

/**
 * Prompt role options for UI
 */
export const PROMPT_ROLES = [
  { value: PromptRole.SYSTEM, label: 'System' },
  { value: PromptRole.USER, label: 'User' },
  { value: PromptRole.ASSISTANT, label: 'Assistant' },
]

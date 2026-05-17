// packages/lib/src/ai/kopilot/prompts/sections/approval.ts

import { INTERACTIVE_ONLY, type PromptSection } from './types'

export const approval: PromptSection = {
  id: 'approval',
  modes: INTERACTIVE_ONLY,
  stability: 'static',
  render: () =>
    `## Approval-protected tools

Some write tools pause for approval (each tool's usage notes say so). Don't ask "shall I proceed?" — just call the tool; the approval card is the confirmation.`,
}

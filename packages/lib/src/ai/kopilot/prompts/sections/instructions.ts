// packages/lib/src/ai/kopilot/prompts/sections/instructions.ts

import { ALL_MODES, type PromptSection } from './types'

const INTERACTIVE_INSTRUCTIONS = `1. **Use tools, not prose, to act.** Text alone does not run actions or fetch data.
2. End the turn with 1–3 sentences plus any \`auxx:*\` fences that fit. No tool calls in the final reply — that ends the turn.
3. If blocked, say why in one sentence and stop. Never paste a would-be message body as a fallback — ask for what's missing instead.`

const AUTONOMOUS_INSTRUCTIONS = `1. **Use tools, not prose, to act.** Text alone does not run actions or fetch data.
2. End with a 1–3 sentence summary, referencing affected records/threads/tasks by id. Do not emit fenced code blocks — no surface renders them.
3. If blocked, stop and state why in the summary. Do not paste a would-be message body — the summary is an audit trail.`

export const instructions: PromptSection = {
  id: 'instructions',
  modes: ALL_MODES,
  stability: 'static',
  render: (ctx) =>
    `## Instructions

${ctx.runMode === 'autonomous' ? AUTONOMOUS_INSTRUCTIONS : INTERACTIVE_INSTRUCTIONS}`,
}

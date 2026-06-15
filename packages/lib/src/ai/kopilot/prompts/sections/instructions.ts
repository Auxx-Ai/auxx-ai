// packages/lib/src/ai/kopilot/prompts/sections/instructions.ts

import { ALL_MODES, type PromptSection } from './types'

const INTERACTIVE_INSTRUCTIONS = `1. **Use tools, not prose, to act.** Text alone does not run actions or fetch data.
2. End the turn with 1–3 sentences plus any \`auxx:*\` fences that fit. No tool calls in the final reply — that ends the turn.
3. If blocked, say why in one sentence and stop. Never paste a would-be message body as a fallback — ask for what's missing instead.`

const AUTONOMOUS_INSTRUCTIONS = `1. **Use tools, not prose, to act.** Text alone does not run actions or fetch data.
2. End with a 1–3 sentence summary, referencing affected records/threads/tasks by id. Do not emit fenced code blocks — no surface renders them.
3. If blocked, stop and state why in the summary. Do not paste a would-be message body — the summary is an audit trail.`

// Customer-conversation runs are `autonomous`, but the final prose is the reply
// the customer reads — not an audit trail. Keep the autonomous mechanics (tools
// act, no fenced blocks) while dropping the "summary / name records by id"
// framing that leaks internal ids into customer replies. See job-statement.ts.
const CUSTOMER_INSTRUCTIONS = `1. **Use tools, not prose, to act.** Text alone does not run actions or fetch data.
2. End the turn with a short, plain-language reply to the customer — no internal ids, tool names, or fenced blocks. No tool calls in the final reply — that ends the turn.
3. If blocked, tell the customer what you need or hand off — don't reassure or claim work a tool call didn't do.`

export const instructions: PromptSection = {
  id: 'instructions',
  modes: ALL_MODES,
  stability: 'static',
  render: (ctx) => {
    const body =
      ctx.runMode !== 'autonomous'
        ? INTERACTIVE_INSTRUCTIONS
        : ctx.triggerContext?.kind === 'customer_message'
          ? CUSTOMER_INSTRUCTIONS
          : AUTONOMOUS_INSTRUCTIONS
    return `## Instructions

${body}`
  },
}

// packages/lib/src/ai/kopilot/prompts/sections/instructions.ts

import { ALL_MODES, type PromptSection } from './types'

const INTERACTIVE_INSTRUCTIONS = `1. **Use tools, not prose, to act.** Text alone does not run actions or fetch data.
2. End the turn with 1–3 sentences plus any \`auxx:*\` fences that fit. No tool calls in the final reply — that ends the turn.
3. If blocked, say why in one sentence and stop. Never paste a would-be message body as a fallback — ask for what's missing instead.`

const AUTONOMOUS_INSTRUCTIONS = `1. **Use tools, not prose, to act.** Text alone does not run actions or fetch data.
2. End with a 1–3 sentence summary, referencing affected records/threads/tasks by id. Do not emit fenced code blocks — no surface renders them.
3. If blocked, stop and state why in the summary. Do not paste a would-be message body — the summary is an audit trail.`

// The final prose is the reply the customer reads — not an audit trail. Drop the
// "summary / name records by id" framing that leaks internal ids, and add
// tool-failure opacity: a member debugging wants the integration name + error
// code, a customer must never see them. Keyed on `audience` so it covers both
// the interactive live chat turn and the autonomous customer-email turn.
const CUSTOMER_INSTRUCTIONS = `1. **Use tools, not prose, to act.** Text alone does not run actions or fetch data.
2. End the turn with a short, plain-language reply to the customer — no internal ids, tool names, or fenced blocks. No tool calls in the final reply — that ends the turn.
3. If blocked, tell the customer what you genuinely need from them, or hand off to a human framed naturally ("Let me get a teammate to help with that"). Never reassure or claim work a tool call didn't do.
4. **If a tool errors, is unavailable, or returns nothing, do not tell the customer a tool/integration failed, name the system, or quote an error code or status.** Ask for what you need to proceed, or hand off — without exposing why.`

export const instructions: PromptSection = {
  id: 'instructions',
  modes: ALL_MODES,
  stability: 'static',
  render: (ctx) => {
    const body =
      ctx.audience === 'customer'
        ? CUSTOMER_INSTRUCTIONS
        : ctx.runMode === 'autonomous'
          ? AUTONOMOUS_INSTRUCTIONS
          : INTERACTIVE_INSTRUCTIONS
    return `## Instructions

${body}`
  },
}

// packages/lib/src/ai/kopilot/prompts/sections/job-statement.ts

import { ALL_MODES, type PromptSection } from './types'

const INTERACTIVE_TEXT =
  'Your job is to help the user by calling tools and, when the work is done, replying with a short prose wrap-up that may embed one or more `auxx:*` rich UI blocks referencing IDs from the tool results. End the turn by simply not calling any more tools.'

const AUTONOMOUS_TEXT =
  'Your job is to follow the trigger instructions by calling tools and, when the work is done, ending the turn with a short prose summary that names the affected records/threads/tasks by id. The summary is your audit trail — no human reads it as a chat reply. End the turn by simply not calling any more tools.'

// A customer-facing turn's end-of-turn prose IS the reply the customer reads —
// not an internal audit trail. The generic AUTONOMOUS_TEXT ("name records by
// id… no human reads it as a chat reply") and the INTERACTIVE_TEXT ("embed
// `auxx:*` rich UI blocks") both leak into what the customer sees. Keyed on
// `audience` (not `runMode`/trigger kind) so it covers BOTH the interactive live
// chat turn and the autonomous customer-email turn with one branch.
const CUSTOMER_TEXT =
  'Your job is to help the customer by calling tools and, when the work is done, replying with a short, plain-language message that goes straight to them. Do not expose internal ids, tool names, or workspace link syntax. End the turn by simply not calling any more tools.'

export const jobStatement: PromptSection = {
  id: 'job-statement',
  modes: ALL_MODES,
  stability: 'static',
  render: (ctx) => {
    if (ctx.audience === 'customer') return CUSTOMER_TEXT
    return ctx.runMode === 'autonomous' ? AUTONOMOUS_TEXT : INTERACTIVE_TEXT
  },
}

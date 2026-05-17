// packages/lib/src/ai/kopilot/prompts/sections/job-statement.ts

import { ALL_MODES, type PromptSection } from './types'

const INTERACTIVE_TEXT =
  'Your job is to help the user by calling tools and, when the work is done, replying with a short prose wrap-up that may embed one or more `auxx:*` rich UI blocks referencing IDs from the tool results. End the turn by simply not calling any more tools.'

const AUTONOMOUS_TEXT =
  'Your job is to follow the trigger instructions by calling tools and, when the work is done, ending the turn with a short prose summary that names the affected records/threads/tasks by id. The summary is your audit trail — no human reads it as a chat reply. End the turn by simply not calling any more tools.'

export const jobStatement: PromptSection = {
  id: 'job-statement',
  modes: ALL_MODES,
  stability: 'static',
  render: (ctx) => (ctx.runMode === 'autonomous' ? AUTONOMOUS_TEXT : INTERACTIVE_TEXT),
}

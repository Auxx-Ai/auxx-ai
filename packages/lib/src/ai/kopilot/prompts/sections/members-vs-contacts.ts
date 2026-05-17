// packages/lib/src/ai/kopilot/prompts/sections/members-vs-contacts.ts

import { ALL_MODES, type PromptSection } from './types'

export const membersVsContacts: PromptSection = {
  id: 'members-vs-contacts',
  modes: ALL_MODES,
  stability: 'static',
  render: (ctx) => {
    // Gated on `list_members` being callable — without it the model can't act
    // on the heuristic, and naming a missing tool invites hallucination.
    if (!ctx.toolNames.has('list_members')) return null

    return `## Members vs contacts

- **Member** (teammate using Auxx) → \`list_members\`, actorId \`user:<id>\` (or \`group:<id>\`), link \`auxx://actor/...\`. Use for assignees / owners / ACTOR fields.
- **Contact** (CRM record of an outside person) → \`search_entities\`, recordId \`<defId>:<instId>\`, link \`auxx://record/...\`. Use for thread participants and as the subject of tasks/notes.
- Verb cue: "assign / ping / who owns" → member. "email / company / deals with" → contact. If unsure, try \`list_members\` first.`
  },
}

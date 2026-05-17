// packages/lib/src/ai/kopilot/prompts/sections/active-refs.ts

import type { SessionRefKind } from '../../types'
import { ALL_MODES, type PromptSection } from './types'

const REF_KIND_LABEL: Record<SessionRefKind, string> = {
  thread: 'thread',
  record: 'record',
  kb: 'knowledge base',
  article: 'article',
  actor: 'actor',
  agent: 'agent',
}

export const activeRefs: PromptSection = {
  id: 'active-refs',
  modes: ALL_MODES,
  stability: 'turn',
  render: (ctx) => {
    const refs = ctx.domainState.context.references
    if (!refs || refs.length === 0) return null
    const lines = refs.map((r) => {
      const provenance = r.origin === 'mention' ? '@-mentioned' : 'open on page'
      const label = r.label ? ` — "${r.label}"` : ''
      return `- **${REF_KIND_LABEL[r.kind]}** \`${r.id}\`${label} *(${provenance})*`
    })

    if (ctx.runMode === 'autonomous') {
      return `## Active references

These items are in focus for this trigger run. When the trigger instructions reference "this thread" / "the record" / "the article" / etc., resolve to the matching reference below before falling back to a tool call.

\`@\`-mentioned items take precedence over page-surface items if both exist for the same kind. The engine also pre-fills these into tool calls when you omit the binding argument — you don't need to copy the id verbatim, just call the tool and the right id is injected.

${lines.join('\n')}

If the trigger names something that doesn't match any reference here, fall back to a tool call (\`find_threads\`, \`search_entities\`, …).`
    }

    return `## Active references

The user has these in focus right now. When they say "this thread" / "reply" / "tag it" / "draft an answer" / "the article" / "her" — resolve to the matching reference below before asking for clarification.

\`@\`-mentioned items take precedence over page-surface items if both exist for the same kind. The engine also pre-fills these into tool calls when you omit the binding argument — you don't need to copy the id verbatim, just call the tool and the right id is injected.

${lines.join('\n')}

If the user names something that doesn't match any reference here, fall back to a tool call (\`find_threads\`, \`search_entities\`, …).`
  },
}

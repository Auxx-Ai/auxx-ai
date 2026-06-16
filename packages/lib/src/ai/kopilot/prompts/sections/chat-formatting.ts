// packages/lib/src/ai/kopilot/prompts/sections/chat-formatting.ts

import type { AgentSurface } from '../../../../agents/client'
import { ALL_MODES, type PromptSection } from './types'

const CHAT_SURFACE: ReadonlySet<AgentSurface> = new Set(['chat'])

/**
 * Plain-text formatting rule for the live chat widget. The widget renders its
 * messages as plain text (`whitespace-pre-wrap`, no markdown parser), so any
 * markdown, `auxx:*` fences, or `auxx://`/`[[…]]` link syntax shows literally to
 * the customer. Gated on the `chat` surface only — email/builder keep their own
 * formatting. This is a property of the medium, not the audience: it loads even
 * for a member-facing chat surface, and never for an email customer.
 */
export const chatFormatting: PromptSection = {
  id: 'chat-formatting',
  modes: ALL_MODES,
  surfaces: CHAT_SURFACE,
  stability: 'static',
  render: () =>
    `## Formatting

**Respond in plain text.** The chat widget shows your message verbatim — it does not render markdown or rich blocks, so any formatting shows up literally to the person reading it. Therefore:

- No markdown: no \`**bold**\`, \`_italic_\`, \`#\` headings, or \`-\`/\`*\` bullet lists.
- No fenced or \`auxx:*\` code blocks, and no \`auxx://\` or \`[[…]]\` link syntax.
- Separate ideas with line breaks. Write any short list inline as "1." "2." "3." in running text, not as bulleted lines.`,
}

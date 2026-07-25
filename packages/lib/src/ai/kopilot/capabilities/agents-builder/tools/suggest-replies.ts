// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/suggest-replies.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const MIN_PROMPTS = 1
const MAX_PROMPTS = 4
const ID_MAX = 40
const LABEL_MAX = 80

/**
 * Emit a structured "suggested replies" block the chat renders as chips above
 * the composer. Pure UX — no DB writes. Reusable in master Kopilot as well as
 * the agents builder, so this tool registers under `__global__`.
 */
export function createSuggestRepliesTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'suggest_replies',
    permission: {
      target: 'none',
      note: 'UI directive: renders reply chips above the composer from strings the model supplied. Reads and writes nothing.',
    },
    displayName: 'Suggest replies',
    // Every legitimate use means "I'm done, waiting for the admin" — the chips
    // are for the client, not the model, so the call terminates the turn.
    endsTurn: true,
    description: `Suggest 2–4 short reply chips for the user.

The client renders these above the composer; tapping a chip sends \`label\`
as the user's next message. Use when you're asking a clarifying question and
the answer space is small ("Yes / No", "Drafts / Send", a handful of named
options).

Don't suggest empty or vague options. Don't put long sentences in labels —
under ${LABEL_MAX} chars, terse, action-oriented.`,
    parameters: {
      type: 'object',
      properties: {
        prompts: {
          type: 'array',
          minItems: MIN_PROMPTS,
          maxItems: MAX_PROMPTS,
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                minLength: 1,
                maxLength: ID_MAX,
                description: 'Stable id for telemetry / future routing.',
              },
              label: {
                type: 'string',
                minLength: 1,
                maxLength: LABEL_MAX,
                description: 'Chip text; sent verbatim as the next user message.',
              },
            },
            required: ['id', 'label'],
            additionalProperties: false,
          },
        },
      },
      required: ['prompts'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const prompts = (args.prompts ?? []) as Array<{ id: string; label: string }>
      if (!Array.isArray(prompts) || prompts.length < MIN_PROMPTS) {
        return { success: false, output: null, error: 'prompts must have at least one entry' }
      }
      if (prompts.length > MAX_PROMPTS) {
        return {
          success: false,
          output: null,
          error: `prompts exceeds max ${MAX_PROMPTS} entries`,
        }
      }
      const cleaned: Array<{ id: string; label: string }> = []
      const seen = new Set<string>()
      for (const p of prompts) {
        if (typeof p.id !== 'string' || p.id.length === 0 || p.id.length > ID_MAX) {
          return { success: false, output: null, error: `each prompt.id must be 1–${ID_MAX} chars` }
        }
        if (typeof p.label !== 'string' || p.label.length === 0 || p.label.length > LABEL_MAX) {
          return {
            success: false,
            output: null,
            error: `each prompt.label must be 1–${LABEL_MAX} chars`,
          }
        }
        if (seen.has(p.id)) {
          return { success: false, output: null, error: `duplicate prompt.id "${p.id}"` }
        }
        seen.add(p.id)
        cleaned.push({ id: p.id, label: p.label })
      }
      return {
        success: true,
        output: {
          _suggestReplies: {
            version: 'v1' as const,
            prompts: cleaned,
          },
        },
      }
    },
  }
}

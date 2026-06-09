// packages/lib/src/evals/simulation/persona.ts
//
// The synthetic customer. `LlmPersonaConversationSource` returns the case's
// `openingMessage` verbatim on the first turn, then generates each subsequent
// customer turn with the configured persona model from the redacted visible
// conversation plus the customer context. It stops when the procedure reaches a
// terminal outcome (the executor stops calling it) or the persona itself decides
// the conversation is resolved (`done`). See plans/evals/phase-1-agent-simulation.md §1.7.

import type { ConversationMessage } from '../../agents/procedures'
import type { LLMCallParams, LLMStreamEvent } from '../../ai/agent-framework/types'
import type { Message } from '../../ai/clients/base/types'

export type CallModel = (params: LLMCallParams) => AsyncGenerator<LLMStreamEvent>

/** One generated customer turn, or a structured stop. */
export type PersonaTurn =
  | { done: false; text: string; usage?: PersonaUsage }
  | { done: true; usage?: PersonaUsage }

export interface PersonaUsage {
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  finishReason?: string
}

/**
 * A turn source the executor drains for the next customer message. Agent-only —
 * workflows never implement it (build-plan: "AgentConversationSource is agent-only").
 */
export interface AgentConversationSource {
  /**
   * Produce the next customer turn from the visible conversation so far (customer
   * = `user`, agent = `assistant`). Returns `{ done: true }` when the customer has
   * nothing left to say.
   */
  nextTurn(visible: ConversationMessage[]): Promise<PersonaTurn>
}

const PERSONA_RESPONSE_SCHEMA = {
  type: 'json_schema' as const,
  jsonSchema: {
    name: 'customer_turn',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: {
          type: 'string',
          description: 'What the customer says next. Empty string if done.',
        },
        done: {
          type: 'boolean',
          description: 'True when the customer is satisfied / has nothing left to ask.',
        },
      },
      required: ['message', 'done'],
    },
  },
}

export interface LlmPersonaConfig {
  openingMessage: string
  customerContext: string | null
  channel: 'chat' | 'email'
  model: { provider: string; model: string }
  callModel: CallModel
  signal?: AbortSignal
}

/**
 * The live LLM persona. Deterministic only in its first turn (the opening message
 * is verbatim); later turns are model-generated, so the executor records provider/
 * model/usage/finish for each and never claims bit-for-bit reproducibility.
 */
export class LlmPersonaConversationSource implements AgentConversationSource {
  private opened = false
  constructor(private readonly config: LlmPersonaConfig) {}

  async nextTurn(visible: ConversationMessage[]): Promise<PersonaTurn> {
    if (!this.opened) {
      this.opened = true
      return { done: false, text: this.config.openingMessage }
    }

    const messages = this.buildMessages(visible)
    const result = await this.drain(messages)
    if (result.done || !result.text.trim()) {
      return { done: true, usage: result.usage }
    }
    return { done: false, text: result.text, usage: result.usage }
  }

  private buildMessages(visible: ConversationMessage[]): Message[] {
    const channelNote =
      this.config.channel === 'email'
        ? 'This is an email support conversation.'
        : 'This is a live chat support conversation.'
    const context = this.config.customerContext
      ? `Your situation:\n${this.config.customerContext}`
      : 'You have an ordinary customer support need.'

    const system: Message = {
      role: 'system',
      content: [
        'You are role-playing a CUSTOMER contacting a support agent. Stay in character.',
        channelNote,
        context,
        'Reply ONLY as the customer, in the first person. Keep messages short and natural.',
        'Do not narrate, do not act as the agent, do not break character.',
        'When your issue is resolved or you have nothing left to ask, set "done" to true.',
      ].join('\n'),
    }

    // From the customer's point of view the AGENT is the other party: map the
    // agent's `assistant` turns to `user`, and prior customer `user` turns to
    // `assistant`. Only prose is shown — no tool calls, no internal state.
    const history: Message[] = visible.map((m) => ({
      role: m.role === 'assistant' ? 'user' : 'assistant',
      content: m.content,
    }))

    return [system, ...history]
  }

  private async drain(
    messages: Message[]
  ): Promise<{ text: string; done: boolean; usage?: PersonaUsage }> {
    const params: LLMCallParams = {
      provider: this.config.model.provider,
      model: this.config.model.model,
      messages,
      responseFormat: PERSONA_RESPONSE_SCHEMA,
      signal: this.config.signal,
    }

    let content = ''
    let usage: PersonaUsage | undefined
    for await (const event of this.config.callModel(params)) {
      if (event.type === 'done') {
        content = event.content
        usage = {
          provider: this.config.model.provider,
          model: this.config.model.model,
          promptTokens: event.usage.prompt_tokens ?? 0,
          completionTokens: event.usage.completion_tokens ?? 0,
          totalTokens: event.usage.total_tokens ?? 0,
          finishReason: event.finishReason,
        }
      }
    }

    const parsed = parsePersonaJson(content)
    return { text: parsed.message, done: parsed.done, usage }
  }
}

/** Tolerant parse of the persona's structured reply (falls back to raw text). */
function parsePersonaJson(content: string): { message: string; done: boolean } {
  try {
    const obj = JSON.parse(content) as { message?: unknown; done?: unknown }
    return {
      message: typeof obj.message === 'string' ? obj.message : '',
      done: obj.done === true,
    }
  } catch {
    // Model ignored the schema — treat the raw text as the customer's message.
    return { message: content.trim(), done: content.trim().length === 0 }
  }
}

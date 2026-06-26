// packages/lib/src/ai/agent-framework/__tests__/wire-format-conversion.test.ts

import { describe, expect, it } from 'vitest'
import type { Message } from '../../clients/base/types'
import type { ContentPart } from '../types'
import { partsToWireFormat } from '../utils'

/**
 * `partsToWireFormat(parts, messageId)` reconstructs the OpenAI / Anthropic
 * wire format from a persisted parts[] array. The model still expects an
 * assistant message followed by separate tool messages — this function
 * preserves that boundary while the persisted shape collapses everything
 * onto a single assistant message.
 *
 * Returned shape: `Message[]` — one assistant Message, plus zero or more
 * trailing tool Messages (one per completed tool_call part).
 */

const messageId = 'msg_abc'

describe('partsToWireFormat — assistant text only', () => {
  it('emits a single assistant message with concatenated text', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'Hello, ' },
      { type: 'text', text: 'world!' },
    ]
    const wire = partsToWireFormat(parts, messageId)
    expect(wire).toHaveLength(1)
    expect(wire[0]?.role).toBe('assistant')
    expect(wire[0]?.content).toBe('Hello, world!')
    expect(wire[0]?.tool_calls).toBeUndefined()
  })

  it('omits tool_calls entirely when there are no tool_call parts', () => {
    const parts: ContentPart[] = [{ type: 'text', text: 'plain reply' }]
    const wire = partsToWireFormat(parts, messageId)
    expect(wire).toHaveLength(1)
    expect(wire[0]?.tool_calls).toBeUndefined()
  })
})

describe('partsToWireFormat — empty placeholder', () => {
  it('emits nothing for an empty parts array (the iteration-1 in-progress placeholder)', () => {
    const wire = partsToWireFormat([], messageId)
    // An empty assistant message carries no information and is rejected by
    // OpenAI-compatible providers (Kimi: "the message ... must not be empty").
    expect(wire).toHaveLength(0)
  })

  it('emits nothing when all text parts are empty and there are no tool calls', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: '' },
      { type: 'text', text: '' },
    ]
    const wire = partsToWireFormat(parts, messageId)
    expect(wire).toHaveLength(0)
  })

  it('still emits a reasoning-only assistant message (Anthropic keeps thinking)', () => {
    const parts: ContentPart[] = [{ type: 'thinking', text: 'internal reasoning' }]
    const wire = partsToWireFormat(parts, messageId)
    expect(wire).toHaveLength(1)
    expect(wire[0]?.role).toBe('assistant')
    expect(wire[0]?.reasoning_content).toContain('internal reasoning')
  })
})

describe('partsToWireFormat — assistant + single tool', () => {
  it('emits [assistant{ tool_calls:[...] }, tool{ tool_call_id, content }]', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'Looking it up…' },
      {
        type: 'tool_call',
        toolCallId: 'tc_1',
        name: 'search_entities',
        args: { query: 'John' },
        status: 'completed',
        output: { matches: [{ recordId: 'r1' }] },
      },
    ]
    const wire = partsToWireFormat(parts, messageId)
    expect(wire).toHaveLength(2)

    const assistant = wire[0] as Message
    expect(assistant.role).toBe('assistant')
    expect(assistant.content).toBe('Looking it up…')
    expect(assistant.tool_calls).toHaveLength(1)
    expect(assistant.tool_calls?.[0]?.id).toBe('tc_1')
    expect(assistant.tool_calls?.[0]?.function.name).toBe('search_entities')
    // Args may be serialized as a JSON string or kept as an object — both
    // satisfy the LLM client interface.
    const rawArgs = assistant.tool_calls?.[0]?.function.arguments
    const parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
    expect(parsedArgs).toEqual({ query: 'John' })

    const toolMsg = wire[1] as Message
    expect(toolMsg.role).toBe('tool')
    expect(toolMsg.tool_call_id).toBe('tc_1')
    const toolContent =
      typeof toolMsg.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg.content
    expect(toolContent).toMatchObject({ matches: [{ recordId: 'r1' }] })
  })
})

describe('partsToWireFormat — multiple tool calls', () => {
  it('emits one assistant with all tool_calls, followed by one tool message per call in order', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'Working through this…' },
      {
        type: 'tool_call',
        toolCallId: 'tc_1',
        name: 'search_entities',
        args: {},
        status: 'completed',
        output: { rows: 1 },
      },
      {
        type: 'tool_call',
        toolCallId: 'tc_2',
        name: 'get_thread_detail',
        args: { threadId: 't_1' },
        status: 'completed',
        output: { messages: 12 },
      },
    ]
    const wire = partsToWireFormat(parts, messageId)
    expect(wire).toHaveLength(3)
    expect(wire[0]?.role).toBe('assistant')
    expect(wire[0]?.tool_calls?.map((tc) => tc.id)).toEqual(['tc_1', 'tc_2'])

    expect(wire[1]?.role).toBe('tool')
    expect((wire[1] as Message).tool_call_id).toBe('tc_1')
    expect(wire[2]?.role).toBe('tool')
    expect((wire[2] as Message).tool_call_id).toBe('tc_2')
  })
})

describe('partsToWireFormat — in-flight / awaiting / errored tools', () => {
  it('omits the tool message for a tool_call still running (no output yet)', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'Just started…' },
      {
        type: 'tool_call',
        toolCallId: 'tc_1',
        name: 'slow_tool',
        args: {},
        status: 'running',
        // no output yet
      },
    ]
    const wire = partsToWireFormat(parts, messageId)
    // The assistant message still carries the tool_call (the LLM client expects
    // every tool_call to have a result before being sent — so a still-running
    // tool would NOT typically be sent back to the LLM in a follow-up call.
    // The function MAY include the assistant only, OR may include both with
    // the assistant's tool_calls listing the in-flight call. Either way, no
    // tool message is emitted for the running call.
    const toolMessages = wire.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(0)
  })

  it('omits the tool message for a tool_call awaiting approval', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'I will send.' },
      {
        type: 'tool_call',
        toolCallId: 'tc_1',
        name: 'send_email',
        args: { to: 'a@b.com' },
        status: 'awaiting-approval',
      },
    ]
    const wire = partsToWireFormat(parts, messageId)
    const toolMessages = wire.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(0)
  })

  it('emits a tool message with the error payload for an errored tool_call', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'Trying…' },
      {
        type: 'tool_call',
        toolCallId: 'tc_1',
        name: 'flaky',
        args: {},
        status: 'error',
        error: 'boom',
      },
    ]
    const wire = partsToWireFormat(parts, messageId)
    const toolMsg = wire.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.tool_call_id).toBe('tc_1')
    const parsed =
      typeof toolMsg?.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg?.content
    expect(parsed).toMatchObject({ error: 'boom' })
  })

  it('emits a tool message with rejected payload for a rejected tool_call', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: '' },
      {
        type: 'tool_call',
        toolCallId: 'tc_1',
        name: 'send_email',
        args: {},
        status: 'rejected',
        output: { rejected: true },
      },
    ]
    const wire = partsToWireFormat(parts, messageId)
    const toolMsg = wire.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    const parsed =
      typeof toolMsg?.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg?.content
    expect(parsed).toMatchObject({ rejected: true })
  })
})

describe('partsToWireFormat — untrusted MCP output boundary', () => {
  it('re-fences a completed part carrying an outputBoundary, output stays walkable', () => {
    const parts: ContentPart[] = [
      {
        type: 'tool_call',
        toolCallId: 'tc_1',
        name: 'mcp__demo__list',
        args: {},
        status: 'completed',
        output: [{ id: 1 }, { id: 2 }],
        outputBoundary: { server: 'demo', tool: 'list' },
      },
    ]
    const wire = partsToWireFormat(parts, messageId)
    const toolMsg = wire.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    const content = toolMsg?.content as string
    expect(content).toContain('<mcp_tool_output server="demo" tool="list">')
    expect(content).toContain('</mcp_tool_output>')
    // The JSON output is embedded inside the fence.
    expect(content).toContain('"id": 1')
  })

  it('does NOT fence a completed part without an outputBoundary (pre-change part)', () => {
    const parts: ContentPart[] = [
      {
        type: 'tool_call',
        toolCallId: 'tc_1',
        name: 'mcp__demo__list',
        args: {},
        status: 'completed',
        // Pre-change parts hold an already-embedded fence string + no marker.
        output: '<mcp_tool_output server="demo" tool="list">\n[]\n</mcp_tool_output>',
      },
    ]
    const wire = partsToWireFormat(parts, messageId)
    const toolMsg = wire.find((m) => m.role === 'tool')
    const content = toolMsg?.content as string
    // Exactly one fence — JSON.stringify of the already-fenced string, never double-wrapped.
    expect(content.match(/<mcp_tool_output/g)).toHaveLength(1)
  })

  it('fences the output of an errored MCP part', () => {
    const parts: ContentPart[] = [
      {
        type: 'tool_call',
        toolCallId: 'tc_1',
        name: 'mcp__demo__list',
        args: {},
        status: 'error',
        error: 'nope',
        output: { message: 'nope' },
        outputBoundary: { server: 'demo', tool: 'list' },
      },
    ]
    const wire = partsToWireFormat(parts, messageId)
    const toolMsg = wire.find((m) => m.role === 'tool')
    const parsed = JSON.parse(toolMsg?.content as string)
    expect(parsed.error).toBe('nope')
    expect(parsed.output).toContain('<mcp_tool_output server="demo" tool="list">')
  })
})

describe('partsToWireFormat — thinking parts', () => {
  it('drops thinking parts from assistant content (or surfaces them via reasoning_content)', () => {
    const parts: ContentPart[] = [
      { type: 'thinking', text: 'internal reasoning' },
      { type: 'text', text: 'public answer' },
    ]
    const wire = partsToWireFormat(parts, messageId)
    expect(wire).toHaveLength(1)
    const assistant = wire[0] as Message
    // The user-visible `content` MUST NOT contain the thinking text. The wire
    // format may surface reasoning via the optional `reasoning_content` field
    // (Anthropic / DeepSeek shape) — both are acceptable.
    expect(assistant.content).toBe('public answer')
    expect(typeof assistant.content === 'string' ? assistant.content : '').not.toContain(
      'internal reasoning'
    )
    if (assistant.reasoning_content !== undefined) {
      expect(assistant.reasoning_content).toContain('internal reasoning')
    }
  })
})

describe('partsToWireFormat — interleaved text/tool/text', () => {
  it('concatenates all text parts onto the assistant content (one assistant message)', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'Pre-tool: ' },
      {
        type: 'tool_call',
        toolCallId: 'tc_1',
        name: 'lookup',
        args: {},
        status: 'completed',
        output: { ok: true },
      },
      { type: 'text', text: 'Post-tool conclusion.' },
    ]
    const wire = partsToWireFormat(parts, messageId)
    // Wire format collapses text into a single assistant content string. The
    // tool boundary is preserved by the trailing tool message, not by
    // splitting text into multiple assistant messages.
    const assistantMessages = wire.filter((m) => m.role === 'assistant')
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]?.content).toBe('Pre-tool: Post-tool conclusion.')
    // The follow-up tool message comes after the assistant.
    expect(wire[wire.length - 1]?.role).toBe('tool')
  })
})

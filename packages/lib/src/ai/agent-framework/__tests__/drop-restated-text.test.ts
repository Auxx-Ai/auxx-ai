// packages/lib/src/ai/agent-framework/__tests__/drop-restated-text.test.ts

import { describe, expect, it } from 'vitest'
import { dropRestatedTextParts } from '../query-loop'
import type { ContentPart } from '../types'

const text = (t: string): ContentPart => ({ type: 'text', text: t, agent: 'agent' })
const tool = (): ContentPart => ({
  type: 'tool_call',
  toolCallId: 'call_1',
  name: 'find_order',
  args: {},
  status: 'completed',
})

describe('dropRestatedTextParts', () => {
  it('drops an earlier text part restated verbatim after a tool call', () => {
    const earlier = 'I found order #2088 for that email — can you confirm this is the right one?'
    const parts = [text(earlier), tool(), text(`Thanks for waiting. ${earlier}`)]
    dropRestatedTextParts(parts)
    expect(parts).toHaveLength(2)
    expect(parts[0]?.type).toBe('tool_call')
    expect((parts[1] as { text: string }).text).toContain('Thanks for waiting.')
  })

  it('matches across whitespace and markdown-emphasis differences', () => {
    const parts = [
      text('Your order  #2088 includes 2x Jacket (Black / L), total $545.00.'),
      tool(),
      text(
        'Your order **#2088** includes **2x Jacket (Black / L)**, total **$545.00**. Shall I proceed?'
      ),
    ]
    dropRestatedTextParts(parts)
    expect(parts.filter((p) => p.type === 'text')).toHaveLength(1)
  })

  it('leaves genuinely different passages alone', () => {
    const parts = [
      text('Let me look that order up for you right away.'),
      tool(),
      text('I found order #2088 — two jackets, fulfilled and paid. Is that the right one?'),
    ]
    dropRestatedTextParts(parts)
    expect(parts.filter((p) => p.type === 'text')).toHaveLength(2)
  })

  it('keeps short echoes and never drops the only text part', () => {
    const short = [text('Done.'), tool(), text('Done. Anything else I can help with today?')]
    dropRestatedTextParts(short)
    expect(short.filter((p) => p.type === 'text')).toHaveLength(2)

    const single = [tool(), text('I found order #2088 for that email address.')]
    dropRestatedTextParts(single)
    expect(single.filter((p) => p.type === 'text')).toHaveLength(1)
  })
})

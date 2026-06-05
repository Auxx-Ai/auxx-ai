// packages/lib/src/agents/procedures/__tests__/conversation.test.ts

import { describe, expect, it } from 'vitest'
import type { SessionMessage } from '../../../ai/agent-framework/types'
import { sessionMessagesToConversation } from '../conversation'

const msg = (m: Partial<SessionMessage> & { role: SessionMessage['role'] }) =>
  m as unknown as SessionMessage

describe('sessionMessagesToConversation', () => {
  it('keeps user + assistant turns, reading string content', () => {
    const out = sessionMessagesToConversation([
      msg({ role: 'user', content: 'hi' }),
      msg({ role: 'assistant', content: 'hello' }),
    ])
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('joins text parts when content is absent', () => {
    const out = sessionMessagesToConversation([
      msg({
        role: 'assistant',
        parts: [
          { type: 'text', text: 'foo ' },
          { type: 'thinking', text: 'ignored' },
          { type: 'text', text: 'bar' },
        ],
      }),
    ])
    expect(out).toEqual([{ role: 'assistant', content: 'foo bar' }])
  })

  it('drops non user/assistant roles and empty turns', () => {
    const out = sessionMessagesToConversation([
      msg({ role: 'system', content: 'sys' }),
      msg({ role: 'user', content: '   ' }),
      msg({ role: 'user', content: 'keep me' }),
    ])
    expect(out).toEqual([{ role: 'user', content: 'keep me' }])
  })
})

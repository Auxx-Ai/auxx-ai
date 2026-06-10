// packages/lib/src/ai/kopilot/prompts/__tests__/trigger-context.test.ts

import { describe, expect, it } from 'vitest'
import { renderTriggerSection } from '../trigger-context'

describe('renderTriggerSection', () => {
  it('returns empty string when no triggerContext is provided', () => {
    expect(renderTriggerSection(undefined)).toBe('')
  })

  it('renders the mention block, instructions, and run-mode banner', () => {
    const out = renderTriggerSection({
      kind: 'mention',
      instructions: 'Reply with a haiku.',
      payload: {
        kind: 'mention',
        commentId: 'cmt_1',
        parentRecordId: 'ticket:t_1',
        mentionerUserId: 'u_42',
        firedAt: '2026-05-15T10:00:00.000Z',
      },
    })
    expect(out).toContain('## Trigger fired')
    expect(out).toContain('Kind: `mention`')
    expect(out).toContain('Comment id: `cmt_1`')
    expect(out).toContain('Mentioned in: `ticket:t_1`')
    expect(out).toContain('Mentioner: `user:u_42`')
    expect(out).toContain('## Trigger instructions')
    expect(out).toContain('Reply with a haiku.')
    expect(out).toContain('## Run mode')
    expect(out).toContain('autonomously')
  })

  it('omits the instructions section when instructions are null or blank', () => {
    const out = renderTriggerSection({
      kind: 'mention',
      instructions: null,
      payload: {
        kind: 'mention',
        commentId: 'cmt_1',
        parentRecordId: 'ticket:t_1',
        mentionerUserId: 'u_42',
      },
    })
    expect(out).not.toContain('## Trigger instructions')
    expect(out).toContain('## Trigger fired')
    expect(out).toContain('## Run mode')
  })

  it('renders the scheduled block', () => {
    const out = renderTriggerSection({
      kind: 'scheduled',
      instructions: null,
      payload: { kind: 'scheduled', firedAt: '2026-05-15T10:00:00.000Z' },
    })
    expect(out).toContain('Kind: `scheduled`')
    expect(out).toContain('Fired at: 2026-05-15T10:00:00.000Z')
  })

  it('renders the customer_message block and conversation-appropriate banner', () => {
    const out = renderTriggerSection({
      kind: 'customer_message',
      instructions: null,
      payload: { channel: 'chat', firedAt: '2026-06-09T10:00:00.000Z', simulated: true },
    })
    expect(out).toContain('Kind: `customer_message`')
    expect(out).toContain('Channel: `chat`')
    expect(out).toContain('Fired at: 2026-06-09T10:00:00.000Z')
    expect(out).toContain('## Run mode')
    expect(out).toContain('customer conversation')
    // The fire-and-forget banner would sabotage a live conversation.
    expect(out).not.toContain('there is no caller')
    expect(out).not.toContain('Follow your trigger instructions')
    // It must invite asking the customer, and forbid fabricated action claims.
    expect(out).toContain('Ask the customer')
    expect(out).toContain('a tool call in this conversation actually did it')
  })

  it('renders scheduled instructions when set', () => {
    const out = renderTriggerSection({
      kind: 'scheduled',
      instructions: 'Post the digest to #support.',
      payload: { kind: 'scheduled', firedAt: '2026-05-15T10:00:00.000Z' },
    })
    expect(out).toContain('Kind: `scheduled`')
    expect(out).toContain('## Trigger instructions')
    expect(out).toContain('Post the digest to #support.')
  })

  it('renders the event block with record id', () => {
    const out = renderTriggerSection({
      kind: 'event',
      instructions: null,
      payload: {
        kind: 'event',
        eventType: 'thread.created',
        recordId: 'thread:th_9',
        firedAt: '2026-05-15T10:00:00.000Z',
      },
    })
    expect(out).toContain('Kind: `event`')
    expect(out).toContain('Event type: `thread.created`')
    expect(out).toContain('Triggering record: `thread:th_9`')
    expect(out).toContain('domain state under `triggerResource`')
  })

  it('renders event instructions when set', () => {
    const out = renderTriggerSection({
      kind: 'event',
      instructions: 'Draft a reply using the customer order history.',
      payload: {
        kind: 'event',
        eventType: 'thread.created',
        recordId: 'thread:th_9',
        firedAt: '2026-05-15T10:00:00.000Z',
      },
    })
    expect(out).toContain('Kind: `event`')
    expect(out).toContain('## Trigger instructions')
    expect(out).toContain('Draft a reply using the customer order history.')
  })

  it('renders the assignment block with thread record id', () => {
    const out = renderTriggerSection({
      kind: 'assignment',
      instructions: null,
      payload: {
        kind: 'assignment',
        threadRecordId: 'ticket:t_1',
        assignerUserId: 'u_42',
      },
    })
    expect(out).toContain('Kind: `assignment`')
    expect(out).toContain('Assigned thread: `ticket:t_1`')
    expect(out).toContain('Assigner: `user:u_42`')
  })

  it('renders the Acting as line when agentUserId is provided', () => {
    const out = renderTriggerSection(
      {
        kind: 'mention',
        instructions: 'Take ownership.',
        payload: {
          kind: 'mention',
          commentId: 'cmt_1',
          parentRecordId: 'ticket:t_1',
          mentionerUserId: 'u_42',
        },
      },
      { agentUserId: 'agent_user_99' }
    )
    expect(out).toContain('## Acting as')
    expect(out).toContain('actor:user:agent_user_99')
  })

  it('omits the Acting as line when agentUserId is null', () => {
    const out = renderTriggerSection(
      {
        kind: 'scheduled',
        instructions: null,
        payload: { kind: 'scheduled', firedAt: '2026-05-15T10:00:00.000Z' },
      },
      { agentUserId: null }
    )
    expect(out).not.toContain('## Acting as')
  })

  it('renders the app block', () => {
    const out = renderTriggerSection({
      kind: 'app',
      instructions: 'Triage the incoming event.',
      payload: {
        kind: 'app',
        appId: 'shopify',
        triggerId: 'order.created',
        installationId: 'inst_1',
        eventId: 'evt_1',
      },
    })
    expect(out).toContain('Kind: `app`')
    expect(out).toContain('App: `shopify`')
    expect(out).toContain('Trigger id: `order.created`')
    expect(out).toContain('Triage the incoming event.')
  })
})

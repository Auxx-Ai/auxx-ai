// apps/web/src/components/kopilot/utils/__tests__/task-notifications.test.ts

import { describe, expect, it } from 'vitest'
import type { KopilotMessage } from '../../stores/kopilot-store'
import {
  canDrainNotification,
  extractTaskRefs,
  findUnnotifiedTaskRefs,
  hasPendingApproval,
  isTaskNotificationMessage,
} from '../task-notifications'

let nextId = 0
function msg(partial: Partial<KopilotMessage>): KopilotMessage {
  nextId += 1
  return { id: `m${nextId}`, role: 'user', timestamp: 0, parentId: null, ...partial }
}

function toolMsg(output: unknown, status: 'completed' | 'running' = 'completed'): KopilotMessage {
  return msg({
    role: 'assistant',
    parts: [
      { type: 'text', text: 'hi' },
      { type: 'tool_call', toolCallId: 't1', name: 'run_eval_suite', args: {}, status, output },
    ],
  })
}

function notificationMsg(kind: string, ref: string): KopilotMessage {
  return msg({
    role: 'user',
    content: '<task-notification>…</task-notification>',
    metadata: { origin: 'task-notification', kind, ref },
  })
}

const SUITE_OUTPUT = {
  suiteRunId: 'esr_1',
  taskNotification: { kind: 'eval-suite', ref: 'esr_1' },
}

describe('extractTaskRefs', () => {
  it('finds refs on completed tool outputs and dedupes', () => {
    const messages = [toolMsg(SUITE_OUTPUT), toolMsg(SUITE_OUTPUT)]
    expect(extractTaskRefs(messages)).toEqual([{ kind: 'eval-suite', ref: 'esr_1' }])
  })

  it('ignores running tools, outputs without the marker, and malformed refs', () => {
    const messages = [
      toolMsg(SUITE_OUTPUT, 'running'),
      toolMsg({ anything: true }),
      toolMsg({ taskNotification: { kind: 'eval-suite' } }),
      msg({ role: 'user', content: 'hello' }),
    ]
    expect(extractTaskRefs(messages)).toEqual([])
  })
})

describe('findUnnotifiedTaskRefs (replay classification)', () => {
  it('returns refs lacking a notification message', () => {
    expect(findUnnotifiedTaskRefs([toolMsg(SUITE_OUTPUT)])).toEqual([
      { kind: 'eval-suite', ref: 'esr_1' },
    ])
  })

  it('skips refs already notified', () => {
    const messages = [toolMsg(SUITE_OUTPUT), notificationMsg('eval-suite', 'esr_1')]
    expect(findUnnotifiedTaskRefs(messages)).toEqual([])
  })

  it('does not match a notification for a different ref', () => {
    const messages = [toolMsg(SUITE_OUTPUT), notificationMsg('eval-suite', 'esr_OTHER')]
    expect(findUnnotifiedTaskRefs(messages)).toEqual([{ kind: 'eval-suite', ref: 'esr_1' }])
  })
})

describe('isTaskNotificationMessage', () => {
  it('requires user role + origin marker', () => {
    expect(isTaskNotificationMessage(notificationMsg('eval-suite', 'esr_1'))).toBe(true)
    expect(isTaskNotificationMessage(msg({ role: 'user', content: 'hi' }))).toBe(false)
    expect(
      isTaskNotificationMessage(msg({ role: 'system', metadata: { origin: 'task-notification' } }))
    ).toBe(false)
  })
})

describe('canDrainNotification (the gate)', () => {
  const idle = { isStreaming: false, pendingRequest: null, messages: [] as KopilotMessage[] }

  it('drains only when fully idle', () => {
    expect(canDrainNotification(idle)).toBe(true)
    expect(canDrainNotification({ ...idle, isStreaming: true })).toBe(false)
    expect(canDrainNotification({ ...idle, pendingRequest: { message: 'x' } })).toBe(false)
  })

  it('a pending approval counts as an active turn', () => {
    const approvalPending = msg({
      role: 'system',
      approval: { toolName: 'x', toolCallId: 't', args: {}, status: 'pending' },
    })
    expect(canDrainNotification({ ...idle, messages: [approvalPending] })).toBe(false)
    expect(hasPendingApproval([approvalPending])).toBe(true)

    const approvalDecided = msg({
      role: 'system',
      approval: { toolName: 'x', toolCallId: 't', args: {}, status: 'approved' },
    })
    expect(canDrainNotification({ ...idle, messages: [approvalDecided] })).toBe(true)
  })
})

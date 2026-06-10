// apps/web/src/app/api/kopilot/stream/__tests__/task-notification.test.ts

import type { TaskNotificationKindHandler } from '@auxx/lib/ai/kopilot/task-notifications'
import { describe, expect, it } from 'vitest'
import { isNotificationForTask, resolveTaskNotification } from '../task-notification'

const TASK = { kind: 'eval-suite', ref: 'esr_1' }

function makeHandler(overrides: Partial<TaskNotificationKindHandler> = {}) {
  const handler: TaskNotificationKindHandler = {
    kind: 'eval-suite',
    load: async () => ({ id: 'esr_1', status: 'completed' }),
    isTerminal: () => true,
    summarize: () => ({
      status: 'completed',
      summary: '5 runs: 4 passed · 1 failed',
      instruction: 'Report the outcome.',
    }),
    ...overrides,
  }
  return handler
}

function makeDeps(input: {
  handler?: TaskNotificationKindHandler | undefined
  messages?: Record<string, unknown>[] | null
}) {
  return {
    getHandler: () => input.handler,
    loadSessionMessages: async () => (input.messages === undefined ? [] : input.messages),
  }
}

describe('resolveTaskNotification', () => {
  it('rejects when sessionId is missing (notifications never create sessions)', async () => {
    const result = await resolveTaskNotification(
      { task: TASK, organizationId: 'org_1' },
      makeDeps({ handler: makeHandler() })
    )
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects a missing or partial task ref', async () => {
    const result = await resolveTaskNotification(
      { sessionId: 's_1', task: { kind: 'eval-suite' }, organizationId: 'org_1' },
      makeDeps({ handler: makeHandler() })
    )
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects an unknown kind', async () => {
    const result = await resolveTaskNotification(
      { sessionId: 's_1', task: TASK, organizationId: 'org_1' },
      makeDeps({ handler: undefined })
    )
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('404s when the task does not exist or belongs to another org', async () => {
    const result = await resolveTaskNotification(
      { sessionId: 's_1', task: TASK, organizationId: 'org_1' },
      makeDeps({ handler: makeHandler({ load: async () => null }) })
    )
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('422s when the task is not terminal yet', async () => {
    const result = await resolveTaskNotification(
      { sessionId: 's_1', task: TASK, organizationId: 'org_1' },
      makeDeps({ handler: makeHandler({ isTerminal: () => false }) })
    )
    expect(result).toMatchObject({ ok: false, status: 422 })
  })

  it('404s when the session cannot be loaded', async () => {
    const result = await resolveTaskNotification(
      { sessionId: 's_1', task: TASK, organizationId: 'org_1' },
      makeDeps({ handler: makeHandler(), messages: null })
    )
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('no-ops when the session already carries a notification for this task', async () => {
    const result = await resolveTaskNotification(
      { sessionId: 's_1', task: TASK, organizationId: 'org_1' },
      makeDeps({
        handler: makeHandler(),
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'user',
            content: '<task-notification>…</task-notification>',
            metadata: { origin: 'task-notification', kind: 'eval-suite', ref: 'esr_1' },
          },
        ],
      })
    )
    expect(result).toEqual({ ok: true, deduped: true })
  })

  it('rewrites the body from the handler summary, ignoring client text', async () => {
    const result = await resolveTaskNotification(
      { sessionId: 's_1', task: TASK, organizationId: 'org_1' },
      makeDeps({ handler: makeHandler() })
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.deduped) throw new Error('expected a rewritten notification')
    expect(result.message).toContain('<summary>5 runs: 4 passed · 1 failed</summary>')
    expect(result.message).toContain('<ref>esr_1</ref>')
    expect(result.metadata).toEqual({
      origin: 'task-notification',
      kind: 'eval-suite',
      ref: 'esr_1',
    })
  })

  it('500s when the handler load throws', async () => {
    const result = await resolveTaskNotification(
      { sessionId: 's_1', task: TASK, organizationId: 'org_1' },
      makeDeps({
        handler: makeHandler({
          load: async () => {
            throw new Error('db down')
          },
        }),
      })
    )
    expect(result).toMatchObject({ ok: false, status: 500, error: 'db down' })
  })
})

describe('isNotificationForTask', () => {
  it('matches only on origin + kind + ref', () => {
    const msg = {
      metadata: { origin: 'task-notification', kind: 'eval-suite', ref: 'esr_1' },
    }
    expect(isNotificationForTask(msg, TASK)).toBe(true)
    expect(isNotificationForTask(msg, { kind: 'eval-suite', ref: 'esr_2' })).toBe(false)
    expect(isNotificationForTask({ metadata: { origin: 'other' } }, TASK)).toBe(false)
    expect(isNotificationForTask({}, TASK)).toBe(false)
  })
})

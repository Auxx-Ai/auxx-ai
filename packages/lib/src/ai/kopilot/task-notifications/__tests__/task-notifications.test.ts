// packages/lib/src/ai/kopilot/task-notifications/__tests__/task-notifications.test.ts

import { describe, expect, it } from 'vitest'
import { buildTaskNotificationBody } from '../body'
import { EVAL_SUITE_TASK_KIND, evalSuiteTaskNotificationHandler } from '../kinds/eval-suite'
import { getTaskNotificationHandler, listTaskNotificationKinds } from '../registry'

/** Minimal suite-run snapshot; only the fields the handler reads. */
function suite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'esr_1',
    status: 'completed',
    requestedCount: 5,
    completedCount: 5,
    passedCount: 4,
    failedCount: 1,
    errorCount: 0,
    cancelledCount: 0,
    timedOutCount: 0,
    ...overrides,
  }
}

describe('task-notification registry', () => {
  it('resolves registered kinds', () => {
    expect(getTaskNotificationHandler(EVAL_SUITE_TASK_KIND)).toBe(evalSuiteTaskNotificationHandler)
    expect(listTaskNotificationKinds()).toContain(EVAL_SUITE_TASK_KIND)
  })

  it('returns undefined for unknown kinds', () => {
    expect(getTaskNotificationHandler('nope')).toBeUndefined()
  })
})

describe('eval-suite handler — isTerminal', () => {
  it.each([
    ['queued', false],
    ['running', false],
    ['completed', true],
    ['cancelled', true],
    ['error', true],
  ])('%s → %s', (status, expected) => {
    expect(evalSuiteTaskNotificationHandler.isTerminal(suite({ status }))).toBe(expected)
  })
})

describe('eval-suite handler — summarize', () => {
  it('builds the headline from counters', () => {
    const result = evalSuiteTaskNotificationHandler.summarize(suite())
    expect(result.status).toBe('completed')
    expect(result.summary).toBe('5 runs: 4 passed · 1 failed')
    expect(result.instruction).toContain('Do not re-run the suite')
  })

  it('includes error/cancelled/timed-out counts only when nonzero', () => {
    const result = evalSuiteTaskNotificationHandler.summarize(
      suite({ errorCount: 2, cancelledCount: 1, timedOutCount: 3 })
    )
    expect(result.summary).toBe(
      '5 runs: 4 passed · 1 failed · 2 errored · 1 cancelled · 3 timed out'
    )
  })

  it('singularizes a one-run suite', () => {
    const result = evalSuiteTaskNotificationHandler.summarize(
      suite({ requestedCount: 1, passedCount: 1, failedCount: 0 })
    )
    expect(result.summary).toBe('1 run: 1 passed · 0 failed')
  })
})

describe('buildTaskNotificationBody', () => {
  it('emits the canonical XML shape', () => {
    const body = buildTaskNotificationBody({
      kind: 'eval-suite',
      ref: 'esr_1',
      status: 'completed',
      summary: '5 runs: 4 passed · 1 failed',
      instruction: 'Report the outcome.',
    })
    expect(body).toBe(
      [
        '<task-notification>',
        '  <kind>eval-suite</kind>',
        '  <ref>esr_1</ref>',
        '  <status>completed</status>',
        '  <summary>5 runs: 4 passed · 1 failed</summary>',
        '  <instruction>Report the outcome.</instruction>',
        '</task-notification>',
      ].join('\n')
    )
  })

  it('escapes XML-significant characters', () => {
    const body = buildTaskNotificationBody({
      kind: 'eval-suite',
      ref: 'esr_1',
      status: 'error',
      summary: 'failed on <case> & friends',
      instruction: 'x',
    })
    expect(body).toContain('<summary>failed on &lt;case&gt; &amp; friends</summary>')
  })
})

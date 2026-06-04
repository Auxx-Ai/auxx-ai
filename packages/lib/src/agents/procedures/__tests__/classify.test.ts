// packages/lib/src/agents/procedures/__tests__/classify.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ClassifierCandidate, type ClassifyDeps, classifyProcedure } from '../classify'

// Mock the orchestrator: capture the request and return a controllable structured output.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('../../../ai/orchestrator/llm-orchestrator', () => ({
  LLMOrchestrator: class {
    invoke = invokeMock
  },
}))

const deps: ClassifyDeps = {
  db: {} as Database,
  organizationId: 'org-1',
  userId: 'user-1',
  model: 'claude-haiku-4-5',
  provider: 'anthropic',
}
const conversation = [{ role: 'user' as const, content: 'I want to cancel my subscription' }]
const candidates: ClassifierCandidate[] = [
  { id: 'p-cancel', whenToUse: 'Customer wants to cancel', triggerExamples: [] },
  { id: 'p-refund', whenToUse: 'Customer wants a refund', triggerExamples: [] },
]

beforeEach(() => invokeMock.mockReset())

describe('classifyProcedure', () => {
  it('returns the chosen id from structured output', async () => {
    invokeMock.mockResolvedValue({ structured_output: { procedureId: 'p-cancel' } })
    expect(await classifyProcedure(conversation, candidates, deps)).toEqual({ id: 'p-cancel' })
  })

  it('is O(1): exactly one invoke regardless of candidate count', async () => {
    invokeMock.mockResolvedValue({ structured_output: { procedureId: 'p-refund' } })
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `p-${i}`,
      whenToUse: `case ${i}`,
      triggerExamples: [],
    }))
    await classifyProcedure(conversation, many, deps)
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('returns null when the model picks null', async () => {
    invokeMock.mockResolvedValue({ structured_output: { procedureId: null } })
    expect(await classifyProcedure(conversation, candidates, deps)).toEqual({ id: null })
  })

  it('belt-and-suspenders: rejects an id outside the candidate set', async () => {
    invokeMock.mockResolvedValue({ structured_output: { procedureId: 'p-not-a-candidate' } })
    expect(await classifyProcedure(conversation, candidates, deps)).toEqual({ id: null })
  })

  it('constrains the structured-output enum to the candidate ids ∪ null', async () => {
    invokeMock.mockResolvedValue({ structured_output: { procedureId: 'p-cancel' } })
    await classifyProcedure(conversation, candidates, deps)
    const req = invokeMock.mock.calls[0][0]
    expect(req.structuredOutput.enabled).toBe(true)
    expect(req.structuredOutput.schema.properties.procedureId.enum).toEqual([
      'p-cancel',
      'p-refund',
      null,
    ])
  })

  it('splits triggerExamples into Use/Avoid blocks in the system prompt', async () => {
    invokeMock.mockResolvedValue({ structured_output: { procedureId: null } })
    await classifyProcedure(
      conversation,
      [
        {
          id: 'p-cancel',
          whenToUse: 'Customer wants to cancel',
          triggerExamples: [
            { text: 'please cancel my plan', behavior: 'use' },
            { text: 'I want to upgrade', behavior: 'avoid' },
          ],
        },
      ],
      deps
    )
    const sys = invokeMock.mock.calls[0][0].messages[0].content
    expect(sys).toContain('Use when:')
    expect(sys).toContain('please cancel my plan')
    expect(sys).toContain('Avoid when:')
    expect(sys).toContain('I want to upgrade')
  })

  it('returns null without an LLM call when there are no candidates', async () => {
    expect(await classifyProcedure(conversation, [], deps)).toEqual({ id: null })
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

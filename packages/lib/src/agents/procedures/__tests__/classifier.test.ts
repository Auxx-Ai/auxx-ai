// packages/lib/src/agents/procedures/__tests__/classifier.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backstopClassify, classifyTextBranch, goalMetCheck } from '../classifier'
import type { ClassifyDeps } from '../classify'
import type { ProcedureStep } from '../types'

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

const step: Extract<ProcedureStep, { kind: 'instruction' }> = {
  id: 's0',
  kind: 'instruction',
  doc: {
    type: 'fragment',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cancel the order.' }] }],
  },
  next: null,
}

const lastRequest = () => invokeMock.mock.calls.at(-1)?.[0]

beforeEach(() => invokeMock.mockReset())

describe('goalMetCheck', () => {
  it('returns true/false from structured output and tags the call source', async () => {
    invokeMock.mockResolvedValue({ structured_output: { met: true } })
    expect(await goalMetCheck('Done, your order is cancelled.', step, deps)).toBe(true)
    expect(lastRequest().context).toEqual({ source: 'procedure-advance-check' })

    invokeMock.mockResolvedValue({ structured_output: { met: false } })
    expect(await goalMetCheck('What is your order number?', step, deps)).toBe(false)
  })

  it('defaults to false when the model omits the field', async () => {
    invokeMock.mockResolvedValue({ structured_output: {} })
    expect(await goalMetCheck('…', step, deps)).toBe(false)
  })
})

describe('backstopClassify', () => {
  it('returns the on-procedure / multi-turn verdict', async () => {
    invokeMock.mockResolvedValue({ structured_output: { onProcedure: false, multiTurn: true } })
    expect(await backstopClassify('Sure, I can also help with returns…', step, deps)).toEqual({
      onProcedure: false,
      multiTurn: true,
    })
    expect(lastRequest().context).toEqual({ source: 'procedure-backstop' })
  })

  it('coerces missing fields to false', async () => {
    invokeMock.mockResolvedValue({ structured_output: {} })
    expect(await backstopClassify('…', step, deps)).toEqual({
      onProcedure: false,
      multiTurn: false,
    })
  })
})

describe('classifyTextBranch', () => {
  const convo = [{ role: 'user' as const, content: 'I want to cancel now and re-order later' }]

  it('returns the chosen in-range arm index', async () => {
    invokeMock.mockResolvedValue({ structured_output: { arm: 1 } })
    expect(await classifyTextBranch(convo, ['cancel only', 'cancel + re-order'], deps)).toBe(1)
    expect(lastRequest().context).toEqual({ source: 'procedure-text-condition' })
  })

  it('clamps an out-of-range arm to null (else fallthrough)', async () => {
    invokeMock.mockResolvedValue({ structured_output: { arm: 5 } })
    expect(await classifyTextBranch(convo, ['a', 'b'], deps)).toBeNull()
  })

  it('returns null when the model picks none', async () => {
    invokeMock.mockResolvedValue({ structured_output: { arm: null } })
    expect(await classifyTextBranch(convo, ['a', 'b'], deps)).toBeNull()
  })

  it('short-circuits with no LLM call when there are no predicates', async () => {
    expect(await classifyTextBranch(convo, [], deps)).toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

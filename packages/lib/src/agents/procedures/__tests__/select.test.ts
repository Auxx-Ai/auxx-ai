// packages/lib/src/agents/procedures/__tests__/select.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Subject, ToolContext } from '../../../ai/agent-framework/tool-context'
import type { Condition, ConditionGroup } from '../../../conditions/types'
import { type ResolvedCandidate, type SelectProcedureArgs, selectProcedure } from '../select'
import type { CompiledProcedure, ProcedureFrame, ProcedureStack } from '../types'

// `buildProcedureFieldResolver` is mocked to a sync lookup over a controllable map,
// so the REAL `evaluateConditions` runs against values we pin per test.
const { resolved, classifyMock, buildResolverMock } = vi.hoisted(() => ({
  resolved: {} as Record<string, unknown>,
  classifyMock: vi.fn(),
  buildResolverMock: vi.fn(),
}))
vi.mock('../classify', () => ({ classifyProcedure: classifyMock }))
vi.mock('../context', () => ({ buildProcedureFieldResolver: buildResolverMock }))

const compiled = (entryStepId = 's0'): CompiledProcedure => ({
  entryStepId,
  steps: { [entryStepId]: { id: entryStepId, kind: 'instruction', doc: {}, next: null } },
  codeBlocks: {},
  subProcedures: {},
  localAttributes: [],
})

const candidate = (over: Partial<ResolvedCandidate> & { id?: string } = {}): ResolvedCandidate => {
  const id = over.id ?? 'p1'
  return {
    link: { enabled: true, priority: 0, ...(over.link ?? {}) } as ResolvedCandidate['link'],
    procedure: {
      id,
      activeVersionId: 'v1',
      ...(over.procedure ?? {}),
    } as ResolvedCandidate['procedure'],
    activeVersion: {
      id: 'v1',
      compiled: compiled(),
      ...(over.activeVersion ?? {}),
    } as ResolvedCandidate['activeVersion'],
    resolved: {
      whenToUse: 'help with X',
      triggerExamples: [],
      ruleset: [],
      ...(over.resolved ?? {}),
    },
  }
}

const group = (conditions: Condition[]): ConditionGroup => ({
  id: 'g',
  conditions,
  logicalOperator: 'AND',
})
const cond = (fieldId: string, value: unknown): Condition => ({
  id: 'c',
  fieldId,
  operator: 'is',
  value,
})

const ctx = { db: {} } as ToolContext
const subject: Subject = { anchors: {}, identityVerified: false }
const baseArgs = (over: Partial<SelectProcedureArgs>): SelectProcedureArgs => ({
  stack: { frames: [] },
  candidates: [],
  conversation: [{ role: 'user', content: 'hi' }],
  ctx,
  subject,
  classifyDeps: { organizationId: 'org', userId: 'u', model: 'm', provider: 'anthropic' },
  ...over,
})

const runningFrame: ProcedureFrame = {
  procedureId: 'p-old',
  procedureVersionId: 'v-old',
  cursor: 's2',
  status: 'running',
  history: [],
  pushedBy: 'selection',
}

beforeEach(() => {
  for (const k of Object.keys(resolved)) delete resolved[k]
  classifyMock.mockReset()
  buildResolverMock.mockReset()
  buildResolverMock.mockResolvedValue((_e: unknown, fieldId: string) => resolved[fieldId])
})

describe('selectProcedure', () => {
  it('STICKY: a running top frame resumes without a classifier call', async () => {
    const stack: ProcedureStack = { frames: [runningFrame] }
    const result = await selectProcedure(baseArgs({ stack, candidates: [candidate()] }))
    expect(result).toEqual({ kind: 'resume', frame: runningFrame })
    expect(classifyMock).not.toHaveBeenCalled()
    expect(buildResolverMock).not.toHaveBeenCalled()
  })

  it('a FINISHED top frame does NOT short-circuit (proceeds to classify)', async () => {
    classifyMock.mockResolvedValue({ id: 'p1' })
    const stack: ProcedureStack = { frames: [{ ...runningFrame, status: 'finished' }] }
    const result = await selectProcedure(baseArgs({ stack, candidates: [candidate()] }))
    expect(result.kind).toBe('selected')
    expect(classifyMock).toHaveBeenCalledTimes(1)
  })

  it('ZERO candidates: returns none with no LLM call (no regression)', async () => {
    const result = await selectProcedure(baseArgs({ candidates: [] }))
    expect(result).toEqual({ kind: 'none' })
    expect(classifyMock).not.toHaveBeenCalled()
    expect(buildResolverMock).not.toHaveBeenCalled()
  })

  it('drops disabled / empty-whenToUse candidates before classify', async () => {
    const result = await selectProcedure(
      baseArgs({
        candidates: [
          candidate({
            id: 'disabled',
            link: { enabled: false, priority: 0 } as ResolvedCandidate['link'],
          }),
          candidate({
            id: 'blank',
            resolved: { whenToUse: '   ', triggerExamples: [], ruleset: [] },
          }),
        ],
      })
    )
    expect(result).toEqual({ kind: 'none' })
    expect(classifyMock).not.toHaveBeenCalled()
  })

  it('RULESET pre-filter: a non-matching ruleset is dropped; an empty ruleset survives', async () => {
    classifyMock.mockResolvedValue({ id: 'always' })
    resolved.status = 'CLOSED' // so the contact:status=OPEN gate fails
    const result = await selectProcedure(
      baseArgs({
        candidates: [
          candidate({
            id: 'open-only',
            resolved: {
              whenToUse: 'a',
              triggerExamples: [],
              ruleset: [group([cond('contact:status', 'OPEN')])],
            },
          }),
          candidate({
            id: 'always',
            resolved: { whenToUse: 'b', triggerExamples: [], ruleset: [] },
          }),
        ],
      })
    )
    // only the empty-ruleset candidate reaches the classifier
    const survivors = classifyMock.mock.calls[0]![1] as { id: string }[]
    expect(survivors.map((s) => s.id)).toEqual(['always'])
    expect(result.kind).toBe('selected')
  })

  it('GATE-BY-ABSENCE: empty subject drops a ruleset requiring a present field', async () => {
    const result = await selectProcedure(
      baseArgs({
        candidates: [
          candidate({
            id: 'needs-contact',
            resolved: {
              whenToUse: 'a',
              triggerExamples: [],
              ruleset: [group([cond('contact:status', 'OPEN')])],
            },
          }),
        ],
      })
    )
    expect(result).toEqual({ kind: 'none' })
    expect(classifyMock).not.toHaveBeenCalled()
  })

  it('excludeProcedureIds filters before filter/classify (Phase 3 digression reuse)', async () => {
    const result = await selectProcedure(
      baseArgs({ candidates: [candidate({ id: 'p1' })], excludeProcedureIds: ['p1'] })
    )
    expect(result).toEqual({ kind: 'none' })
    expect(classifyMock).not.toHaveBeenCalled()
  })

  it('FRAME 0: pins the active version and entry step', async () => {
    classifyMock.mockResolvedValue({ id: 'p1' })
    const c = candidate({
      id: 'p1',
      procedure: { id: 'p1', activeVersionId: 'v9' } as ResolvedCandidate['procedure'],
      activeVersion: {
        id: 'v9',
        compiled: compiled('entry'),
      } as ResolvedCandidate['activeVersion'],
    })
    const result = await selectProcedure(baseArgs({ candidates: [c] }))
    expect(result).toEqual({
      kind: 'selected',
      frame: {
        procedureId: 'p1',
        procedureVersionId: 'v9',
        cursor: 'entry',
        status: 'running',
        history: [],
        pushedBy: 'selection',
      },
    })
  })

  it('whole-procedure-as-text: a single-step build selects cleanly', async () => {
    classifyMock.mockResolvedValue({ id: 'p1' })
    const c = candidate({
      activeVersion: { id: 'v1', compiled: compiled('only') } as ResolvedCandidate['activeVersion'],
    })
    const result = await selectProcedure(baseArgs({ candidates: [c] }))
    expect(result.kind).toBe('selected')
    if (result.kind === 'selected') expect(result.frame.cursor).toBe('only')
  })

  it('classifier null → none', async () => {
    classifyMock.mockResolvedValue({ id: null })
    const result = await selectProcedure(baseArgs({ candidates: [candidate()] }))
    expect(result).toEqual({ kind: 'none' })
  })

  it('sorts survivors by link.priority desc before the classifier', async () => {
    classifyMock.mockResolvedValue({ id: 'low' })
    await selectProcedure(
      baseArgs({
        candidates: [
          candidate({
            id: 'low',
            link: { enabled: true, priority: 1 } as ResolvedCandidate['link'],
          }),
          candidate({
            id: 'high',
            link: { enabled: true, priority: 9 } as ResolvedCandidate['link'],
          }),
        ],
      })
    )
    const survivors = classifyMock.mock.calls[0]![1] as { id: string }[]
    expect(survivors.map((s) => s.id)).toEqual(['high', 'low'])
  })
})

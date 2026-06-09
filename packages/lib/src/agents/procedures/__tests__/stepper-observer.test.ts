// packages/lib/src/agents/procedures/__tests__/stepper-observer.test.ts
//
// The eval-only stepper transition observer (§1.7). Verifies the explicit
// step_entered / routing / procedure_finished events the AgentSimExecutor derives
// terminal outcomes from. Production omits the observer (no-op).

import { describe, expect, it, vi } from 'vitest'
import type { ToolContext } from '../../../ai/agent-framework/tool-context'
import type { ProcedureObserver, ProcedureTransitionEvent } from '../observer'
import { prepareTurn, type StepperDeps } from '../stepper'
import type { CompiledProcedure, ProcedureStack, ProcedureStep } from '../types'

// CRM field resolution routes through the v8 subject resolver — both exports must
// be stubbed or the missing one resolves `undefined` and breaks resolution.
vi.mock('../../bindings/resolve', () => ({
  buildResolveVarSource: vi.fn(() => async () => undefined),
  buildSubjectFieldResolver: vi.fn(() => async () => undefined),
}))

const instruction = (id: string, next: string | null): ProcedureStep => ({
  id,
  kind: 'instruction',
  doc: { type: 'fragment', content: [] },
  next,
})

const routing = (
  id: string,
  outcome: 'finished' | 'handoff' | 'switch' | 'call',
  opts: { next?: string | null; subProcedureId?: string; switchToProcedureId?: string } = {}
): ProcedureStep => ({
  id,
  kind: 'routing',
  outcome,
  next: opts.next ?? null,
  ...(opts.subProcedureId ? { subProcedureId: opts.subProcedureId } : {}),
  ...(opts.switchToProcedureId ? { switchToProcedureId: opts.switchToProcedureId } : {}),
})

const build = (
  entryStepId: string,
  steps: ProcedureStep[],
  subProcedures: CompiledProcedure['subProcedures'] = {}
): CompiledProcedure => ({
  entryStepId,
  steps: Object.fromEntries(steps.map((s) => [s.id, s])),
  codeBlocks: {},
  subProcedures,
  localAttributes: [],
})

const stackAt = (cursor: string | null): ProcedureStack => ({
  frames: [
    {
      procedureId: 'p1',
      procedureVersionId: 'v1',
      cursor,
      status: 'running',
      history: [],
      pushedBy: 'selection',
    },
  ],
})

function makeDeps(compiled: CompiledProcedure, observer: ProcedureObserver): StepperDeps {
  return {
    ctx: {
      subject: { anchors: {}, identityVerified: false },
      context: { read: async () => undefined, write: async () => {} },
    } as unknown as ToolContext,
    readVersion: async (id) => (id === 'v1' ? { compiled } : null),
    loadActiveVersion: async (procedureId) => ({
      procedureVersionId: 'v2',
      compiled: build('s2', [instruction('s2', null)]),
    }),
    selectOther: async () => null,
    pickTextBranch: async () => null,
    checkGoalMet: async () => true,
    classifyBackstop: async () => ({ onProcedure: true, multiTurn: false }),
    runCode: async () => ({ ok: true, result: {} }),
    onTransition: observer,
  }
}

function collect() {
  const events: ProcedureTransitionEvent[] = []
  return { events, observer: ((e) => events.push(e)) as ProcedureObserver }
}

describe('stepper transition observer', () => {
  it('emits step_entered when an instruction is injected', async () => {
    const { events, observer } = collect()
    await prepareTurn(stackAt('i1'), makeDeps(build('i1', [instruction('i1', null)]), observer))
    expect(events).toContainEqual({
      type: 'step_entered',
      procedureId: 'p1',
      procedureVersionId: 'v1',
      stepId: 'i1',
    })
  })

  it('emits routing(finished) then procedure_finished(routing) on a finished outcome', async () => {
    const { events, observer } = collect()
    await prepareTurn(stackAt('r'), makeDeps(build('r', [routing('r', 'finished')]), observer))
    const types = events.map(
      (e) => `${e.type}:${'outcome' in e ? e.outcome : 'reason' in e ? e.reason : ''}`
    )
    expect(types).toContain('routing:finished')
    expect(types).toContain('procedure_finished:routing')
  })

  it('emits routing(handoff) on a handoff outcome', async () => {
    const { events, observer } = collect()
    await prepareTurn(stackAt('r'), makeDeps(build('r', [routing('r', 'handoff')]), observer))
    expect(events.some((e) => e.type === 'routing' && e.outcome === 'handoff')).toBe(true)
  })

  it('emits routing(switch) with the target id', async () => {
    const { events, observer } = collect()
    await prepareTurn(
      stackAt('r'),
      makeDeps(build('r', [routing('r', 'switch', { switchToProcedureId: 'pX' })]), observer)
    )
    expect(events).toContainEqual({
      type: 'routing',
      procedureId: 'p1',
      procedureVersionId: 'v1',
      stepId: 'r',
      outcome: 'switch',
      targetId: 'pX',
    })
  })

  it('emits routing(call) with the sub-procedure id', async () => {
    const { events, observer } = collect()
    const compiled = build('r', [routing('r', 'call', { subProcedureId: 'sub1', next: null })], {
      sub1: { name: 'Sub', entryStepId: 'si', steps: { si: instruction('si', null) } } as never,
    })
    await prepareTurn(stackAt('r'), makeDeps(compiled, observer))
    expect(
      events.some((e) => e.type === 'routing' && e.outcome === 'call' && e.targetId === 'sub1')
    ).toBe(true)
  })

  it('emits procedure_finished(chain_end) when the chain ends with no terminal', async () => {
    const { events, observer } = collect()
    // instruction i1 → next null; resume PAST it by parking the cursor at its `next`.
    await prepareTurn(stackAt(null), makeDeps(build('i1', [instruction('i1', null)]), observer))
    expect(events.some((e) => e.type === 'procedure_finished' && e.reason === 'chain_end')).toBe(
      true
    )
  })

  it('emits procedure_finished(missing_step) when the cursor dangles', async () => {
    const { events, observer } = collect()
    await prepareTurn(stackAt('nope'), makeDeps(build('i1', [instruction('i1', null)]), observer))
    expect(events.some((e) => e.type === 'procedure_finished' && e.reason === 'missing_step')).toBe(
      true
    )
  })
})

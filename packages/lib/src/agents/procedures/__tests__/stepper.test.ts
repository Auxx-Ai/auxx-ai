// packages/lib/src/agents/procedures/__tests__/stepper.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolContext } from '../../../ai/agent-framework/tool-context'
import { PROC_SIGNAL_KEY } from '../control-tools'
import { interpretSignal, type PrepareResult, prepareTurn, type StepperDeps } from '../stepper'
import type { CompiledProcedure, ProcedureFrame, ProcedureStack, ProcedureStep } from '../types'

// CRM-field resolution goes through the v8 binding resolver — mocked to read `resolveMap`.
// The fixtures below use `var:*` predicates (served by `ctx.context.read`), so this is
// only exercised by the one CRM test.
const { resolveMap } = vi.hoisted(() => ({ resolveMap: {} as Record<string, unknown> }))
vi.mock('../../bindings/resolve', () => ({
  buildResolveVarSource: vi.fn(
    () => async (source: { kind: string; ref: string | string[] }) =>
      resolveMap[Array.isArray(source.ref) ? source.ref.join('|') : source.ref]
  ),
}))

// ── fixture builders ───────────────────────────────────────────────────────

const frag = (text = ''): unknown =>
  text
    ? { type: 'fragment', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
    : { type: 'fragment', content: [] }

const instruction = (id: string, next: string | null, text = ''): ProcedureStep => ({
  id,
  kind: 'instruction',
  doc: frag(text),
  next,
})

const structured = (
  id: string,
  cases: { thenStep: string | null; varName: string; value: unknown }[],
  elseStep: string | null,
  next: string | null
): ProcedureStep => ({
  id,
  kind: 'condition',
  mode: 'structured',
  cases: cases.map((c) => ({
    thenStep: c.thenStep,
    group: {
      id: `g-${c.varName}`,
      logicalOperator: 'AND',
      conditions: [
        { id: `c-${c.varName}`, fieldId: `var:${c.varName}`, operator: 'is', value: c.value },
      ],
    },
  })),
  elseStep,
  next,
})

const textCond = (
  id: string,
  cases: { thenStep: string | null; predicate: string }[],
  elseStep: string | null,
  next: string | null
): ProcedureStep => ({
  id,
  kind: 'condition',
  mode: 'text',
  cases: cases.map((c) => ({ thenStep: c.thenStep, predicate: c.predicate })),
  elseStep,
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

const frame = (
  procedureVersionId: string,
  cursor: string | null,
  pushedBy: ProcedureFrame['pushedBy'] = 'selection',
  procedureId = 'p1'
): ProcedureFrame => ({
  procedureId,
  procedureVersionId,
  cursor,
  status: 'running',
  history: [],
  pushedBy,
})

const stackOf = (...frames: ProcedureFrame[]): ProcedureStack => ({ frames })

// ── deps ─────────────────────────────────────────────────────────────────

let varStore: Record<string, unknown>
let reads: string[]

function makeDeps(
  versions: Record<string, CompiledProcedure>,
  overrides: Partial<StepperDeps> = {}
): StepperDeps {
  return {
    ctx: {
      subject: { anchors: {}, identityVerified: false },
      context: {
        read: async (ref: string) => {
          reads.push(ref)
          return varStore[ref]
        },
        write: async (ref: string, value: unknown) => {
          varStore[ref] = value
        },
      },
    } as unknown as ToolContext,
    readVersion: async (id) => (versions[id] ? { compiled: versions[id]! } : null),
    loadActiveVersion: async () => null,
    selectOther: async () => null,
    pickTextBranch: async () => null,
    checkGoalMet: async () => true,
    classifyBackstop: async () => ({ onProcedure: true, multiTurn: false }),
    ...overrides,
  }
}

const asInject = (r: PrepareResult): Extract<PrepareResult, { kind: 'inject' }> => {
  if (r.kind !== 'inject') throw new Error(`expected inject, got ${r.kind}`)
  return r
}

beforeEach(() => {
  varStore = {}
  reads = []
  for (const k of Object.keys(resolveMap)) delete resolveMap[k]
})

// ── tests ──────────────────────────────────────────────────────────────────

describe('prepareTurn — deterministic advance', () => {
  it('advances instruction → structured condition → instruction with NO classifier call', async () => {
    varStore['var:__la:v1:a'] = 1
    const compiled = build('i0', [
      instruction('i0', 'cond'),
      structured('cond', [{ thenStep: 'iThen', varName: 'a', value: 1 }], 'iElse', 'join'),
      instruction('iThen', 'join'),
      instruction('iElse', 'join'),
      instruction('join', null),
    ])
    const pickTextBranch = vi.fn(async () => null)
    const r = asInject(
      await prepareTurn(stackOf(frame('v1', 'i0')), makeDeps({ v1: compiled }, { pickTextBranch }))
    )
    // i0 is the first instruction → stops there immediately.
    expect(r.activeStep.id).toBe('i0')
    expect(pickTextBranch).not.toHaveBeenCalled()
  })

  it('descends the structured TRUE branch from a var predicate', async () => {
    varStore['var:__la:v1:a'] = 1
    const compiled = build('cond', [
      structured('cond', [{ thenStep: 'iThen', varName: 'a', value: 1 }], 'iElse', null),
      instruction('iThen', null, 'then body'),
      instruction('iElse', null, 'else body'),
    ])
    const r = asInject(await prepareTurn(stackOf(frame('v1', 'cond')), makeDeps({ v1: compiled })))
    expect(r.activeStep.id).toBe('iThen')
  })

  it('falls to the ELSE branch when no case matches', async () => {
    varStore['var:__la:v1:a'] = 999
    const compiled = build('cond', [
      structured('cond', [{ thenStep: 'iThen', varName: 'a', value: 1 }], 'iElse', null),
      instruction('iThen', null),
      instruction('iElse', null),
    ])
    const r = asInject(await prepareTurn(stackOf(frame('v1', 'cond')), makeDeps({ v1: compiled })))
    expect(r.activeStep.id).toBe('iElse')
  })

  it('is idempotent — re-running from the resulting cursor yields the same step, no writes', async () => {
    varStore['var:__la:v1:a'] = 1
    const compiled = build('i0', [
      instruction('i0', 'cond'),
      structured('cond', [{ thenStep: 'iThen', varName: 'a', value: 1 }], null, null),
      instruction('iThen', null),
    ])
    const stack = stackOf(frame('v1', 'i0'))
    const first = asInject(await prepareTurn(stack, makeDeps({ v1: compiled })))
    // advance again from where it stopped — instructions stop immediately, same result.
    const second = asInject(await prepareTurn(first.stack, makeDeps({ v1: compiled })))
    expect(second.activeStep.id).toBe(first.activeStep.id)
    expect(second.stack.frames[0]!.cursor).toBe(first.stack.frames[0]!.cursor)
  })

  it('resumes correctly when the cursor starts INSIDE a nested condition (OQ#3)', async () => {
    varStore['var:__la:v1:a'] = 1
    varStore['var:__la:v1:b'] = 2
    const compiled = build('outer', [
      structured('outer', [{ thenStep: 'inner', varName: 'a', value: 1 }], 'iEnd', 'join'),
      structured('inner', [{ thenStep: 'iThen', varName: 'b', value: 2 }], 'iElse', 'join'),
      instruction('iThen', 'join'),
      instruction('iElse', 'join'),
      instruction('iEnd', 'join'),
      instruction('join', null),
    ])
    // Resume directly at the inner condition (a parked mid-tree cursor).
    const r = asInject(await prepareTurn(stackOf(frame('v1', 'inner')), makeDeps({ v1: compiled })))
    expect(r.activeStep.id).toBe('iThen')
  })

  it('resolves a CRM FieldReference off the subject in a structured condition', async () => {
    resolveMap['contact:status'] = 'OPEN'
    const compiled: CompiledProcedure = {
      entryStepId: 'cond',
      steps: {
        cond: {
          id: 'cond',
          kind: 'condition',
          mode: 'structured',
          cases: [
            {
              thenStep: 'iThen',
              group: {
                id: 'g',
                logicalOperator: 'AND',
                conditions: [{ id: 'c', fieldId: 'contact:status', operator: 'is', value: 'OPEN' }],
              },
            },
          ],
          elseStep: 'iElse',
          next: null,
        },
        iThen: instruction('iThen', null),
        iElse: instruction('iElse', null),
      },
      codeBlocks: {},
      subProcedures: {},
      localAttributes: [],
    }
    const r = asInject(await prepareTurn(stackOf(frame('v1', 'cond')), makeDeps({ v1: compiled })))
    expect(r.activeStep.id).toBe('iThen')
  })
})

describe('prepareTurn — text condition', () => {
  it('spends ONE classify call and descends the chosen arm', async () => {
    const compiled = build('cond', [
      textCond(
        'cond',
        [
          { thenStep: 'iA', predicate: 'customer wants to cancel' },
          { thenStep: 'iB', predicate: 'customer wants a refund' },
        ],
        'iElse',
        null
      ),
      instruction('iA', null),
      instruction('iB', null),
      instruction('iElse', null),
    ])
    const pickTextBranch = vi.fn(async () => 1)
    const r = asInject(
      await prepareTurn(
        stackOf(frame('v1', 'cond')),
        makeDeps({ v1: compiled }, { pickTextBranch })
      )
    )
    expect(pickTextBranch).toHaveBeenCalledOnce()
    expect(pickTextBranch).toHaveBeenCalledWith([
      'customer wants to cancel',
      'customer wants a refund',
    ])
    expect(r.activeStep.id).toBe('iB')
  })

  it('falls through to ELSE when the classifier returns null', async () => {
    const compiled = build('cond', [
      textCond('cond', [{ thenStep: 'iA', predicate: 'x' }], 'iElse', null),
      instruction('iA', null),
      instruction('iElse', null),
    ])
    const r = asInject(
      await prepareTurn(
        stackOf(frame('v1', 'cond')),
        makeDeps({ v1: compiled }, { pickTextBranch: async () => null })
      )
    )
    expect(r.activeStep.id).toBe('iElse')
  })
})

describe('prepareTurn — routing & stack ops', () => {
  it('finished routing pops frame 0 → free-form', async () => {
    const compiled = build('end', [routing('end', 'finished')])
    const r = await prepareTurn(stackOf(frame('v1', 'end')), makeDeps({ v1: compiled }))
    expect(r.kind).toBe('free-form')
    expect(r.stack.frames).toHaveLength(0)
  })

  it('handoff routing clears the stack → free-form + flags handoff', async () => {
    const compiled = build('h', [routing('h', 'handoff')])
    const r = await prepareTurn(
      stackOf(frame('v1', 'a'), frame('v1', 'h')),
      makeDeps({ v1: compiled })
    )
    expect(r.kind).toBe('free-form')
    expect(r.stack.frames).toHaveLength(0)
    expect(r.kind === 'free-form' && r.handoff).toBe(true)
  })

  it('switch replaces the top frame with the target procedure’s pinned active version', async () => {
    const p1 = build('sw', [routing('sw', 'switch', { switchToProcedureId: 'p2' })])
    const p2 = build('p2entry', [instruction('p2entry', null, 'p2 first')])
    const loadActiveVersion = vi.fn(async () => ({ procedureVersionId: 'v2', compiled: p2 }))
    const r = asInject(
      await prepareTurn(
        stackOf(frame('v1', 'sw')),
        makeDeps({ v1: p1, v2: p2 }, { loadActiveVersion })
      )
    )
    expect(loadActiveVersion).toHaveBeenCalledWith('p2')
    expect(r.stack.frames).toHaveLength(1) // replaced, not pushed
    expect(r.stack.frames[0]).toMatchObject({
      procedureId: 'p2',
      procedureVersionId: 'v2',
      pushedBy: 'switch',
    })
    expect(r.activeStep.id).toBe('p2entry')
  })

  it('call pushes a same-version sub-procedure frame and parks the parent at routing.next', async () => {
    const compiled = build(
      'callStep',
      [
        routing('callStep', 'call', { subProcedureId: 'sub', next: 'afterCall' }),
        instruction('afterCall', null),
        instruction('subBody', null, 'sub body'),
      ],
      { sub: { id: 'sub', name: 'Sub', entryStepId: 'subBody' } }
    )
    const r = asInject(
      await prepareTurn(stackOf(frame('v1', 'callStep')), makeDeps({ v1: compiled }))
    )
    expect(r.stack.frames).toHaveLength(2)
    expect(r.stack.frames[0]!.cursor).toBe('afterCall') // parent parked at the return cursor
    expect(r.stack.frames[1]).toMatchObject({
      procedureVersionId: 'v1',
      pushedBy: 'call',
      cursor: 'subBody',
    })
    expect(r.activeStep.id).toBe('subBody')
  })
})

describe('prepareTurn — pop & re-anchor', () => {
  it('a digression pop re-injects the parent step WITH a breadcrumb', async () => {
    const compiled = build('parentInstr', [
      instruction('parentInstr', null, 'Your cancellation request is being processed.'),
      routing('childEnd', 'finished'),
    ])
    const stack = stackOf(
      frame('v1', 'parentInstr', 'selection'),
      frame('v1', 'childEnd', 'digression')
    )
    const r = asInject(await prepareTurn(stack, makeDeps({ v1: compiled })))
    expect(r.activeStep.id).toBe('parentInstr')
    expect(r.stack.frames).toHaveLength(1)
    expect(r.breadcrumb).toMatch(/^Back to /)
  })

  it('a call (sub-procedure) pop resumes the parent SILENTLY (no breadcrumb)', async () => {
    const compiled = build('parentInstr', [
      instruction('parentInstr', null, 'Parent step.'),
      routing('childEnd', 'finished'),
    ])
    const stack = stackOf(frame('v1', 'parentInstr', 'selection'), frame('v1', 'childEnd', 'call'))
    const r = asInject(await prepareTurn(stack, makeDeps({ v1: compiled })))
    expect(r.activeStep.id).toBe('parentInstr')
    expect(r.breadcrumb).toBeUndefined()
  })
})

describe('prepareTurn — depth cap & pin integrity', () => {
  it('a call AT the depth cap runs the sub-procedure inline (no push)', async () => {
    const compiled = build(
      'callStep',
      [
        routing('callStep', 'call', { subProcedureId: 'sub', next: 'afterCall' }),
        instruction('afterCall', null),
        instruction('subBody', null),
      ],
      { sub: { id: 'sub', name: 'Sub', entryStepId: 'subBody' } }
    )
    // Four frames = MAX_DEPTH; the top is at the call step.
    const stack = stackOf(
      frame('v1', 'afterCall'),
      frame('v1', 'afterCall'),
      frame('v1', 'afterCall'),
      frame('v1', 'callStep')
    )
    const r = asInject(await prepareTurn(stack, makeDeps({ v1: compiled })))
    expect(r.stack.frames).toHaveLength(4) // no push at the cap
    expect(r.activeStep.id).toBe('subBody') // ran inline in the current frame
  })

  it('a hard-deleted pinned version (readVersion → null) discards the frame and recovers the parent', async () => {
    const compiled = build('parentInstr', [instruction('parentInstr', null)])
    // parent on v1 (loadable), child on v9 (deleted → null).
    const stack = stackOf(frame('v1', 'parentInstr'), frame('v9', 'whatever', 'digression'))
    const r = asInject(await prepareTurn(stack, makeDeps({ v1: compiled })))
    expect(r.activeStep.id).toBe('parentInstr')
    expect(r.stack.frames).toHaveLength(1)
  })

  it('frame 0 with a deleted pin → free-form', async () => {
    const r = await prepareTurn(stackOf(frame('gone', 'x')), makeDeps({}))
    expect(r.kind).toBe('free-form')
    expect(r.stack.frames).toHaveLength(0)
  })
})

describe('interpretSignal', () => {
  const basic = () =>
    build('i0', [instruction('i0', 'i1', 'Cancel the order.'), instruction('i1', null)])
  const setSignal = (s: unknown) => {
    varStore[PROC_SIGNAL_KEY] = s
  }

  it('advance + goal met → cursor moves to next, reinvoke; signal key is deleted', async () => {
    setSignal({ kind: 'advance' })
    const r = await interpretSignal(
      stackOf(frame('v1', 'i0')),
      'Cancelled.',
      makeDeps({ v1: basic() })
    )
    expect(r).toMatchObject({ reinvoke: true, endTurn: false })
    expect(r.stack.frames[0]!.cursor).toBe('i1')
    expect(varStore[PROC_SIGNAL_KEY]).toBeUndefined()
  })

  it('advance + goal NOT met → stays on step, parks (await)', async () => {
    setSignal({ kind: 'advance' })
    const stack = stackOf(frame('v1', 'i0'))
    const r = await interpretSignal(
      stack,
      'What is your order number?',
      makeDeps({ v1: basic() }, { checkGoalMet: async () => false })
    )
    expect(r).toMatchObject({ reinvoke: false, endTurn: true })
    expect(r.stack.frames[0]!.cursor).toBe('i0') // unchanged
    expect(r.stack.frames[0]!.status).toBe('awaiting_customer')
  })

  it('await → parks', async () => {
    setSignal({ kind: 'await' })
    const r = await interpretSignal(stackOf(frame('v1', 'i0')), '…', makeDeps({ v1: basic() }))
    expect(r).toMatchObject({ reinvoke: false, endTurn: true })
    expect(r.stack.frames[0]!.status).toBe('awaiting_customer')
  })

  it('digress + match → push a digression frame, reinvoke (B opens this turn)', async () => {
    setSignal({ kind: 'digress', reason: 'wants a refund' })
    const selectOther = vi.fn(async () => ({
      procedureId: 'p2',
      procedureVersionId: 'v2',
      compiled: basic(),
    }))
    const r = await interpretSignal(
      stackOf(frame('v1', 'i0')),
      '',
      makeDeps({ v1: basic() }, { selectOther })
    )
    expect(selectOther).toHaveBeenCalledWith('p1')
    expect(r).toMatchObject({ reinvoke: true, endTurn: false })
    expect(r.stack.frames).toHaveLength(2)
    expect(r.stack.frames[1]).toMatchObject({ procedureId: 'p2', pushedBy: 'digression' })
  })

  it('digress + no match → persona-only inline, parent parked', async () => {
    setSignal({ kind: 'digress', reason: 'x' })
    const r = await interpretSignal(
      stackOf(frame('v1', 'i0')),
      '',
      makeDeps({ v1: basic() }, { selectOther: async () => null })
    )
    expect(r).toMatchObject({ inlineFallback: true, reinvoke: false })
    expect(r.stack.frames).toHaveLength(1)
  })

  it('digress AT the depth cap → inline fallback, no selection call', async () => {
    setSignal({ kind: 'digress', reason: 'x' })
    const selectOther = vi.fn(async () => null)
    const stack = stackOf(
      frame('v1', 'i0'),
      frame('v1', 'i0'),
      frame('v1', 'i0'),
      frame('v1', 'i0')
    )
    const r = await interpretSignal(stack, '', makeDeps({ v1: basic() }, { selectOther }))
    expect(r.inlineFallback).toBe(true)
    expect(selectOther).not.toHaveBeenCalled()
  })

  it('handoff → clears the stack + flags handoff for escalation', async () => {
    setSignal({ kind: 'handoff' })
    const r = await interpretSignal(
      stackOf(frame('v1', 'i0')),
      'Escalating.',
      makeDeps({ v1: basic() })
    )
    expect(r).toMatchObject({ reinvoke: false, endTurn: true, handoff: true })
    expect(r.stack.frames).toHaveLength(0)
  })

  it('end → pops one frame, reinvoke (parent resumes)', async () => {
    setSignal({ kind: 'end' })
    const stack = stackOf(frame('v1', 'i0'), frame('v1', 'i0', 'digression'))
    const r = await interpretSignal(stack, 'All done.', makeDeps({ v1: basic() }))
    expect(r).toMatchObject({ reinvoke: true, endTurn: false })
    expect(r.stack.frames).toHaveLength(1)
  })

  it('silent + on-procedure → parks (no auto-advance off a guess)', async () => {
    // no signal set → backstop fires; default classifyBackstop → onProcedure:true
    const stack = stackOf(frame('v1', 'i0'))
    const r = await interpretSignal(
      stack,
      'Continuing the cancellation…',
      makeDeps({ v1: basic() })
    )
    expect(r).toMatchObject({ reinvoke: false, endTurn: true })
    expect(r.stack.frames[0]!.cursor).toBe('i0')
    expect(r.stack.frames[0]!.status).toBe('awaiting_customer')
  })

  it('silent + off-procedure + multiTurn → push for NEXT turn (no goto 1)', async () => {
    const selectOther = vi.fn(async () => ({
      procedureId: 'p2',
      procedureVersionId: 'v2',
      compiled: basic(),
    }))
    const r = await interpretSignal(
      stackOf(frame('v1', 'i0')),
      'Sure, about returns…',
      makeDeps(
        { v1: basic() },
        { classifyBackstop: async () => ({ onProcedure: false, multiTurn: true }), selectOther }
      )
    )
    expect(r).toMatchObject({ reinvoke: false, endTurn: true }) // reply already shipped
    expect(r.stack.frames).toHaveLength(2)
    expect(r.stack.frames[1]).toMatchObject({ pushedBy: 'digression' })
  })

  it('silent + off-procedure + NOT multiTurn → persona-only stands, no push', async () => {
    const r = await interpretSignal(
      stackOf(frame('v1', 'i0')),
      'Quick aside.',
      makeDeps(
        { v1: basic() },
        { classifyBackstop: async () => ({ onProcedure: false, multiTurn: false }) }
      )
    )
    expect(r).toMatchObject({ reinvoke: false, endTurn: true })
    expect(r.stack.frames).toHaveLength(1)
  })
})

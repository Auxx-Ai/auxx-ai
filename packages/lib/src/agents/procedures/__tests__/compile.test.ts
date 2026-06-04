// packages/lib/src/agents/procedures/__tests__/compile.test.ts

import { describe, expect, it } from 'vitest'
import { compileProcedure } from '../compile'
import type { TiptapDoc, TiptapNode } from '../nodes'
import type { ProcedureStep } from '../types'

const prose = (text: string): TiptapNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

const doc = (content: TiptapNode[], localAttributes?: TiptapDoc['localAttributes']): TiptapDoc => ({
  type: 'doc',
  content,
  ...(localAttributes ? { localAttributes } : {}),
})

const conditionBlock = (
  cases: { caseId: string; body: TiptapNode[] }[],
  elseBody: TiptapNode[] | null
): TiptapNode => ({
  type: 'conditionBlock',
  content: [
    ...cases.map((c) => ({
      type: 'conditionCase',
      attrs: { group: { id: c.caseId, conditions: [], logicalOperator: 'AND', case_id: c.caseId } },
      content: c.body,
    })),
    ...(elseBody ? [{ type: 'conditionElse', content: elseBody }] : []),
  ],
})

describe('compileProcedure', () => {
  it('compiles an empty doc to a single trivial instruction step', () => {
    const { compiled, errors } = compileProcedure(doc([]))
    expect(errors).toBeUndefined()
    const ids = Object.keys(compiled.steps)
    expect(ids).toHaveLength(1)
    const entry = compiled.steps[compiled.entryStepId]!
    expect(entry.kind).toBe('instruction')
    expect(entry.next).toBeNull()
  })

  it('coalesces contiguous prose into one instruction step', () => {
    const { compiled } = compileProcedure(doc([prose('a'), prose('b'), prose('c')]))
    const instructions = Object.values(compiled.steps).filter((s) => s.kind === 'instruction')
    expect(instructions).toHaveLength(1)
  })

  it('threads a linear prose → tool → routing(finished) chain', () => {
    const { compiled } = compileProcedure(
      doc([
        prose('intro'),
        { type: 'toolStep', attrs: { toolName: 'lookup' } },
        { type: 'routingStep', attrs: { outcome: 'finished' } },
      ])
    )
    const entry = compiled.steps[compiled.entryStepId]!
    expect(entry.kind).toBe('instruction')
    const tool = compiled.steps[entry.next!]!
    expect(tool.kind).toBe('tool')
    const routing = compiled.steps[tool.next!] as Extract<ProcedureStep, { kind: 'routing' }>
    expect(routing.kind).toBe('routing')
    expect(routing.outcome).toBe('finished')
    expect(routing.next).toBeNull() // finished is terminal
  })

  it('routes nested-condition join targets to the outer continuation', () => {
    // IF a { IF b {} ELSE {} } ELSE {}  followed by a join prose step.
    const { compiled, errors } = compileProcedure(
      doc([
        conditionBlock(
          [{ caseId: 'outerA', body: [conditionBlock([{ caseId: 'innerB', body: [] }], [])] }],
          []
        ),
        prose('join'),
      ])
    )
    expect(errors).toBeUndefined()

    const join = Object.values(compiled.steps).find((s) => s.kind === 'instruction')!
    const outer = compiled.steps[compiled.entryStepId] as Extract<
      ProcedureStep,
      { kind: 'condition' }
    >
    expect(outer.kind).toBe('condition')
    expect(outer.next).toBe(join.id)
    expect(outer.elseStep).toBe(join.id)

    const inner = compiled.steps[outer.cases[0]!.thenStep!] as Extract<
      ProcedureStep,
      { kind: 'condition' }
    >
    expect(inner.kind).toBe('condition')
    // every inner branch + the inner join all flow to the OUTER continuation (the join)
    expect(inner.next).toBe(join.id)
    expect(inner.cases[0]!.thenStep).toBe(join.id)
    expect(inner.elseStep).toBe(join.id)
  })

  it('compiles a local sub-procedure and resolves a call to it', () => {
    const { compiled, errors } = compileProcedure(
      doc([
        { type: 'routingStep', attrs: { outcome: 'call', subProcedureId: 'sub1' } },
        prose('after the call'),
        {
          type: 'subProcedure',
          attrs: { subProcedureId: 'sub1', name: 'Greet' },
          content: [prose('inside sub'), { type: 'routingStep', attrs: { outcome: 'finished' } }],
        },
      ])
    )
    expect(errors).toBeUndefined()
    expect(compiled.subProcedures.sub1).toBeDefined()
    expect(compiled.subProcedures.sub1!.name).toBe('Greet')
    expect(compiled.steps[compiled.subProcedures.sub1!.entryStepId]).toBeDefined()

    const call = compiled.steps[compiled.entryStepId] as Extract<ProcedureStep, { kind: 'routing' }>
    expect(call.outcome).toBe('call')
    // a call keeps `next` as the return target (the prose after it)
    expect(call.next).not.toBeNull()
    expect(compiled.steps[call.next!]!.kind).toBe('instruction')
  })

  it('lifts declared localAttributes verbatim', () => {
    const { compiled } = compileProcedure(
      doc([prose('x')], [{ name: 'orderId', dataType: 'TEXT' }])
    )
    expect(compiled.localAttributes).toEqual([{ name: 'orderId', dataType: 'TEXT' }])
  })

  it('errors on a call to an unknown sub-procedure', () => {
    const { errors } = compileProcedure(
      doc([{ type: 'routingStep', attrs: { outcome: 'call', subProcedureId: 'nope' } }])
    )
    expect(errors?.some((e) => e.code === 'UNKNOWN_SUBPROCEDURE')).toBe(true)
  })

  it('errors on a declared sub-procedure that is never called', () => {
    const { errors } = compileProcedure(
      doc([
        prose('body'),
        {
          type: 'subProcedure',
          attrs: { subProcedureId: 'orphan', name: 'Orphan' },
          content: [prose('x')],
        },
      ])
    )
    expect(errors?.some((e) => e.code === 'UNCALLED_SUBPROCEDURE')).toBe(true)
  })

  it('errors on a switch step with no target', () => {
    const { errors } = compileProcedure(
      doc([{ type: 'routingStep', attrs: { outcome: 'switch' } }])
    )
    expect(errors?.some((e) => e.code === 'MISSING_SWITCH_TARGET')).toBe(true)
  })

  it('errors on a tool assignTo that names no declared attribute', () => {
    const { errors } = compileProcedure(
      doc([{ type: 'toolStep', attrs: { toolName: 't', assignTo: 'ghost' } }])
    )
    expect(errors?.some((e) => e.code === 'UNKNOWN_ATTRIBUTE')).toBe(true)
  })

  it('accepts a tool assignTo that names a declared attribute', () => {
    const { errors } = compileProcedure(
      doc(
        [{ type: 'toolStep', attrs: { toolName: 't', assignTo: 'orderId' } }],
        [{ name: 'orderId', dataType: 'TEXT' }]
      )
    )
    expect(errors?.some((e) => e.code === 'UNKNOWN_ATTRIBUTE')).toBeFalsy()
  })

  it('detects a sub-procedure call cycle', () => {
    const subWithCall = (id: string, callsId: string): TiptapNode => ({
      type: 'subProcedure',
      attrs: { subProcedureId: id, name: id },
      content: [{ type: 'routingStep', attrs: { outcome: 'call', subProcedureId: callsId } }],
    })
    const { errors } = compileProcedure(
      doc([
        { type: 'routingStep', attrs: { outcome: 'call', subProcedureId: 'subA' } },
        subWithCall('subA', 'subB'),
        subWithCall('subB', 'subA'), // cycle: A → B → A
      ])
    )
    expect(errors?.some((e) => e.code === 'CYCLE')).toBe(true)
  })

  it('produces a stable contentHash for identical docs', () => {
    const a = compileProcedure(doc([prose('same')]))
    const b = compileProcedure(doc([prose('same')]))
    expect(a.contentHash).toBe(b.contentHash)
    const c = compileProcedure(doc([prose('different')]))
    expect(c.contentHash).not.toBe(a.contentHash)
  })
})

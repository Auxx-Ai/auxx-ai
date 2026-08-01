// packages/lib/src/agents/procedures/__tests__/compile.test.ts

import { describe, expect, it } from 'vitest'
import { compileProcedure } from '../compile'
import {
  type CodeBlockMapEntry,
  type SubProcedureMapEntry,
  stableStringify,
  type TiptapDoc,
  type TiptapNode,
} from '../nodes'
import type { ProcedureStep } from '../types'

const prose = (text: string): TiptapNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

/** An inline step badge (`reference` node) inside a paragraph. */
const badge = (id: string): TiptapNode => ({
  type: 'paragraph',
  content: [{ type: 'reference', attrs: { id } }],
})

const doc = (
  content: TiptapNode[],
  extra?: Partial<Pick<TiptapDoc, 'localAttributes' | 'subProcedures' | 'codeBlocks'>>
): TiptapDoc => ({ type: 'doc', content, ...extra })

/** A v2 structured-mode condition block. */
const structuredCondition = (
  cases: { caseId: string; body: TiptapNode[] }[],
  elseBody: TiptapNode[] | null
): TiptapNode => ({
  type: 'conditionBlock',
  attrs: { mode: 'structured' },
  content: [
    ...cases.map((c) => ({
      type: 'conditionCase',
      attrs: {
        group: {
          id: c.caseId,
          conditions: [{ fieldId: 'order.total', operator: '>', value: 0 }],
          logicalOperator: 'AND',
          case_id: c.caseId,
        },
      },
      content: [{ type: 'conditionPredicate', content: [] }, ...c.body],
    })),
    ...(elseBody ? [{ type: 'conditionElse', content: elseBody }] : []),
  ],
})

const sub = (id: string, name: string, content: TiptapNode[]): SubProcedureMapEntry => ({
  id,
  name,
  content,
})

const code = (
  id: string,
  name: string,
  bindings?: {
    outputs?: { name: string; surfaceToModel: boolean }[]
  }
): CodeBlockMapEntry => ({
  id,
  name,
  language: 'javascript',
  code: 'return 1',
  ...(bindings?.outputs ? { outputs: bindings.outputs } : {}),
})

type Condition = Extract<ProcedureStep, { kind: 'condition' }>
type Routing = Extract<ProcedureStep, { kind: 'routing' }>

describe('compileProcedure', () => {
  it('compiles an empty doc to a single trivial instruction step', () => {
    const { compiled, errors } = compileProcedure(doc([]))
    expect(errors).toBeUndefined()
    expect(Object.keys(compiled.steps)).toHaveLength(1)
    const entry = compiled.steps[compiled.entryStepId]!
    expect(entry.kind).toBe('instruction')
    expect(entry.next).toBeNull()
  })

  it('coalesces contiguous prose into one instruction step', () => {
    const { compiled } = compileProcedure(doc([prose('a'), prose('b'), prose('c')]))
    const instructions = Object.values(compiled.steps).filter((s) => s.kind === 'instruction')
    expect(instructions).toHaveLength(1)
  })

  it('keeps an inline tool badge in prose but splits a code badge into its own step', () => {
    const { compiled, errors } = compileProcedure(
      doc(
        [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'look it up ' },
              { type: 'reference', attrs: { id: 'tool:order_lookup' } },
              { type: 'text', text: ' then ' },
              { type: 'reference', attrs: { id: 'code:c1' } },
            ],
          },
        ],
        { codeBlocks: [code('c1', 'Compute')] }
      )
    )
    expect(errors).toBeUndefined()
    // tool stays inline (one instruction), code splits out into a deterministic code step.
    const instructions = Object.values(compiled.steps).filter((s) => s.kind === 'instruction')
    expect(instructions).toHaveLength(1)
    const codeSteps = Object.values(compiled.steps).filter((s) => s.kind === 'code')
    expect(codeSteps).toHaveLength(1)
    expect((codeSteps[0] as Extract<ProcedureStep, { kind: 'code' }>).codeBlockId).toBe('c1')
  })

  it('splits the prose chain on an own-step route badge (terminal)', () => {
    const { compiled } = compileProcedure(
      doc([prose('intro'), badge('route:finished'), prose('unreachable after end')])
    )
    const entry = compiled.steps[compiled.entryStepId]!
    expect(entry.kind).toBe('instruction')
    const routing = compiled.steps[entry.next!] as Routing
    expect(routing.kind).toBe('routing')
    expect(routing.outcome).toBe('finished')
    expect(routing.next).toBeNull() // terminal — chain stops here
  })

  it('splits a paragraph that mixes prose and an own-step badge', () => {
    const { compiled, errors } = compileProcedure(
      doc(
        [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'do greeting then ' },
              { type: 'reference', attrs: { id: 'subprocedure:greet' } },
              { type: 'text', text: ' and wrap up' },
            ],
          },
        ],
        { subProcedures: [sub('greet', 'Greet', [prose('hello')])] }
      )
    )
    expect(errors).toBeUndefined()
    const entry = compiled.steps[compiled.entryStepId] as Extract<
      ProcedureStep,
      { kind: 'instruction' }
    >
    expect(entry.kind).toBe('instruction')
    const call = compiled.steps[entry.next!] as Routing
    expect(call.kind).toBe('routing')
    expect(call.outcome).toBe('call')
    expect(call.subProcedureId).toBe('greet')
    // the call returns to a fresh instruction for the prose after the badge.
    expect(compiled.steps[call.next!]!.kind).toBe('instruction')
  })

  it('compiles a switch route badge with the target procedure id', () => {
    const { compiled, errors } = compileProcedure(doc([badge('route:switch:proc-9')]))
    expect(errors).toBeUndefined()
    const routing = compiled.steps[compiled.entryStepId] as Routing
    expect(routing.outcome).toBe('switch')
    expect(routing.switchToProcedureId).toBe('proc-9')
    expect(routing.next).toBeNull()
  })

  it('compiles a structured-mode condition with cases + else', () => {
    const { compiled, errors } = compileProcedure(
      doc([
        structuredCondition(
          [
            {
              caseId: 'a',
              body: [{ type: 'block', attrs: { blockType: 'text' }, content: [prose('arm a')] }],
            },
          ],
          [{ type: 'block', attrs: { blockType: 'text' }, content: [prose('fallback')] }]
        ),
        prose('join'),
      ])
    )
    expect(errors).toBeUndefined()
    const cond = compiled.steps[compiled.entryStepId] as Condition
    expect(cond.kind).toBe('condition')
    expect(cond.mode).toBe('structured')
    expect(cond.cases).toHaveLength(1)
    expect(cond.cases[0]!.group).toBeDefined()
    expect(cond.cases[0]!.predicate).toBeUndefined()
    // the arm body and the else body are real steps; both rejoin at `cond.next`.
    const arm = compiled.steps[cond.cases[0]!.thenStep!]!
    const fallback = compiled.steps[cond.elseStep!]!
    expect(arm.kind).toBe('instruction')
    expect(fallback.kind).toBe('instruction')
    expect(arm.next).toBe(cond.next)
    expect(fallback.next).toBe(cond.next)
    expect(compiled.steps[cond.next!]!.kind).toBe('instruction') // the join prose
  })

  it('compiles a text-mode condition predicate into a string', () => {
    const textCondition: TiptapNode = {
      type: 'conditionBlock',
      attrs: { mode: 'text' },
      content: [
        {
          type: 'conditionCase',
          attrs: {},
          content: [
            {
              type: 'conditionPredicate',
              content: [{ type: 'text', text: 'the customer sounds upset' }],
            },
            { type: 'block', attrs: { blockType: 'text' }, content: [prose('apologize')] },
          ],
        },
      ],
    }
    const { compiled, errors } = compileProcedure(doc([textCondition]))
    expect(errors).toBeUndefined()
    const cond = compiled.steps[compiled.entryStepId] as Condition
    expect(cond.mode).toBe('text')
    expect(cond.cases[0]!.predicate).toBe('the customer sounds upset')
    expect(cond.cases[0]!.group).toBeUndefined()
  })

  it('routes nested-condition join targets to the outer continuation', () => {
    const { compiled, errors } = compileProcedure(
      doc([
        structuredCondition(
          [{ caseId: 'outerA', body: [structuredCondition([{ caseId: 'innerB', body: [] }], [])] }],
          []
        ),
        prose('join'),
      ])
    )
    expect(errors).toBeUndefined()
    const join = Object.values(compiled.steps).find((s) => s.kind === 'instruction')!
    const outer = compiled.steps[compiled.entryStepId] as Condition
    expect(outer.next).toBe(join.id)
    expect(outer.elseStep).toBe(join.id)
    const inner = compiled.steps[outer.cases[0]!.thenStep!] as Condition
    expect(inner.kind).toBe('condition')
    expect(inner.next).toBe(join.id)
    expect(inner.cases[0]!.thenStep).toBe(join.id)
    expect(inner.elseStep).toBe(join.id)
  })

  it('compiles a doc-level sub-procedure and resolves a call to it', () => {
    const { compiled, errors } = compileProcedure(
      doc([badge('subprocedure:sub1'), prose('after the call')], {
        subProcedures: [sub('sub1', 'Greet', [prose('inside sub'), badge('route:finished')])],
      })
    )
    expect(errors).toBeUndefined()
    expect(compiled.subProcedures.sub1).toBeDefined()
    expect(compiled.subProcedures.sub1!.name).toBe('Greet')
    expect(compiled.steps[compiled.subProcedures.sub1!.entryStepId]).toBeDefined()

    const call = compiled.steps[compiled.entryStepId] as Routing
    expect(call.outcome).toBe('call')
    expect(call.next).not.toBeNull()
    expect(compiled.steps[call.next!]!.kind).toBe('instruction')
  })

  it('lifts doc-level code blocks into compiled.codeBlocks', () => {
    const { compiled, errors } = compileProcedure(
      doc([badge('code:c1')], { codeBlocks: [code('c1', 'Compute')] })
    )
    expect(errors).toBeUndefined()
    expect(compiled.codeBlocks.c1).toBeDefined()
    expect(compiled.codeBlocks.c1!.code).toBe('return 1')
  })

  it('lifts declared localAttributes verbatim', () => {
    const { compiled } = compileProcedure(
      doc([prose('x')], { localAttributes: [{ name: 'orderId', dataType: 'TEXT' }] })
    )
    expect(compiled.localAttributes).toEqual([{ name: 'orderId', dataType: 'TEXT' }])
  })

  it('errors on a call to an unknown sub-procedure', () => {
    const { errors } = compileProcedure(doc([badge('subprocedure:nope')]))
    expect(errors?.some((e) => e.code === 'UNKNOWN_SUBPROCEDURE')).toBe(true)
  })

  it('warns (does NOT block publish) on a declared sub-procedure that is never called', () => {
    const { errors, warnings, compiled } = compileProcedure(
      doc([prose('body')], { subProcedures: [sub('orphan', 'Orphan', [prose('x')])] })
    )
    // Unreferenced building blocks are kept on purpose — a warning, not an
    // error. `UNCALLED_SUBPROCEDURE` is not a member of `CompileError['code']`,
    // so probing `errors` for it is a tautology the compiler now rejects;
    // asserting NO error at all is the stronger form of "does not block publish".
    expect(errors).toBeUndefined()
    expect(warnings?.some((w) => w.code === 'UNCALLED_SUBPROCEDURE')).toBe(true)
    // …and the sub-procedure is still compiled into the published output.
    expect(compiled.subProcedures.orphan).toBeDefined()
  })

  it('errors on a code step with no matching code block', () => {
    const { errors } = compileProcedure(doc([badge('code:ghost')]))
    expect(errors?.some((e) => e.code === 'UNKNOWN_CODE_BLOCK')).toBe(true)
  })

  it('compiles a code badge to a code step threading next with outputs from the code-block entry', () => {
    const { compiled, errors } = compileProcedure(
      doc([badge('code:c1'), prose('after')], {
        codeBlocks: [
          code('c1', 'Compute', {
            outputs: [{ name: 'tier', surfaceToModel: true }],
          }),
        ],
        localAttributes: [{ name: 'tier', dataType: 'TEXT' }],
      })
    )
    expect(errors).toBeUndefined()
    const step = compiled.steps[compiled.entryStepId] as Extract<ProcedureStep, { kind: 'code' }>
    expect(step.kind).toBe('code')
    expect(step.codeBlockId).toBe('c1')
    expect(step.outputs).toEqual([{ name: 'tier', surfaceToModel: true }])
    // deterministic — threads to the following instruction.
    expect(compiled.steps[step.next!]!.kind).toBe('instruction')
  })

  it('errors on a code output that is not a declared local attribute', () => {
    const { errors } = compileProcedure(
      doc([badge('code:c1')], {
        codeBlocks: [
          code('c1', 'Compute', { outputs: [{ name: 'ghostAttr', surfaceToModel: false }] }),
        ],
      })
    )
    expect(errors?.some((e) => e.code === 'UNKNOWN_OUTPUT_ATTRIBUTE')).toBe(true)
  })

  it('errors on a structured arm with no conditions', () => {
    const emptyGroupCondition: TiptapNode = {
      type: 'conditionBlock',
      attrs: { mode: 'structured' },
      content: [
        {
          type: 'conditionCase',
          attrs: { group: { id: 'empty', conditions: [], logicalOperator: 'AND' } },
          content: [
            { type: 'conditionPredicate', content: [] },
            { type: 'block', attrs: { blockType: 'text' }, content: [prose('x')] },
          ],
        },
      ],
    }
    const { errors } = compileProcedure(doc([emptyGroupCondition]))
    expect(errors?.some((e) => e.code === 'EMPTY_CONDITION_GROUP')).toBe(true)
  })

  it('errors on a text arm with an empty predicate', () => {
    const textCondition: TiptapNode = {
      type: 'conditionBlock',
      attrs: { mode: 'text' },
      content: [
        {
          type: 'conditionCase',
          attrs: {},
          content: [
            { type: 'conditionPredicate', content: [] },
            { type: 'block', attrs: { blockType: 'text' }, content: [prose('x')] },
          ],
        },
      ],
    }
    const { errors } = compileProcedure(doc([textCondition]))
    expect(errors?.some((e) => e.code === 'EMPTY_PREDICATE')).toBe(true)
  })

  it('detects a sub-procedure call cycle across the doc-level map', () => {
    const { errors } = compileProcedure(
      doc([badge('subprocedure:subA')], {
        subProcedures: [
          sub('subA', 'A', [badge('subprocedure:subB')]),
          sub('subB', 'B', [badge('subprocedure:subA')]), // A → B → A
        ],
      })
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

  // jsonb reorders object keys on the DB round-trip, so the contentHash must be
  // key-order-independent or the tools' compare-and-set false-staleses every edit.
  it('produces the same contentHash regardless of object key order (jsonb round-trip)', () => {
    const inMem = {
      type: 'doc',
      content: [prose('hi')],
      localAttributes: [],
      codeBlocks: [],
      subProcedures: [],
    } as unknown as TiptapDoc
    const reordered = {
      subProcedures: [],
      codeBlocks: [],
      content: [prose('hi')],
      localAttributes: [],
      type: 'doc',
    } as unknown as TiptapDoc
    expect(compileProcedure(inMem).contentHash).toBe(compileProcedure(reordered).contentHash)
  })
})

describe('stableStringify', () => {
  it('is independent of object key order at every depth', () => {
    const a = { type: 'doc', attrs: { id: '1', mode: 'text' }, content: [{ a: 1, b: 2 }] }
    const b = { content: [{ b: 2, a: 1 }], attrs: { mode: 'text', id: '1' }, type: 'doc' }
    expect(stableStringify(a)).toBe(stableStringify(b))
  })

  it('preserves array order and distinguishes different values', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]))
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }))
  })

  it('drops undefined object values like JSON.stringify', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }))
  })
})

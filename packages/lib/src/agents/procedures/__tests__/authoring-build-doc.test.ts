// packages/lib/src/agents/procedures/__tests__/authoring-build-doc.test.ts

import { describe, expect, it } from 'vitest'
import { buildProcedureDoc, ProcedureBuildError } from '../authoring/build-doc'
import { docToDsl } from '../authoring/doc-to-dsl'
import type { ProcedureDsl } from '../authoring/dsl'
import { compileProcedure } from '../compile'
import type { CodeBlockMapEntry, TiptapDoc, TiptapNode } from '../nodes'
import type { ProcedureStep } from '../types'

const t = (text: string): TiptapNode => ({ type: 'text', text })
const ref = (id: string): TiptapNode => ({ type: 'reference', attrs: { id } })
/** A KB text block — the prose container the real procedure editor emits. */
const pb = (...inline: TiptapNode[]): TiptapNode => ({
  type: 'block',
  attrs: { blockType: 'text' },
  content: inline,
})

const emptyDraft: TiptapDoc = { type: 'doc', content: [], codeBlocks: [], localAttributes: [] }

const stepsOfKind = (doc: TiptapDoc, kind: ProcedureStep['kind']) =>
  Object.values(compileProcedure(doc).compiled.steps).filter((s) => s.kind === kind)

describe('buildProcedureDoc — DSL lowering', () => {
  it('lowers an instruction to prose that compiles to one instruction step', () => {
    const dsl: ProcedureDsl = {
      steps: [{ id: 's1', kind: 'instruction', text: 'Greet the customer warmly.' }],
    }
    const doc = buildProcedureDoc(dsl, emptyDraft)
    const { errors } = compileProcedure(doc)
    expect(errors).toBeUndefined()
    expect(stepsOfKind(doc, 'instruction')).toHaveLength(1)
  })

  it('lowers route/handoff/switch to terminal routing steps', () => {
    const dsl: ProcedureDsl = {
      steps: [
        { id: 'a', kind: 'instruction', text: 'do a' },
        { id: 'b', kind: 'route', outcome: 'handoff' },
      ],
    }
    const doc = buildProcedureDoc(dsl, emptyDraft)
    const routing = stepsOfKind(doc, 'routing')
    expect(routing).toHaveLength(1)
    expect((routing[0] as Extract<ProcedureStep, { kind: 'routing' }>).outcome).toBe('handoff')
  })

  it('lowers a switch route carrying the target procedure id', () => {
    const dsl: ProcedureDsl = {
      steps: [{ id: 'a', kind: 'route', outcome: 'switch', switchToProcedureId: 'proc-42' }],
    }
    const { compiled, errors } = compileProcedure(buildProcedureDoc(dsl, emptyDraft))
    expect(errors).toBeUndefined()
    const routing = compiled.steps[compiled.entryStepId] as Extract<
      ProcedureStep,
      { kind: 'routing' }
    >
    expect(routing.outcome).toBe('switch')
    expect(routing.switchToProcedureId).toBe('proc-42')
  })

  it('lowers a text-mode condition with a predicate the compiler reads back', () => {
    const dsl: ProcedureDsl = {
      steps: [
        {
          id: 'c',
          kind: 'condition',
          cases: [{ id: 'k1', when: 'the order has shipped', steps: [] }],
          else: [{ id: 'e1', kind: 'instruction', text: 'cancel and refund' }],
        },
      ],
    }
    const { compiled, errors } = compileProcedure(buildProcedureDoc(dsl, emptyDraft))
    expect(errors).toBeUndefined()
    const cond = compiled.steps[compiled.entryStepId] as Extract<
      ProcedureStep,
      { kind: 'condition' }
    >
    expect(cond.kind).toBe('condition')
    expect(cond.mode).toBe('text')
    expect(cond.cases[0]!.predicate).toBe('the order has shipped')
    expect(cond.elseStep).not.toBeNull()
  })

  it('lowers a call + declared sub-procedure that compiles cleanly', () => {
    const dsl: ProcedureDsl = {
      steps: [{ id: 'call1', kind: 'call', subProcedureId: 'verify' }],
      subProcedures: [
        {
          id: 'verify',
          name: 'Verify identity',
          steps: [{ id: 'v1', kind: 'instruction', text: 'ask for order number' }],
        },
      ],
    }
    const { compiled, errors } = compileProcedure(buildProcedureDoc(dsl, emptyDraft))
    expect(errors).toBeUndefined()
    expect(compiled.subProcedures.verify).toBeDefined()
    expect(compiled.subProcedures.verify!.name).toBe('Verify identity')
    const call = compiled.steps[compiled.entryStepId] as Extract<ProcedureStep, { kind: 'routing' }>
    expect(call.outcome).toBe('call')
    expect(call.subProcedureId).toBe('verify')
  })

  it('surfaces UNKNOWN_SUBPROCEDURE when a call targets an undeclared sub-procedure', () => {
    // Bypasses validateProcedureDsl on purpose — the compiler is the backstop.
    const dsl = {
      steps: [{ id: 'call1', kind: 'call', subProcedureId: 'ghost' }],
    } as ProcedureDsl
    const { errors } = compileProcedure(buildProcedureDoc(dsl, emptyDraft))
    expect(errors?.some((e) => e.code === 'UNKNOWN_SUBPROCEDURE')).toBe(true)
  })
})

describe('buildProcedureDoc — opaque carry-through', () => {
  const codeBlocks: CodeBlockMapEntry[] = [
    {
      id: 'c1',
      name: 'Risk score',
      language: 'javascript',
      code: 'return riskScore(inputs)',
      outputs: [{ name: 'score', surfaceToModel: true }],
    },
  ]
  // A draft authored in the editor: prose, then a code badge, then prose.
  const draft: TiptapDoc = {
    type: 'doc',
    content: [pb(t('look up the order')), pb(ref('code:c1')), pb(t('explain the result'))],
    codeBlocks,
    localAttributes: [{ name: 'score', dataType: 'NUMBER' }],
  }

  it('re-hydrates an opaque code step verbatim and copies server-owned maps from the draft', () => {
    const dsl = docToDsl(draft)
    // The model keeps the opaque step exactly and edits only surrounding prose.
    expect(dsl.steps.some((s) => s.kind === 'opaque')).toBe(true)
    const built = buildProcedureDoc(dsl, draft)

    // codeBlocks + localAttributes come from the draft, never from the DSL.
    expect(built.codeBlocks).toEqual(codeBlocks)
    expect(built.localAttributes).toEqual([{ name: 'score', dataType: 'NUMBER' }])

    const { compiled, errors } = compileProcedure(built)
    expect(errors).toBeUndefined()
    expect(compiled.codeBlocks.c1!.code).toBe('return riskScore(inputs)')
    const codeStep = Object.values(compiled.steps).find((s) => s.kind === 'code') as Extract<
      ProcedureStep,
      { kind: 'code' }
    >
    expect(codeStep.codeBlockId).toBe('c1')
    expect(codeStep.outputs).toEqual([{ name: 'score', surfaceToModel: true }])
  })

  it('rejects an unknown opaque occurrence key', () => {
    const dsl: ProcedureDsl = {
      steps: [{ id: 'opaque:body:#9', kind: 'opaque', label: 'code block: ghost' }],
    }
    expect(() => buildProcedureDoc(dsl, draft)).toThrow(ProcedureBuildError)
  })

  it('rejects re-using one opaque occurrence key twice', () => {
    const dsl = docToDsl(draft)
    const opaque = dsl.steps.find((s) => s.kind === 'opaque')!
    const dup: ProcedureDsl = { steps: [opaque, { ...opaque }] }
    expect(() => buildProcedureDoc(dup, draft)).toThrow(/more than once/)
  })

  it('treats repeated uses of the same code block as distinct occurrences', () => {
    const repeated: TiptapDoc = {
      type: 'doc',
      content: [pb(ref('code:c1')), pb(t('between')), pb(ref('code:c1'))],
      codeBlocks,
      localAttributes: [{ name: 'score', dataType: 'NUMBER' }],
    }
    const dsl = docToDsl(repeated)
    const opaqueIds = dsl.steps.filter((s) => s.kind === 'opaque').map((s) => s.id)
    expect(opaqueIds).toHaveLength(2)
    expect(new Set(opaqueIds).size).toBe(2) // distinct keys
    const { compiled, errors } = compileProcedure(buildProcedureDoc(dsl, repeated))
    expect(errors).toBeUndefined()
    expect(Object.values(compiled.steps).filter((s) => s.kind === 'code')).toHaveLength(2)
  })
})

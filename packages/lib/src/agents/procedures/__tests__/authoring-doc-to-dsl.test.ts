// packages/lib/src/agents/procedures/__tests__/authoring-doc-to-dsl.test.ts

import { describe, expect, it } from 'vitest'
import { docToText } from '../../../tiptap'
import { buildProcedureDoc } from '../authoring/build-doc'
import { docToDsl } from '../authoring/doc-to-dsl'
import { compileProcedure } from '../compile'
import type { CodeBlockMapEntry, TiptapDoc, TiptapNode } from '../nodes'
import type { CompiledProcedure, StepId } from '../types'

// ── fixture builders (realistic editor shapes) ───────────────────────────────

const t = (text: string): TiptapNode => ({ type: 'text', text })
const ref = (id: string): TiptapNode => ({ type: 'reference', attrs: { id } })
const pb = (...inline: TiptapNode[]): TiptapNode => ({
  type: 'block',
  attrs: { blockType: 'text' },
  content: inline,
})
const textCondition = (
  cases: { when: string; body: TiptapNode[] }[],
  elseBody?: TiptapNode[]
): TiptapNode => ({
  type: 'conditionBlock',
  attrs: { id: 'cb', mode: 'text' },
  content: [
    ...cases.map((c) => ({
      type: 'conditionCase',
      attrs: { id: `cc-${c.when.slice(0, 4)}` },
      content: [
        { type: 'conditionPredicate', attrs: { mode: 'text' }, content: [t(c.when)] },
        ...c.body,
      ],
    })),
    ...(elseBody ? [{ type: 'conditionElse', content: elseBody }] : []),
  ],
})
const structuredCondition = (caseId: string, body: TiptapNode[]): TiptapNode => ({
  type: 'conditionBlock',
  attrs: { id: 'sb', mode: 'structured' },
  content: [
    {
      type: 'conditionCase',
      attrs: {
        group: {
          id: caseId,
          conditions: [{ fieldId: 'order.total', operator: '>', value: 500 }],
          logicalOperator: 'AND',
          case_id: caseId,
        },
      },
      content: [{ type: 'conditionPredicate', content: [] }, ...body],
    },
  ],
})

// ── structural canonicalizer (StepId-independent) ────────────────────────────

/**
 * Serialize a compiled procedure into a canonical, StepId-independent shape:
 * DFS from each entry replacing ids with visit-order indices (back-references
 * collapse to `{ ref }`). Instruction prose is normalized to `docToText` so the
 * markdown round-trip (which re-mints block ids and re-escapes text) compares as
 * the same prose. Opaque-carried payloads (code source, structured groups) are
 * byte-compared via the compiled output.
 */
function canonicalize(compiled: CompiledProcedure): unknown {
  const idToIndex = new Map<StepId, number>()
  let counter = 0
  const visit = (id: StepId | null): unknown => {
    if (id === null) return null
    const seen = idToIndex.get(id)
    if (seen !== undefined) return { ref: seen }
    const index = counter++
    idToIndex.set(id, index)
    const step = compiled.steps[id]
    if (!step) return { missing: true }
    const base: Record<string, unknown> = { i: index, kind: step.kind }
    if (step.kind === 'instruction') {
      base.text = docToText(step.doc)
    } else if (step.kind === 'code') {
      base.codeBlockId = step.codeBlockId
      base.outputs = step.outputs
    } else if (step.kind === 'condition') {
      base.mode = step.mode
      base.cases = step.cases.map((c) => ({
        predicate: c.predicate ?? null,
        group: c.group ?? null,
        thenBranch: visit(c.thenStep),
      }))
      base.else = visit(step.elseStep)
    } else if (step.kind === 'routing') {
      base.outcome = step.outcome
      if (step.subProcedureId) base.subProcedureId = step.subProcedureId
      if (step.switchToProcedureId) base.switchToProcedureId = step.switchToProcedureId
    }
    base.next = visit(step.next)
    return base
  }
  const body = visit(compiled.entryStepId)
  const subs = Object.values(compiled.subProcedures)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, name: s.name, entry: visit(s.entryStepId) }))
  return { body, subs, codeBlocks: compiled.codeBlocks, localAttributes: compiled.localAttributes }
}

/** The load-bearing round-trip assertion: read → DSL → rebuild → compile is structurally identical. */
function assertRoundTrip(doc: TiptapDoc): void {
  const original = compileProcedure(doc).compiled
  const rebuilt = compileProcedure(buildProcedureDoc(docToDsl(doc), doc)).compiled
  expect(canonicalize(rebuilt)).toEqual(canonicalize(original))
}

// ── tests ────────────────────────────────────────────────────────────────────

const codeBlocks: CodeBlockMapEntry[] = [
  {
    id: 'c1',
    name: 'Risk',
    language: 'javascript',
    code: 'return risk(inputs)',
    outputs: [{ name: 'tier', surfaceToModel: true }],
  },
]
const localAttributes = [{ name: 'tier', dataType: 'TEXT' as const }]

describe('docToDsl ↔ buildProcedureDoc round-trip (compile-equivalent)', () => {
  it('round-trips plain prose', () => {
    assertRoundTrip({ type: 'doc', content: [pb(t('Greet the customer.')), pb(t('Be concise.'))] })
  })

  it('round-trips prose with an inline tool chip', () => {
    assertRoundTrip({
      type: 'doc',
      content: [pb(t('look it up with '), ref('tool:order_lookup'), t(' then reply'))],
    })
  })

  it('round-trips a text-mode condition with else and nested prose', () => {
    assertRoundTrip({
      type: 'doc',
      content: [
        textCondition(
          [{ when: 'the order has shipped', body: [pb(t('offer a return label'))] }],
          [pb(t('cancel and refund'))]
        ),
        pb(t('wrap up')),
      ],
    })
  })

  it('round-trips nested conditions', () => {
    assertRoundTrip({
      type: 'doc',
      content: [
        textCondition([
          {
            when: 'over $500',
            body: [textCondition([{ when: 'VIP', body: [pb(t('escalate'))] }])],
          },
        ]),
        pb(t('join')),
      ],
    })
  })

  it('round-trips a route:switch badge', () => {
    assertRoundTrip({
      type: 'doc',
      content: [pb(t('hand to billing')), pb(ref('route:switch:proc-9'))],
    })
  })

  it('round-trips a sub-procedure call AND an uncalled sub-procedure', () => {
    assertRoundTrip({
      type: 'doc',
      content: [pb(ref('subprocedure:greet')), pb(t('after greeting'))],
      subProcedures: [
        { id: 'greet', name: 'Greet', content: [pb(t('hello')), pb(ref('route:finished'))] },
        { id: 'orphan', name: 'Orphan', content: [pb(t('never called'))] },
      ],
    })
  })

  it('round-trips repeated code-badge occurrences with ZERO data loss', () => {
    assertRoundTrip({
      type: 'doc',
      content: [pb(ref('code:c1')), pb(t('between')), pb(ref('code:c1'))],
      codeBlocks,
      localAttributes,
    })
  })

  it('round-trips a doc containing BOTH a code block and a structured condition (no loss)', () => {
    assertRoundTrip({
      type: 'doc',
      content: [
        pb(t('intro')),
        pb(ref('code:c1')),
        structuredCondition('big', [pb(t('escalate for review'))]),
        pb(t('finish')),
      ],
      codeBlocks,
      localAttributes,
    })
  })

  it('round-trips code/structured opaque nodes living inside a sub-procedure', () => {
    assertRoundTrip({
      type: 'doc',
      content: [pb(ref('subprocedure:assess'))],
      subProcedures: [
        {
          id: 'assess',
          name: 'Assess',
          content: [pb(ref('code:c1')), structuredCondition('big', [pb(t('flag'))])],
        },
      ],
      codeBlocks,
      localAttributes,
    })
  })
})

describe('docToDsl never leaks server-owned payloads', () => {
  it('omits code source, output bindings, local attributes, and structured groups', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [pb(ref('code:c1')), structuredCondition('big', [pb(t('x'))])],
      codeBlocks,
      localAttributes,
    }
    const json = JSON.stringify(docToDsl(doc))
    expect(json).not.toContain('return risk(inputs)') // code source
    expect(json).not.toContain('surfaceToModel') // output bindings
    expect(json).not.toContain('order.total') // structured ConditionGroup field
    expect(json).not.toContain('localAttributes')
    // The opaque steps carry only a human label + occurrence key.
    const opaque = docToDsl(doc).steps.filter((s) => s.kind === 'opaque')
    expect(opaque).toHaveLength(2)
    expect(opaque[0]).toEqual({ id: 'opaque:body:#0', kind: 'opaque', label: 'code block: Risk' })
    expect(opaque[1]).toEqual({
      id: 'opaque:body:#1',
      kind: 'opaque',
      label: 'rules-based condition',
    })
  })
})

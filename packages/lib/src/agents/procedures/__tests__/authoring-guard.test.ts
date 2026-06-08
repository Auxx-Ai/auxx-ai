// packages/lib/src/agents/procedures/__tests__/authoring-guard.test.ts

import { describe, expect, it } from 'vitest'
import { docToDsl } from '../authoring/doc-to-dsl'
import type { ProcedureDsl } from '../authoring/dsl'
import { checkBodyPreservation } from '../authoring/guard'
import type { CodeBlockMapEntry, TiptapDoc, TiptapNode } from '../nodes'

const t = (text: string): TiptapNode => ({ type: 'text', text })
const ref = (id: string): TiptapNode => ({ type: 'reference', attrs: { id } })
const pb = (...inline: TiptapNode[]): TiptapNode => ({
  type: 'block',
  attrs: { blockType: 'text' },
  content: inline,
})
const codeBlocks: CodeBlockMapEntry[] = [
  { id: 'c1', name: 'Risk', language: 'javascript', code: 'return 1' },
]

// A draft with a code block + an existing sub-procedure.
const draft: TiptapDoc = {
  type: 'doc',
  content: [pb(t('intro')), pb(ref('code:c1'))],
  codeBlocks,
  subProcedures: [{ id: 'sp1', name: 'Verify', content: [pb(t('verify'))] }],
}

describe('checkBodyPreservation (deletion guard)', () => {
  it('accepts a body that keeps every opaque occurrence and sub-procedure', () => {
    const body = docToDsl(draft) // a faithful read-back keeps everything
    expect(checkBodyPreservation(draft, body)).toEqual({ ok: true })
  })

  it('rejects a body that drops the code-block opaque step', () => {
    const body: ProcedureDsl = {
      steps: [{ id: 's1', kind: 'instruction', text: 'intro only' }],
      subProcedures: [
        { id: 'sp1', name: 'Verify', steps: [{ id: 'v1', kind: 'instruction', text: 'verify' }] },
      ],
    }
    const result = checkBodyPreservation(draft, body)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/can't be removed via chat/)
  })

  it('rejects a body that duplicates an opaque occurrence', () => {
    const read = docToDsl(draft)
    const opaque = read.steps.find((s) => s.kind === 'opaque')!
    const body: ProcedureDsl = {
      steps: [...read.steps, { ...opaque }],
      subProcedures: read.subProcedures,
    }
    const result = checkBodyPreservation(draft, body)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/duplicated/)
  })

  it('rejects an unknown opaque id', () => {
    const body: ProcedureDsl = {
      steps: [{ id: 'opaque:body:#99', kind: 'opaque', label: 'code block: ghost' }],
      subProcedures: [{ id: 'sp1', name: 'Verify', steps: [] }],
    }
    const result = checkBodyPreservation(draft, body)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Unknown read-only step/)
  })

  it('rejects dropping an existing sub-procedure', () => {
    const read = docToDsl(draft)
    const body: ProcedureDsl = { steps: read.steps } // omits subProcedures
    const result = checkBodyPreservation(draft, body)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Sub-procedure "sp1" can't be removed/)
  })

  it('allows adding a new sub-procedure while keeping the existing one', () => {
    const read = docToDsl(draft)
    const body: ProcedureDsl = {
      steps: read.steps,
      subProcedures: [
        ...(read.subProcedures ?? []),
        { id: 'sp-new', name: 'New', steps: [{ id: 'n1', kind: 'instruction', text: 'new' }] },
      ],
    }
    expect(checkBodyPreservation(draft, body)).toEqual({ ok: true })
  })
})

// packages/lib/src/agents/procedures/__tests__/authoring-dsl.test.ts

import { describe, expect, it } from 'vitest'
import { type ProcedureDsl, validateProcedureDsl } from '../authoring/dsl'

const valid: ProcedureDsl = {
  steps: [
    { id: 's1', kind: 'instruction', text: 'Greet.' },
    {
      id: 's2',
      kind: 'condition',
      cases: [
        { id: 'c1', when: 'over $500', steps: [{ id: 's3', kind: 'route', outcome: 'handoff' }] },
      ],
      else: [{ id: 's4', kind: 'call', subProcedureId: 'sp1' }],
    },
    { id: 's5', kind: 'route', outcome: 'switch', switchToProcedureId: 'proc-9' },
  ],
  subProcedures: [
    { id: 'sp1', name: 'Refund', steps: [{ id: 's6', kind: 'instruction', text: 'refund' }] },
  ],
}

describe('validateProcedureDsl', () => {
  it('accepts a valid document', () => {
    expect(validateProcedureDsl(valid)).toEqual([])
  })

  it('rejects a non-object body', () => {
    expect(validateProcedureDsl(null).length).toBeGreaterThan(0)
    expect(validateProcedureDsl([]).length).toBeGreaterThan(0)
  })

  it('rejects an unknown step kind', () => {
    const errs = validateProcedureDsl({ steps: [{ id: 'x', kind: 'loop' }] })
    expect(errs.some((e) => e.includes('unknown kind'))).toBe(true)
  })

  it('rejects an unknown property on a step', () => {
    const errs = validateProcedureDsl({
      steps: [{ id: 'x', kind: 'instruction', text: 'hi', extra: 1 }],
    })
    expect(errs.some((e) => e.includes('unknown property "extra"'))).toBe(true)
  })

  it('rejects an empty instruction text', () => {
    const errs = validateProcedureDsl({ steps: [{ id: 'x', kind: 'instruction', text: '  ' }] })
    expect(errs.some((e) => e.includes('non-empty string'))).toBe(true)
  })

  it('rejects duplicate ids across steps and cases', () => {
    const errs = validateProcedureDsl({
      steps: [
        { id: 'dup', kind: 'instruction', text: 'a' },
        { id: 'dup', kind: 'instruction', text: 'b' },
      ],
    })
    expect(errs.some((e) => e.includes('Duplicate id "dup"'))).toBe(true)
  })

  it('rejects a call to an undeclared sub-procedure', () => {
    const errs = validateProcedureDsl({
      steps: [{ id: 'x', kind: 'call', subProcedureId: 'ghost' }],
    })
    expect(errs.some((e) => e.includes('undeclared sub-procedure'))).toBe(true)
  })

  it('rejects a switch route with no target', () => {
    const errs = validateProcedureDsl({ steps: [{ id: 'x', kind: 'route', outcome: 'switch' }] })
    expect(errs.some((e) => e.includes('switchToProcedureId'))).toBe(true)
  })

  it('rejects an empty predicate in a condition case', () => {
    const errs = validateProcedureDsl({
      steps: [{ id: 'x', kind: 'condition', cases: [{ id: 'c', when: '', steps: [] }] }],
    })
    expect(errs.some((e) => e.includes('non-empty predicate'))).toBe(true)
  })

  it('rejects a condition with no cases', () => {
    const errs = validateProcedureDsl({ steps: [{ id: 'x', kind: 'condition', cases: [] }] })
    expect(errs.some((e) => e.includes('non-empty array'))).toBe(true)
  })

  it('rejects a condition nested inside a condition case', () => {
    const errs = validateProcedureDsl({
      steps: [
        {
          id: 'outer',
          kind: 'condition',
          cases: [
            {
              id: 'k1',
              when: 'a',
              steps: [
                {
                  id: 'inner',
                  kind: 'condition',
                  cases: [{ id: 'k2', when: 'b', steps: [] }],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(errs.some((e) => e.includes('cannot be nested inside another condition'))).toBe(true)
  })

  it('rejects a condition nested inside a condition else', () => {
    const errs = validateProcedureDsl({
      steps: [
        {
          id: 'outer',
          kind: 'condition',
          cases: [{ id: 'k1', when: 'a', steps: [] }],
          else: [{ id: 'inner', kind: 'condition', cases: [{ id: 'k2', when: 'b', steps: [] }] }],
        },
      ],
    })
    expect(errs.some((e) => e.includes('cannot be nested inside another condition'))).toBe(true)
  })

  it('accepts a condition inside a sub-procedure invoked from a condition arm', () => {
    const doc: ProcedureDsl = {
      steps: [
        {
          id: 'outer',
          kind: 'condition',
          cases: [
            { id: 'k1', when: 'a', steps: [{ id: 'c1', kind: 'call', subProcedureId: 'sp1' }] },
          ],
        },
      ],
      subProcedures: [
        {
          id: 'sp1',
          name: 'Nested',
          steps: [{ id: 's1', kind: 'condition', cases: [{ id: 'k2', when: 'b', steps: [] }] }],
        },
      ],
    }
    expect(validateProcedureDsl(doc)).toEqual([])
  })

  it('accepts an opaque step (shape only — resolution checked at build time)', () => {
    expect(
      validateProcedureDsl({
        steps: [{ id: 'opaque:body:#0', kind: 'opaque', label: 'code block: X' }],
      })
    ).toEqual([])
  })
})

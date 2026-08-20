// packages/lib/src/workflow-engine/catalog/if-else.test.ts

/**
 * The `if-else` manifest's branch contract
 * (`plans/kopilot/workflow/21-branch-authoring-reliability.md` §13.1, F1/F4).
 *
 * `case_id` is not a label — it IS the branch handle edges leave on, the
 * address `connect_nodes`/`add_node` resolve, and the key the engine routes on.
 * Two authored ids therefore have to be refused rather than merely reported:
 * `false` (the reserved ELSE handle — a case claiming it collapses into ELSE,
 * so a matched case and a nothing-matched fall-through leave on the same edge),
 * and any duplicate. Both were writable through the tools and neither was
 * checked anywhere; the logged 2026-08-18 turn wrote `case_id: 'false'` and
 * finished reporting `publishable: true` with half the workflow missing.
 *
 * The derivation is separately pinned as TOTAL: it used to throw for fewer than
 * two branches, which is what `cases: []` produces, and both production call
 * sites are on READ paths.
 */

import { describe, expect, it } from 'vitest'
import {
  branchNameCorrect,
  extractIfElseVariableIds,
  type IfElseNodeData,
  ifElseManifest,
  unwrapBracedVariableId,
  validateIfElseConfig,
} from './nodes/if-else'

function ifElseData(cases: unknown[]): IfElseNodeData {
  return {
    id: 'n1',
    type: 'if-else',
    title: 'Check Carrier',
    desc: 'Route by carrier',
    cases,
  } as unknown as IfElseNodeData
}

function oneCase(caseId: string) {
  return {
    id: `c-${caseId}`,
    case_id: caseId,
    logical_operator: 'and',
    conditions: [{ id: 'x', variableId: 'Carrier.value', comparison_operator: 'is', value: 'ups' }],
  }
}

/** The `blocksAuthoring` errors a config reports — what refuses a write. */
function blockers(data: IfElseNodeData) {
  return validateIfElseConfig(data).errors.filter((e) => e.blocksAuthoring === true)
}

describe('validateIfElseConfig — case_id is the branch address (F1)', () => {
  it("refuses case_id 'false' — the reserved ELSE handle", () => {
    const found = blockers(ifElseData([oneCase('carrier-ups'), oneCase('false')]))
    expect(found).toHaveLength(1)
    expect(found[0]?.field).toBe('cases.1.case_id')
    expect(found[0]?.message).toContain('reserved ELSE handle')
    expect(found[0]?.message).toContain('carrier-ups')
    expect(found[0]?.type).toBe('error')
  })

  it('refuses duplicate case_ids across cases', () => {
    const found = blockers(ifElseData([oneCase('carrier-ups'), oneCase('carrier-ups')]))
    expect(found).toHaveLength(1)
    expect(found[0]?.field).toBe('cases.1.case_id')
    expect(found[0]?.message).toContain('Duplicate case_id "carrier-ups"')
  })

  it('accepts distinct, meaningful case_ids', () => {
    expect(blockers(ifElseData([oneCase('carrier-fedex'), oneCase('carrier-ups')]))).toEqual([])
  })

  it("still accepts the shipped default 'true'", () => {
    // No migration is owed: every shipped template uses `true` or a descriptive
    // `case_*` id, and `defaultData()` ships one `true` case.
    expect(blockers(ifElseData([oneCase('true')]))).toEqual([])
  })

  it('survives a case with no conditions array at all', () => {
    // A throwing validator returns NO blockers (`authoringBlockers` swallows
    // it), so the reserved-handle rule would silently stop firing on exactly
    // the half-built config it exists to catch.
    const data = ifElseData([{ id: 'c1', case_id: 'false', logical_operator: 'and' }])
    expect(() => validateIfElseConfig(data)).not.toThrow()
    expect(blockers(data)).toHaveLength(1)
  })
})

describe('branchNameCorrect — total, never throws (F4)', () => {
  it('returns just the ELSE branch when there are no cases', () => {
    expect(branchNameCorrect([{ id: 'false', name: '' }])).toEqual([{ id: 'false', name: 'ELSE' }])
  })

  it('returns an empty list for an empty list', () => {
    expect(branchNameCorrect([])).toEqual([])
  })

  it('keeps IF/ELSE for two branches and CASE n/ELSE for three or more', () => {
    expect(
      branchNameCorrect([
        { id: 'true', name: '' },
        { id: 'false', name: '' },
      ])
    ).toEqual([
      { id: 'true', name: 'IF' },
      { id: 'false', name: 'ELSE' },
    ])
    expect(
      branchNameCorrect([
        { id: 'a', name: '' },
        { id: 'b', name: '' },
        { id: 'false', name: '' },
      ]).map((b) => b.name)
    ).toEqual(['CASE 1', 'CASE 2', 'ELSE'])
  })
})

describe('ifElseManifest.connection.branches', () => {
  it('derives one branch per case plus the reserved ELSE', () => {
    const branches = ifElseManifest.connection.branches?.(
      ifElseData([oneCase('carrier-fedex'), oneCase('carrier-ups')])
    )
    expect(branches).toEqual([
      { id: 'carrier-fedex', name: 'CASE 1', kind: 'default' },
      { id: 'carrier-ups', name: 'CASE 2', kind: 'default' },
      { id: 'false', name: 'ELSE', kind: 'default' },
    ])
  })

  it('does not throw for cases: [] or absent cases — it degrades to ELSE', () => {
    expect(ifElseManifest.connection.branches?.(ifElseData([]))).toEqual([
      { id: 'false', name: 'ELSE', kind: 'default' },
    ])
    expect(
      ifElseManifest.connection.branches?.({ id: 'n1', type: 'if-else' } as IfElseNodeData)
    ).toEqual([{ id: 'false', name: 'ELSE', kind: 'default' }])
  })
})

describe('agent docs', () => {
  it('teaches case_id as the address and never authors a `false` or `true` case', () => {
    const usage = ifElseManifest.agent?.usage ?? ''
    expect(usage).toContain('case_id')
    expect(usage).toContain('UNIQUE')
    expect(usage).toContain('reserved')
    // The old wording — "The ELSE branch handle is always 'false'" — read as an
    // instruction to NAME the else case `false`, and the model followed it.
    expect(usage).not.toContain("always 'false'")

    const authored = (ifElseManifest.agent?.examples ?? []).flatMap((example) =>
      ((example.config as { cases?: Array<{ case_id: string }> }).cases ?? []).map((c) => c.case_id)
    )
    expect(authored.length).toBeGreaterThan(0)
    expect(authored).not.toContain('true')
    expect(authored).not.toContain('false')
    expect(authored).toContain('carrier-fedex')
    // Every example must survive its own validator.
    for (const example of ifElseManifest.agent?.examples ?? []) {
      expect(blockers(ifElseData((example.config as { cases: unknown[] }).cases))).toEqual([])
    }
  })

  it('carries the search synonyms the natural queries use', () => {
    expect(ifElseManifest.synonyms).toEqual(
      expect.arrayContaining(['if else', 'switch', 'branch', 'route'])
    )
  })
})

describe('variableId brace tolerance (F5, read side)', () => {
  it('strips one surrounding {{ }} and leaves a bare path alone', () => {
    expect(unwrapBracedVariableId('{{Carrier.value}}')).toBe('Carrier.value')
    expect(unwrapBracedVariableId('{{ Carrier.value }}')).toBe('Carrier.value')
    expect(unwrapBracedVariableId('Carrier.value')).toBe('Carrier.value')
  })

  it('extracts the unwrapped path, so ref-check never sees quadruple braces', () => {
    const data = ifElseData([
      {
        id: 'c1',
        case_id: 'carrier-ups',
        logical_operator: 'and',
        conditions: [{ id: 'x', variableId: '{{Carrier.value}}', comparison_operator: 'is' }],
      },
    ])
    expect(extractIfElseVariableIds(data)).toEqual(['Carrier.value'])
  })
})

// packages/lib/src/agents/procedures/__tests__/context.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Subject, ToolContext } from '../../../ai/agent-framework/tool-context'
import { evaluateConditions } from '../../../conditions/evaluate'
import type { Condition, ConditionGroup } from '../../../conditions/types'
import { buildProcedureFieldResolver } from '../context'

// The v8 binding resolver is mocked: it returns whatever `resolveMap` holds for the
// ref (joined for FieldPath), so the test controls "what the subject resolves to".
const { resolveMap } = vi.hoisted(() => ({ resolveMap: {} as Record<string, unknown> }))
vi.mock('../../bindings/resolve', () => ({
  buildResolveVarSource: vi.fn(
    () => async (source: { kind: string; ref: string | string[] }) =>
      resolveMap[Array.isArray(source.ref) ? source.ref.join('|') : source.ref]
  ),
}))

const ctx = {} as ToolContext
const subject: Subject = { anchors: {}, identityVerified: false }

const cond = (
  fieldId: Condition['fieldId'],
  operator: Condition['operator'],
  value: unknown
): Condition => ({
  id: `c-${String(fieldId)}`,
  fieldId,
  operator,
  value,
})
const group = (conditions: Condition[]): ConditionGroup => ({
  id: 'g',
  conditions,
  logicalOperator: 'AND',
})

beforeEach(() => {
  for (const k of Object.keys(resolveMap)) delete resolveMap[k]
})

describe('buildProcedureFieldResolver', () => {
  it('keys the map by the SIMPLE field id the evaluator looks up (ResourceFieldId)', async () => {
    resolveMap['contact:status'] = 'OPEN'
    const resolver = await buildProcedureFieldResolver(ctx, subject, [
      group([cond('contact:status', 'is', 'OPEN')]),
    ])
    // The evaluator strips `contact:` and looks up the simple `status`.
    expect(resolver(subject, 'status')).toBe('OPEN')
    // The full ResourceFieldId is NOT a key (that mis-keying is the silent-corruption risk).
    expect(resolver(subject, 'contact:status')).toBeUndefined()
  })

  it('end-to-end: a matching ruleset evaluates true through evaluateConditions', async () => {
    resolveMap['contact:status'] = 'OPEN'
    const groups = [group([cond('contact:status', 'is', 'OPEN')])]
    const resolver = await buildProcedureFieldResolver(ctx, subject, groups)
    expect(evaluateConditions(subject, groups, resolver)).toBe(true)
  })

  it('uses the LAST segment of a FieldPath as the simple key', async () => {
    resolveMap['contact:company|company:name'] = 'Acme'
    const resolver = await buildProcedureFieldResolver(ctx, subject, [
      group([cond(['contact:company', 'company:name'] as Condition['fieldId'], 'is', 'Acme')]),
    ])
    expect(resolver(subject, 'name')).toBe('Acme')
  })

  it('gate-by-absence: an unresolved anchor yields undefined (empty subject)', async () => {
    // resolveMap has no entry for contact:status → resolver returns undefined.
    const groups = [group([cond('contact:status', 'is', 'OPEN')])]
    const resolver = await buildProcedureFieldResolver(ctx, subject, groups)
    expect(resolver(subject, 'status')).toBeUndefined()
    expect(evaluateConditions(subject, groups, resolver)).toBe(false)
  })

  it('a bare legacy field id (no entity root) resolves to undefined, never throws', async () => {
    const resolver = await buildProcedureFieldResolver(ctx, subject, [
      group([cond('status', 'is', 'OPEN')]),
    ])
    expect(resolver(subject, 'status')).toBeUndefined()
  })

  it('resolves each distinct field exactly once even when referenced repeatedly', async () => {
    const { buildResolveVarSource } = await import('../../bindings/resolve')
    const innerCalls: unknown[] = []
    vi.mocked(buildResolveVarSource).mockReturnValueOnce(async (source) => {
      if (source.kind === 'var') innerCalls.push(source.ref)
      return 'x'
    })
    const resolver = await buildProcedureFieldResolver(ctx, subject, [
      group([cond('contact:status', 'is', 'a'), cond('contact:status', 'is not', 'b')]),
    ])
    expect(resolver(subject, 'status')).toBe('x')
    expect(innerCalls).toHaveLength(1) // deduped by simple key
  })
})

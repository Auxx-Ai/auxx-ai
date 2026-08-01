// packages/lib/src/agents/procedures/__tests__/context.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Subject, ToolContext } from '../../../ai/agent-framework/tool-context'
import { evaluateConditions } from '../../../conditions/evaluate'
import type { Condition, ConditionGroup } from '../../../conditions/types'
import { buildProcedureFieldResolver, buildProcedurePredicateResolver, scopedVar } from '../context'
import type { ProcedureFrame } from '../types'

// The v8 binding resolver is mocked: it returns whatever `resolveMap` holds for the
// ref (joined for FieldPath), so the test controls "what the subject resolves to".
// `buildSubjectFieldResolver` (the shared helper readProcedureRef now goes through)
// is mirrored faithfully so it routes back through the mocked `buildResolveVarSource`.
const { resolveMap } = vi.hoisted(() => ({ resolveMap: {} as Record<string, unknown> }))
vi.mock('../../bindings/resolve', async (importOriginal) => {
  // Partial mock (HANDOFF §2.8): the two overrides below win, and anything the
  // import graph reaches for later still resolves off the real module.
  const buildResolveVarSource = vi.fn(
    // Arity mirrors the real `(ctx) => (source, subject) => …`; only `source.ref`
    // is consulted here.
    (_ctx: ToolContext) => async (source: { kind: string; ref: string | string[] }) =>
      resolveMap[Array.isArray(source.ref) ? source.ref.join('|') : source.ref]
  )
  const buildSubjectFieldResolver = (ctx: ToolContext) => {
    if (ctx.evalFieldResolver) {
      const overlay = ctx.evalFieldResolver
      return (ref: unknown) => overlay(ref as never)
    }
    const resolve = buildResolveVarSource(ctx)
    return async (ref: string | string[]) => {
      if (!ctx.subject) return undefined
      return resolve({ kind: 'var', ref })
    }
  }
  return {
    ...(await importOriginal<typeof import('../../bindings/resolve')>()),
    buildResolveVarSource,
    buildSubjectFieldResolver,
  }
})

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

const frame: ProcedureFrame = {
  procedureId: 'p1',
  procedureVersionId: 'v1',
  cursor: 's0',
  status: 'running',
  history: [],
  pushedBy: 'selection',
}

/** A ToolContext whose `context.read` serves `store` and whose `subject` is the empty subject. */
function makeCtx(store: Record<string, unknown>, reads?: string[]): ToolContext {
  return {
    subject,
    context: {
      read: async (ref: string) => {
        reads?.push(ref)
        return store[ref]
      },
    },
  } as unknown as ToolContext
}

describe('scopedVar', () => {
  it('namespaces a local attribute under the procedure VERSION as a flat var key', () => {
    expect(scopedVar(frame, 'cancel_result')).toBe('var:__la:v1:cancel_result')
  })

  it('a different procedureVersionId yields an isolated key (cross-procedure push)', () => {
    const other: ProcedureFrame = { ...frame, procedureVersionId: 'v2' }
    expect(scopedVar(other, 'cancel_result')).toBe('var:__la:v2:cancel_result')
    expect(scopedVar(other, 'cancel_result')).not.toBe(scopedVar(frame, 'cancel_result'))
  })
})

describe('buildProcedurePredicateResolver', () => {
  it('reads a declared local attribute from the VERSION-scoped store key', async () => {
    const ctxV = makeCtx({ 'var:__la:v1:cancel_result': 'done' })
    const { resolver, prime } = buildProcedurePredicateResolver(ctxV, frame)
    const groups = [group([cond('var:cancel_result', 'is', 'done')])]
    await prime(groups)
    // The evaluator strips `var:` → looks up the simple `cancel_result`.
    expect(resolver(subject, 'cancel_result')).toBe('done')
    expect(evaluateConditions(subject, groups, resolver)).toBe(true)
  })

  it('isolates locals by version — a v2 frame does not see a v1 write', async () => {
    const ctxV = makeCtx({ 'var:__la:v1:cancel_result': 'done' })
    const v2Frame: ProcedureFrame = { ...frame, procedureVersionId: 'v2' }
    const { resolver, prime } = buildProcedurePredicateResolver(ctxV, v2Frame)
    await prime([group([cond('var:cancel_result', 'is', 'done')])])
    expect(resolver(subject, 'cancel_result')).toBeUndefined() // v2 key is empty
  })

  it('resolves CRM FieldReferences off the subject, same as selection', async () => {
    resolveMap['contact:status'] = 'OPEN'
    const { resolver, prime } = buildProcedurePredicateResolver(makeCtx({}), frame)
    await prime([group([cond('contact:status', 'is', 'OPEN')])])
    expect(resolver(subject, 'status')).toBe('OPEN')
  })

  it('mixes a local var and a CRM field in one group', async () => {
    resolveMap['contact:status'] = 'OPEN'
    const ctxV = makeCtx({ 'var:__la:v1:verified': true })
    const { resolver, prime } = buildProcedurePredicateResolver(ctxV, frame)
    const groups = [group([cond('contact:status', 'is', 'OPEN'), cond('var:verified', 'is', true)])]
    await prime(groups)
    expect(evaluateConditions(subject, groups, resolver)).toBe(true)
  })

  it('gate-by-absence: an unwritten local attribute is undefined, never throws', async () => {
    const ctxV = makeCtx({}) // store empty
    const { resolver, prime } = buildProcedurePredicateResolver(ctxV, frame)
    const groups = [group([cond('var:cancel_result', 'is', 'done')])]
    await prime(groups)
    expect(resolver(subject, 'cancel_result')).toBeUndefined()
    expect(evaluateConditions(subject, groups, resolver)).toBe(false)
  })

  it('re-reads local var:* LIVE on every prime (no memo) — for compute→branch', async () => {
    const reads: string[] = []
    const store: Record<string, unknown> = { 'var:__la:v1:a': 1, 'var:__la:v1:b': 2 }
    const ctxV = makeCtx(store, reads)
    const { prime, resolver } = buildProcedurePredicateResolver(ctxV, frame)
    await prime([group([cond('var:a', 'is', 1)])])
    // A code step mutates the var between primes — the next prime MUST see the new value.
    store['var:__la:v1:a'] = 99
    await prime([group([cond('var:a', 'is', 99), cond('var:b', 'is', 2)])])
    // `a` is re-read each prime (live), `b` once — locals are never memoized.
    expect(reads).toEqual(['var:__la:v1:a', 'var:__la:v1:a', 'var:__la:v1:b'])
    expect(resolver(subject, 'a')).toBe(99) // fresh value, not the stale 1
    expect(resolver(subject, 'b')).toBe(2)
  })

  it('memoizes CRM fields — a repeated FieldReference resolves once across primes', async () => {
    resolveMap['contact:status'] = 'OPEN'
    const resolveSpy = vi.fn(
      async (source: { ref: string | string[] }) => resolveMap[String(source.ref)]
    )
    const mod = await import('../../bindings/resolve')
    vi.mocked(mod.buildResolveVarSource).mockReturnValue(resolveSpy as never)
    const { prime, resolver } = buildProcedurePredicateResolver(makeCtx({}), frame)
    await prime([group([cond('contact:status', 'is', 'OPEN')])])
    await prime([group([cond('contact:status', 'is', 'OPEN')])]) // repeated — must NOT re-resolve
    expect(resolveSpy).toHaveBeenCalledTimes(1)
    expect(resolver(subject, 'status')).toBe('OPEN')
  })
})

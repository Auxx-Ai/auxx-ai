// apps/web/src/components/workflow/store/__tests__/branch-scope.test.ts

import {
  BaseType,
  ErrorStrategy,
  type NodeErrorHandling,
  type UnifiedVariable,
} from '@auxx/lib/workflow-engine/client'
import { describe, expect, it } from 'vitest'
import { markPathConditional, scopeAncestorOutputs } from '../branch-scope'

const NODE = 'n1'

const v = (path: string, extra?: Partial<UnifiedVariable>): UnifiedVariable => ({
  id: `${NODE}.${path}`,
  label: path,
  type: BaseType.STRING,
  category: 'node',
  ...extra,
})

/** Mirrors crud: a source-only record tree, an always-written block, fail-only errors. */
const ERROR_HANDLING: NodeErrorHandling = {
  strategies: [ErrorStrategy.fail, ErrorStrategy.default],
  defaultStrategy: ErrorStrategy.fail,
  failOutputs: ['success', 'error', 'errorDetails', 'operation', 'resourceType'],
  failureOnlyOutputs: ['error', 'errorDetails'],
}

const DECLARED = [
  v('record', { type: BaseType.OBJECT, properties: { email: v('record.email') } }),
  v('id'),
  v('success', { type: BaseType.BOOLEAN }),
  v('operation'),
  v('resourceType'),
  v('error'),
  v('errorDetails', { type: BaseType.OBJECT }),
]

const scope = (handles: Set<string> | undefined, config: unknown = { error_strategy: 'fail' }) =>
  scopeAncestorOutputs({
    ancestorId: NODE,
    handles,
    declared: DECLARED,
    errorHandling: ERROR_HANDLING,
    config,
  })

const ids = (vars: UnifiedVariable[]) => new Set(vars.map((x) => x.id.slice(`${NODE}.`.length)))

describe('scopeAncestorOutputs', () => {
  it('narrows to the failure path on a fail-only consumer', () => {
    const { variables, conditional } = scope(new Set(['fail']))
    expect(ids(variables)).toEqual(
      new Set(['success', 'error', 'errorDetails', 'operation', 'resourceType'])
    )
    expect(conditional.size).toBe(0)
  })

  it('subtracts the failure-only keys on a source-only consumer under `fail`', () => {
    const { variables, conditional } = scope(new Set(['source']))
    expect(ids(variables)).toEqual(
      new Set(['record', 'id', 'success', 'operation', 'resourceType'])
    )
    expect(conditional.size).toBe(0)
  })

  it('keeps the failure keys on `source` under `continue` — the failure lands here', () => {
    const { variables } = scope(new Set(['source']), { error_strategy: 'continue' })
    expect(ids(variables)).toEqual(new Set(DECLARED.map((x) => x.id.slice(`${NODE}.`.length))))
  })

  it('unions at a convergence and marks only the difference', () => {
    const { variables, conditional } = scope(new Set(['source', 'fail']))
    // Union: nothing is filtered at a join.
    expect(variables).toHaveLength(DECLARED.length)
    // union − intersection, from BOTH directions.
    expect(new Set(Array.from(conditional, (id) => id.slice(`${NODE}.`.length)))).toEqual(
      new Set(['record', 'id', 'error', 'errorDetails'])
    )
  })

  it('treats the legacy `onError` handle as the failure door', () => {
    // `findFailureEdge` still falls back to it, so a graph carrying one must
    // scope the same as `fail` rather than silently reading as `source`.
    expect(ids(scope(new Set(['onError'])).variables)).toEqual(
      ids(scope(new Set(['fail'])).variables)
    )
  })

  it('offers everything when the type declares no errorHandling', () => {
    // App blocks and unmigrated types. Absent ⇒ no per-handle difference,
    // which must not be read as "this handle writes nothing".
    const { variables, conditional } = scopeAncestorOutputs({
      ancestorId: NODE,
      handles: new Set(['fail']),
      declared: DECLARED,
      errorHandling: undefined,
      config: { error_strategy: 'fail' },
    })
    expect(variables).toBe(DECLARED)
    expect(conditional.size).toBe(0)
  })

  it('offers everything when the consumer has no handle information', () => {
    expect(scope(undefined).variables).toBe(DECLARED)
    expect(scope(new Set()).variables).toBe(DECLARED)
  })

  it('does not duplicate a variable an ancestor reaches on two handles', () => {
    const { variables } = scope(new Set(['source', 'fail']))
    expect(new Set(variables.map((x) => x.id)).size).toBe(variables.length)
  })
})

describe('markPathConditional', () => {
  it('stamps the whole subtree, because a conditional root makes its children conditional', () => {
    const marked = markPathConditional(DECLARED[0]!)
    expect(marked.pathConditional).toBe(true)
    expect(marked.properties?.email?.pathConditional).toBe(true)
  })

  it('clones rather than mutating — the source tree is shared across consumers', () => {
    const original = DECLARED[0]!
    markPathConditional(original)
    expect(original.pathConditional).toBeUndefined()
    expect(original.properties?.email?.pathConditional).toBeUndefined()
  })

  it('stamps through `items` as well as `properties`', () => {
    const list = v('rows', { type: BaseType.ARRAY, items: v('rows[*]', { type: BaseType.OBJECT }) })
    expect(markPathConditional(list).items?.pathConditional).toBe(true)
  })
})

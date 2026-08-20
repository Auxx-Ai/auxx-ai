// packages/lib/src/workflow-engine/catalog/__tests__/default-values.test.ts

import { describe, expect, it } from 'vitest'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import {
  coerceDefaultValue,
  defaultValueTargets,
  ErrorStrategy,
  readDefaultValues,
  validateDefaultValues,
} from '../error-handling'
import { crudManifest } from '../nodes/crud'
import { getHttpOutputVariables, httpManifest } from '../nodes/http'

const NODE = 'n1'

/** A flat declared output, the shape http's resolver returns. */
function flat(path: string, type: BaseType = BaseType.STRING): UnifiedVariable {
  return { id: `${NODE}.${path}`, label: path, type, category: 'node' } as UnifiedVariable
}

describe('coerceDefaultValue', () => {
  it('parses each declared type', () => {
    expect(coerceDefaultValue('string', 'hi')).toBe('hi')
    expect(coerceDefaultValue('number', '503')).toBe(503)
    expect(coerceDefaultValue('boolean', 'true')).toBe(true)
    expect(coerceDefaultValue('object', '{"a":1}')).toEqual({ a: 1 })
    expect(coerceDefaultValue('array', '[1,2]')).toEqual([1, 2])
  })

  it('preserves the lossy edges the three copies had', () => {
    // Documented in the helper, asserted here so "fixing" one silently is a
    // failing test rather than a behaviour change on a failure path.
    expect(coerceDefaultValue('number', 'abc')).toBe(0)
    expect(coerceDefaultValue('boolean', 'yes')).toBe(false)
    expect(coerceDefaultValue('object', 'not json')).toBe('not json')
  })
})

describe('readDefaultValues', () => {
  const row = { key: 'status', type: 'number' as const, value: '503' }

  it('reads the canonical plural key', () => {
    expect(readDefaultValues({ default_values: [row] })).toEqual([row])
  })

  it("reads http's legacy singular key so stored graphs keep working", () => {
    expect(readDefaultValues({ default_value: [row] })).toEqual([row])
  })

  it('prefers the plural when a row somehow carries both', () => {
    const legacy = { key: 'body', type: 'string' as const, value: 'old' }
    expect(readDefaultValues({ default_values: [row], default_value: [legacy] })).toEqual([row])
  })

  it('is empty for an unconfigured node', () => {
    expect(readDefaultValues(undefined)).toEqual([])
    expect(readDefaultValues({})).toEqual([])
  })
})

describe('defaultValueTargets', () => {
  it('offers every flat declared output for http', () => {
    const targets = defaultValueTargets(
      getHttpOutputVariables({} as never, NODE),
      NODE,
      httpManifest.errorHandling
    )
    expect(targets.map((t) => t.path).sort()).toEqual([
      'body',
      'error',
      'headers',
      'response',
      'status',
      'success',
    ])
  })

  it('offers `status` — the whole point of §9.1 — even though it is in failOutputs', () => {
    // The regression guard on deriving the target list from `failOutputs`.
    // http's is `['status', 'error', 'success']`, and `status` is precisely
    // the substitute the editor exists to set.
    const targets = defaultValueTargets(
      getHttpOutputVariables({} as never, NODE),
      NODE,
      httpManifest.errorHandling
    )
    expect(targets.map((t) => t.path)).toContain('status')
  })

  it('excludes the keys a manifest declares as defaultValueExclude', () => {
    // Declared inline rather than read off a manifest: crud was the only type
    // that carried a `defaultValueExclude`, and it lost the list along with
    // the `default` strategy. The rule itself still has to hold for whichever
    // type declares one next.
    const declared = [flat('id'), flat('record', BaseType.OBJECT), flat('success')]
    const targets = defaultValueTargets(declared, NODE, {
      strategies: [ErrorStrategy.fail, ErrorStrategy.default],
      defaultStrategy: ErrorStrategy.fail,
      defaultValueExclude: ['success'],
    })
    expect(targets.map((t) => t.path)).toEqual(['id', 'record'])
  })

  it('descends ONE level into an object, and no further', () => {
    // "If the create fails, pretend it made this record" is the case that
    // needs depth 1. crud declares its record tree at maxDepth 2, and offering
    // sixty deep paths is not an editor (plan 24 §10.2).
    const grandchild = flat('def.owner.email')
    const child: UnifiedVariable = {
      ...flat('def.owner', BaseType.OBJECT),
      properties: { email: grandchild },
    }
    const root: UnifiedVariable = {
      ...flat('def', BaseType.OBJECT),
      properties: { owner: child },
    }
    const targets = defaultValueTargets([root], NODE, undefined)
    expect(targets.map((t) => t.path)).toEqual(['def', 'def.owner'])
  })
})

describe('validateDefaultValues', () => {
  const targets = [{ path: 'status' }, { path: 'body' }]

  it('is silent under any policy but `default`', () => {
    expect(validateDefaultValues({ strategy: ErrorStrategy.fail, values: [], targets })).toEqual([])
    expect(
      validateDefaultValues({ strategy: ErrorStrategy.continue, values: [], targets })
    ).toEqual([])
  })

  it('warns — not errors — when `default` is selected with no rows', () => {
    // §9.2: the strategy silently does nothing today, because every
    // processor's `default` arm is guarded on a non-empty list. A warning
    // rather than an error because the node still runs; it runs as `fail`.
    const issues = validateDefaultValues({
      strategy: ErrorStrategy.default,
      values: [],
      targets,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.type).toBe('warning')
    expect(issues[0]!.field).toBe('default_values')
    expect(issues[0]!.message).toContain('the node will still fail')
  })

  it('errors on a key that is not a declared output', () => {
    const issues = validateDefaultValues({
      strategy: ErrorStrategy.default,
      values: [{ key: 'status_code', type: 'number', value: '503' }],
      targets,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.type).toBe('error')
    expect(issues[0]!.message).toContain('status_code')
  })

  it('accepts a key that IS a declared output', () => {
    expect(
      validateDefaultValues({
        strategy: ErrorStrategy.default,
        values: [{ key: 'status', type: 'number', value: '503' }],
        targets,
      })
    ).toEqual([])
  })

  it('reports nothing when targets cannot be resolved yet', () => {
    // crud's manifest `validate` receives only `data`, so it cannot resolve
    // the record tree. `undefined` must mean "cannot tell", never "every key
    // is wrong" — the panel, which has the resource, runs the full check.
    expect(
      validateDefaultValues({
        strategy: ErrorStrategy.default,
        values: [{ key: 'anything', type: 'string', value: 'x' }],
        targets: undefined,
      })
    ).toEqual([])
  })
})

describe('manifest validators surface the substitute findings', () => {
  it('http warns on `default` with an empty list', () => {
    const result = httpManifest.validate({
      title: 'Call API',
      url: 'https://example.com',
      error_strategy: ErrorStrategy.default,
      default_values: [],
    } as never)
    expect(result.errors.some((e) => e.field === 'default_values' && e.type === 'warning')).toBe(
      true
    )
  })

  it('http errors on the legacy `status_code` key — §9.1, now visible', () => {
    const result = httpManifest.validate({
      title: 'Call API',
      url: 'https://example.com',
      error_strategy: ErrorStrategy.default,
      default_values: [{ key: 'status_code', type: 'number', value: '503' }],
    } as never)
    const issue = result.errors.find((e) => e.field === 'default_values')
    expect(issue?.type).toBe('error')
    expect(issue?.message).toContain('status_code')
  })

  it('http accepts `status`, and that is what makes {{Http.status}} settable', () => {
    const result = httpManifest.validate({
      title: 'Call API',
      url: 'https://example.com',
      error_strategy: ErrorStrategy.default,
      default_values: [{ key: 'status', type: 'number', value: '503' }],
    } as never)
    expect(result.errors.filter((e) => e.field === 'default_values')).toEqual([])
  })

  it('crud warns on a LEGACY `default` with an empty list', () => {
    // crud no longer offers `default`, but the processor switches on the
    // stored value, so a node persisted under it still runs that arm — and an
    // empty list makes that arm a silent no-op. `validate` is the surface that
    // says so; it is the only thing that reaches such a node now.

    const result = crudManifest.validate({
      title: 'Create contact',
      mode: 'create',
      resourceType: 'contact',
      error_strategy: ErrorStrategy.default,
      default_values: [],
    } as never)
    expect(result.errors.some((e) => e.field === 'default_values' && e.type === 'warning')).toBe(
      true
    )
  })
})

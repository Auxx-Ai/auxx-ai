// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/find-limit-resolution.test.ts

import { describe, expect, it } from 'vitest'
import { ExecutionContextManager } from '../../../core/execution-context'
import type { WorkflowNode } from '../../../core/types'
import { WorkflowNodeType } from '../../../core/types'
import { FindProcessor } from '../find'

/**
 * Pins the Find node's row limit against the picker's storage shape.
 *
 * The limit field is a `VAR_MODE.PICKER` editor, so binding it to a variable
 * stores a **bare dotted path** (`node-1.count`), not a `{{…}}` template. The old
 * resolver interpolated only, so the path came back untouched, `parseInt` gave
 * `NaN`, and the node quietly queried the 10-row default while the panel showed a
 * correctly-bound field.
 *
 * `resolveLimit` is exercised directly: the surrounding `executeNode` needs a live
 * resource cache and database, and neither participates in this decision.
 */

type Resolver = (config: unknown, ctx: ExecutionContextManager) => Promise<number | undefined>

function createContext(variables: Record<string, unknown> = {}): ExecutionContextManager {
  const context = new ExecutionContextManager('wf', 'run', 'org')
  for (const [key, value] of Object.entries(variables)) {
    context.setVariable(key, value)
  }
  return context
}

const processor = new FindProcessor()
const resolveLimit: Resolver = (config, ctx) =>
  (processor as unknown as { resolveLimit: Resolver }).resolveLimit(config, ctx)

describe('FindProcessor — limit resolution', () => {
  it('resolves a bare picker path', async () => {
    const ctx = createContext({ 'node-1.count': 25 })
    expect(await resolveLimit({ limit: 'node-1.count', fieldModes: { limit: false } }, ctx)).toBe(
      25
    )
  })

  it('resolves a bare picker path arriving as a numeric string', async () => {
    const ctx = createContext({ 'node-1.count': '25' })
    expect(await resolveLimit({ limit: 'node-1.count', fieldModes: { limit: false } }, ctx)).toBe(
      25
    )
  })

  it('resolves a {{…}} template', async () => {
    const ctx = createContext({ 'node-1.count': 5 })
    expect(
      await resolveLimit({ limit: '{{node-1.count}}', fieldModes: { limit: false } }, ctx)
    ).toBe(5)
  })

  it('falls back to 10 when the bound variable is missing', async () => {
    const ctx = createContext()
    expect(await resolveLimit({ limit: 'missing.count', fieldModes: { limit: false } }, ctx)).toBe(
      10
    )
  })

  it('falls back to 10 when the bound variable is zero or negative', async () => {
    const ctx = createContext({ 'a.zero': 0, 'a.neg': -5 })
    expect(await resolveLimit({ limit: 'a.zero', fieldModes: { limit: false } }, ctx)).toBe(10)
    expect(await resolveLimit({ limit: 'a.neg', fieldModes: { limit: false } }, ctx)).toBe(10)
  })

  it('truncates a fractional resolved limit', async () => {
    const ctx = createContext({ 'a.n': 7.9 })
    expect(await resolveLimit({ limit: 'a.n', fieldModes: { limit: false } }, ctx)).toBe(7)
  })

  // --- constant mode is unchanged ---

  it('keeps a numeric constant', async () => {
    expect(await resolveLimit({ limit: 50 }, createContext())).toBe(50)
  })

  it('keeps a numeric-string constant', async () => {
    const ctx = createContext()
    expect(await resolveLimit({ limit: '50', fieldModes: { limit: true } }, ctx)).toBe(50)
    expect(await resolveLimit({ limit: '50' }, ctx)).toBe(50)
  })

  it('falls back to 10 for an unparseable constant, as before', async () => {
    const ctx = createContext()
    expect(await resolveLimit({ limit: 'abc', fieldModes: { limit: true } }, ctx)).toBe(10)
    expect(await resolveLimit({ limit: '0', fieldModes: { limit: true } }, ctx)).toBe(10)
  })

  it('leaves an absent limit absent', async () => {
    expect(await resolveLimit({}, createContext())).toBeUndefined()
  })
})

describe('FindProcessor — limit is declared as a dependency', () => {
  function node(data: Record<string, unknown>): WorkflowNode {
    return {
      id: 'find-1',
      workflowId: 'wf',
      nodeId: 'find-1',
      type: WorkflowNodeType.FIND,
      name: 'Find',
      description: '',
      data: { resourceType: 'ticket', findMode: 'findMany', ...data },
      metadata: {},
    } as unknown as WorkflowNode
  }

  const extract = (n: WorkflowNode) =>
    (
      processor as unknown as { extractRequiredVariables: (n: WorkflowNode) => string[] }
    ).extractRequiredVariables(n)

  it('declares a bare picker path', () => {
    expect(extract(node({ limit: 'node-1.count', fieldModes: { limit: false } }))).toContain(
      'node-1.count'
    )
  })

  it('declares a templated limit', () => {
    expect(extract(node({ limit: '{{node-1.count}}' }))).toContain('node-1.count')
  })

  it('declares nothing for a numeric-string constant', () => {
    expect(extract(node({ limit: '25', fieldModes: { limit: true } }))).toEqual([])
  })
})

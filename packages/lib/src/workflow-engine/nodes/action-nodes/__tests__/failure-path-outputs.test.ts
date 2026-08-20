// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/failure-path-outputs.test.ts

/**
 * What a FAILED node actually writes into the variable namespace, versus what
 * its manifest declares as `failOutputs` (plan 24 PR 2).
 *
 * The declaration is only worth anything if the processor honours it: the
 * picker offers exactly `failOutputs` on the fail branch, so a key declared
 * but never written is a variable the author is invited to use and that
 * silently interpolates to an empty string.
 *
 * The trap this guards is that `NodeExecutionResult.output` is NOT the variable
 * namespace — the engine files it into `nodeResults`/traces, and only
 * `setNodeVariable` reaches `{{…}}` resolution. Both of http's error arms
 * returned the error in `output` alone and wrote no variables at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crudManifest } from '../../../catalog/nodes/crud'
import { httpManifest } from '../../../catalog/nodes/http'
import type { NodeData, WorkflowNode } from '../../../core/types'
import { WorkflowNodeType } from '../../../core/types'
import { HttpProcessor } from '../http'

/**
 * Built from the manifest's own `defaultData` so the node satisfies
 * `httpNodeConfigSchema`. A hand-rolled fixture fails `safeParse`, which
 * returns early with no `outputHandle` and never reaches the error arms under
 * test — the failure would look like the arms are broken when they are not.
 */
const httpNode = (errorStrategy: string): WorkflowNode => ({
  id: 'http_1',
  workflowId: 'workflow_1',
  nodeId: 'http_1',
  name: 'Call API',
  type: WorkflowNodeType.HTTP,
  data: {
    ...httpManifest.defaultData(),
    id: 'http_1',
    type: WorkflowNodeType.HTTP,
    title: 'Call API',
    method: 'get',
    url: 'https://example.invalid/boom',
    error_strategy: errorStrategy,
    default_values: [],
  } as unknown as Partial<NodeData>,
  metadata: { position: { x: 0, y: 0 } },
})

describe('http writes the outputs its manifest declares on failure', () => {
  let contextManager: any
  let written: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    written = {}
    contextManager = {
      getVariable: vi.fn(async () => undefined),
      resolveVariablePath: vi.fn(async () => undefined),
      // Every request in this suite fails at interpolation time, which is the
      // cheapest way to reach the catch without a network stub.
      interpolateVariables: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED')
      }),
      setVariable: vi.fn(),
      setNodeVariable: vi.fn((_nodeId: string, key: string, value: unknown) => {
        written[key] = value
      }),
      log: vi.fn(),
      getContext: vi.fn(() => ({ organizationId: 'org_1', userId: 'user_1' })),
    }
  })

  const run = async (strategy: string) => {
    const processor = new HttpProcessor()
    const node = httpNode(strategy)
    const result = await (processor as any).executeNode(node, contextManager, {})
    return { result, written: { ...written } }
  }

  it('leaves via `fail` and writes exactly failOutputs', async () => {
    const { result, written } = await run('fail')

    expect(result.status).toBe('failed')
    expect(result.outputHandle).toBe('fail')
    expect(Object.keys(written).sort()).toEqual(
      [...(httpManifest.errorHandling?.failOutputs ?? [])].sort()
    )
    expect(written.error).toContain('ECONNREFUSED')
    expect(written.success).toBe(false)
    expect(written.status).toBe(0)
  })

  it('writes the same variables on `continue`, which stays on source', async () => {
    // `continue` is the one policy http keeps (§6.5), and it is the one whose
    // entire purpose is to hand you the error — it must not be the broken one.
    const { result, written } = await run('continue')

    expect(result.status).toBe('succeeded')
    expect(result.outputHandle).toBe('source')
    expect(written.error).toContain('ECONNREFUSED')
    expect(written.success).toBe(false)
  })

  it('writes them on the legacy `none` spelling too', async () => {
    const { result, written } = await run('none')

    expect(result.outputHandle).toBe('source')
    expect(written.error).toContain('ECONNREFUSED')
  })

  it('an empty `default` list falls through to fail and still writes them', async () => {
    // `default` with no configured substitutes drops into the fail arm (§6.4),
    // so the variables must be there — a silent no-op is what plan 24 §9.2 is
    // about.
    const { result, written } = await run('default')

    expect(result.outputHandle).toBe('fail')
    expect(written.error).toContain('ECONNREFUSED')
  })
})

describe('http `default` substitutes land on the DECLARED output paths', () => {
  /**
   * Plan 24 §9.1, the worst defect in the feature. `processDefaultValues`
   * seeded `{ status: 200, success: true, body: {} }` and filed EVERY key
   * under `result.body[key]`, so the panel's "Status Code" control set
   * `body.status_code` — a path declared nowhere — while `{{Http.status}}`
   * stayed 200 whatever the author typed.
   *
   * This suite needs a WORKING interpolator, unlike the one above: the request
   * must still fail (to reach the error arms) but `processText` has to resolve
   * the substitute values rather than throw.
   */
  const runWithDefaults = async (defaults: Array<Record<string, string>>) => {
    const written: Record<string, unknown> = {}
    let calls = 0
    const contextManager: any = {
      getVariable: vi.fn(async () => undefined),
      resolveVariablePath: vi.fn(async () => undefined),
      // Fail the FIRST interpolation (the URL, reaching the catch), then
      // resolve normally so the substitutes are processed.
      interpolateVariables: vi.fn(async (text: string) => {
        calls += 1
        if (calls === 1) throw new Error('connect ECONNREFUSED')
        return text
      }),
      setVariable: vi.fn(),
      setNodeVariable: vi.fn((_nodeId: string, key: string, value: unknown) => {
        written[key] = value
      }),
      log: vi.fn(),
      getContext: vi.fn(() => ({ organizationId: 'org_1', userId: 'user_1' })),
    }

    const node = httpNode('default')
    ;(node.data as any).default_values = defaults
    const result = await (new HttpProcessor() as any).executeNode(node, contextManager, {})
    return { result, written }
  }

  it('a `status` substitute of 503 makes {{Http.status}} resolve to 503', async () => {
    const { result, written } = await runWithDefaults([
      { key: 'status', type: 'number', value: '503' },
    ])

    expect(result.outputHandle).toBe('source')
    expect(result.status).toBe('succeeded')
    // The acceptance criterion, stated literally.
    expect(written.status).toBe(503)
    // And NOT the old nested path.
    expect(written['body.status_code']).toBeUndefined()
    expect((written.body as Record<string, unknown>)?.status_code).toBeUndefined()
  })

  it('a `body` substitute lands on body, not body.body', async () => {
    const { written } = await runWithDefaults([
      { key: 'body', type: 'object', value: '{"ok":false}' },
    ])
    expect(written.body).toEqual({ ok: false })
  })

  it('keeps a 200 floor when no status substitute is configured', async () => {
    const { written } = await runWithDefaults([{ key: 'body', type: 'string', value: 'fallback' }])
    expect(written.status).toBe(200)
    expect(written.body).toBe('fallback')
  })

  it('still reads the legacy singular key until the migration runs', async () => {
    const written: Record<string, unknown> = {}
    let calls = 0
    const contextManager: any = {
      getVariable: vi.fn(async () => undefined),
      resolveVariablePath: vi.fn(async () => undefined),
      interpolateVariables: vi.fn(async (text: string) => {
        calls += 1
        if (calls === 1) throw new Error('connect ECONNREFUSED')
        return text
      }),
      setVariable: vi.fn(),
      setNodeVariable: vi.fn((_nodeId: string, key: string, value: unknown) => {
        written[key] = value
      }),
      log: vi.fn(),
      getContext: vi.fn(() => ({ organizationId: 'org_1', userId: 'user_1' })),
    }
    const node = httpNode('default')
    ;(node.data as any).default_values = undefined
    ;(node.data as any).default_value = [{ key: 'status', type: 'number', value: '418' }]
    await (new HttpProcessor() as any).executeNode(node, contextManager, {})
    expect(written.status).toBe(418)
  })
})

describe('crud declares only what its failure path writes', () => {
  it('failOutputs matches the status block `handleCrudError` sets', () => {
    // Asserted against the source of the processor rather than by executing it:
    // `handleCrudError` writes these five before the strategy switch, so any
    // added or removed `setNodeVariable` there has to be mirrored in the
    // manifest or the fail branch starts lying again.
    expect(crudManifest.errorHandling?.failOutputs).toEqual([
      'success',
      'error',
      'errorDetails',
      'operation',
      'resourceType',
    ])
  })

  it('every failureOnlyOutput is one the failure path writes', () => {
    for (const key of crudManifest.errorHandling?.failureOnlyOutputs ?? []) {
      expect(crudManifest.errorHandling?.failOutputs).toContain(key)
    }
  })
})

// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/http-outbound-guard.test.ts

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { httpManifest } from '../../../catalog/nodes/http'
import type { NodeData, WorkflowNode } from '../../../core/types'
import { WorkflowNodeType } from '../../../core/types'
import { HttpProcessor } from '../http'

let server: Server
let port: number
let hits: Array<{ method?: string; contentType?: string; body: string }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      hits.push({ method: req.method, contentType: req.headers['content-type'], body })
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

afterEach(() => {
  vi.unstubAllEnvs()
  hits = []
})

const httpNode = (data: Record<string, unknown>): WorkflowNode => ({
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
    url: `http://127.0.0.1:${port}/hook`,
    error_strategy: 'continue',
    default_values: [],
    ...data,
  } as unknown as Partial<NodeData>,
  metadata: { position: { x: 0, y: 0 } },
})

function makeContext() {
  const written: Record<string, unknown> = {}
  const contextManager = {
    getVariable: vi.fn(async () => undefined),
    resolveVariablePath: vi.fn(async () => undefined),
    interpolateVariables: vi.fn(async (template: string) => template),
    setVariable: vi.fn(),
    setNodeVariable: vi.fn((_nodeId: string, key: string, value: unknown) => {
      written[key] = value
    }),
    log: vi.fn(),
    getContext: vi.fn(() => ({ organizationId: 'org_1', userId: 'user_1' })),
  }
  return { contextManager, written }
}

const run = (node: WorkflowNode, preprocessed?: unknown) => {
  const { contextManager, written } = makeContext()
  return (new HttpProcessor() as any)
    .executeNode(node, contextManager, preprocessed ?? {})
    .then((result: any) => ({ result, written }))
}

describe('http node outbound address guard', () => {
  it('blocks a loopback URL in production and surfaces it as the node error', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { result, written } = await run(httpNode({}))

    expect(result.outputHandle).toBe('source')
    expect(written.success).toBe(false)
    expect(written.error).toMatch(/private or reserved address \(127\.0\.0\.1\)/)
    expect(hits).toHaveLength(0)
  })

  it('routes a blocked address to the fail branch under `fail`', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { result } = await run(httpNode({ error_strategy: 'fail' }))

    expect(result.status).toBe('failed')
    expect(result.outputHandle).toBe('fail')
    expect(hits).toHaveLength(0)
  })

  it('blocks on the preprocessed path too', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { contextManager } = makeContext()
    const node = httpNode({})
    const processor = new HttpProcessor() as any
    const preprocessed = await processor.preprocessNode(node, contextManager)

    await expect(processor.executeNode(node, contextManager, preprocessed)).rejects.toThrow(
      /private or reserved address/
    )
    expect(hits).toHaveLength(0)
  })

  it('completes a preprocessed request when the address is allowed', async () => {
    const { contextManager } = makeContext()
    const node = httpNode({})
    const processor = new HttpProcessor() as any
    const preprocessed = await processor.preprocessNode(node, contextManager)

    const result = await processor.executeNode(node, contextManager, preprocessed)
    expect(result.output.status).toBe(200)
    expect(hits).toHaveLength(1)
  })

  it('still sends JSON and urlencoded bodies when the address is allowed', async () => {
    const json = await run(
      httpNode({
        method: 'post',
        body: { type: 'json', data: [{ type: 'text', value: '{"a":1}' }] },
      })
    )
    expect(json.written.success).toBe(true)

    const form = await run(
      httpNode({
        method: 'put',
        body: { type: 'x-www-form-urlencoded', data: [{ type: 'text', key: 'k', value: 'v w' }] },
      })
    )
    expect(form.written.success).toBe(true)

    expect(hits).toEqual([
      { method: 'POST', contentType: 'application/json', body: '{"a":1}' },
      { method: 'PUT', contentType: 'application/x-www-form-urlencoded', body: 'k=v+w' },
    ])
  })
})

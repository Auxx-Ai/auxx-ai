// packages/lib/src/workflows/graph-edit/__tests__/run-node.test.ts

/**
 * `runNode` (`03-graph-edit-service.md` §8): refuses a config-invalid node
 * with the tier-2 issues as the error, runs a valid node through the existing
 * `WorkflowExecutionService.runSingleNode` path against the DRAFT workflow
 * row, and returns a SUMMARY (status, outputs, error) — never the raw
 * execution dump. The executor is mocked; what's under test is the wrapper's
 * gating, input mapping and summarization.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError, UnprocessableEntityError } from '../../../errors'

// Partial mock — `loadDraftContext` builds the per-org manifest lookup, which
// reads the installed-apps org cache. No app is installed in these fixtures, so
// the lookup must resolve to the core registry alone. Partial, never wholesale:
// the cache barrel is imported by half of lib and replacing it dies at
// collection.
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedInstalledApps: async () => [],
}))

// The execution service constructs the whole engine off its constructor —
// replaced so none of that module graph loads (run-node lazy-imports it).
const runSingleNode = vi.fn()
vi.mock('../../workflow-execution-service', () => ({
  WorkflowExecutionService: class {
    runSingleNode(...args: unknown[]) {
      return runSingleNode(...args)
    }
  },
}))

const { runNode } = await import('../run-node')

import type { DraftGraph, GraphNode } from '../types'

const ORG = 'org_1'
const APP = 'wfapp_1'
const WAIT_ID = 'wait-aaaaaaaaaaaaaaaaaaaaa'
const ANSWER_ID = 'answer-aaaaaaaaaaaaaaaaaaaaa'

function waitNode(): GraphNode {
  return {
    id: WAIT_ID,
    type: 'standard',
    position: { x: 100, y: 200 },
    data: {
      id: WAIT_ID,
      type: 'wait',
      title: 'Wait A Bit',
      waitType: 'duration',
      durationAmount: 5,
      isDurationConstant: true,
      durationUnit: 'seconds',
    },
  }
}

/** A fresh answer node is NOT config-valid — `text` is required by the validator. */
function answerNode(): GraphNode {
  return {
    id: ANSWER_ID,
    type: 'standard',
    position: { x: 300, y: 200 },
    data: { id: ANSWER_ID, type: 'answer', title: 'Send Answer', text: '' },
  }
}

function makeDb(graph: DraftGraph, opts: { noDraft?: boolean } = {}) {
  const app = {
    id: APP,
    name: 'My Flow',
    organizationId: ORG,
    draftWorkflow: opts.noDraft
      ? null
      : {
          id: 'wf_draft',
          name: 'My Flow (Draft)',
          graph,
          triggerType: 'scheduled',
          entityDefinitionId: null,
          organizationId: ORG,
          version: 3,
        },
  }
  const db = { query: { WorkflowApp: { findFirst: vi.fn(async () => app) } } }
  return db as unknown as import('@auxx/database').Database
}

const scope = { workflowAppId: APP, organizationId: ORG, userId: 'user_1' }

beforeEach(() => {
  runSingleNode.mockReset()
  runSingleNode.mockResolvedValue({
    id: 'exec_1',
    status: 'succeeded',
    outputs: { paused_at: '2026-08-14T00:00:00.000Z' },
    error: null,
    elapsedTime: 0.42,
    processData: { internal: 'raw engine dump' },
    executionMetadata: null,
  })
})

describe('runNode', () => {
  it('refuses a config-invalid node with the tier-2 issues as the error', async () => {
    const result = await runNode(makeDb({ nodes: [answerNode()], edges: [] }), {
      ...scope,
      nodeId: 'Send Answer',
    })
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('text')
    expect(error.message).toContain('not config-valid')
    expect(runSingleNode).not.toHaveBeenCalled()
  })

  it('runs a valid node against the DRAFT row and maps the input record', async () => {
    const result = await runNode(makeDb({ nodes: [waitNode()], edges: [] }), {
      ...scope,
      nodeId: 'Wait A Bit',
      input: { 'trigger.subject': 'hello' },
    })
    expect(result.isOk()).toBe(true)

    expect(runSingleNode).toHaveBeenCalledTimes(1)
    expect(runSingleNode.mock.calls[0]?.[0]).toEqual({
      workflowAppId: APP,
      workflowId: 'wf_draft', // the draft Workflow row, never a published one
      nodeId: WAIT_ID,
      inputs: [{ variableId: 'trigger.subject', value: 'hello' }],
      userId: 'user_1',
      organizationId: ORG,
    })
  })

  it('summarizes the result — status/outputs/error only, never the raw dump', async () => {
    const result = await runNode(makeDb({ nodes: [waitNode()], edges: [] }), {
      ...scope,
      nodeId: WAIT_ID,
    })
    const summary = result._unsafeUnwrap()
    expect(summary).toEqual({
      status: 'succeeded',
      outputs: { paused_at: '2026-08-14T00:00:00.000Z' },
      error: null,
      elapsedTime: 0.42,
    })
    expect(summary).not.toHaveProperty('processData')
    expect(summary).not.toHaveProperty('executionMetadata')
  })

  it('surfaces a failed run with its per-field validation errors', async () => {
    runSingleNode.mockResolvedValue({
      id: 'exec_2',
      status: 'failed',
      outputs: null,
      error: 'Validation failed',
      elapsedTime: 0.1,
      executionMetadata: {
        validationError: { fields: [{ field: 'to', message: 'Recipient is required' }] },
      },
    })
    const result = await runNode(makeDb({ nodes: [waitNode()], edges: [] }), {
      ...scope,
      nodeId: WAIT_ID,
    })
    const summary = result._unsafeUnwrap()
    expect(summary.status).toBe('failed')
    expect(summary.error).toBe('Validation failed')
    expect(summary.validationErrors).toEqual([{ field: 'to', message: 'Recipient is required' }])
  })

  it('errors when the app has no draft, and on an unresolvable node ref', async () => {
    const noDraft = await runNode(makeDb({ nodes: [], edges: [] }, { noDraft: true }), {
      ...scope,
      nodeId: WAIT_ID,
    })
    expect(noDraft.isErr()).toBe(true)
    expect(noDraft._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)

    const badRef = await runNode(makeDb({ nodes: [waitNode()], edges: [] }), {
      ...scope,
      nodeId: 'No Such Node',
    })
    expect(badRef.isErr()).toBe(true)
    expect(runSingleNode).not.toHaveBeenCalled()
  })

  it('maps executor throws to typed AuxxErrors, never a bare throw', async () => {
    runSingleNode.mockRejectedValue(new Error('Node not found in workflow'))
    const result = await runNode(makeDb({ nodes: [waitNode()], edges: [] }), {
      ...scope,
      nodeId: WAIT_ID,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)

    runSingleNode.mockRejectedValue(new Error('boom'))
    const crashed = await runNode(makeDb({ nodes: [waitNode()], edges: [] }), {
      ...scope,
      nodeId: WAIT_ID,
    })
    expect(crashed._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(crashed._unsafeUnwrapErr().message).toContain('boom')
  })
})

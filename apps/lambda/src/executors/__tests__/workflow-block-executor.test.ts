// apps/lambda/src/executors/__tests__/workflow-block-executor.test.ts

/**
 * Regression tests for the workflow-block executor's tool dispatch.
 *
 * Router-style blocks delegate to internal tools via `ctx.runTool(toolId)`,
 * which resolves off `globalThis.__AUXX_TOOLS__`. The bundle keeps that registry
 * as a function-local const, so the executor must lift it onto the global before
 * invoking the block and clear it afterward. These tests pin that contract — the
 * dispatch path that previously threw "Tool not found" for every tool id.
 */

import { assertEquals } from 'jsr:@std/assert'
import { executeWorkflowBlock } from '../workflow-block-executor.ts'

/**
 * A minimal fake server bundle. Defines a router block whose `execute` dispatches
 * to an internal tool via `ctx.runTool`, plus the `__AUXX_TOOLS__` registry the
 * real generated bundle emits. Both are top-level consts so the executor's
 * appended `return { __AUXX_WORKFLOW_BLOCKS__, __AUXX_TOOLS__ }` can lift them.
 */
const FAKE_BUNDLE = `
  const __AUXX_TOOLS__ = {
    t_echo: { execute: (input) => ({ ok: true, echo: input }) },
  };
  const __AUXX_WORKFLOW_BLOCKS__ = {
    demo: {
      execute: async (input, ctx) => {
        return await ctx.runTool(input.toolId, { value: input.value });
      },
    },
  };
`

const workflowContext = {
  workflowId: 'wf_test',
  executionId: 'exec_test',
  nodeId: 'node_test',
  variables: {},
  user: { id: 'u1', email: 'test@example.com', name: 'Test' },
  organization: { id: 'org1', handle: 'acme', name: 'Acme' },
}

const runtimeContext = {
  organizationId: 'org1',
  organizationHandle: 'acme',
  app: { installationId: 'inst1' },
  user: { id: 'u1', email: 'test@example.com', name: 'Test' },
}

Deno.test('workflow block dispatches to an internal tool via runTool', async () => {
  const result = await executeWorkflowBlock({
    type: 'workflow-block',
    blockId: 'demo',
    bundleCode: FAKE_BUNDLE,
    workflowContext,
    workflowInput: { toolId: 't_echo', value: 42 },
    context: runtimeContext,
    timeout: 5000,
    memoryLimit: 128,
  })

  assertEquals(result.result, { ok: true, echo: { value: 42 } })
})

Deno.test('tool registry is cleared from global scope after execution', async () => {
  await executeWorkflowBlock({
    type: 'workflow-block',
    blockId: 'demo',
    bundleCode: FAKE_BUNDLE,
    workflowContext,
    workflowInput: { toolId: 't_echo', value: 1 },
    context: runtimeContext,
    timeout: 5000,
    memoryLimit: 128,
  })

  assertEquals((globalThis as { __AUXX_TOOLS__?: unknown }).__AUXX_TOOLS__, undefined)
})

Deno.test('unmapped tool id surfaces a structured runtime error, not a throw', async () => {
  const result = await executeWorkflowBlock({
    type: 'workflow-block',
    blockId: 'demo',
    bundleCode: FAKE_BUNDLE,
    workflowInput: { toolId: 't_missing', value: 1 },
    workflowContext,
    context: runtimeContext,
    timeout: 5000,
    memoryLimit: 128,
  })

  assertEquals(result.result, null)
  assertEquals(result.metadata?.runtimeError?.message, 'Tool not found: t_missing')
  // Global is cleaned up even on the error path.
  assertEquals((globalThis as { __AUXX_TOOLS__?: unknown }).__AUXX_TOOLS__, undefined)
})

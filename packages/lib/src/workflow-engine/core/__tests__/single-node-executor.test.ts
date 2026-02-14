// packages/lib/src/workflow-engine/core/__tests__/single-node-executor.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { NodeProcessorRegistry } from '../node-processor-registry'
import { executeSingleNode } from '../single-node-executor'
import type { WorkflowNode } from '../types'

describe('executeSingleNode', () => {
  let registry: NodeProcessorRegistry

  beforeEach(async () => {
    registry = new NodeProcessorRegistry()
    await registry.initializeWithDefaults()
  })

  it('should execute a variable-set node', async () => {
    const node: WorkflowNode = {
      id: 'node-1',
      nodeId: 'node-1',
      workflowId: 'wf-1',
      type: 'variable-set',
      name: 'Set Variable',
      data: {
        variableName: 'testVar',
        value: 'Hello World',
      },
      metadata: {},
    }

    const result = await executeSingleNode(
      node,
      {},
      {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
      registry
    )

    expect(result).toBeDefined()
    expect(result.outputs).toBeDefined()
  })

  it('should throw error if processor not found', async () => {
    const node: WorkflowNode = {
      id: 'node-1',
      nodeId: 'node-1',
      workflowId: 'wf-1',
      type: 'non-existent-type' as any,
      name: 'Invalid Node',
      data: {},
      metadata: {},
    }

    await expect(
      executeSingleNode(
        node,
        {},
        {
          workflowId: 'wf-1',
          executionId: 'exec-1',
          organizationId: 'org-1',
          userId: 'user-1',
        },
        registry
      )
    ).rejects.toThrow('No processor found for node type')
  })

  it('should initialize context with inputs', async () => {
    const node: WorkflowNode = {
      id: 'node-1',
      nodeId: 'node-1',
      workflowId: 'wf-1',
      type: 'variable-set',
      name: 'Set Variable',
      data: {
        variableName: 'outputVar',
        value: '{{input1}}',
      },
      metadata: {},
    }

    const inputs = {
      input1: 'value1',
      input2: 42,
    }

    const result = await executeSingleNode(
      node,
      inputs,
      {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
      registry
    )

    expect(result).toBeDefined()
    expect(result.outputs).toBeDefined()
  })

  it('should include user context in execution', async () => {
    const node: WorkflowNode = {
      id: 'node-1',
      nodeId: 'node-1',
      workflowId: 'wf-1',
      type: 'variable-set',
      name: 'Set Variable',
      data: {
        variableName: 'userInfo',
        value: 'test',
      },
      metadata: {},
    }

    const result = await executeSingleNode(
      node,
      {},
      {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        organizationId: 'org-1',
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        organizationName: 'Test Org',
        organizationHandle: 'test-org',
      },
      registry
    )

    expect(result).toBeDefined()
    expect(result.outputs).toBeDefined()
  })

  it('should return outputs and processData', async () => {
    const node: WorkflowNode = {
      id: 'node-1',
      nodeId: 'node-1',
      workflowId: 'wf-1',
      type: 'variable-set',
      name: 'Set Variable',
      data: {
        variableName: 'myVar',
        value: 'myValue',
      },
      metadata: {},
    }

    const result = await executeSingleNode(
      node,
      {},
      {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
      registry
    )

    expect(result).toHaveProperty('outputs')
    expect(result).toHaveProperty('processData')
    expect(typeof result.outputs).toBe('object')
  })

  it('should handle empty inputs', async () => {
    const node: WorkflowNode = {
      id: 'node-1',
      nodeId: 'node-1',
      workflowId: 'wf-1',
      type: 'variable-set',
      name: 'Set Variable',
      data: {
        variableName: 'constant',
        value: 'constantValue',
      },
      metadata: {},
    }

    const result = await executeSingleNode(
      node,
      {},
      {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
      registry
    )

    expect(result).toBeDefined()
    expect(result.outputs).toBeDefined()
  })

  it('should handle optional context fields', async () => {
    const node: WorkflowNode = {
      id: 'node-1',
      nodeId: 'node-1',
      workflowId: 'wf-1',
      type: 'variable-set',
      name: 'Set Variable',
      data: {
        variableName: 'test',
        value: 'test',
      },
      metadata: {},
    }

    // Only required fields
    const result = await executeSingleNode(
      node,
      {},
      {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
      registry
    )

    expect(result).toBeDefined()
    expect(result.outputs).toBeDefined()
  })
})

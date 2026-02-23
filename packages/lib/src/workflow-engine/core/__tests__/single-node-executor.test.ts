// packages/lib/src/workflow-engine/core/__tests__/single-node-executor.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeProcessorRegistry } from '../node-processor-registry'
import { executeSingleNode } from '../single-node-executor'
import type { WorkflowNode } from '../types'
import { NodeRunningStatus, WorkflowNodeType } from '../types'

/**
 * Mock processor for variable-set nodes used in tests
 * Avoids pulling in all default processors and their server-only dependencies
 */
class MockVariableSetProcessor {
  readonly type = WorkflowNodeType.VARIABLE_SET

  async preprocessNode(node: WorkflowNode) {
    const config = node.data
    const variables = config.variables || {}

    // Simple preprocessing: treat variableName/value as a single variable
    if (config.variableName) {
      return {
        inputs: {
          resolvedVariables: { [config.variableName]: config.value },
          failedVariables: [],
          stopOnError: true,
        },
        metadata: { nodeType: 'variable-set', totalVariables: 1 },
      }
    }

    return {
      inputs: {
        resolvedVariables: variables,
        failedVariables: [],
        stopOnError: true,
      },
      metadata: { nodeType: 'variable-set', totalVariables: Object.keys(variables).length },
    }
  }

  async execute(node: WorkflowNode, contextManager: any, preprocessedData?: any) {
    const inputs = preprocessedData?.inputs
    const setVariables: Record<string, any> = {}

    if (inputs?.resolvedVariables) {
      for (const [key, value] of Object.entries(inputs.resolvedVariables)) {
        contextManager.setVariable(key, value)
        setVariables[key] = value
      }
    }

    return {
      nodeId: node.nodeId,
      status: NodeRunningStatus.Succeeded,
      output: { variablesSet: setVariables, variableCount: Object.keys(setVariables).length },
      processData: { resolvedVariables: setVariables },
      outputHandle: 'source',
      executionTime: 0,
    }
  }

  async validate() {
    return { valid: true, errors: [], warnings: [] }
  }
}

describe('executeSingleNode', () => {
  let registry: NodeProcessorRegistry

  beforeEach(() => {
    registry = new NodeProcessorRegistry()
    registry.registerProcessor(new MockVariableSetProcessor())
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

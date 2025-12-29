// packages/lib/src/workflow-engine/nodes/transform-nodes/__tests__/list-processor.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import { ListProcessor } from '../list-processor'
import { WorkflowNodeType, NodeRunningStatus } from '../../../core/types'
import { ExecutionContextManager } from '../../../core/execution-context'
import type { WorkflowNode } from '../../../core/types'

/**
 * Create a mock workflow node for testing
 */
function createMockListNode(operation: string, config: any): WorkflowNode {
  return {
    id: 'test-node',
    workflowId: 'test-workflow',
    nodeId: 'test-node',
    type: WorkflowNodeType.LIST,
    name: 'Test List Node',
    description: 'Test node for list operations',
    data: {
      id: 'test-node',
      type: 'list',
      operation,
      inputList: 'testList',
      ...config,
    },
    metadata: {},
  }
}

/**
 * Create a mock execution context manager
 */
function createMockContext(variables: Record<string, any> = {}): ExecutionContextManager {
  const context = new ExecutionContextManager({
    workflowRunId: 'test-run',
    workflowId: 'test-workflow',
    organizationId: 'test-org',
    currentNodeId: 'test-node',
    logger: {
      log: () => {},
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    } as any,
  })

  // Set variables
  Object.entries(variables).forEach(([key, value]) => {
    context.setVariable(key, value)
  })

  return context
}

describe('ListProcessor - Sort Operation', () => {
  let processor: ListProcessor

  beforeEach(() => {
    processor = new ListProcessor()
  })

  describe('Single Field Sort', () => {
    it('should sort by a simple field ascending', async () => {
      const input = [
        { name: 'Charlie', age: 30 },
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 35 },
      ]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'name',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result).toBeDefined()
      expect(result.output?.result[0].name).toBe('Alice')
      expect(result.output?.result[1].name).toBe('Bob')
      expect(result.output?.result[2].name).toBe('Charlie')
    })

    it('should sort by a simple field descending', async () => {
      const input = [
        { name: 'Charlie', age: 30 },
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 35 },
      ]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'age',
          direction: 'desc',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result[0].age).toBe(35)
      expect(result.output?.result[1].age).toBe(30)
      expect(result.output?.result[2].age).toBe(25)
    })

    it('should sort by nested field path (relation subfield)', async () => {
      const input = [
        { id: 1, contact: { name: 'Zoe', email: 'zoe@example.com' } },
        { id: 2, contact: { name: 'Alice', email: 'alice@example.com' } },
        { id: 3, contact: { name: 'Mike', email: 'mike@example.com' } },
      ]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'contact.name',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result[0].contact.name).toBe('Alice')
      expect(result.output?.result[1].contact.name).toBe('Mike')
      expect(result.output?.result[2].contact.name).toBe('Zoe')
    })

    it('should handle null values with nullHandling: first', async () => {
      const input = [
        { name: 'Bob', age: 30 },
        { name: 'Alice', age: null },
        { name: 'Charlie', age: 25 },
      ]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'age',
          direction: 'asc',
          nullHandling: 'first',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result[0].name).toBe('Alice') // null first
      expect(result.output?.result[1].name).toBe('Charlie') // 25
      expect(result.output?.result[2].name).toBe('Bob') // 30
    })

    it('should handle null values with nullHandling: last (default)', async () => {
      const input = [
        { name: 'Bob', age: 30 },
        { name: 'Alice', age: null },
        { name: 'Charlie', age: 25 },
      ]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'age',
          direction: 'asc',
          nullHandling: 'last',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result[0].name).toBe('Charlie') // 25
      expect(result.output?.result[1].name).toBe('Bob') // 30
      expect(result.output?.result[2].name).toBe('Alice') // null last
    })

    it('should handle deep nested paths', async () => {
      const input = [
        { ticket: { contact: { company: { name: 'Zeta Corp' } } } },
        { ticket: { contact: { company: { name: 'Alpha Inc' } } } },
        { ticket: { contact: { company: { name: 'Beta LLC' } } } },
      ]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'ticket.contact.company.name',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result[0].ticket.contact.company.name).toBe('Alpha Inc')
      expect(result.output?.result[1].ticket.contact.company.name).toBe('Beta LLC')
      expect(result.output?.result[2].ticket.contact.company.name).toBe('Zeta Corp')
    })

    it('should fail validation if no field specified', async () => {
      const input = [
        { name: 'Charlie', age: 30 },
        { name: 'Alice', age: 25 },
      ]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: '',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })

      // Should fail validation because field is required
      await expect(processor.execute(node, context)).rejects.toThrow('Sort field is required')
    })

    it('should handle missing nested fields gracefully', async () => {
      const input = [
        { id: 1, contact: { name: 'Alice' } },
        { id: 2, contact: null }, // Missing contact
        { id: 3, contact: { name: 'Charlie' } },
      ]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'contact.name',
          direction: 'asc',
          nullHandling: 'last',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result[0].contact.name).toBe('Alice')
      expect(result.output?.result[1].contact.name).toBe('Charlie')
      expect(result.output?.result[2].contact).toBeNull() // null last
    })

    it('should handle numeric sorting correctly', async () => {
      const input = [{ id: 100 }, { id: 20 }, { id: 3 }, { id: 1000 }]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'id',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result[0].id).toBe(3)
      expect(result.output?.result[1].id).toBe(20)
      expect(result.output?.result[2].id).toBe(100)
      expect(result.output?.result[3].id).toBe(1000)
    })

    it('should handle string sorting with case sensitivity', async () => {
      const input = [{ name: 'zebra' }, { name: 'Apple' }, { name: 'banana' }, { name: 'Cherry' }]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'name',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      // localeCompare handles case-insensitive sorting
      expect(result.output?.result[0].name).toBe('Apple')
      expect(result.output?.result[1].name).toBe('banana')
      expect(result.output?.result[2].name).toBe('Cherry')
      expect(result.output?.result[3].name).toBe('zebra')
    })
  })

  describe('Validation', () => {
    it('should return error if field is missing', async () => {
      const node = createMockListNode('sort', {
        sortConfig: {
          direction: 'asc',
        },
      })

      const result = await processor.validate(node)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.toLowerCase().includes('sort field'))).toBe(true)
    })

    it('should pass validation with valid config', async () => {
      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'name',
          direction: 'asc',
        },
      })

      const result = await processor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate operation is required', async () => {
      const node = createMockListNode('', {})
      delete node.data.operation

      const result = await processor.validate(node)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.toLowerCase().includes('operation'))).toBe(true)
    })

    it('should validate input list is required', async () => {
      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'name',
          direction: 'asc',
        },
      })
      node.data.inputList = ''

      const result = await processor.validate(node)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.toLowerCase().includes('input list'))).toBe(true)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty array', async () => {
      const input: any[] = []

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'name',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result).toEqual([])
    })

    it('should handle single item array', async () => {
      const input = [{ name: 'Alice', age: 25 }]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'name',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result).toEqual(input)
    })

    it('should handle all null values', async () => {
      const input = [
        { name: 'Alice', age: null },
        { name: 'Bob', age: null },
        { name: 'Charlie', age: null },
      ]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'age',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result).toHaveLength(3)
    })

    it('should not modify original array', async () => {
      const input = [
        { name: 'Charlie', age: 30 },
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 35 },
      ]

      const originalCopy = JSON.parse(JSON.stringify(input))

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'name',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })
      await processor.execute(node, context)

      // Verify original array is unchanged
      expect(input).toEqual(originalCopy)
    })

    it('should handle undefined values like null', async () => {
      const input = [
        { name: 'Bob', age: 30 },
        { name: 'Alice', age: undefined },
        { name: 'Charlie', age: 25 },
      ]

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'age',
          direction: 'asc',
          nullHandling: 'last',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result[0].name).toBe('Charlie') // 25
      expect(result.output?.result[1].name).toBe('Bob') // 30
      expect(result.output?.result[2].name).toBe('Alice') // undefined last
    })
  })

  describe('Error Handling', () => {
    it('should fail if input is not an array', async () => {
      const input = { name: 'Not an array' }

      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'name',
          direction: 'asc',
        },
      })

      const context = createMockContext({ testList: input })
      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Failed)
      expect(result.error).toBeDefined()
      expect(result.error?.toLowerCase()).toContain('not an array')
    })

    it('should handle missing input variable gracefully', async () => {
      const node = createMockListNode('sort', {
        sortConfig: {
          field: 'name',
          direction: 'asc',
        },
      })

      const context = createMockContext({}) // No testList variable

      const result = await processor.execute(node, context)

      // Should fail because input list is required
      expect(result.status).toBe(NodeRunningStatus.Failed)
    })
  })
})

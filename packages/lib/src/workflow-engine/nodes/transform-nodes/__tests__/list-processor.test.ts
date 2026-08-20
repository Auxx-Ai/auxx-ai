// packages/lib/src/workflow-engine/nodes/transform-nodes/__tests__/list-processor.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { ALL_OPERATOR_KEYS } from '../../../../conditions/operator-definitions'
import { ExecutionContextManager } from '../../../core/execution-context'
import type { WorkflowNode } from '../../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../../core/types'
import { ListProcessor } from '../list-processor'

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
  const context = new ExecutionContextManager('test-workflow', 'test-run', 'test-org')

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

/**
 * Build a filter condition in the shape the builder's condition panel emits.
 */
function createCondition(
  fieldId: string,
  operator: string,
  value?: any,
  extra: Record<string, any> = {}
) {
  return { id: `${fieldId}-${operator}`, fieldId, operator, value, isConstant: true, ...extra }
}

/**
 * Run the filter operation over `items` and return the surviving items.
 */
async function runFilter(
  items: any[],
  conditions: any[],
  filterConfigExtras: Record<string, any> = {}
): Promise<any[]> {
  const processor = new ListProcessor()
  const node = createMockListNode('filter', {
    filterConfig: { conditions, ...filterConfigExtras },
  })
  const result = await processor.execute(node, createMockContext({ testList: items }))

  expect(result.status).toBe(NodeRunningStatus.Succeeded)
  return result.output?.result as any[]
}

/**
 * Assert an operator keeps the item it should match and drops the one it should not.
 */
async function expectOperatorSelects(
  operator: string,
  matching: any,
  notMatching: any,
  compareValue?: any
) {
  const survivors = await runFilter(
    [
      { id: 'yes', value: matching },
      { id: 'no', value: notMatching },
    ],
    [createCondition('value', operator, compareValue)]
  )

  expect(survivors.map((item) => item.id)).toEqual(['yes'])
}

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS)

/**
 * A workflow file variable, as the FILE operators expect it.
 */
function createFile(overrides: Record<string, any> = {}) {
  return {
    id: 'file-1',
    fileId: 'file-1',
    assetId: 'asset-1',
    versionId: 'version-1',
    filename: 'notes.txt',
    mimeType: 'text/plain',
    size: 1024,
    url: 'https://example.com/notes.txt',
    nodeId: 'upload-1',
    uploadedAt: new Date(),
    ...overrides,
  }
}

const MB = 1024 * 1024

/**
 * Every operator the builder's list filter panel can offer, with a value that must
 * match and a value that must not. The panel derives its operator options straight
 * from OPERATOR_DEFINITIONS (`getOperatorsForFieldType` / `getOperatorsForBaseType`),
 * so this table is asserted to be exhaustive below.
 */
const OPERATOR_CASES: Array<{
  operator: string
  matching: any
  notMatching: any
  compareValue?: any
}> = [
  // EQUALITY
  { operator: 'is', matching: 'Open', notMatching: 'Closed', compareValue: 'open' },
  { operator: 'is not', matching: 'Closed', notMatching: 'Open', compareValue: 'Open' },

  // COMPARISON
  { operator: '>', matching: 10, notMatching: 3, compareValue: 5 },
  { operator: '<', matching: 3, notMatching: 10, compareValue: 5 },
  { operator: '>=', matching: 5, notMatching: 4, compareValue: 5 },
  { operator: '<=', matching: 5, notMatching: 6, compareValue: 5 },

  // STRING
  {
    operator: 'contains',
    matching: 'Urgent request',
    notMatching: 'all good',
    compareValue: 'URGENT',
  },
  {
    operator: 'not contains',
    matching: 'all good',
    notMatching: 'urgent request',
    compareValue: 'urgent',
  },
  {
    operator: 'starts with',
    matching: 'Refund me please',
    notMatching: 'please refund me',
    compareValue: 'refund',
  },
  {
    operator: 'ends with',
    matching: 'please refund',
    notMatching: 'refund please',
    compareValue: 'refund',
  },

  // SET
  { operator: 'in', matching: 'high', notMatching: 'low', compareValue: ['HIGH', 'medium'] },
  { operator: 'not in', matching: 'low', notMatching: 'high', compareValue: ['high', 'medium'] },

  // DATE
  {
    operator: 'before',
    matching: new Date(2020, 0, 1),
    notMatching: new Date(2030, 0, 1),
    compareValue: new Date(2025, 0, 1),
  },
  {
    operator: 'after',
    matching: new Date(2030, 0, 1),
    notMatching: new Date(2020, 0, 1),
    compareValue: new Date(2025, 0, 1),
  },
  {
    operator: 'on_date',
    matching: new Date(2025, 5, 15, 9),
    notMatching: new Date(2025, 5, 16, 9),
    compareValue: new Date(2025, 5, 15, 18),
  },
  {
    operator: 'not_on_date',
    matching: new Date(2025, 5, 16, 9),
    notMatching: new Date(2025, 5, 15, 9),
    compareValue: new Date(2025, 5, 15, 18),
  },
  { operator: 'within_days', matching: daysAgo(2), notMatching: daysAgo(30), compareValue: 7 },
  { operator: 'older_than_days', matching: daysAgo(30), notMatching: daysAgo(1), compareValue: 7 },
  { operator: 'today', matching: new Date(), notMatching: daysAgo(3) },
  { operator: 'yesterday', matching: daysAgo(1), notMatching: new Date() },
  { operator: 'this_week', matching: new Date(), notMatching: daysAgo(60) },
  { operator: 'this_month', matching: new Date(), notMatching: daysAgo(60) },

  // EXISTENCE
  { operator: 'empty', matching: '', notMatching: 'something' },
  { operator: 'not empty', matching: 'something', notMatching: '' },

  // ARRAY
  { operator: 'length =', matching: [1, 2], notMatching: [1], compareValue: 2 },
  { operator: 'length >', matching: [1, 2, 3], notMatching: [1], compareValue: 2 },
  { operator: 'length <', matching: [1], notMatching: [1, 2, 3], compareValue: 2 },
  { operator: 'length >=', matching: [1, 2], notMatching: [1], compareValue: 2 },
  { operator: 'length <=', matching: [1], notMatching: [1, 2, 3], compareValue: 1 },

  // OBJECT
  {
    operator: 'has key',
    matching: { sku: 'A1' },
    notMatching: { name: 'A1' },
    compareValue: 'sku',
  },
  {
    operator: 'key equals',
    matching: { status: 'open' },
    notMatching: { status: 'closed' },
    compareValue: 'status:open',
  },

  // FILE
  {
    operator: 'is_valid',
    matching: createFile(),
    notMatching: createFile({ filename: '  ' }),
  },
  {
    operator: 'is_invalid',
    matching: createFile({ filename: '  ' }),
    notMatching: createFile(),
  },
  {
    operator: 'uploaded_today',
    matching: createFile(),
    notMatching: createFile({ uploadedAt: daysAgo(5) }),
  },
  {
    operator: 'uploaded_within_days',
    matching: createFile({ uploadedAt: daysAgo(2) }),
    notMatching: createFile({ uploadedAt: daysAgo(40) }),
    compareValue: 7,
  },
  {
    operator: 'matches_pattern',
    matching: createFile({ filename: 'invoice-903.pdf' }),
    notMatching: createFile({ filename: 'notes.txt' }),
    compareValue: '^invoice',
  },
  {
    operator: 'contains_numbers',
    matching: createFile({ filename: 'report7.pdf' }),
    notMatching: createFile({ filename: 'report.pdf' }),
  },
  {
    operator: 'contains_date',
    matching: createFile({ filename: 'report-2024-01-02.pdf' }),
    notMatching: createFile({ filename: 'report.pdf' }),
  },
  {
    operator: 'has_version',
    matching: createFile({ filename: 'app-v2.zip' }),
    notMatching: createFile({ filename: 'app.zip' }),
  },
  {
    operator: 'is_office_document',
    matching: createFile({ filename: 'contract.docx' }),
    notMatching: createFile({ filename: 'contract.txt' }),
  },
  {
    operator: 'is_image_format',
    matching: createFile({ filename: 'logo.png' }),
    notMatching: createFile({ filename: 'logo.txt' }),
  },
  {
    operator: 'is_text_format',
    matching: createFile({ filename: 'notes.txt' }),
    notMatching: createFile({ filename: 'notes.png' }),
  },
  {
    operator: 'is_compressed',
    matching: createFile({ filename: 'bundle.zip' }),
    notMatching: createFile({ filename: 'bundle.txt' }),
  },
  {
    operator: 'is_executable',
    matching: createFile({ filename: 'installer.exe' }),
    notMatching: createFile({ filename: 'installer.txt' }),
  },
  {
    operator: 'within_size_limit',
    matching: createFile({ size: 1 * MB }),
    notMatching: createFile({ size: 20 * MB }),
    compareValue: 5,
  },
  {
    operator: 'exceeds_limit',
    matching: createFile({ size: 20 * MB }),
    notMatching: createFile({ size: 1 * MB }),
    compareValue: 5,
  },
]

/**
 * Mail-search scope operators. They live in OPERATOR_DEFINITIONS but describe a
 * mailbox scope rather than an item value, so they never select a list item.
 */
const SCOPE_OPERATORS = ['this_mailbox', 'everywhere']

describe('ListProcessor - Filter Operation', () => {
  describe('Operator vocabulary (registry keys emitted by the builder)', () => {
    it('handles every operator OPERATOR_DEFINITIONS exposes', () => {
      const covered = new Set([...OPERATOR_CASES.map((c) => c.operator), ...SCOPE_OPERATORS])
      const uncovered = ALL_OPERATOR_KEYS.filter((key) => !covered.has(key))

      expect(uncovered).toEqual([])
    })

    it.each(
      OPERATOR_CASES.map((c) => [c.operator, c] as const)
    )('"%s" keeps matching items and drops the rest', async (_operator, testCase) => {
      await expectOperatorSelects(
        testCase.operator,
        testCase.matching,
        testCase.notMatching,
        testCase.compareValue
      )
    })

    it.each(SCOPE_OPERATORS)('scope operator "%s" matches nothing', async (operator) => {
      const survivors = await runFilter(
        [
          { id: 'a', value: 'x' },
          { id: 'b', value: 'y' },
        ],
        [createCondition('value', operator)]
      )

      expect(survivors).toEqual([])
    })

    it('does not silently drop everything for the builder default operator', async () => {
      // Regression: the processor used to switch on `equals`/`greater_than`/`is_empty`
      // while the builder emitted `is`/`>`/`empty`, so every filter returned [].
      const survivors = await runFilter(
        [
          { id: 'a', status: 'open' },
          { id: 'b', status: 'closed' },
        ],
        [createCondition('status', 'is', 'open')]
      )

      expect(survivors.map((item) => item.id)).toEqual(['a'])
    })

    it('refuses to run an operator the registry does not define', async () => {
      // `equals` is the legacy vocabulary — no longer a registry key. It must fail
      // loudly instead of evaluating to "no match" for every item.
      const processor = new ListProcessor()
      const node = createMockListNode('filter', {
        filterConfig: { conditions: [createCondition('status', 'equals', 'open')] },
      })
      const context = createMockContext({ testList: [{ id: 'a', status: 'open' }] })

      await expect(processor.execute(node, context)).rejects.toThrow('Unknown operator "equals"')
    })

    it('reports an unknown operator during validation', async () => {
      const processor = new ListProcessor()
      const node = createMockListNode('filter', {
        filterConfig: { conditions: [createCondition('status', 'equals', 'open')] },
      })

      const result = await processor.validate(node)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Unknown operator "equals"'))).toBe(true)
    })

    it('reports a missing operator during validation', async () => {
      const processor = new ListProcessor()
      const node = createMockListNode('filter', {
        filterConfig: { conditions: [{ id: 'c1', fieldId: 'status', value: 'open' }] },
      })

      const result = await processor.validate(node)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Missing operator'))).toBe(true)
    })
  })

  describe('Value shapes', () => {
    it('matches ANY element of an array-valued field for positive operators', async () => {
      const survivors = await runFilter(
        [
          { id: 'a', tags: ['vip', 'refund'] },
          { id: 'b', tags: ['newsletter'] },
        ],
        [createCondition('tags', 'is', 'refund')]
      )

      expect(survivors.map((item) => item.id)).toEqual(['a'])
    })

    it('requires EVERY element of an array-valued field to satisfy a negated operator', async () => {
      const survivors = await runFilter(
        [
          { id: 'a', tags: ['vip', 'newsletter'] },
          { id: 'b', tags: ['vip', 'refund'] },
        ],
        [createCondition('tags', 'is not', 'refund')]
      )

      expect(survivors.map((item) => item.id)).toEqual(['a'])
    })

    it('treats an empty array, whitespace and an empty object as empty', async () => {
      const survivors = await runFilter(
        [
          { id: 'empty-array', value: [] },
          { id: 'whitespace', value: '   ' },
          { id: 'empty-object', value: {} },
          { id: 'null', value: null },
          { id: 'filled', value: ['x'] },
        ],
        [createCondition('value', 'empty')]
      )

      expect(survivors.map((item) => item.id)).toEqual([
        'empty-array',
        'whitespace',
        'empty-object',
        'null',
      ])
    })

    it('compares RecordId values against the bare instance id', async () => {
      const survivors = await runFilter(
        [
          { id: 'a', contact: 'contact:inst-1' },
          { id: 'b', contact: 'contact:inst-2' },
        ],
        [createCondition('contact', 'is', 'inst-1')]
      )

      expect(survivors.map((item) => item.id)).toEqual(['a'])
    })

    it('reads values out of a custom entity instance fieldValues bag', async () => {
      const survivors = await runFilter(
        [
          { id: 'a', fieldValues: { priority: 'high' } },
          { id: 'b', fieldValues: { priority: 'low' } },
        ],
        [createCondition('ticket:priority', 'is', 'high')]
      )

      expect(survivors.map((item) => item.id)).toEqual(['a'])
    })
  })

  describe('Multi-condition logic (AND / OR)', () => {
    const items = [
      { id: 'both', status: 'open', priority: 'high' },
      { id: 'status-only', status: 'open', priority: 'low' },
      { id: 'priority-only', status: 'closed', priority: 'high' },
      { id: 'neither', status: 'closed', priority: 'low' },
    ]

    const conditions = [
      createCondition('status', 'is', 'open'),
      createCondition('priority', 'is', 'high'),
    ]

    it('defaults to AND when nothing declares the logic', async () => {
      const survivors = await runFilter(items, conditions)

      expect(survivors.map((item) => item.id)).toEqual(['both'])
    })

    it('honours the per-condition logicalOperator the builder writes (AND)', async () => {
      const survivors = await runFilter(items, [
        conditions[0],
        { ...conditions[1], logicalOperator: 'AND' },
      ])

      expect(survivors.map((item) => item.id)).toEqual(['both'])
    })

    it('honours the per-condition logicalOperator the builder writes (OR)', async () => {
      const survivors = await runFilter(items, [
        conditions[0],
        { ...conditions[1], logicalOperator: 'OR' },
      ])

      expect(survivors.map((item) => item.id)).toEqual(['both', 'status-only', 'priority-only'])
    })

    it('honours the node-level filterConfig.logic key (OR)', async () => {
      const survivors = await runFilter(items, conditions, { logic: 'OR' })

      expect(survivors.map((item) => item.id)).toEqual(['both', 'status-only', 'priority-only'])
    })

    it('honours the node-level filterConfig.logic key (AND)', async () => {
      const survivors = await runFilter(items, conditions, { logic: 'AND' })

      expect(survivors.map((item) => item.id)).toEqual(['both'])
    })

    it('accepts lowercase logic values', async () => {
      const survivors = await runFilter(items, conditions, { logic: 'or' })

      expect(survivors.map((item) => item.id)).toEqual(['both', 'status-only', 'priority-only'])
    })

    it('prefers the node-level logic key over the per-condition marker', async () => {
      const survivors = await runFilter(
        items,
        [conditions[0], { ...conditions[1], logicalOperator: 'OR' }],
        { logic: 'AND' }
      )

      expect(survivors.map((item) => item.id)).toEqual(['both'])
    })

    it('rejects a filter with no conditions rather than passing the list through', async () => {
      const processor = new ListProcessor()
      const node = createMockListNode('filter', { filterConfig: { conditions: [] } })
      const context = createMockContext({ testList: items })

      await expect(processor.execute(node, context)).rejects.toThrow(
        'At least one condition is required'
      )
    })
  })

  describe('Case sensitivity', () => {
    // There is no per-condition case-sensitivity writer in the builder, so the
    // processor no longer reads a `caseSensitive` key: string comparisons are always
    // case-insensitive, matching conditions/evaluate.ts.
    it('compares equality case-insensitively', async () => {
      const survivors = await runFilter(
        [
          { id: 'a', status: 'OPEN' },
          { id: 'b', status: 'closed' },
        ],
        [createCondition('status', 'is', 'open')]
      )

      expect(survivors.map((item) => item.id)).toEqual(['a'])
    })

    it('compares substrings case-insensitively', async () => {
      const survivors = await runFilter(
        [
          { id: 'a', subject: 'URGENT: refund' },
          { id: 'b', subject: 'newsletter' },
        ],
        [createCondition('subject', 'contains', 'urgent')]
      )

      expect(survivors.map((item) => item.id)).toEqual(['a'])
    })

    it('ignores a stale caseSensitive flag on a condition', async () => {
      const survivors = await runFilter(
        [
          { id: 'a', status: 'OPEN' },
          { id: 'b', status: 'closed' },
        ],
        [createCondition('status', 'is', 'open', { caseSensitive: true })]
      )

      expect(survivors.map((item) => item.id)).toEqual(['a'])
    })
  })
})

/**
 * Run any list operation and hand back both halves of the node's contract: the
 * `output` recorded on the execution row for the trace UI, and the variable
 * store the picker's `<nodeId>.<path>` references actually resolve against.
 *
 * They are NOT the same place — a value that only ever reaches `output` is
 * unreachable from a downstream node — so every assertion below checks the store.
 */
async function runOperation(operation: string, config: Record<string, any>, items: any[]) {
  const processor = new ListProcessor()
  const node = createMockListNode(operation, config)
  const context = createMockContext({ testList: items })
  const result = await processor.execute(node, context)

  return {
    result,
    output: result.output,
    variable: (path: string) => context.getVariable(`test-node.${path}`),
  }
}

describe('ListProcessor - published output variables', () => {
  const items = [
    { id: 'a', status: 'open' },
    { id: 'b', status: 'closed' },
    { id: 'c', status: 'open' },
  ]

  it('publishes `result` into the variable store, not just the trace output', async () => {
    const { result, variable } = await runOperation('reverse', {}, items)

    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    expect(await variable('result')).toEqual([items[2], items[1], items[0]])
  })

  // `output-variables.ts` advertises `<nodeId>.count` for exactly these three
  // operations. Each one is asserted against the STORE because the write used to
  // go through a computed `Object.entries(metadata)` loop, which publishes fine
  // but is invisible to the parity reader — the reason `variable:list.count` was
  // filed as drift.
  describe('count — advertised for the three operations that change the item count', () => {
    it('filter publishes the surviving item count', async () => {
      const { output, variable } = await runOperation(
        'filter',
        { filterConfig: { conditions: [createCondition('status', 'is', 'open')] } },
        items
      )

      expect(await variable('count')).toBe(2)
      expect(output?.count).toBe(2)
    })

    it('unique publishes the deduplicated item count', async () => {
      const { output, variable } = await runOperation(
        'unique',
        { uniqueConfig: { by: 'field', field: 'status' } },
        items
      )

      expect(await variable('count')).toBe(2)
      expect(output?.count).toBe(2)
    })

    it('slice publishes the sliced item count', async () => {
      const { variable } = await runOperation(
        'slice',
        { sliceConfig: { mode: 'first', count: 2, isCountConstant: true } },
        items
      )

      expect(await variable('count')).toBe(2)
    })

    it('slice publishes 1 when it collapses to a single item', async () => {
      const { output, variable } = await runOperation(
        'slice',
        { sliceConfig: { mode: 'first', count: 1, isCountConstant: true } },
        items
      )

      expect(output?.result).toEqual(items[0])
      expect(await variable('count')).toBe(1)
    })
  })

  // The other four operations do not advertise `count`, so publishing one would
  // be the mirror-image bug: a variable the engine writes that the picker never
  // offers, wired to nothing.
  describe('count — not published for the operations that do not advertise it', () => {
    it.each([
      ['sort', { sortConfig: { field: 'id', direction: 'asc' } }],
      ['join', { joinConfig: { delimiter: ', ', field: 'id' } }],
      ['pluck', { pluckConfig: { field: 'id' } }],
      ['reverse', {}],
    ])('%s omits count', async (operation, config) => {
      const { result, output, variable } = await runOperation(operation, config, items)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(output).not.toHaveProperty('count')
      expect(await variable('count')).toBeUndefined()
    })
  })
})

describe('ListProcessor - Unique operation', () => {
  const items = [
    { id: 'a', email: 'Ada@Example.com' },
    { id: 'b', email: 'ada@example.com' },
    { id: 'c', email: 'grace@example.com' },
  ]

  // The panel's switch reads `config?.caseSensitive ?? true` and `panel.tsx`
  // seeds `{ by: 'whole', keepFirst: true, caseSensitive: true }` the moment the
  // operation is chosen — so an ABSENT key has to mean case-sensitive here, or
  // the toggle the user sees means the opposite of what the engine does.
  it('treats an absent caseSensitive as case-SENSITIVE, matching the panel default', async () => {
    const { output } = await runOperation(
      'unique',
      { uniqueConfig: { by: 'field', field: 'email' } },
      items
    )

    expect(output?.result.map((item: any) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('honours caseSensitive: true', async () => {
    const { output } = await runOperation(
      'unique',
      { uniqueConfig: { by: 'field', field: 'email', caseSensitive: true } },
      items
    )

    expect(output?.result.map((item: any) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('honours caseSensitive: false', async () => {
    const { output } = await runOperation(
      'unique',
      { uniqueConfig: { by: 'field', field: 'email', caseSensitive: false } },
      items
    )

    expect(output?.result.map((item: any) => item.id)).toEqual(['a', 'c'])
  })

  it('keeps the last occurrence when keepFirst is false', async () => {
    const { output } = await runOperation(
      'unique',
      { uniqueConfig: { by: 'field', field: 'email', caseSensitive: false, keepFirst: false } },
      items
    )

    expect(output?.result.map((item: any) => item.id)).toEqual(['b', 'c'])
  })
})

describe('ListProcessor - the operation surface is exactly what the builder offers', () => {
  const processor = new ListProcessor()

  // `find` / `map` / `reduce` / `group` / `flatten` survived as commented-out
  // switch arms with live `findConfig` / `mapConfig` reads in
  // `extractRequiredVariables` and `validateNodeConfig`. There is no panel, no
  // config interface and no output-variable inference for any of them on the
  // builder side, so they were removed rather than finished — these pin that the
  // node now fails loudly instead of advertising them.
  it.each([
    'find',
    'map',
    'reduce',
    'group',
    'flatten',
  ])('fails with Unknown operation for the removed `%s` operation', async (operation) => {
    const { result } = await runOperation('' + operation, {}, [{ id: 'a' }])

    expect(result.status).toBe(NodeRunningStatus.Failed)
    expect(result.error).toContain(`Unknown operation: ${operation}`)
    expect(result.outputHandle).toBe('fail')
  })

  it('no longer treats findConfig as a source of required variables', async () => {
    const node = createMockListNode('find', {
      inputList: '{{upstream.items}}',
      findConfig: { conditions: [createCondition('status', 'is', '{{upstream.status}}')] },
    })

    expect((processor as any).extractRequiredVariables(node)).toEqual(['upstream.items'])
  })

  it('no longer treats mapConfig.template as a source of required variables', async () => {
    const node = createMockListNode('map', {
      inputList: '{{upstream.items}}',
      mapConfig: { mode: 'template', template: '{{upstream.greeting}}' },
    })

    expect((processor as any).extractRequiredVariables(node)).toEqual(['upstream.items'])
  })

  it('still extracts variables from the filter conditions it does support', async () => {
    const node = createMockListNode('filter', {
      inputList: '{{upstream.items}}',
      filterConfig: { conditions: [createCondition('status', 'is', '{{upstream.status}}')] },
    })

    expect((processor as any).extractRequiredVariables(node)).toEqual([
      'upstream.items',
      'upstream.status',
    ])
  })

  it('validates a unique node by its own config, with no find branch left', async () => {
    const valid = await (processor as any).validateNodeConfig(
      createMockListNode('unique', { uniqueConfig: { by: 'field', field: 'email' } })
    )
    expect(valid.valid).toBe(true)

    const invalid = await (processor as any).validateNodeConfig(
      createMockListNode('unique', { uniqueConfig: { by: 'field' } })
    )
    expect(invalid.errors).toContain('Unique field is required when deduplicating by field')
  })
})

/**
 * The step-4 acceptance criterion (plan 21, PR B). `list` used to return
 * `outputHandle: 'error'` on failure — a handle no manifest declared and no
 * canvas could wire, so the run died. A `list` node with no stored
 * `error_strategy` (every row that predates the opt-in) must still die.
 */
describe('ListProcessor - failure policy', () => {
  it('a node with no stored error_strategy fails onto the declared `fail` handle', async () => {
    // `fail` resolves from the catalog-wide default. The node never rendered
    // the handle, so no edge can address it, `findFailureEdge` finds nothing
    // and `workflow-engine.ts` throws — the pre-opt-in outcome exactly.
    const { result } = await runOperation('nope', {}, [{ id: 'a' }])
    expect(result.status).toBe(NodeRunningStatus.Failed)
    expect(result.outputHandle).toBe('fail')
  })

  it('`continue` succeeds on `source` with a null result instead', async () => {
    const { result, variable } = await runOperation('nope', { error_strategy: 'continue' }, [
      { id: 'a' },
    ])
    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    expect(result.outputHandle).toBe('source')
    // `result` is published so `{{list_1.result}}` still resolves downstream
    // rather than dangling; it is the only variable this node advertises.
    expect(await variable('result')).toBeNull()
  })
})

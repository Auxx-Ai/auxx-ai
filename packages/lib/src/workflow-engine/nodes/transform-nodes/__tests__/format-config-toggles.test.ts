// packages/lib/src/workflow-engine/nodes/transform-nodes/__tests__/format-config-toggles.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { ExecutionContextManager } from '../../../core/execution-context'
import type { WorkflowNode } from '../../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../../core/types'
import { FormatProcessor } from '../format-processor'

function createMockNode(
  operation: string,
  input: string,
  config: Record<string, any> = {}
): WorkflowNode {
  return {
    id: 'test-node',
    workflowId: 'test-workflow',
    nodeId: 'test-node',
    type: WorkflowNodeType.FORMAT,
    name: 'Test Format Node',
    description: 'Test node for format config toggles',
    data: {
      id: 'test-node',
      type: 'format',
      title: 'Test Format Node',
      operation,
      input,
      ...config,
    },
    metadata: {},
  }
}

function createMockContext(variables: Record<string, any> = {}): ExecutionContextManager {
  const context = new ExecutionContextManager('test-workflow', 'test-run', 'test-org')
  Object.entries(variables).forEach(([key, value]) => context.setVariable(key, value))
  return context
}

/**
 * The panel exposes a constant/variable toggle on exactly four format config fields:
 * `trimConfig.trimAll`, `replaceConfig.replaceAll`, `currencyConfig.currencyCode` and
 * `stripHtmlConfig.keepLineBreaks`. Their mode is stored in `data.fieldModes`.
 */
describe('FormatProcessor — moded config fields', () => {
  let processor: FormatProcessor

  beforeEach(() => {
    processor = new FormatProcessor()
  })

  describe('trimConfig.trimAll', () => {
    it('honours a constant true', async () => {
      const node = createMockNode('trim', '  hello   world  ', { trimConfig: { trimAll: true } })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello world')
    })

    it('resolves a bound variable', async () => {
      const node = createMockNode('trim', '  hello   world  ', {
        trimConfig: { trimAll: 'upstream.collapse' },
        fieldModes: { trimAll: false },
      })
      const context = createMockContext({ 'upstream.collapse': true })
      const result = await processor.execute(node, context)
      expect(result.output?.result).toBe('hello world')
    })

    it('a bound variable resolving to false keeps internal whitespace', async () => {
      const node = createMockNode('trim', '  hello   world  ', {
        trimConfig: { trimAll: 'upstream.collapse' },
        fieldModes: { trimAll: false },
      })
      const context = createMockContext({ 'upstream.collapse': false })
      const result = await processor.execute(node, context)
      expect(result.output?.result).toBe('hello   world')
    })

    it('a variable-mode value is not read as a truthy string', async () => {
      // Before the fix a raw "upstream.collapse" string was truthy and always collapsed.
      const node = createMockNode('trim', '  hello   world  ', {
        trimConfig: { trimAll: 'upstream.missing' },
        fieldModes: { trimAll: false },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello   world')
    })
  })

  describe('replaceConfig.replaceAll', () => {
    it('honours a constant false', async () => {
      const node = createMockNode('replace', 'foo foo foo', {
        replaceConfig: { find: 'foo', replaceWith: 'bar', replaceAll: false },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('bar foo foo')
    })

    it('resolves a bound variable', async () => {
      const node = createMockNode('replace', 'foo foo foo', {
        replaceConfig: { find: 'foo', replaceWith: 'bar', replaceAll: 'upstream.all' },
        fieldModes: { replaceAll: false },
      })
      const context = createMockContext({ 'upstream.all': true })
      const result = await processor.execute(node, context)
      expect(result.output?.result).toBe('bar bar bar')
    })

    it('accepts a "true" string from an interpolated variable', async () => {
      const node = createMockNode('replace', 'foo foo', {
        replaceConfig: { find: 'foo', replaceWith: 'bar', replaceAll: '{{upstream.all}}' },
        fieldModes: { replaceAll: false },
      })
      const context = createMockContext({ 'upstream.all': 'true' })
      const result = await processor.execute(node, context)
      expect(result.output?.result).toBe('bar bar')
    })
  })

  describe('currencyConfig.currencyCode', () => {
    it('honours a constant code, treating the input as MINOR UNITS', async () => {
      // The input is an integer count of minor units — the platform-wide
      // CURRENCY convention. This op used to apply no scaling at all, so a
      // stored value rendered 10^exponent high while every other reader
      // divided.
      const node = createMockNode('currency', '123450', {
        currencyConfig: { locale: 'en-US', currencyCode: 'USD' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toContain('1,234.50')
      expect(result.output?.result).toContain('$')
    })

    it('takes the scale from the code, not a hardcoded 100', async () => {
      // JPY has exponent 0: 1000 minor units is ¥1,000, not ¥10.00.
      const node = createMockNode('currency', '1000', {
        currencyConfig: { locale: 'en-US', currencyCode: 'JPY' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toContain('1,000')
      expect(result.output?.result).not.toContain('10.00')
    })

    it('resolves a bound variable', async () => {
      const node = createMockNode('currency', '123450', {
        currencyConfig: { locale: 'en-US', currencyCode: 'shopify_get_order.order.currency' },
        fieldModes: { currencyCode: false },
      })
      const context = createMockContext({ 'shopify_get_order.order.currency': 'EUR' })
      const result = await processor.execute(node, context)
      expect(result.output?.result).toContain('€')
    })

    it('falls back to USD when the bound variable is missing instead of throwing', async () => {
      // A raw "node.path" reached Intl.NumberFormat before the fix and threw a RangeError.
      const node = createMockNode('currency', '10', {
        currencyConfig: { locale: 'en-US', currencyCode: 'upstream.missing' },
        fieldModes: { currencyCode: false },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result).toContain('$')
    })
  })

  describe('stripHtmlConfig.keepLineBreaks', () => {
    it('defaults to keeping line breaks', async () => {
      const node = createMockNode('strip_html', '<p>hello</p><p>world</p>')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toContain('\n')
    })

    it('resolves a bound variable to false', async () => {
      const node = createMockNode('strip_html', '<p>hello</p><p>world</p>', {
        stripHtmlConfig: { keepLineBreaks: 'upstream.keep' },
        fieldModes: { keepLineBreaks: false },
      })
      const context = createMockContext({ 'upstream.keep': false })
      const result = await processor.execute(node, context)
      expect(result.output?.result).toBe('helloworld')
    })

    it('resolves a bound variable to true', async () => {
      const node = createMockNode('strip_html', '<p>hello</p><p>world</p>', {
        stripHtmlConfig: { keepLineBreaks: 'upstream.keep' },
        fieldModes: { keepLineBreaks: false },
      })
      const context = createMockContext({ 'upstream.keep': true })
      const result = await processor.execute(node, context)
      expect(result.output?.result).toContain('\n')
    })
  })

  describe('variable-mode fields are declared as dependencies', () => {
    it('declares an interpolated toggle variable', () => {
      const node = createMockNode('replace', 'foo', {
        replaceConfig: { find: 'foo', replaceWith: 'bar', replaceAll: '{{upstream.all}}' },
        fieldModes: { replaceAll: false },
      })
      const required = (processor as any).extractRequiredVariables(node) as string[]
      expect(required).toContain('upstream.all')
    })

    it('does not declare a constant-mode value', () => {
      const node = createMockNode('currency', '1', {
        currencyConfig: { currencyCode: 'USD' },
      })
      const required = (processor as any).extractRequiredVariables(node) as string[]
      expect(required).toEqual([])
    })
  })

  /**
   * `shopify-order-lookup` depends on this: a failed order lookup must yield `result: ''`
   * so the email-match condition fails and the run takes the "Not Found" branch.
   */
  describe('load-bearing behaviour for shopify-order-lookup', () => {
    it('lowercase of a missing variable resolves to an empty result', async () => {
      const node = createMockNode('lowercase', '{{shopify_get_order.order.email}}')
      const context = createMockContext()
      const result = await processor.execute(node, context)
      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result).toBe('')
      expect(await context.getVariable('test-node.result')).toBe('')
    })

    it('lowercase of a present variable normalizes it and writes result', async () => {
      const node = createMockNode('lowercase', '{{shopify_get_order.order.email}}')
      const context = createMockContext({
        'shopify_get_order.order.email': 'Buyer@Example.COM',
      })
      const result = await processor.execute(node, context)
      expect(result.output?.result).toBe('buyer@example.com')
      expect(await context.getVariable('test-node.result')).toBe('buyer@example.com')
    })
  })
})

// packages/lib/src/workflow-engine/nodes/transform-nodes/__tests__/format-processor.test.ts

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
    description: 'Test node for format operations',
    data: {
      id: 'test-node',
      type: 'format',
      operation,
      input,
      ...config,
    },
    metadata: {},
  }
}

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

  Object.entries(variables).forEach(([key, value]) => {
    context.setVariable(key, value)
  })

  return context
}

describe('FormatProcessor', () => {
  let processor: FormatProcessor

  beforeEach(() => {
    processor = new FormatProcessor()
  })

  // --- General ---

  describe('General', () => {
    it('combine passes through input as-is', async () => {
      const node = createMockNode('combine', 'Hello John, order #123')
      const result = await processor.execute(node, createMockContext())
      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result).toBe('Hello John, order #123')
    })
  })

  // --- Text Case ---

  describe('Text Case', () => {
    it('uppercase', async () => {
      const node = createMockNode('uppercase', 'hello world')
      const result = await processor.execute(node, createMockContext())
      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result).toBe('HELLO WORLD')
    })

    it('lowercase', async () => {
      const node = createMockNode('lowercase', 'Hello World')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello world')
    })

    it('title_case', async () => {
      const node = createMockNode('title_case', 'hello world foo')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('Hello World Foo')
    })

    it('sentence_case', async () => {
      const node = createMockNode('sentence_case', 'hello. bye. ok')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('Hello. Bye. Ok')
    })

    it('camel_case', async () => {
      const node = createMockNode('camel_case', 'hello world')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('helloWorld')
    })

    it('camel_case from kebab', async () => {
      const node = createMockNode('camel_case', 'hello-world-foo')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('helloWorldFoo')
    })

    it('snake_case', async () => {
      const node = createMockNode('snake_case', 'Hello World')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello_world')
    })

    it('snake_case from camelCase', async () => {
      const node = createMockNode('snake_case', 'helloWorld')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello_world')
    })

    it('kebab_case', async () => {
      const node = createMockNode('kebab_case', 'Hello World')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello-world')
    })
  })

  // --- Trim & Pad ---

  describe('Trim & Pad', () => {
    it('trim basic', async () => {
      const node = createMockNode('trim', '  hello  ')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello')
    })

    it('trim with trimAll collapses internal whitespace', async () => {
      const node = createMockNode('trim', '  hello   world  ', { trimConfig: { trimAll: true } })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello world')
    })

    it('pad_start', async () => {
      const node = createMockNode('pad_start', '42', { padConfig: { length: 6, character: '0' } })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('000042')
    })

    it('pad_end', async () => {
      const node = createMockNode('pad_end', 'hi', { padConfig: { length: 5, character: '.' } })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hi...')
    })

    it('pad_start defaults to space', async () => {
      const node = createMockNode('pad_start', 'hi', { padConfig: { length: 5 } })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('   hi')
    })
  })

  // --- Truncate & Wrap ---

  describe('Truncate & Wrap', () => {
    it('truncate with default suffix', async () => {
      const node = createMockNode('truncate', 'Hello World', {
        truncateConfig: { maxLength: 5 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('Hello...')
    })

    it('truncate with custom suffix', async () => {
      const node = createMockNode('truncate', 'Hello World', {
        truncateConfig: { maxLength: 5, suffix: '~' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('Hello~')
    })

    it('truncate does nothing when input is shorter', async () => {
      const node = createMockNode('truncate', 'Hi', {
        truncateConfig: { maxLength: 10 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('Hi')
    })

    it('wrap with prefix and suffix', async () => {
      const node = createMockNode('wrap', 'world', {
        wrapConfig: { prefix: 'Hello ', suffix: '!' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('Hello world!')
    })

    it('wrap with only prefix', async () => {
      const node = createMockNode('wrap', 'world', {
        wrapConfig: { prefix: '> ' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('> world')
    })
  })

  // --- Find & Replace ---

  describe('Find & Replace', () => {
    it('replace first occurrence', async () => {
      const node = createMockNode('replace', 'foo bar foo', {
        replaceConfig: { find: 'foo', replaceWith: 'baz', replaceAll: false },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('baz bar foo')
    })

    it('replace all occurrences', async () => {
      const node = createMockNode('replace', 'foo bar foo', {
        replaceConfig: { find: 'foo', replaceWith: 'baz', replaceAll: true },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('baz bar baz')
    })

    it('replace with empty find returns input unchanged', async () => {
      const node = createMockNode('replace', 'hello', {
        replaceConfig: { find: '', replaceWith: 'x' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello')
    })

    it('replace_regex', async () => {
      const node = createMockNode('replace_regex', 'abc 123 def 456', {
        replaceRegexConfig: { pattern: '\\d+', replaceWith: '***', flags: 'g' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('abc *** def ***')
    })

    it('replace_regex with empty pattern returns input', async () => {
      const node = createMockNode('replace_regex', 'hello', {
        replaceRegexConfig: { pattern: '', replaceWith: 'x' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello')
    })

    it('remove', async () => {
      const node = createMockNode('remove', 'hello world hello', {
        removeConfig: { find: 'hello' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe(' world ')
    })

    it('remove with empty find returns input', async () => {
      const node = createMockNode('remove', 'hello', { removeConfig: { find: '' } })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello')
    })
  })

  // --- Number Formatting ---

  describe('Number Formatting', () => {
    it('currency USD', async () => {
      const node = createMockNode('currency', '1234.5', {
        currencyConfig: { locale: 'en-US', currencyCode: 'USD' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('$1,234.50')
    })

    it('currency with non-numeric input returns input', async () => {
      const node = createMockNode('currency', 'abc', {
        currencyConfig: { locale: 'en-US', currencyCode: 'USD' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('abc')
    })

    it('percentage', async () => {
      const node = createMockNode('percentage', '0.156', {
        percentageConfig: { decimals: 1 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('15.6%')
    })

    it('percentage with zero decimals', async () => {
      const node = createMockNode('percentage', '0.156', {
        percentageConfig: { decimals: 0 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('16%')
    })

    it('fixed_decimals', async () => {
      const node = createMockNode('fixed_decimals', '3.14159', {
        fixedDecimalsConfig: { decimals: 2 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('3.14')
    })

    it('fixed_decimals with non-numeric returns input', async () => {
      const node = createMockNode('fixed_decimals', 'abc', {
        fixedDecimalsConfig: { decimals: 2 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('abc')
    })

    it('ordinal', async () => {
      const node = createMockNode('ordinal', '1')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('1st')
    })

    it('ordinal 2nd', async () => {
      const node = createMockNode('ordinal', '2')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('2nd')
    })

    it('ordinal 3rd', async () => {
      const node = createMockNode('ordinal', '3')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('3rd')
    })

    it('ordinal 11th (special case)', async () => {
      const node = createMockNode('ordinal', '11')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('11th')
    })

    it('ordinal 21st', async () => {
      const node = createMockNode('ordinal', '21')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('21st')
    })

    it('compact', async () => {
      const node = createMockNode('compact', '1200000', {
        compactConfig: { locale: 'en-US' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('1.2M')
    })
  })

  // --- Encode / Decode ---

  describe('Encode / Decode', () => {
    it('url_encode', async () => {
      const node = createMockNode('url_encode', 'hello world&foo=bar')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello%20world%26foo%3Dbar')
    })

    it('url_decode', async () => {
      const node = createMockNode('url_decode', 'hello%20world%26foo%3Dbar')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello world&foo=bar')
    })

    it('html_encode', async () => {
      const node = createMockNode('html_encode', '<b>hello</b> & "world"')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('&lt;b&gt;hello&lt;/b&gt; &amp; &quot;world&quot;')
    })

    it('html_decode', async () => {
      const node = createMockNode('html_decode', '&lt;b&gt;hello&lt;/b&gt; &amp; &quot;world&quot;')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('<b>hello</b> & "world"')
    })

    it('base64_encode', async () => {
      const node = createMockNode('base64_encode', 'hello')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('aGVsbG8=')
    })

    it('base64_decode', async () => {
      const node = createMockNode('base64_decode', 'aGVsbG8=')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello')
    })

    it('slug', async () => {
      const node = createMockNode('slug', 'Hello World! How are you?')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello-world-how-are-you')
    })

    it('slug with custom separator', async () => {
      const node = createMockNode('slug', 'Hello World!', { slugConfig: { separator: '_' } })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello_world')
    })
  })

  // --- Extract / Parse ---

  describe('Extract / Parse', () => {
    it('substring', async () => {
      const node = createMockNode('substring', 'hello', {
        substringConfig: { start: 1, end: 4 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('ell')
    })

    it('substring with no end uses full length', async () => {
      const node = createMockNode('substring', 'hello', {
        substringConfig: { start: 2 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('llo')
    })

    it('first_n', async () => {
      const node = createMockNode('first_n', 'hello world', {
        firstLastNConfig: { count: 5 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello')
    })

    it('last_n', async () => {
      const node = createMockNode('last_n', 'hello world', {
        firstLastNConfig: { count: 5 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('world')
    })

    it('regex_match extracts first match', async () => {
      const node = createMockNode('regex_match', 'age: 25, height: 180', {
        regexMatchConfig: { pattern: '\\d+', group: 0 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('25')
    })

    it('regex_match with capture group', async () => {
      const node = createMockNode('regex_match', 'name: John', {
        regexMatchConfig: { pattern: 'name: (\\w+)', group: 1 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('John')
    })

    it('regex_match returns empty on no match', async () => {
      const node = createMockNode('regex_match', 'hello', {
        regexMatchConfig: { pattern: '\\d+', group: 0 },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('')
    })

    it('split', async () => {
      const node = createMockNode('split', 'a,b,c', {
        splitConfig: { delimiter: ',' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toEqual(['a', 'b', 'c'])
    })

    it('split with custom delimiter', async () => {
      const node = createMockNode('split', 'hello world foo', {
        splitConfig: { delimiter: ' ' },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toEqual(['hello', 'world', 'foo'])
    })

    it('strip_html', async () => {
      const node = createMockNode('strip_html', '<b>hello</b> <i>world</i>')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello world')
    })

    it('strip_html preserves line breaks from br/p tags', async () => {
      const node = createMockNode('strip_html', '<p>hello</p><p>world</p>', {
        stripHtmlConfig: { keepLineBreaks: true },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toContain('hello')
      expect(result.output?.result).toContain('world')
      expect(result.output?.result).toContain('\n')
    })

    it('strip_html without keeping line breaks', async () => {
      const node = createMockNode('strip_html', '<p>hello</p><br><p>world</p>', {
        stripHtmlConfig: { keepLineBreaks: false },
      })
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('helloworld')
    })
  })

  // --- Edge Cases ---

  describe('Edge Cases', () => {
    it('empty input returns empty for text operations', async () => {
      const node = createMockNode('uppercase', '')
      const result = await processor.execute(node, createMockContext())
      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output?.result).toBe('')
    })

    it('unknown operation returns input unchanged', async () => {
      const node = createMockNode('nonexistent_op', 'hello')
      const result = await processor.execute(node, createMockContext())
      expect(result.output?.result).toBe('hello')
    })

    it('sets node variable on success', async () => {
      const context = createMockContext()
      const node = createMockNode('uppercase', 'hello')
      await processor.execute(node, context)
      const value = await context.getVariable('test-node.result')
      expect(value).toBe('HELLO')
    })

    it('returns source output handle on success', async () => {
      const node = createMockNode('uppercase', 'hello')
      const result = await processor.execute(node, createMockContext())
      expect(result.outputHandle).toBe('source')
    })
  })
})

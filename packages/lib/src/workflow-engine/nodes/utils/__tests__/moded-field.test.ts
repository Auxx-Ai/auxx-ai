// packages/lib/src/workflow-engine/nodes/utils/__tests__/moded-field.test.ts

import { describe, expect, it } from 'vitest'
import { ExecutionContextManager } from '../../../core/execution-context'
import type { WorkflowNode } from '../../../core/types'
import { WorkflowNodeType } from '../../../core/types'
import { FormatProcessor } from '../../transform-nodes/format-processor'
import {
  resolveModedBoolean,
  resolveModedNumber,
  resolveModedString,
  resolveModedValue,
} from '../moded-field'
import { extractVariableRefs, isBareVariablePath, isVariableTemplate } from '../variable-refs'

function createContext(variables: Record<string, unknown> = {}): ExecutionContextManager {
  const context = new ExecutionContextManager('test-workflow', 'test-run', 'test-org')
  for (const [key, value] of Object.entries(variables)) {
    context.setVariable(key, value)
  }
  return context
}

describe('variable-refs — the literal/reference line', () => {
  it('reads a bare picker path as a reference', () => {
    expect(isBareVariablePath('node-1.result')).toBe(true)
    expect(isBareVariablePath('chunker_1.chunkCount')).toBe(true)
    expect(isBareVariablePath('find_1.order.line_items[0]')).toBe(true)
    expect(isBareVariablePath('$loop.item')).toBe(true)
  })

  it('refuses numeric literals — this is the false positive that matters', () => {
    expect(isBareVariablePath('0.5')).toBe(false)
    expect(isBareVariablePath('3.14')).toBe(false)
    expect(isBareVariablePath('1.0e3')).toBe(false)
    expect(isBareVariablePath('-2.5')).toBe(false)
    expect(isBareVariablePath('100')).toBe(false)
  })

  it('refuses single-segment identifiers and prose', () => {
    expect(isBareVariablePath('item')).toBe(false)
    expect(isBareVariablePath('hello world')).toBe(false)
    expect(isBareVariablePath('Mr. Smith')).toBe(false)
  })

  it('separates the two shapes', () => {
    expect(isVariableTemplate('{{node-1.result}}')).toBe(true)
    expect(isVariableTemplate('node-1.result')).toBe(false)
  })

  it('extracts refs from both shapes', () => {
    expect(extractVariableRefs('{{a.b}} and {{c.d}}')).toEqual(['a.b', 'c.d'])
    expect(extractVariableRefs('node-1.result')).toEqual(['node-1.result'])
    expect(extractVariableRefs('0.5')).toEqual([])
    expect(extractVariableRefs(42)).toEqual([])
  })
})

describe('resolveModedValue', () => {
  it('passes a constant straight through', async () => {
    const ctx = createContext({ 'a.b': 'resolved' })
    expect(await resolveModedValue('a.b', true, ctx)).toBe('a.b')
    expect(await resolveModedValue('a.b', undefined, ctx)).toBe('a.b')
  })

  it('resolves a bare path in variable mode', async () => {
    const ctx = createContext({ 'a.b': 'resolved' })
    expect(await resolveModedValue('a.b', false, ctx)).toBe('resolved')
  })

  it('interpolates a template in variable mode', async () => {
    const ctx = createContext({ 'a.b': 'resolved' })
    expect(await resolveModedValue('{{a.b}}!', false, ctx)).toBe('resolved!')
  })

  it('leaves non-strings alone', async () => {
    const ctx = createContext()
    expect(await resolveModedValue(7, false, ctx)).toBe(7)
    expect(await resolveModedValue(true, false, ctx)).toBe(true)
  })
})

describe('resolveModedNumber', () => {
  it('resolves a bare picker path — the bug this fixes', async () => {
    const ctx = createContext({ 'node-1.result': 12 })
    expect(await resolveModedNumber('node-1.result', false, 0, ctx)).toBe(12)
  })

  it('resolves a bare picker path even with no mode flag stored', async () => {
    // Hand-authored and template-installed graphs carry no isConstant flag, and a
    // dotted path can never be a number, so honouring the flag strictly would
    // strand a genuine reference.
    const ctx = createContext({ 'node-1.result': 12 })
    expect(await resolveModedNumber('node-1.result', undefined, 0, ctx)).toBe(12)
    expect(await resolveModedNumber('node-1.result', true, 0, ctx)).toBe(12)
  })

  it('resolves a numeric string coming back from interpolation', async () => {
    const ctx = createContext({ 'node-1.result': '25' })
    expect(await resolveModedNumber('{{node-1.result}}', false, 0, ctx)).toBe(25)
    expect(await resolveModedNumber('node-1.result', false, 0, ctx)).toBe(25)
  })

  it('never reads a decimal literal as a path', async () => {
    const ctx = createContext({ '0': 'nope', '0.5': 'nope' })
    expect(await resolveModedNumber('0.5', true, 1, ctx)).toBe(0.5)
    expect(await resolveModedNumber('0.5', undefined, 1, ctx)).toBe(0.5)
    expect(await resolveModedNumber('3.14', false, 1, ctx)).toBe(3.14)
  })

  it('falls back for an unresolvable path rather than producing NaN', async () => {
    const ctx = createContext()
    expect(await resolveModedNumber('missing.path', false, 7, ctx)).toBe(7)
  })

  it('falls back for non-finite and non-numeric results', async () => {
    const ctx = createContext({ 'a.b': Number.POSITIVE_INFINITY, 'a.c': true, 'a.d': 'abc' })
    expect(await resolveModedNumber('a.b', false, 5, ctx)).toBe(5)
    expect(await resolveModedNumber('a.c', false, 5, ctx)).toBe(5)
    expect(await resolveModedNumber('a.d', false, 5, ctx)).toBe(5)
    expect(await resolveModedNumber('Infinity', true, 5, ctx)).toBe(5)
  })

  it('keeps constant-mode behaviour intact', async () => {
    const ctx = createContext()
    expect(await resolveModedNumber(10, true, 0, ctx)).toBe(10)
    expect(await resolveModedNumber('10', true, 0, ctx)).toBe(10)
    expect(await resolveModedNumber('-4', true, 0, ctx)).toBe(-4)
    expect(await resolveModedNumber(' 8 ', true, 0, ctx)).toBe(8)
    expect(await resolveModedNumber('not a number', true, 3, ctx)).toBe(3)
    expect(await resolveModedNumber(undefined, true, 3, ctx)).toBe(3)
    expect(await resolveModedNumber(null, true, 3, ctx)).toBe(3)
    expect(await resolveModedNumber('', true, 3, ctx)).toBe(3)
  })

  it('resolves a single-segment id only when variable mode says so', async () => {
    const ctx = createContext({ item: 3 })
    expect(await resolveModedNumber('item', false, 0, ctx)).toBe(3)
    expect(await resolveModedNumber('item', true, 0, ctx)).toBe(0)
  })
})

describe('resolveModedString', () => {
  it('trusts the mode flag — a dotted literal stays a literal', async () => {
    const ctx = createContext({ 'shipped.today': 'RESOLVED' })
    expect(await resolveModedString('shipped.today', true, 'x', ctx)).toBe('shipped.today')
    expect(await resolveModedString('shipped.today', undefined, 'x', ctx)).toBe('shipped.today')
    expect(await resolveModedString('shipped.today', false, 'x', ctx)).toBe('RESOLVED')
  })

  it('falls back for empty and unresolvable values', async () => {
    const ctx = createContext()
    expect(await resolveModedString(undefined, false, 'USD', ctx)).toBe('USD')
    expect(await resolveModedString('', false, 'USD', ctx)).toBe('USD')
    expect(await resolveModedString('missing.path', false, 'USD', ctx)).toBe('USD')
  })
})

describe('resolveModedBoolean', () => {
  it('coerces both the real boolean and its interpolated string form', async () => {
    const ctx = createContext({ 'a.real': false, 'a.text': 'false', 'a.on': 'on' })
    expect(await resolveModedBoolean('a.real', false, true, ctx)).toBe(false)
    expect(await resolveModedBoolean('a.text', false, true, ctx)).toBe(false)
    expect(await resolveModedBoolean('{{a.text}}', false, true, ctx)).toBe(false)
    expect(await resolveModedBoolean('a.on', false, false, ctx)).toBe(true)
  })

  it('falls back rather than flipping to true on an unresolvable path', async () => {
    const ctx = createContext()
    expect(await resolveModedBoolean('missing.path', false, false, ctx)).toBe(false)
    expect(await resolveModedBoolean('missing.path', false, true, ctx)).toBe(true)
  })

  it('keeps a literal boolean', async () => {
    const ctx = createContext()
    expect(await resolveModedBoolean(true, true, false, ctx)).toBe(true)
    expect(await resolveModedBoolean(false, true, true, ctx)).toBe(false)
  })
})

// --- End-to-end through the processor that owns the reported victims ---

function formatNode(operation: string, input: string, config: Record<string, any>): WorkflowNode {
  return {
    id: 'fmt',
    workflowId: 'wf',
    nodeId: 'fmt',
    type: WorkflowNodeType.FORMAT,
    name: 'Format',
    description: '',
    data: { id: 'fmt', type: 'format', title: 'Format', operation, input, ...config },
    metadata: {},
  } as WorkflowNode
}

describe("format's variable-mode numeric fields resolve through the base class", () => {
  const processor = new FormatProcessor()

  it('truncate.maxLength', async () => {
    const node = formatNode('truncate', 'abcdefghij', {
      truncateConfig: { maxLength: 'up.len', isMaxLengthConstant: false, suffix: '' },
    })
    const result = await processor.execute(node, createContext({ 'up.len': 4 }))
    expect(result.output?.result).toBe('abcd')
  })

  it('pad_start.length', async () => {
    const node = formatNode('pad_start', 'ab', {
      padConfig: { length: 'up.len', isLengthConstant: false, character: '0' },
    })
    const result = await processor.execute(node, createContext({ 'up.len': 5 }))
    expect(result.output?.result).toBe('000ab')
  })

  it('pad_end.length', async () => {
    const node = formatNode('pad_end', 'ab', {
      padConfig: { length: 'up.len', isLengthConstant: false, character: '0' },
    })
    const result = await processor.execute(node, createContext({ 'up.len': 5 }))
    expect(result.output?.result).toBe('ab000')
  })

  it('substring.start and substring.end', async () => {
    const node = formatNode('substring', 'abcdefghij', {
      substringConfig: {
        start: 'up.start',
        isStartConstant: false,
        end: 'up.end',
        isEndConstant: false,
      },
    })
    const result = await processor.execute(node, createContext({ 'up.start': 2, 'up.end': 5 }))
    expect(result.output?.result).toBe('cde')
  })

  it('first_n.count and last_n.count', async () => {
    const config = { firstLastNConfig: { count: 'up.n', isCountConstant: false } }
    const ctx = createContext({ 'up.n': 3 })
    expect(
      (await processor.execute(formatNode('first_n', 'abcdef', config), ctx)).output?.result
    ).toBe('abc')
    expect(
      (await processor.execute(formatNode('last_n', 'abcdef', config), ctx)).output?.result
    ).toBe('def')
  })

  it('fixed_decimals.decimals', async () => {
    const node = formatNode('fixed_decimals', '3.14159', {
      fixedDecimalsConfig: { decimals: 'up.dp', isDecimalsConstant: false },
    })
    const result = await processor.execute(node, createContext({ 'up.dp': 3 }))
    expect(result.output?.result).toBe('3.142')
  })

  it('percentage.decimals', async () => {
    const node = formatNode('percentage', '0.12345', {
      percentageConfig: { decimals: 'up.dp', isDecimalsConstant: false },
    })
    const result = await processor.execute(node, createContext({ 'up.dp': 2 }))
    expect(result.output?.result).toBe('12.35%')
  })

  it('constant-mode decimals are still read as numbers, not paths', async () => {
    const node = formatNode('fixed_decimals', '3.14159', {
      fixedDecimalsConfig: { decimals: '3', isDecimalsConstant: true },
    })
    const result = await processor.execute(node, createContext())
    expect(result.output?.result).toBe('3.142')
  })
})

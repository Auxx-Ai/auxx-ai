// packages/lib/src/evals/__tests__/tool-examples.test.ts

import { describe, expect, it } from 'vitest'
import type { AgentToolDefinition } from '../../ai/agent-framework/types'
import { getToolExampleOutput } from '../tool-examples'

const stub = (over: Partial<AgentToolDefinition>): AgentToolDefinition => ({
  name: 'tool',
  displayName: 'Tool',
  description: '',
  parameters: {},
  execute: async () => ({ success: true, output: null }),
  ...over,
})

describe('getToolExampleOutput', () => {
  it('returns the declared example when present', () => {
    const example = { id: 'abc', label: 'Widget' }
    expect(getToolExampleOutput(stub({ exampleOutput: example }))).toEqual(example)
  })

  it('returns undefined when the tool has no example', () => {
    expect(getToolExampleOutput(stub({}))).toBeUndefined()
  })
})

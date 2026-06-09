// packages/sdk/src/root/tools/__tests__/define-tool.test.ts

import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { defineTool } from '../define-tool.js'

const baseTool = {
  id: 'get_thing',
  name: 'Get thing',
  description: 'Gets a thing.',
  inputs: z.object({ id: z.string() }),
  outputs: z.object({ id: z.string(), label: z.string() }),
  execute: async () => ({ id: 'x', label: 'y' }),
}

describe('defineTool exampleOutput validation', () => {
  it('accepts a tool with no example', () => {
    expect(() => defineTool(baseTool)).not.toThrow()
  })

  it('accepts an example that satisfies the outputs schema', () => {
    expect(() =>
      defineTool({ ...baseTool, exampleOutput: { id: 'abc', label: 'Widget' } })
    ).not.toThrow()
  })

  it('rejects an example that fails outputs.safeParse', () => {
    expect(() =>
      // Missing required `label`.
      defineTool({ ...baseTool, exampleOutput: { id: 'abc' } as never })
    ).toThrow(/does not satisfy its outputs schema/)
  })

  it('rejects a non-JSON-serializable example (circular ref)', () => {
    const circular: Record<string, unknown> = { id: 'abc', label: 'Widget' }
    circular.self = circular
    expect(() => defineTool({ ...baseTool, exampleOutput: circular as never })).toThrow(
      /not JSON-serializable/
    )
  })
})

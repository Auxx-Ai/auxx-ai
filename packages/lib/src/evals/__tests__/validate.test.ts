// packages/lib/src/evals/__tests__/validate.test.ts

import { describe, expect, it } from 'vitest'
import type { CompiledProcedure } from '../../agents/procedures'
import { collectReferencedToolNames } from '../validate'

const compiled = (steps: CompiledProcedure['steps']): CompiledProcedure => ({
  entryStepId: 's1',
  steps,
  codeBlocks: {},
  subProcedures: {},
  localAttributes: [],
})

const instructionDoc = (toolNames: string[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: toolNames.map((name) => ({ type: 'reference', attrs: { id: `tool:${name}` } })),
    },
  ],
})

describe('collectReferencedToolNames', () => {
  it('collects tool chips from instruction docs across procedures', () => {
    const names = collectReferencedToolNames([
      compiled({
        s1: {
          id: 's1',
          kind: 'instruction',
          doc: instructionDoc(['shopify_find_shopify_order']),
          next: 's2',
        },
        s2: { id: 's2', kind: 'routing', outcome: 'finished', next: null },
      }),
      compiled({
        s1: { id: 's1', kind: 'instruction', doc: instructionDoc(['send_email']), next: null },
      }),
    ])
    expect(names).toEqual(new Set(['shopify_find_shopify_order', 'send_email']))
  })

  it('ignores non-tool chips, malformed nodes, and non-instruction steps', () => {
    const names = collectReferencedToolNames([
      compiled({
        s1: {
          id: 's1',
          kind: 'instruction',
          doc: {
            type: 'doc',
            content: [
              { type: 'reference', attrs: { id: 'toolset:shopify' } },
              { type: 'reference', attrs: { id: 'entity:contact' } },
              { type: 'reference', attrs: { id: 'tool:' } },
              { type: 'reference' },
              null,
            ],
          },
          next: null,
        },
      }),
    ])
    expect(names.size).toBe(0)
  })
})

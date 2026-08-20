// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/__tests__/list-node-types.test.ts

/**
 * `list_node_types` discovery
 * (`plans/kopilot/workflow/21-branch-authoring-reliability.md` F6).
 *
 * Two defects, one turn. The search was a plain substring match over
 * `id | displayName | description | category`, so `"if else"` (space) missed
 * both `if-else` (hyphen) and `IF/ELSE` (slash), `"switch"` missed entirely,
 * and `category: 'flow_control'` returned only `loop` because if-else is
 * `condition`. And an empty result came back `success: false`, which reads as a
 * TOOL FAILURE, so the model reworded instead of accepting the answer — four
 * iterations before it landed on the one-character query `"if"`.
 */

import { describe, expect, it } from 'vitest'
import { createListNodeTypesTool } from '../list-node-types'

const tool = createListNodeTypesTool(() => ({}) as never)

async function search(args: Record<string, unknown>) {
  const result = await tool.execute(args, {} as never)
  return result as { success: boolean; output: { types: Array<{ type: string }>; note?: string } }
}

/** The type ids a query returns. */
async function typesFor(query: string): Promise<string[]> {
  return (await search({ query })).output.types.map((t) => t.type)
}

describe('list_node_types — the natural branching queries hit', () => {
  it.each([
    'if else',
    'if/else',
    'IF ELSE',
    'switch',
    'branch',
    'route',
    'condition',
    'if',
  ])('query %j finds if-else', async (query) => {
    expect(await typesFor(query)).toContain('if-else')
  })

  it('finds the other branching types by the words people use for them', async () => {
    expect(await typesFor('classify')).toContain('text-classifier')
    expect(await typesFor('for each')).toContain('loop')
    expect(await typesFor('approval')).toContain('human-confirmation')
  })

  it('does not display synonyms — they are a search key, not output', async () => {
    const rows = (await search({ query: 'switch' })).output.types
    expect(rows.every((row) => !('synonyms' in row))).toBe(true)
  })
})

describe('list_node_types — an empty result is an ANSWER, not a failure', () => {
  it('returns success with an empty list and a terminal note', async () => {
    const result = await search({ query: 'quantum-blockchain' })
    expect(result.success).toBe(true)
    expect(result.output.types).toEqual([])
    expect(result.output.note).toContain('quantum-blockchain')
    expect(result.output.note).toContain('a reworded query will not change the answer')
    expect(result.output.note).toContain('list_app_blocks')
  })

  it('keeps the digest honest for an empty result', () => {
    expect(tool.buildDigest?.({ types: [] })).toEqual({
      label: 'Node types listed',
      resultCount: 0,
    })
  })
})

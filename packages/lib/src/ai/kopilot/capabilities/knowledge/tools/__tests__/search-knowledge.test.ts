// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/__tests__/search-knowledge.test.ts

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const searchSpy = vi.fn()
vi.mock('../../../../../../datasets/services/search.service', () => ({
  SearchService: { search: (...args: unknown[]) => searchSpy(...args) },
}))

import type { ToolContext } from '../../../../../agent-framework/tool-context'
import { createSearchKnowledgeTool } from '../search-knowledge'

/**
 * Fake drizzle handle that records which tables `.from()` touched and resolves
 * `.where()` to table-specific rows. Enough to exercise the dataset-resolution
 * branches without a real DB. KnowledgeBase rows expose `datasetId` (the
 * PUBLIC-clamp path); Dataset rows expose `id` (the managed / RAG path).
 */
function makeFakeDb(fromTables: unknown[]) {
  return {
    select: () => ({
      from: (table: unknown) => {
        fromTables.push(table)
        const rows =
          table === schema.KnowledgeBase ? [{ datasetId: 'ds_public' }] : [{ id: 'ds_managed' }]
        return { where: () => Promise.resolve(rows) }
      },
    }),
  }
}

function runTool(db: unknown, ctx: Partial<ToolContext>) {
  const tool = createSearchKnowledgeTool(() => ({ db }) as never)
  const fullCtx = { organizationId: 'org_1', userId: 'u_1', ...ctx } as ToolContext
  return tool.execute({ query: 'how do I cancel' }, fullCtx)
}

beforeEach(() => {
  searchSpy.mockReset()
  searchSpy.mockResolvedValue({ results: [], total: 0, metrics: {} })
})

describe('search_knowledge chat clamp', () => {
  it('is marked externalSafe (offered on chat by default)', () => {
    const tool = createSearchKnowledgeTool(() => ({}) as never)
    expect(tool.externalSafe).toBe(true)
    // Default `surfaces` (absent) ⇒ offered everywhere, including chat.
    expect(tool.surfaces).toBeUndefined()
  })

  it('with a chat subject, searches only PUBLIC knowledge-base datasets (no RAG)', async () => {
    const fromTables: unknown[] = []
    await runTool(makeFakeDb(fromTables), {
      subject: {
        anchors: { thread: 'thread:t_1', participant: 'participant:p_1' } as never,
        identityVerified: false,
      },
    })

    // The PUBLIC-clamp path queries KnowledgeBase (visibility filter), never
    // the raw Dataset table that would include INTERNAL KBs + RAG uploads.
    expect(fromTables).toContain(schema.KnowledgeBase)
    expect(fromTables).not.toContain(schema.Dataset)
    expect(searchSpy).toHaveBeenCalledTimes(1)
    const searchArgs = searchSpy.mock.calls[0]?.[0] as { datasetIds?: string[] } | undefined
    expect(searchArgs?.datasetIds).toEqual(['ds_public'])
  })

  it('without a subject (internal kopilot), searches all managed + RAG datasets', async () => {
    const fromTables: unknown[] = []
    await runTool(makeFakeDb(fromTables), {})

    // No PUBLIC clamp — the managed Dataset path runs, the KB-visibility path
    // does not.
    expect(fromTables).toContain(schema.Dataset)
    expect(fromTables).not.toContain(schema.KnowledgeBase)
    expect(searchSpy).toHaveBeenCalledTimes(1)
  })
})

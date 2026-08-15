// packages/lib/src/workflow-engine/nodes/dataset/knowledge-retrieval-output.test.ts
//
// The retrieval node's OUTPUT contract (plan 12 §7) plus the two post-filters
// that shape it: `dedupePerDocument` (K8) and `recordIds`.
//
// Covers the KB-provenance fields that make a downstream `answer`/`ai` node able
// to cite an article (`docSlug` → `[Title](auxx://doc/<docSlug>)`) and a `crud`
// node able to link a reply back to it (`articleId`).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../core/execution-context'
import type { WorkflowNode } from '../../core/types'
import { WorkflowNodeType } from '../../core/types'

const search = vi.fn()
vi.mock('../../../datasets/services/search.service', () => ({
  SearchService: { search: (...args: unknown[]) => search(...args) },
}))

import { KnowledgeRetrievalProcessor } from './knowledge-retrieval'

/** A KB-sourced segment, metadata shaped as `KBSyncService` writes it. */
function kbHit(
  overrides: {
    id?: string
    articleId?: string
    documentId?: string
    score?: number
    recordId?: string
  } = {}
) {
  const {
    id = 'seg_1',
    articleId = 'art_1',
    documentId = 'doc_1',
    score = 0.9,
    recordId,
  } = overrides
  return {
    segment: {
      id,
      content: 'Refunds are issued within 5-7 business days.',
      position: 0,
      metadata: {
        source: 'kb',
        articleId,
        articleSlug: 'refund-policy',
        articleSlugPath: 'policies/refund-policy',
        kbId: 'kb_1',
        kbSlug: 'help',
        ...(recordId ? { links: [{ recordId }] } : {}),
      },
      document: {
        id: documentId,
        title: 'Refund policy',
        filename: 'refund-policy.md',
        dataset: { id: 'ds_kb', name: 'Help Center' },
      },
    },
    score,
    rank: 1,
    searchType: 'hybrid',
  }
}

/** A standalone RAG segment — no KB metadata at all. */
function ragHit(overrides: { id?: string; documentId?: string; score?: number } = {}) {
  const { id = 'seg_r', documentId = 'doc_r', score = 0.8 } = overrides
  return {
    segment: {
      id,
      content: 'Uploaded handbook text.',
      position: 3,
      metadata: {},
      document: {
        id: documentId,
        title: 'Handbook',
        filename: 'handbook.pdf',
        dataset: { id: 'ds_rag', name: 'Uploads' },
      },
    },
    score,
    rank: 2,
    searchType: 'vector',
  }
}

function respond(results: unknown[]) {
  search.mockResolvedValue({
    results,
    total: results.length,
    responseTime: 12,
    hasMore: false,
    query: 'refunds',
    searchType: 'hybrid',
  })
}

function node(): WorkflowNode {
  return {
    id: 'n1',
    workflowId: 'wf',
    nodeId: 'n1',
    type: WorkflowNodeType.KNOWLEDGE_RETRIEVAL,
    name: 'Search Knowledge',
    description: '',
    data: { id: 'n1', type: 'knowledge-retrieval', title: 'Search' },
    metadata: {},
  } as unknown as WorkflowNode
}

interface RunOutput {
  results: Array<Record<string, unknown>>
  total: number
  success: boolean
  error?: string
}

/** Drive executeNode directly with a preprocessed payload. */
async function run(inputs: Record<string, unknown>): Promise<{ output: RunOutput }> {
  const processor = new KnowledgeRetrievalProcessor()
  const context = new ExecutionContextManager('wf', 'run', 'org')
  // @ts-expect-error - exercising the protected contract directly
  const result = await processor.executeNode(node(), context, {
    inputs: {
      query: 'refunds',
      datasetIds: ['ds_kb'],
      searchType: 'hybrid',
      limit: 10,
      organizationId: 'org',
      userId: 'user',
      ...inputs,
    },
    metadata: {},
  })
  const output = result.output as RunOutput | undefined
  // A thrown search surfaces as the node's error output, never as a bare
  // undefined — assert rather than optional-chain so a regression is loud.
  if (!output) throw new Error(`executeNode returned no output: ${JSON.stringify(result)}`)
  return { output }
}

/** The `SearchQuery` the node built on the last call. */
function lastQuery(): Record<string, unknown> {
  const call = search.mock.calls.at(-1)
  if (!call) throw new Error('SearchService.search was never called')
  return call[0] as Record<string, unknown>
}

/** First result, asserted present. */
function first(output: RunOutput): Record<string, unknown> {
  const item = output.results[0]
  if (!item) throw new Error('expected at least one result')
  return item
}

beforeEach(() => {
  search.mockReset()
})

describe('KB provenance on results (§7)', () => {
  it('labels a KB hit and builds docSlug from kbSlug + articleSlugPath', async () => {
    respond([kbHit()])
    const { output } = await run({})

    expect(first(output)).toMatchObject({
      source: 'kb',
      articleId: 'art_1',
      articleSlug: 'refund-policy',
      articleSlugPath: 'policies/refund-policy',
      kbId: 'kb_1',
      kbSlug: 'help',
      docSlug: 'help/policies/refund-policy',
    })
  })

  it('labels a RAG hit and omits every article field', async () => {
    respond([ragHit()])
    const { output } = await run({})

    const item = first(output)
    expect(item.source).toBe('rag')
    expect(item).not.toHaveProperty('articleId')
    expect(item).not.toHaveProperty('docSlug')
    expect(item).not.toHaveProperty('kbId')
  })

  it('omits docSlug when the KB metadata is partial', async () => {
    const hit = kbHit()
    // biome-ignore lint/performance/noDelete: modelling a partial metadata row
    delete (hit.segment.metadata as Record<string, unknown>).kbSlug
    respond([hit])

    const { output } = await run({})
    expect(first(output).source).toBe('kb')
    expect(first(output)).not.toHaveProperty('docSlug')
  })

  it('keeps the pre-existing fields untouched', async () => {
    respond([kbHit()])
    const { output } = await run({})

    expect(first(output)).toMatchObject({
      content: 'Refunds are issued within 5-7 business days.',
      score: 0.9,
      rank: 1,
      segmentId: 'seg_1',
      documentId: 'doc_1',
      documentTitle: 'Refund policy',
      datasetId: 'ds_kb',
      datasetName: 'Help Center',
      position: 0,
      searchType: 'hybrid',
    })
  })
})

describe('search query construction', () => {
  it('always requests metadata — the vector lane gates provenance on it', async () => {
    respond([kbHit()])
    await run({})

    expect(lastQuery()).toMatchObject({ includeMetadata: true })
  })

  it('omits similarityThreshold when unset (K7) so the lane default applies', async () => {
    respond([kbHit()])
    await run({ similarityThreshold: undefined })

    expect(lastQuery()).not.toHaveProperty('similarityThreshold')
  })

  it('passes similarityThreshold through when the author set one', async () => {
    respond([kbHit()])
    await run({ similarityThreshold: 0.55 })

    expect(lastQuery()).toMatchObject({ similarityThreshold: 0.55 })
  })

  it('does not over-fetch when nothing will post-filter', async () => {
    respond([kbHit()])
    await run({ limit: 10 })

    expect(lastQuery()).toMatchObject({ limit: 10 })
  })

  it('over-fetches when a post-filter will cut the list', async () => {
    respond([kbHit()])
    await run({ limit: 10, dedupePerDocument: true })

    // max(10*3, 15) capped at 50
    expect(lastQuery()).toMatchObject({ limit: 30 })
  })
})

describe('dedupePerDocument (K8)', () => {
  it('keeps only the best passage per article', async () => {
    respond([
      kbHit({ id: 'seg_1', articleId: 'art_1', score: 0.9 }),
      kbHit({ id: 'seg_2', articleId: 'art_1', score: 0.8 }),
      kbHit({ id: 'seg_3', articleId: 'art_2', score: 0.7 }),
    ])

    const { output } = await run({ dedupePerDocument: true })

    expect(output.results.map((r) => r.segmentId)).toEqual(['seg_1', 'seg_3'])
  })

  it('falls back to documentId for RAG segments, which carry no articleId', async () => {
    respond([
      ragHit({ id: 'seg_a', documentId: 'doc_1', score: 0.9 }),
      ragHit({ id: 'seg_b', documentId: 'doc_1', score: 0.8 }),
      ragHit({ id: 'seg_c', documentId: 'doc_2', score: 0.7 }),
    ])

    const { output } = await run({ dedupePerDocument: true })

    expect(output.results.map((r) => r.segmentId)).toEqual(['seg_a', 'seg_c'])
  })

  it('returns raw segments when off — existing nodes keep their behaviour', async () => {
    respond([
      kbHit({ id: 'seg_1', articleId: 'art_1' }),
      kbHit({ id: 'seg_2', articleId: 'art_1' }),
    ])

    const { output } = await run({ dedupePerDocument: false })

    expect(output.results).toHaveLength(2)
  })

  it('trims to the requested limit after deduping', async () => {
    respond([
      kbHit({ id: 'seg_1', articleId: 'art_1' }),
      kbHit({ id: 'seg_2', articleId: 'art_2' }),
      kbHit({ id: 'seg_3', articleId: 'art_3' }),
    ])

    const { output } = await run({ limit: 2, dedupePerDocument: true })

    expect(output.results.map((r) => r.segmentId)).toEqual(['seg_1', 'seg_2'])
  })
})

describe('recordIds filter', () => {
  it('keeps only segments linked to one of the given records', async () => {
    respond([
      kbHit({ id: 'seg_1', articleId: 'art_1', recordId: 'rec_1' }),
      kbHit({ id: 'seg_2', articleId: 'art_2', recordId: 'rec_2' }),
      kbHit({ id: 'seg_3', articleId: 'art_3' }), // no links at all
    ])

    const { output } = await run({ recordIds: ['rec_2'] })

    expect(output.results.map((r) => r.segmentId)).toEqual(['seg_2'])
  })

  it('drops segments with no links when a filter is active', async () => {
    respond([ragHit({ id: 'seg_r' })])

    const { output } = await run({ recordIds: ['rec_1'] })

    expect(output.results).toHaveLength(0)
  })

  it('is inert when no records are given', async () => {
    respond([kbHit({ id: 'seg_1' }), ragHit({ id: 'seg_r' })])

    const { output } = await run({ recordIds: [] })

    expect(output.results).toHaveLength(2)
  })
})

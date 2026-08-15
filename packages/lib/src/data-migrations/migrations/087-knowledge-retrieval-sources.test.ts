// packages/lib/src/data-migrations/migrations/087-knowledge-retrieval-sources.test.ts

import { describe, expect, it } from 'vitest'
import { rewriteGraph, rewriteKnowledgeRetrievalNode } from './087-knowledge-retrieval-sources'

describe('rewriteKnowledgeRetrievalNode — reshape', () => {
  it('maps datasets[] to dataset-kind sources[] and drops the old key', () => {
    const data: Record<string, unknown> = {
      type: 'knowledge-retrieval',
      datasets: [{ datasetId: 'ds_1' }, { datasetId: 'ds_2' }],
    }
    expect(rewriteKnowledgeRetrievalNode(data)).toBe(true)
    expect(data.sources).toEqual([
      { kind: 'dataset', datasetId: 'ds_1' },
      { kind: 'dataset', datasetId: 'ds_2' },
    ])
    expect(data.datasets).toBeUndefined()
  })

  it('renames the positional fieldModes keys, preserving index and value', () => {
    const data: Record<string, unknown> = {
      type: 'knowledge-retrieval',
      datasets: [{ datasetId: 'ds_1' }, { datasetId: '{{find_1.record}}' }],
      fieldModes: {
        query: false,
        'datasets.0.datasetId': true,
        'datasets.1.datasetId': false,
      },
    }
    rewriteKnowledgeRetrievalNode(data)
    expect(data.fieldModes).toEqual({
      query: false,
      'sources.0.datasetId': true,
      'sources.1.datasetId': false,
    })
  })

  it('keeps a variable-bound dataset id verbatim', () => {
    const data: Record<string, unknown> = {
      type: 'knowledge-retrieval',
      datasets: [{ datasetId: '{{find_1.record}}' }],
    }
    rewriteKnowledgeRetrievalNode(data)
    expect(data.sources).toEqual([{ kind: 'dataset', datasetId: '{{find_1.record}}' }])
  })

  it('handles an empty datasets array', () => {
    const data: Record<string, unknown> = { type: 'knowledge-retrieval', datasets: [] }
    expect(rewriteKnowledgeRetrievalNode(data)).toBe(true)
    expect(data.sources).toEqual([])
  })

  it('leaves other node types alone', () => {
    const data: Record<string, unknown> = { type: 'find', datasets: [{ datasetId: 'ds_1' }] }
    expect(rewriteKnowledgeRetrievalNode(data)).toBe(false)
    expect(data.datasets).toEqual([{ datasetId: 'ds_1' }])
  })
})

describe('rewriteKnowledgeRetrievalNode — limit clamp (K9)', () => {
  it('clamps a literal limit above the ceiling', () => {
    const data: Record<string, unknown> = { type: 'knowledge-retrieval', limit: 100 }
    expect(rewriteKnowledgeRetrievalNode(data)).toBe(true)
    expect(data.limit).toBe(25)
  })

  it('leaves a limit at or below the ceiling untouched', () => {
    const data: Record<string, unknown> = { type: 'knowledge-retrieval', limit: 20 }
    expect(rewriteKnowledgeRetrievalNode(data)).toBe(false)
    expect(data.limit).toBe(20)
  })

  it('leaves a variable-bound limit alone — it is range-checked at run time', () => {
    const data: Record<string, unknown> = {
      type: 'knowledge-retrieval',
      limit: '{{trigger_1.limit}}',
    }
    expect(rewriteKnowledgeRetrievalNode(data)).toBe(false)
    expect(data.limit).toBe('{{trigger_1.limit}}')
  })

  it('clamps even when the node ALREADY carries sources — the guards are independent', () => {
    // The reshape is skipped for an already-migrated node; if the clamp rode
    // that branch, a stored limit of 100 would survive and fail the node's own
    // configSchema.
    const data: Record<string, unknown> = {
      type: 'knowledge-retrieval',
      sources: [{ kind: 'kb', knowledgeBaseId: 'kb_1' }],
      limit: 100,
    }
    expect(rewriteKnowledgeRetrievalNode(data)).toBe(true)
    expect(data.limit).toBe(25)
    expect(data.sources).toEqual([{ kind: 'kb', knowledgeBaseId: 'kb_1' }])
  })
})

describe('rewriteKnowledgeRetrievalNode — idempotency', () => {
  it('a second pass changes nothing', () => {
    const data: Record<string, unknown> = {
      type: 'knowledge-retrieval',
      datasets: [{ datasetId: 'ds_1' }],
      limit: 100,
      fieldModes: { 'datasets.0.datasetId': true },
    }
    expect(rewriteKnowledgeRetrievalNode(data)).toBe(true)
    const afterFirst = JSON.parse(JSON.stringify(data))
    expect(rewriteKnowledgeRetrievalNode(data)).toBe(false)
    expect(data).toEqual(afterFirst)
  })

  it('does not resurrect datasets on a node that never had them', () => {
    const data: Record<string, unknown> = {
      type: 'knowledge-retrieval',
      sources: [{ kind: 'kb', knowledgeBaseId: 'kb_1' }],
    }
    expect(rewriteKnowledgeRetrievalNode(data)).toBe(false)
    expect(data.datasets).toBeUndefined()
  })
})

describe('rewriteGraph', () => {
  it('counts only the nodes it touched', () => {
    const graph = {
      nodes: [
        { data: { type: 'knowledge-retrieval', datasets: [{ datasetId: 'ds_1' }] } },
        { data: { type: 'find', resourceType: 'contact' } },
        { data: { type: 'knowledge-retrieval', limit: 100 } },
        { data: { type: 'knowledge-retrieval', sources: [], limit: 5 } },
      ],
    }
    expect(rewriteGraph(graph)).toBe(2)
  })

  it('tolerates a graph with no nodes array', () => {
    expect(rewriteGraph({})).toBe(0)
    expect(rewriteGraph({ nodes: [] })).toBe(0)
  })

  it('skips nodes with no data', () => {
    expect(rewriteGraph({ nodes: [{}, { data: undefined }] })).toBe(0)
  })
})

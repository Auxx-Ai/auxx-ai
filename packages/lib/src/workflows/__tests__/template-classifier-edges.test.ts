// packages/lib/src/workflows/__tests__/template-classifier-edges.test.ts
//
// `validateClassifierEdges` had zero callers and failed open on its own worst
// input (an edge with NO `sourceHandle` — which in category mode routes to no
// category at all — was the one case the guard skipped). It is now wired into
// the template install door as a warning. See
// `plans/kopilot/workflow/23-graph-document-canonicalization.md` §7.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TemplateGraphTransformer } from '../template-graph-transformer'

const transformer = new TemplateGraphTransformer()

const classifier = (categories: string[], outputMode?: string) => ({
  id: 'classifier_1',
  type: 'standard',
  position: { x: 0, y: 0 },
  data: {
    type: 'text-classifier',
    ...(outputMode ? { outputMode } : {}),
    categories: categories.map((id) => ({ id, name: id })),
  },
})

const target = (id: string) => ({
  id,
  type: 'standard',
  position: { x: 0, y: 0 },
  data: { type: 'end' },
})

describe('validateClassifierEdges', () => {
  it('accepts an edge whose handle names a real category', () => {
    const graph = {
      nodes: [classifier(['cat_a', 'cat_b']), target('t1')],
      edges: [{ id: 'e1', source: 'classifier_1', target: 't1', sourceHandle: 'cat_a' }],
    }

    expect(transformer.validateClassifierEdges(graph as never)).toEqual([])
  })

  it('flags an edge whose handle names no category', () => {
    const graph = {
      nodes: [classifier(['cat_a']), target('t1')],
      edges: [{ id: 'e1', source: 'classifier_1', target: 't1', sourceHandle: 'cat_ghost' }],
    }

    expect(transformer.validateClassifierEdges(graph as never)).toEqual([
      'Edge e1: sourceHandle "cat_ghost" not in classifier categories',
    ])
  })

  it('flags an ABSENT handle instead of skipping it', () => {
    const graph = {
      nodes: [classifier(['cat_a']), target('t1')],
      edges: [{ id: 'e1', source: 'classifier_1', target: 't1' }],
    }

    // This is the fail-open case: the old guard's `edge.sourceHandle &&` short
    // circuit meant the ONE edge that provably cannot route was the one edge
    // that was never reported.
    expect(transformer.validateClassifierEdges(graph as never)).toEqual([
      'Edge e1: no sourceHandle, so it routes to no classifier category',
    ])
  })

  it('skips validation entirely in variable output mode', () => {
    const graph = {
      nodes: [classifier([], 'variable'), target('t1')],
      edges: [{ id: 'e1', source: 'classifier_1', target: 't1', sourceHandle: 'source' }],
    }

    expect(transformer.validateClassifierEdges(graph as never)).toEqual([])
  })

  it('allows the plain `source` handle in category mode', () => {
    const graph = {
      nodes: [classifier(['cat_a']), target('t1')],
      edges: [{ id: 'e1', source: 'classifier_1', target: 't1', sourceHandle: 'source' }],
    }

    expect(transformer.validateClassifierEdges(graph as never)).toEqual([])
  })

  it('every bundled template passes, so wiring this cannot break an install', () => {
    const dir = join(__dirname, '..', 'templates')
    const withClassifiers = [
      'order-issue-triage',
      'multi-language-router',
      'ticket-intent-classifier-router',
    ]

    for (const name of withClassifiers) {
      const parsed = JSON.parse(readFileSync(join(dir, `${name}.template.json`), 'utf8'))
      const graph = parsed.graph ?? parsed
      expect(transformer.validateClassifierEdges(graph as never), name).toEqual([])
    }
  })
})

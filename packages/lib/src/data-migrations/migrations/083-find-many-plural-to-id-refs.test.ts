// packages/lib/src/data-migrations/migrations/083-find-many-plural-to-id-refs.test.ts

import { describe, expect, it } from 'vitest'
import type { WorkflowGraph, WorkflowNode } from '../../workflows/template-graph-transformer'
import {
  buildOrgResourceMap,
  buildStaticResourceMap,
  rewriteFindManyRefsInGraph,
} from './083-find-many-plural-to-id-refs'

/**
 * Pure-logic tests only (no DB — see the migration's docblock for why the
 * plumbing is not exercised here, same reasoning as
 * `072-mail-filters-limit.test.ts`). `rewriteFindManyRefsInGraph` is the
 * entire behavior surface: everything DB-shaped in `run()` is fetch-rows /
 * call-this-function / write-rows-that-changed.
 */

const VENDOR_DEF_ID = 'vendorentitydefcuid00001'

function node(id: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type: data.type as string, position: { x: 0, y: 0 }, data }
}

function graphWith(nodes: WorkflowNode[]): WorkflowGraph {
  return { nodes, edges: [] }
}

describe('buildStaticResourceMap', () => {
  it('maps a static resource by id and apiSlug to the same entry', () => {
    const map = buildStaticResourceMap()
    const byId = map.get('thread')
    const bySlug = map.get('threads')

    expect(byId).toEqual({ id: 'thread', plural: 'Threads' })
    expect(bySlug).toBe(byId) // same object reference
  })
})

describe('buildOrgResourceMap', () => {
  it('layers EntityDefinition rows over the static map by id, entityType, and apiSlug', () => {
    const staticMap = buildStaticResourceMap()
    const orgMap = buildOrgResourceMap(staticMap, [
      { id: VENDOR_DEF_ID, plural: 'Vendors', entityType: null, apiSlug: 'vendors' },
      {
        id: 'entitydefcuidcontact001',
        plural: 'Contacts',
        entityType: 'contact',
        apiSlug: 'contacts',
      },
    ])

    expect(orgMap.get(VENDOR_DEF_ID)).toEqual({ id: VENDOR_DEF_ID, plural: 'Vendors' })
    expect(orgMap.get('vendors')).toEqual({ id: VENDOR_DEF_ID, plural: 'Vendors' })
    expect(orgMap.get('contact')).toEqual({ id: 'entitydefcuidcontact001', plural: 'Contacts' })
    expect(orgMap.get('contacts')).toEqual({ id: 'entitydefcuidcontact001', plural: 'Contacts' })
    // Static entries survive underneath the org layer.
    expect(orgMap.get('thread')).toEqual({ id: 'thread', plural: 'Threads' })
  })

  it('does not mutate the static map passed in', () => {
    const staticMap = buildStaticResourceMap()
    const sizeBefore = staticMap.size
    buildOrgResourceMap(staticMap, [
      { id: VENDOR_DEF_ID, plural: 'Vendors', entityType: null, apiSlug: 'vendors' },
    ])
    expect(staticMap.size).toBe(sizeBefore)
  })
})

describe('rewriteFindManyRefsInGraph', () => {
  const resourceMap = buildOrgResourceMap(buildStaticResourceMap(), [
    { id: VENDOR_DEF_ID, plural: 'Vendors', entityType: null, apiSlug: 'vendors' },
  ])

  it('rewrites a {{…}} span referencing the legacy plural key onto the canonical id', () => {
    const findNode = node('find_1', { type: 'find', findMode: 'findMany', resourceType: 'vendors' })
    const messageNode = node('message_1', {
      type: 'answer',
      body: 'First vendor email: {{find_1.vendors[0].email}}',
    })
    const graph = graphWith([findNode, messageNode])

    const touched = rewriteFindManyRefsInGraph(graph, resourceMap)

    expect(touched).toBe(1)
    expect(messageNode.data.body).toBe(`First vendor email: {{find_1.${VENDOR_DEF_ID}[0].email}}`)
  })

  it('rewrites a bare variable-id reference (e.g. a loop itemsSource) the same way', () => {
    const findNode = node('find_1', { type: 'find', findMode: 'findMany', resourceType: 'vendors' })
    const loopNode = node('loop_1', { type: 'loop', itemsSource: 'find_1.vendors' })
    const graph = graphWith([findNode, loopNode])

    rewriteFindManyRefsInGraph(graph, resourceMap)

    expect(loopNode.data.itemsSource).toBe(`find_1.${VENDOR_DEF_ID}`)
  })

  it('handles a multi-word plural with a space in the legacy key', () => {
    const findNode = node('find_1', { type: 'find', findMode: 'findMany', resourceType: 'kb' })
    const messageNode = node('message_1', {
      type: 'answer',
      body: '{{find_1.knowledge bases[*].title}}',
    })
    const graph = graphWith([findNode, messageNode])

    rewriteFindManyRefsInGraph(graph, resourceMap)

    expect(messageNode.data.body).toBe('{{find_1.kb[*].title}}')
  })

  it('never touches an unrelated node whose plural happens to match a different find node id', () => {
    // Two find nodes on the SAME resource — a ref must only rewrite under its
    // OWN node id prefix, never a blanket plural-string replace.
    const findA = node('find_a', { type: 'find', findMode: 'findMany', resourceType: 'vendors' })
    const findB = node('find_b', { type: 'find', findMode: 'findMany', resourceType: 'vendors' })
    const messageNode = node('message_1', {
      type: 'answer',
      body: '{{find_a.vendors[0].email}} and {{find_b.vendors[0].email}}',
    })
    const graph = graphWith([findA, findB, messageNode])

    rewriteFindManyRefsInGraph(graph, resourceMap)

    expect(messageNode.data.body).toBe(
      `{{find_a.${VENDOR_DEF_ID}[0].email}} and {{find_b.${VENDOR_DEF_ID}[0].email}}`
    )
  })

  it('leaves ordinary prose containing the plural word alone', () => {
    const findNode = node('find_1', { type: 'find', findMode: 'findMany', resourceType: 'vendors' })
    const messageNode = node('message_1', {
      type: 'answer',
      body: 'Thanks for reaching out about our vendors program.',
    })
    const graph = graphWith([findNode, messageNode])

    const touched = rewriteFindManyRefsInGraph(graph, resourceMap)

    expect(touched).toBe(0)
    expect(messageNode.data.body).toBe('Thanks for reaching out about our vendors program.')
  })

  it('skips a findMany node whose resourceType does not resolve (deleted/unknown entity)', () => {
    const findNode = node('find_1', {
      type: 'find',
      findMode: 'findMany',
      resourceType: 'entitydefcuidgoneforever',
    })
    const messageNode = node('message_1', { type: 'answer', body: '{{find_1.gone[0].x}}' })
    const graph = graphWith([findNode, messageNode])

    const touched = rewriteFindManyRefsInGraph(graph, resourceMap)

    expect(touched).toBe(0)
  })

  it('ignores findOne nodes — only findMany keys on the plural', () => {
    const findNode = node('find_1', { type: 'find', findMode: 'findOne', resourceType: 'vendors' })
    const messageNode = node('message_1', {
      type: 'answer',
      body: `{{find_1.${VENDOR_DEF_ID}.name}}`,
    })
    const graph = graphWith([findNode, messageNode])

    const touched = rewriteFindManyRefsInGraph(graph, resourceMap)

    expect(touched).toBe(0)
  })

  it('is idempotent — a second pass over an already-rewritten graph is a no-op', () => {
    const findNode = node('find_1', { type: 'find', findMode: 'findMany', resourceType: 'vendors' })
    const messageNode = node('message_1', { type: 'answer', body: '{{find_1.vendors[0].email}}' })
    const graph = graphWith([findNode, messageNode])

    const firstPass = rewriteFindManyRefsInGraph(graph, resourceMap)
    const secondPass = rewriteFindManyRefsInGraph(graph, resourceMap)

    expect(firstPass).toBe(1)
    expect(secondPass).toBe(0)
    expect(messageNode.data.body).toBe(`{{find_1.${VENDOR_DEF_ID}[0].email}}`)
  })

  it('returns 0 for a graph with no nodes', () => {
    expect(rewriteFindManyRefsInGraph(graphWith([]), resourceMap)).toBe(0)
  })
})

// packages/lib/src/agents/__tests__/knowledge-scope.test.ts

import type { KnowledgeEntry } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  filterKnowledgeScopeEntries,
  isKnowledgeScopeRecordId,
  parseAgentKnowledgeScope,
  parseKnowledgeScopeRecordId,
  scopeHasIncludes,
} from '../knowledge-scope'

function entry(
  recordId: string,
  mode: KnowledgeEntry['mode'] = 'include_one',
  source: KnowledgeEntry['source'] = 'manual'
): KnowledgeEntry {
  return { recordId, mode, source }
}

describe('isKnowledgeScopeRecordId / parseKnowledgeScopeRecordId', () => {
  it.each(['kb', 'kb:x', 'article:x', 'dataset', 'dataset:x'])('accepts %s', (recordId) => {
    expect(isKnowledgeScopeRecordId(recordId)).toBe(true)
  })

  it.each([
    'contact',
    'contact:x',
    'ticket:x',
    'entity:contact',
    'kb:',
    '',
  ])('rejects %s', (recordId) => {
    expect(isKnowledgeScopeRecordId(recordId)).toBe(false)
  })

  it('parses a bare definition-level prefix with a null instanceId', () => {
    expect(parseKnowledgeScopeRecordId('kb')).toEqual({ prefix: 'kb', instanceId: null })
    expect(parseKnowledgeScopeRecordId('dataset')).toEqual({
      prefix: 'dataset',
      instanceId: null,
    })
  })

  it('parses an instance-level id into prefix + instanceId', () => {
    expect(parseKnowledgeScopeRecordId('kb:abc')).toEqual({ prefix: 'kb', instanceId: 'abc' })
    expect(parseKnowledgeScopeRecordId('article:def')).toEqual({
      prefix: 'article',
      instanceId: 'def',
    })
    expect(parseKnowledgeScopeRecordId('dataset:ghi')).toEqual({
      prefix: 'dataset',
      instanceId: 'ghi',
    })
  })

  it('rejects a bare "article" — only kb and dataset have a definition level', () => {
    // A bare `article` row would mean "every article in the org", which a bare
    // `kb` row already says. Articles are always instance-level.
    expect(parseKnowledgeScopeRecordId('article')).toBeNull()
    expect(isKnowledgeScopeRecordId('article')).toBe(false)
  })

  it('rejects an empty instanceId after the colon', () => {
    expect(parseKnowledgeScopeRecordId('kb:')).toBeNull()
  })

  it('rejects prefixes outside the knowledge-scope set', () => {
    expect(parseKnowledgeScopeRecordId('contact:abc')).toBeNull()
    expect(parseKnowledgeScopeRecordId('entity:contact')).toBeNull()
    expect(parseKnowledgeScopeRecordId('ticket:abc')).toBeNull()
  })
})

describe('filterKnowledgeScopeEntries', () => {
  it('returns [] for null/undefined/empty input', () => {
    expect(filterKnowledgeScopeEntries(null)).toEqual([])
    expect(filterKnowledgeScopeEntries(undefined)).toEqual([])
    expect(filterKnowledgeScopeEntries([])).toEqual([])
  })

  it('drops entity-record rows left over from the deleted include system', () => {
    const rows = [entry('kb:abc'), entry('contact:xyz'), entry('ticket:123'), entry('article:def')]
    expect(filterKnowledgeScopeEntries(rows)).toEqual([entry('kb:abc'), entry('article:def')])
  })

  it('keeps only knowledge-scope rows when the list is entity-only', () => {
    expect(filterKnowledgeScopeEntries([entry('contact:xyz'), entry('entity:contact')])).toEqual([])
  })
})

describe('parseAgentKnowledgeScope', () => {
  it('returns null for an empty list', () => {
    expect(parseAgentKnowledgeScope([])).toBeNull()
    expect(parseAgentKnowledgeScope(null)).toBeNull()
    expect(parseAgentKnowledgeScope(undefined)).toBeNull()
  })

  it('returns null when every row is an entity-record leftover', () => {
    expect(parseAgentKnowledgeScope([entry('contact:xyz'), entry('ticket:123')])).toBeNull()
  })

  it('buckets definition-level include/exclude rows', () => {
    const scope = parseAgentKnowledgeScope([
      entry('kb', 'include_one', 'manual'),
      entry('dataset', 'exclude', 'manual'),
    ])
    expect(scope).toMatchObject({ allKbs: 'include', allDatasets: 'exclude' })
  })

  it('buckets instance-level kb and dataset rows by direction', () => {
    const scope = parseAgentKnowledgeScope([
      entry('kb:abc', 'include_one', 'manual'),
      entry('kb:excluded', 'exclude', 'manual'),
      entry('dataset:def', 'include_one', 'manual'),
      entry('dataset:excluded', 'exclude', 'manual'),
    ])
    expect(scope).toMatchObject({
      kbIds: ['abc'],
      excludedKbIds: ['excluded'],
      datasetIds: ['def'],
      excludedDatasetIds: ['excluded'],
    })
  })

  it('buckets article include_one vs include_descendants separately', () => {
    const scope = parseAgentKnowledgeScope([
      entry('article:one', 'include_one', 'manual'),
      entry('article:tree', 'include_descendants', 'manual'),
    ])
    expect(scope).toMatchObject({
      articleIds: ['one'],
      articleTreeIds: ['tree'],
    })
  })

  it('buckets an excluded article regardless of its mode (exclude always covers the subtree)', () => {
    const scope = parseAgentKnowledgeScope([
      entry('article:excluded', 'exclude', 'manual'),
      entry('article:excluded-tree', 'exclude', 'manual'),
    ])
    expect(scope?.excludedArticleIds.sort()).toEqual(['excluded', 'excluded-tree'])
    expect(scope?.articleIds).toEqual([])
    expect(scope?.articleTreeIds).toEqual([])
  })

  it('is a no-op for a bare "article" row — no definition-level article bucket exists', () => {
    const scope = parseAgentKnowledgeScope([
      entry('article', 'include_one', 'manual'),
      entry('kb:abc', 'include_one', 'manual'),
    ])
    expect(scope).toMatchObject({ kbIds: ['abc'] })
    expect(scope?.articleIds).toEqual([])
    expect(scope?.articleTreeIds).toEqual([])
  })

  it('ignores interleaved entity-record rows while bucketing the rest', () => {
    const scope = parseAgentKnowledgeScope([
      entry('contact:xyz', 'include_one', 'manual'),
      entry('kb:abc', 'include_one', 'manual'),
      entry('ticket:123', 'exclude', 'manual'),
    ])
    expect(scope).toMatchObject({ kbIds: ['abc'] })
  })
})

describe('scopeHasIncludes', () => {
  const empty = parseAgentKnowledgeScope([]) // null — build a base manually instead
  const base = {
    allKbs: null,
    allDatasets: null,
    kbIds: [] as string[],
    articleIds: [] as string[],
    articleTreeIds: [] as string[],
    datasetIds: [] as string[],
    excludedKbIds: [] as string[],
    excludedArticleIds: [] as string[],
    excludedDatasetIds: [] as string[],
  }

  it('is false for an all-null/empty scope', () => {
    expect(scopeHasIncludes(base)).toBe(false)
    expect(empty).toBeNull()
  })

  it('is false when only excludes are present (excludes carve out of an org-wide default)', () => {
    expect(scopeHasIncludes({ ...base, allKbs: 'exclude', excludedKbIds: ['abc'] })).toBe(false)
  })

  it('is true for a definition-level include', () => {
    expect(scopeHasIncludes({ ...base, allKbs: 'include' })).toBe(true)
    expect(scopeHasIncludes({ ...base, allDatasets: 'include' })).toBe(true)
  })

  it('is true when any instance-level include list is non-empty', () => {
    expect(scopeHasIncludes({ ...base, kbIds: ['abc'] })).toBe(true)
    expect(scopeHasIncludes({ ...base, articleIds: ['abc'] })).toBe(true)
    expect(scopeHasIncludes({ ...base, articleTreeIds: ['abc'] })).toBe(true)
    expect(scopeHasIncludes({ ...base, datasetIds: ['abc'] })).toBe(true)
  })
})

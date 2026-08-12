// packages/lib/src/workflow-engine/nodes/dataset/dataset-node-config.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { ExecutionContextManager } from '../../core/execution-context'
import type { WorkflowNode } from '../../core/types'
import { WorkflowNodeType } from '../../core/types'
import { ChunkerProcessor } from './chunker'
import { DatasetProcessor } from './dataset'
import { DocumentExtractorProcessor } from './document-extractor'
import { KnowledgeRetrievalProcessor } from './knowledge-retrieval'

/**
 * Builder↔engine contract tests for the knowledge/dataset cluster.
 *
 * Two failures are covered:
 *  - a config field bound to a variable must survive the processor's zod
 *    schema, so the variable gets a chance to resolve at all
 *  - a boolean bound to a variable must follow the variable, instead of being
 *    coerced to `false` whatever the variable says
 */

function createNode(type: WorkflowNodeType, data: Record<string, unknown>): WorkflowNode {
  return {
    id: 'test-node',
    workflowId: 'test-workflow',
    nodeId: 'test-node',
    type,
    name: `Test ${type}`,
    description: 'contract test node',
    data: { id: 'test-node', type, title: 'Test', ...data },
    metadata: {},
  } as unknown as WorkflowNode
}

function createContext(variables: Record<string, unknown> = {}): ExecutionContextManager {
  const context = new ExecutionContextManager('test-workflow', 'test-run', 'test-org')
  context.setVariable('sys.organizationId', 'test-org')
  context.setVariable('sys.userId', 'test-user')
  Object.entries(variables).forEach(([key, value]) => context.setVariable(key, value))
  return context
}

describe('ChunkerProcessor config binding', () => {
  let processor: ChunkerProcessor

  beforeEach(() => {
    processor = new ChunkerProcessor()
  })

  it('accepts variable-bound numeric and boolean fields and resolves them', async () => {
    const node = createNode(WorkflowNodeType.CHUNKER, {
      content: 'extractor_1.content',
      chunkSize: 'settings_1.chunkSize',
      chunkOverlap: 'settings_1.chunkOverlap',
      normalizeWhitespace: 'settings_1.normalize',
      removeUrlsAndEmails: 'settings_1.strip',
      fieldModes: {
        content: false,
        chunkSize: false,
        chunkOverlap: false,
        normalizeWhitespace: false,
        removeUrlsAndEmails: false,
      },
    })

    const context = createContext({
      'extractor_1.content': 'the quick brown fox jumps over the lazy dog',
      'settings_1.chunkSize': 500,
      'settings_1.chunkOverlap': 25,
      'settings_1.normalize': false,
      'settings_1.strip': true,
    })

    const preprocessed = await processor.preprocessNode(node, context)

    expect(preprocessed.inputs.chunkSize).toBe(500)
    expect(preprocessed.inputs.chunkOverlap).toBe(25)
    expect(preprocessed.inputs.normalizeWhitespace).toBe(false)
    expect(preprocessed.inputs.removeUrlsAndEmails).toBe(true)
  })

  it('accepts {{…}} templates for numeric fields', async () => {
    const node = createNode(WorkflowNodeType.CHUNKER, {
      content: 'hello world',
      chunkSize: '{{settings_1.chunkSize}}',
      fieldModes: { content: true, chunkSize: false },
    })

    const preprocessed = await processor.preprocessNode(
      node,
      createContext({ 'settings_1.chunkSize': 800 })
    )

    expect(preprocessed.inputs.chunkSize).toBe(800)
  })

  it('declares bound settings as required variables', () => {
    const node = createNode(WorkflowNodeType.CHUNKER, {
      content: 'extractor_1.content',
      chunkSize: 'settings_1.chunkSize',
      normalizeWhitespace: 'settings_1.normalize',
      fieldModes: { content: false, chunkSize: false, normalizeWhitespace: false },
    })

    // @ts-expect-error - exercising the protected contract directly
    const required = processor.extractRequiredVariables(node) as string[]

    expect(required).toContain('settings_1.chunkSize')
    expect(required).toContain('settings_1.normalize')
  })

  it('still accepts literal constants', async () => {
    const node = createNode(WorkflowNodeType.CHUNKER, {
      content: 'hello world',
      chunkSize: 1000,
      chunkOverlap: 50,
      normalizeWhitespace: true,
      removeUrlsAndEmails: false,
      fieldModes: {
        content: true,
        chunkSize: true,
        chunkOverlap: true,
        normalizeWhitespace: true,
        removeUrlsAndEmails: true,
      },
    })

    const preprocessed = await processor.preprocessNode(node, createContext())

    expect(preprocessed.inputs.chunkSize).toBe(1000)
    expect(preprocessed.inputs.normalizeWhitespace).toBe(true)
    expect(preprocessed.inputs.removeUrlsAndEmails).toBe(false)
  })
})

describe('KnowledgeRetrievalProcessor config binding', () => {
  let processor: KnowledgeRetrievalProcessor

  beforeEach(() => {
    processor = new KnowledgeRetrievalProcessor()
  })

  it('accepts variable-bound search settings and resolves them', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'trigger_1.question',
      datasets: [{ datasetId: 'ds_123' }],
      searchType: 'settings_1.mode',
      limit: 'settings_1.limit',
      similarityThreshold: 'settings_1.threshold',
      fieldModes: {
        query: false,
        'datasets.0.datasetId': true,
        searchType: false,
        limit: false,
        similarityThreshold: false,
      },
    })

    const context = createContext({
      'trigger_1.question': 'how do refunds work?',
      'settings_1.mode': 'vector',
      'settings_1.limit': 5,
      'settings_1.threshold': 0.42,
    })

    const preprocessed = await processor.preprocessNode(node, context)

    expect(preprocessed.inputs.query).toBe('how do refunds work?')
    expect(preprocessed.inputs.searchType).toBe('vector')
    expect(preprocessed.inputs.limit).toBe(5)
    expect(preprocessed.inputs.similarityThreshold).toBe(0.42)
  })

  it('resolves search settings delivered as interpolated strings', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      datasets: [{ datasetId: 'ds_123' }],
      searchType: '{{settings_1.mode}}',
      limit: '{{settings_1.limit}}',
      fieldModes: { query: true, 'datasets.0.datasetId': true, searchType: false, limit: false },
    })

    const preprocessed = await processor.preprocessNode(
      node,
      createContext({ 'settings_1.mode': 'text', 'settings_1.limit': '7' })
    )

    expect(preprocessed.inputs.searchType).toBe('text')
    expect(preprocessed.inputs.limit).toBe(7)
  })

  it('falls back to defaults when a bound setting resolves out of range', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      datasets: [{ datasetId: 'ds_123' }],
      limit: 'settings_1.limit',
      fieldModes: { query: true, 'datasets.0.datasetId': true, limit: false },
    })

    const preprocessed = await processor.preprocessNode(
      node,
      createContext({ 'settings_1.limit': 9000 })
    )

    expect(preprocessed.inputs.limit).toBe(20)
  })

  it('declares bound search settings as required variables', () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'trigger_1.question',
      datasets: [{ datasetId: 'ds_123' }],
      limit: 'settings_1.limit',
      fieldModes: { query: false, 'datasets.0.datasetId': true, limit: false },
    })

    // @ts-expect-error - exercising the protected contract directly
    const required = processor.extractRequiredVariables(node) as string[]

    expect(required).toContain('settings_1.limit')
  })

  it('still accepts literal constants', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      datasets: [{ datasetId: 'ds_123' }],
      searchType: 'hybrid',
      limit: 20,
      similarityThreshold: 0.7,
      fieldModes: {
        query: true,
        'datasets.0.datasetId': true,
        searchType: true,
        limit: true,
        similarityThreshold: true,
      },
    })

    const preprocessed = await processor.preprocessNode(node, createContext())

    expect(preprocessed.inputs.searchType).toBe('hybrid')
    expect(preprocessed.inputs.limit).toBe(20)
    expect(preprocessed.inputs.similarityThreshold).toBe(0.7)
  })
})

describe('DatasetProcessor boolean binding', () => {
  let processor: DatasetProcessor

  const chunks = [{ content: 'a chunk', position: 0 }]

  function datasetNode(overrides: Record<string, unknown>): WorkflowNode {
    return createNode(WorkflowNodeType.DATASET, {
      datasetId: 'ds_123',
      chunks: 'chunker_1.chunks',
      fieldModes: { datasetId: true, chunks: false, ...(overrides.fieldModes as object) },
      ...overrides,
    })
  }

  beforeEach(() => {
    processor = new DatasetProcessor()
  })

  it.each([
    ['a real boolean true', true],
    ['the string "true"', 'true'],
    ['the number 1', 1],
  ])('resolves a bound skipEmbedding to true for %s', async (_label, value) => {
    const node = datasetNode({
      skipEmbedding: 'settings_1.skip',
      fieldModes: { skipEmbedding: false },
    })

    const preprocessed = await processor.preprocessNode(
      node,
      createContext({ 'chunker_1.chunks': chunks, 'settings_1.skip': value })
    )

    expect(preprocessed.inputs.skipEmbedding).toBe(true)
  })

  it.each([
    ['a real boolean false', false],
    ['the string "false"', 'false'],
    ['the number 0', 0],
  ])('resolves a bound skipEmbedding to false for %s', async (_label, value) => {
    const node = datasetNode({
      skipEmbedding: 'settings_1.skip',
      fieldModes: { skipEmbedding: false },
    })

    const preprocessed = await processor.preprocessNode(
      node,
      createContext({ 'chunker_1.chunks': chunks, 'settings_1.skip': value })
    )

    expect(preprocessed.inputs.skipEmbedding).toBe(false)
  })

  it('resolves a bound waitForEmbeddings through a {{…}} template', async () => {
    const node = datasetNode({
      waitForEmbeddings: '{{settings_1.wait}}',
      fieldModes: { waitForEmbeddings: false },
    })

    const preprocessed = await processor.preprocessNode(
      node,
      createContext({ 'chunker_1.chunks': chunks, 'settings_1.wait': true })
    )

    expect(preprocessed.inputs.waitForEmbeddings).toBe(true)
  })

  it('keeps literal constants intact', async () => {
    const trueNode = datasetNode({ skipEmbedding: true, fieldModes: { skipEmbedding: true } })
    const falseNode = datasetNode({ skipEmbedding: false, fieldModes: { skipEmbedding: true } })
    const context = () => createContext({ 'chunker_1.chunks': chunks })

    expect((await processor.preprocessNode(trueNode, context())).inputs.skipEmbedding).toBe(true)
    expect((await processor.preprocessNode(falseNode, context())).inputs.skipEmbedding).toBe(false)
  })

  it('falls back to the default when a bound toggle never resolves', async () => {
    const node = datasetNode({
      skipEmbedding: 'settings_1.missing',
      fieldModes: { skipEmbedding: false },
    })

    const preprocessed = await processor.preprocessNode(
      node,
      createContext({ 'chunker_1.chunks': chunks })
    )

    expect(preprocessed.inputs.skipEmbedding).toBe(false)
  })
})

describe('DocumentExtractorProcessor boolean binding', () => {
  let processor: DocumentExtractorProcessor

  function extractorNode(overrides: Record<string, unknown>): WorkflowNode {
    return createNode(WorkflowNodeType.DOCUMENT_EXTRACTOR, {
      sourceType: 'url',
      url: 'https://example.com/doc.pdf',
      fieldModes: { url: true, ...(overrides.fieldModes as object) },
      ...overrides,
    })
  }

  beforeEach(() => {
    processor = new DocumentExtractorProcessor()
  })

  it.each([
    ['a real boolean true', true],
    ['the string "true"', 'true'],
  ])('resolves bound extraction toggles to true for %s', async (_label, value) => {
    const node = extractorNode({
      preserveFormatting: 'settings_1.preserve',
      extractImages: 'settings_1.images',
      fieldModes: { preserveFormatting: false, extractImages: false },
    })

    const preprocessed = await processor.preprocessNode(
      node,
      createContext({ 'settings_1.preserve': value, 'settings_1.images': value })
    )

    expect(preprocessed.inputs.preserveFormatting).toBe(true)
    expect(preprocessed.inputs.extractImages).toBe(true)
  })

  it.each([
    ['a real boolean false', false],
    ['the string "false"', 'false'],
  ])('resolves bound extraction toggles to false for %s', async (_label, value) => {
    const node = extractorNode({
      preserveFormatting: 'settings_1.preserve',
      fieldModes: { preserveFormatting: false },
    })

    const preprocessed = await processor.preprocessNode(
      node,
      createContext({ 'settings_1.preserve': value })
    )

    expect(preprocessed.inputs.preserveFormatting).toBe(false)
  })

  it('keeps literal constants intact', async () => {
    const node = extractorNode({
      preserveFormatting: true,
      extractImages: false,
      fieldModes: { preserveFormatting: true, extractImages: true },
    })

    const preprocessed = await processor.preprocessNode(node, createContext())

    expect(preprocessed.inputs.preserveFormatting).toBe(true)
    expect(preprocessed.inputs.extractImages).toBe(false)
  })

  it('declares bound toggles as required variables', () => {
    const node = extractorNode({
      extractImages: 'settings_1.images',
      fieldModes: { extractImages: false },
    })

    // @ts-expect-error - exercising the protected contract directly
    const required = processor.extractRequiredVariables(node) as string[]

    expect(required).toContain('settings_1.images')
  })
})

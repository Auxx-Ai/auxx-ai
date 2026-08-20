// packages/lib/src/workflow-engine/nodes/dataset/dataset-node-config.test.ts

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../core/execution-context'
import type { PauseReason, WorkflowNode } from '../../core/types'
import { WorkflowNodeType } from '../../core/types'
import { ChunkerProcessor } from './chunker'
import { DatasetProcessor } from './dataset'
import { DocumentExtractorProcessor } from './document-extractor'
import {
  buildEmbeddingTimeoutJobId,
  clampEmbeddingTimeoutMinutes,
  EMBEDDING_WAIT,
  embeddingResumeVariables,
  scheduleEmbeddingTimeout,
} from './embedding-wait'
import { KnowledgeRetrievalProcessor } from './knowledge-retrieval'

const queueAdd = vi.fn()
vi.mock('../../../jobs/queues', () => ({
  getQueue: () => ({ add: (...args: unknown[]) => queueAdd(...args) }),
  Queues: { workflowDelayQueue: 'workflow-delay' },
}))

/**
 * Knowledge-retrieval now resolves its sources through the shared resolver on
 * the workflow author's authority (K5). These stand in for the access layer so
 * the tests stay about config binding and source routing; the resolver's own
 * behaviour is covered in `datasets/__tests__/resolve-knowledge-targets.test.ts`.
 */
const resolveKnowledgeDatasetIds = vi.fn()
vi.mock('../../../datasets/resolve-knowledge-targets', () => ({
  resolveKnowledgeDatasetIds: (...args: unknown[]) => resolveKnowledgeDatasetIds(...args),
}))
vi.mock('../../../permissions/capabilities/get-capabilities', () => ({
  getCapabilities: async () => ({ canViewInstance: () => true }),
}))
// Partial-mock: a wholesale replacement of the org-cache barrel dies at
// COLLECTION as the import graph grows.
vi.mock('../../../cache/org-cache-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedMembers: async () => [{ userId: 'test-user', status: 'ACTIVE' }],
}))

/**
 * Builder↔engine contract tests for the knowledge/dataset cluster.
 *
 * Three failures are covered:
 *  - a config field bound to a variable must survive the processor's zod
 *    schema, so the variable gets a chance to resolve at all
 *  - a boolean bound to a variable must follow the variable, instead of being
 *    coerced to `false` whatever the variable says
 *  - the dataset node's embedding wait must be bounded, and its outcome must
 *    become addressable when the run resumes
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

  /** The targets the processor handed the resolver on the last call. */
  const lastTargets = () => resolveKnowledgeDatasetIds.mock.calls.at(-1)?.[1].targets

  beforeEach(() => {
    processor = new KnowledgeRetrievalProcessor()
    resolveKnowledgeDatasetIds.mockReset()
    resolveKnowledgeDatasetIds.mockResolvedValue(ok(['ds_resolved']))
  })

  it('accepts variable-bound search settings and resolves them', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'trigger_1.question',
      sources: [{ kind: 'dataset', datasetId: 'ds_123' }],
      searchType: 'settings_1.mode',
      limit: 'settings_1.limit',
      similarityThreshold: 'settings_1.threshold',
      fieldModes: {
        query: false,
        'sources.0.datasetId': true,
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
      sources: [{ kind: 'dataset', datasetId: 'ds_123' }],
      searchType: '{{settings_1.mode}}',
      limit: '{{settings_1.limit}}',
      fieldModes: { query: true, 'sources.0.datasetId': true, searchType: false, limit: false },
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
      sources: [{ kind: 'dataset', datasetId: 'ds_123' }],
      limit: 'settings_1.limit',
      fieldModes: { query: true, 'sources.0.datasetId': true, limit: false },
    })

    const preprocessed = await processor.preprocessNode(
      node,
      createContext({ 'settings_1.limit': 9000 })
    )

    expect(preprocessed.inputs.limit).toBe(20)
  })

  it('rejects a literal limit above the ceiling (K9 — was 100, now 25)', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [{ kind: 'dataset', datasetId: 'ds_123' }],
      limit: 100,
      fieldModes: { query: true, 'sources.0.datasetId': true, limit: true },
    })

    await expect(processor.preprocessNode(node, createContext())).rejects.toThrow(
      /Invalid Knowledge Retrieval configuration/
    )
  })

  it('declares bound search settings as required variables', () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'trigger_1.question',
      sources: [{ kind: 'dataset', datasetId: 'ds_123' }],
      limit: 'settings_1.limit',
      fieldModes: { query: false, 'sources.0.datasetId': true, limit: false },
    })

    // @ts-expect-error - exercising the protected contract directly
    const required = processor.extractRequiredVariables(node) as string[]

    expect(required).toContain('settings_1.limit')
  })

  it('still accepts literal constants', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [{ kind: 'dataset', datasetId: 'ds_123' }],
      searchType: 'hybrid',
      limit: 20,
      similarityThreshold: 0.7,
      fieldModes: {
        query: true,
        'sources.0.datasetId': true,
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

  it('leaves similarityThreshold undefined when unset (K7 — no node default)', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [{ kind: 'dataset', datasetId: 'ds_123' }],
      fieldModes: { query: true, 'sources.0.datasetId': true },
    })

    const preprocessed = await processor.preprocessNode(node, createContext())

    // Not 0.7 — omitted, so the vector lane's own 0.4 floor applies.
    expect(preprocessed.inputs.similarityThreshold).toBeUndefined()
  })
})

describe('KnowledgeRetrievalProcessor source routing', () => {
  let processor: KnowledgeRetrievalProcessor

  const lastTargets = () => resolveKnowledgeDatasetIds.mock.calls.at(-1)?.[1].targets

  beforeEach(() => {
    processor = new KnowledgeRetrievalProcessor()
    resolveKnowledgeDatasetIds.mockReset()
    resolveKnowledgeDatasetIds.mockResolvedValue(ok(['ds_resolved']))
  })

  it('routes a kb row to a kb target', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [{ kind: 'kb', knowledgeBaseId: 'kb_1' }],
      fieldModes: { query: true, 'sources.0.knowledgeBaseId': true },
    })

    await processor.preprocessNode(node, createContext())

    expect(lastTargets()).toEqual([{ kind: 'kb', knowledgeBaseId: 'kb_1' }])
  })

  it('routes a mixed kb + dataset config, preserving order and kind', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [
        { kind: 'kb', knowledgeBaseId: 'kb_1' },
        { kind: 'dataset', datasetId: 'ds_1' },
      ],
      fieldModes: {
        query: true,
        'sources.0.knowledgeBaseId': true,
        'sources.1.datasetId': true,
      },
    })

    await processor.preprocessNode(node, createContext())

    expect(lastTargets()).toEqual([
      { kind: 'kb', knowledgeBaseId: 'kb_1' },
      { kind: 'dataset', datasetId: 'ds_1' },
    ])
  })

  it('resolves a variable-bound KB id', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [{ kind: 'kb', knowledgeBaseId: 'find_1.record' }],
      fieldModes: { query: true, 'sources.0.knowledgeBaseId': false },
    })

    await processor.preprocessNode(node, createContext({ 'find_1.record': 'kb_from_var' }))

    expect(lastTargets()).toEqual([{ kind: 'kb', knowledgeBaseId: 'kb_from_var' }])
  })

  it('a bound id resolving to nothing contributes nothing — siblings still search', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [
        { kind: 'kb', knowledgeBaseId: 'find_1.missing' },
        { kind: 'dataset', datasetId: 'ds_1' },
      ],
      fieldModes: {
        query: true,
        'sources.0.knowledgeBaseId': false,
        'sources.1.datasetId': true,
      },
    })

    await processor.preprocessNode(node, createContext())

    expect(lastTargets()).toEqual([{ kind: 'dataset', datasetId: 'ds_1' }])
  })

  it('errors when EVERY row resolves to nothing, never falling through to an unscoped search', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [{ kind: 'kb', knowledgeBaseId: 'find_1.missing' }],
      fieldModes: { query: true, 'sources.0.knowledgeBaseId': false },
    })

    await expect(processor.preprocessNode(node, createContext())).rejects.toThrow(
      /No valid knowledge sources/
    )
    expect(resolveKnowledgeDatasetIds).not.toHaveBeenCalled()
  })

  it('errors when the resolver returns an empty set — access denied is not "search everything"', async () => {
    resolveKnowledgeDatasetIds.mockResolvedValue(ok([]))

    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [{ kind: 'kb', knowledgeBaseId: 'kb_1' }],
      fieldModes: { query: true, 'sources.0.knowledgeBaseId': true },
    })

    await expect(processor.preprocessNode(node, createContext())).rejects.toThrow(
      /No accessible knowledge sources/
    )
  })

  it('passes an explicit null knowledgeScope (K6) — there is no agent here', async () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [{ kind: 'kb', knowledgeBaseId: 'kb_1' }],
      fieldModes: { query: true, 'sources.0.knowledgeBaseId': true },
    })

    await processor.preprocessNode(node, createContext())

    const args = resolveKnowledgeDatasetIds.mock.calls.at(-1)?.[1]
    expect(args.knowledgeScope).toBeNull()
    expect(args.capabilities).toBeDefined()
    expect(args.capabilities).not.toBe('unrestricted')
  })

  it('refuses to run without a user rather than resolving unrestricted (K5)', async () => {
    const context = new ExecutionContextManager('test-workflow', 'test-run', 'test-org')
    context.setVariable('sys.organizationId', 'test-org')
    // sys.userId deliberately absent

    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [{ kind: 'kb', knowledgeBaseId: 'kb_1' }],
      fieldModes: { query: true, 'sources.0.knowledgeBaseId': true },
    })

    await expect(processor.preprocessNode(node, context)).rejects.toThrow(
      /will not run unrestricted/
    )
    expect(resolveKnowledgeDatasetIds).not.toHaveBeenCalled()
  })

  it('declares a bound source id as a required variable', () => {
    const node = createNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL, {
      query: 'a question',
      sources: [{ kind: 'kb', knowledgeBaseId: 'find_1.record' }],
      fieldModes: { query: true, 'sources.0.knowledgeBaseId': false },
    })

    // @ts-expect-error - exercising the protected contract directly
    const required = processor.extractRequiredVariables(node) as string[]

    expect(required).toContain('find_1.record')
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

describe('DatasetProcessor embedding wait', () => {
  let processor: DatasetProcessor

  const chunks = [{ content: 'a chunk', position: 0 }]

  function datasetNode(overrides: Record<string, unknown> = {}): WorkflowNode {
    return createNode(WorkflowNodeType.DATASET, {
      datasetId: 'ds_123',
      chunks: 'chunker_1.chunks',
      fieldModes: { datasetId: true, chunks: false, ...(overrides.fieldModes as object) },
      ...overrides,
    })
  }

  const preprocess = (node: WorkflowNode, variables: Record<string, unknown> = {}) =>
    processor.preprocessNode(node, createContext({ 'chunker_1.chunks': chunks, ...variables }))

  beforeEach(() => {
    processor = new DatasetProcessor()
  })

  it('waits by default — an unset toggle is not "off"', async () => {
    const preprocessed = await preprocess(datasetNode())

    expect(preprocessed.inputs.waitForEmbeddings).toBe(true)
  })

  it('honours an explicit opt-out', async () => {
    const preprocessed = await preprocess(
      datasetNode({ waitForEmbeddings: false, fieldModes: { waitForEmbeddings: true } })
    )

    expect(preprocessed.inputs.waitForEmbeddings).toBe(false)
  })

  it.each([
    ['a real boolean false', false],
    ['the string "false"', 'false'],
  ])('lets a bound toggle turn the wait off for %s', async (_label, value) => {
    const preprocessed = await preprocess(
      datasetNode({
        waitForEmbeddings: 'settings_1.wait',
        fieldModes: { waitForEmbeddings: false },
      }),
      { 'settings_1.wait': value }
    )

    expect(preprocessed.inputs.waitForEmbeddings).toBe(false)
  })

  it('falls back to waiting when a bound toggle never resolves', async () => {
    const preprocessed = await preprocess(
      datasetNode({
        waitForEmbeddings: 'settings_1.missing',
        fieldModes: { waitForEmbeddings: false },
      })
    )

    expect(preprocessed.inputs.waitForEmbeddings).toBe(true)
  })

  it('defaults the timeout rather than leaving the wait unbounded', async () => {
    const preprocessed = await preprocess(datasetNode())

    expect(preprocessed.inputs.embeddingTimeoutMinutes).toBe(EMBEDDING_WAIT.DEFAULT_TIMEOUT_MINUTES)
  })

  it('resolves a bound timeout and clamps it into range', async () => {
    const node = datasetNode({
      embeddingTimeoutMinutes: 'settings_1.timeout',
      fieldModes: { embeddingTimeoutMinutes: false },
    })

    expect(
      (await preprocess(node, { 'settings_1.timeout': 30 })).inputs.embeddingTimeoutMinutes
    ).toBe(30)
    expect(
      (await preprocess(node, { 'settings_1.timeout': 100_000 })).inputs.embeddingTimeoutMinutes
    ).toBe(EMBEDDING_WAIT.MAX_TIMEOUT_MINUTES)
    expect(
      (await preprocess(node, { 'settings_1.timeout': 0 })).inputs.embeddingTimeoutMinutes
    ).toBe(EMBEDDING_WAIT.MIN_TIMEOUT_MINUTES)
  })

  it('declares bound wait settings as required variables', () => {
    const node = datasetNode({
      waitForEmbeddings: 'settings_1.wait',
      embeddingTimeoutMinutes: 'settings_1.timeout',
      fieldModes: { waitForEmbeddings: false, embeddingTimeoutMinutes: false },
    })

    // @ts-expect-error - exercising the protected contract directly
    const required = processor.extractRequiredVariables(node) as string[]

    expect(required).toContain('settings_1.wait')
    expect(required).toContain('settings_1.timeout')
  })

  it('warns that the wait is inert when embedding is skipped', async () => {
    // @ts-expect-error - exercising the protected contract directly
    const result = await processor.validateNodeConfig(
      datasetNode({ skipEmbedding: true, fieldModes: { skipEmbedding: true } })
    )

    expect(result.warnings).toContain('waitForEmbeddings has no effect when skipEmbedding is true')
  })
})

describe('embedding wait timeout', () => {
  beforeEach(() => {
    queueAdd.mockClear()
  })

  it('clamps a missing or nonsensical timeout to the default', () => {
    expect(clampEmbeddingTimeoutMinutes(undefined)).toBe(EMBEDDING_WAIT.DEFAULT_TIMEOUT_MINUTES)
    expect(clampEmbeddingTimeoutMinutes(Number.NaN)).toBe(EMBEDDING_WAIT.DEFAULT_TIMEOUT_MINUTES)
    expect(clampEmbeddingTimeoutMinutes(Number.POSITIVE_INFINITY)).toBe(
      EMBEDDING_WAIT.DEFAULT_TIMEOUT_MINUTES
    )
    expect(clampEmbeddingTimeoutMinutes(-5)).toBe(EMBEDDING_WAIT.MIN_TIMEOUT_MINUTES)
  })

  it('schedules a delayed resume that ends the wait', async () => {
    await scheduleEmbeddingTimeout({
      workflowRunId: 'run_1',
      nodeId: 'dataset_1',
      documentId: 'doc_1',
      timeoutMs: 15 * 60_000,
      originalNodeOutput: { documentId: 'doc_1', chunksAdded: 3 },
    })

    expect(queueAdd).toHaveBeenCalledTimes(1)
    const [name, data, opts] = queueAdd.mock.calls[0] as [string, any, any]

    expect(name).toBe('resumeWorkflowJob')
    expect(data.workflowRunId).toBe('run_1')
    expect(data.resumeFromNodeId).toBe('dataset_1')
    // The run continues on its normal handle with an honest status, rather than
    // sitting in WAITING forever behind a stuck embedding job.
    expect(data.nodeOutput.embeddingStatus).toBe('timeout')
    expect(data.nodeOutput.chunksAdded).toBe(3)
    expect(opts.delay).toBe(15 * 60_000)
    // Deterministic, so the finalize job can cancel this exact job in O(1).
    expect(opts.jobId).toBe(buildEmbeddingTimeoutJobId('run_1', 'dataset_1'))
  })
})

describe('embedding resume variables', () => {
  const documentProcessing: PauseReason = { type: 'document_processing', nodeId: 'dataset_1' }

  it('publishes the outcome the resume payload carries', () => {
    expect(
      embeddingResumeVariables(documentProcessing, {
        embeddingStatus: 'completed',
        segmentsEmbedded: 12,
        processingTimeMs: 4200,
        completedAt: '2026-08-11T00:00:00.000Z',
        documentId: 'doc_1',
      })
    ).toEqual({
      embeddingStatus: 'completed',
      segmentsEmbedded: 12,
      processingTimeMs: 4200,
      completedAt: '2026-08-11T00:00:00.000Z',
    })
  })

  it('publishes a timeout the same way, so the branch can see it', () => {
    expect(
      embeddingResumeVariables(documentProcessing, {
        embeddingStatus: 'timeout',
        error: 'Embeddings did not complete within 15 minute(s)',
      })
    ).toEqual({
      embeddingStatus: 'timeout',
      error: 'Embeddings did not complete within 15 minute(s)',
    })
  })

  it('is inert for every other pause type', () => {
    expect(
      embeddingResumeVariables({ type: 'wait', nodeId: 'wait_1' }, { embeddingStatus: 'completed' })
    ).toBeNull()
    expect(embeddingResumeVariables(undefined, { embeddingStatus: 'completed' })).toBeNull()
    expect(embeddingResumeVariables(documentProcessing, undefined)).toBeNull()
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

/**
 * The step-4 acceptance criterion (plan 21, PR B): a node of a newly opted-in
 * type that carries NO stored `error_strategy` — which is every row that
 * existed before the opt-in — must behave exactly as it did before.
 *
 * Before: the processor returned `status: Failed` with `outputHandle: 'error'`,
 * a handle no manifest declared and no canvas could wire, so `findFailureEdge`
 * found nothing and `workflow-engine.ts` threw.
 *
 * After: the same node resolves to `fail` (the catalog-wide default), emits the
 * DECLARED `fail` handle — and because it never rendered that handle, no edge
 * can address it, so `findFailureEdge` still finds nothing and the run still
 * dies. Same fatal outcome, over a vocabulary an author can now opt into.
 */
describe('failure policy — behaviour preservation for the step-4 opt-ins', () => {
  const failingNode = (type: WorkflowNodeType) =>
    createNode(type, { title: 'Legacy node' /* no error_strategy key */ })

  it('chunker fails onto the declared `fail` handle', async () => {
    const processor = new ChunkerProcessor()
    // No preprocessed inputs — the processor's own guard throws, which is the
    // failure path without reaching any I/O.
    const result = await (processor as any).executeNode(
      failingNode(WorkflowNodeType.CHUNKER),
      createContext(),
      undefined
    )
    expect(result.status).toBe('failed')
    expect(result.outputHandle).toBe('fail')
  })

  it('dataset fails onto the declared `fail` handle', async () => {
    const processor = new DatasetProcessor()
    const result = await (processor as any).executeNode(
      failingNode(WorkflowNodeType.DATASET),
      createContext(),
      undefined
    )
    expect(result.status).toBe('failed')
    expect(result.outputHandle).toBe('fail')
  })

  it('knowledge-retrieval fails onto the declared `fail` handle', async () => {
    const processor = new KnowledgeRetrievalProcessor()
    const result = await (processor as any).executeNode(
      failingNode(WorkflowNodeType.KNOWLEDGE_RETRIEVAL),
      createContext(),
      undefined
    )
    expect(result.status).toBe('failed')
    expect(result.outputHandle).toBe('fail')
  })

  it('document-extractor fails onto the declared `fail` handle', async () => {
    const processor = new DocumentExtractorProcessor()
    const context = createContext()
    vi.spyOn(context, 'getVariable').mockRejectedValue(new Error('context unavailable'))
    const result = await (processor as any).executeNode(
      failingNode(WorkflowNodeType.DOCUMENT_EXTRACTOR),
      context,
      undefined
    )
    expect(result.status).toBe('failed')
    expect(result.outputHandle).toBe('fail')
  })

  it('`continue` succeeds on `source` instead, carrying the error in the output', async () => {
    // The capability the opt-in exists for: "this one document was corrupt,
    // keep going" (plan 21 §14.3). Only reachable once the author sets the key.
    const processor = new ChunkerProcessor()
    const result = await (processor as any).executeNode(
      createNode(WorkflowNodeType.CHUNKER, { error_strategy: 'continue' }),
      createContext(),
      undefined
    )
    expect(result.status).toBe('succeeded')
    expect(result.outputHandle).toBe('source')
    expect(result.output).toMatchObject({ success: false })
  })

  it('no processor in the cluster emits the undeclared `error` handle any more', async () => {
    // The whole point of §14.4 option C: one error vocabulary, not two.
    for (const [type, processor] of [
      [WorkflowNodeType.CHUNKER, new ChunkerProcessor()],
      [WorkflowNodeType.DATASET, new DatasetProcessor()],
      [WorkflowNodeType.KNOWLEDGE_RETRIEVAL, new KnowledgeRetrievalProcessor()],
    ] as const) {
      const result = await (processor as any).executeNode(
        failingNode(type),
        createContext(),
        undefined
      )
      expect(result.outputHandle).not.toBe('error')
    }
  })
})

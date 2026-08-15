// packages/lib/src/workflow-engine/catalog/dataset-family.test.ts

import { describe, expect, it } from 'vitest'
import {
  CHUNKER_DEFAULT_CHUNK_OVERLAP,
  CHUNKER_DEFAULT_CHUNK_SIZE,
  type ChunkerNodeData,
  chunkerManifest,
  extractChunkerVariables,
  getChunkerOutputVariables,
  validateChunkerConfig,
} from './nodes/chunker'
import {
  type DatasetNodeData,
  datasetManifest,
  extractDatasetVariables,
  getDatasetOutputVariables,
  validateDatasetConfig,
} from './nodes/dataset'
import {
  type DocumentExtractorNodeData,
  DocumentSourceType,
  documentExtractorManifest,
  extractDocumentExtractorVariables,
  getDocumentExtractorOutputVariables,
  validateDocumentExtractorConfig,
} from './nodes/document-extractor'
import { getManifest, listManifests } from './registry'

/**
 * The RAG-cluster manifests (`document-extractor` → `chunker` → `dataset`),
 * migrated together as the follow-up to `knowledge-retrieval` (#1644).
 *
 * The catalog-coverage suite in apps/web already parses each manifest's
 * `defaultData()` against its own `configSchema` and asserts registry/tracker
 * set equality, and the output-resolution parity suite compares each resolver
 * across the browser and server orchestrations. What is NOT covered there, and
 * is covered here, is the config-DEPENDENT behaviour: the two resolvers that
 * change shape with config, and the validators (two of which are new — neither
 * `dataset` nor `document-extractor` had one before the migration).
 */

const NODE_ID = 'n1'

function paths(variables: Array<{ id: string }>): string[] {
  return variables.map((v) => v.id.replace(`${NODE_ID}.`, ''))
}

function chunker(overrides: Partial<ChunkerNodeData> = {}): ChunkerNodeData {
  return {
    id: NODE_ID,
    type: 'chunker',
    title: 'Chunker',
    selected: false,
    ...chunkerManifest.defaultData(),
    ...overrides,
  } as ChunkerNodeData
}

function dataset(overrides: Partial<DatasetNodeData> = {}): DatasetNodeData {
  return {
    id: NODE_ID,
    type: 'dataset',
    title: 'Dataset',
    selected: false,
    ...datasetManifest.defaultData(),
    ...overrides,
  } as DatasetNodeData
}

function extractor(overrides: Partial<DocumentExtractorNodeData> = {}): DocumentExtractorNodeData {
  return {
    id: NODE_ID,
    type: 'document-extractor',
    title: 'Document Extractor',
    selected: false,
    ...documentExtractorManifest.defaultData(),
    ...overrides,
  } as DocumentExtractorNodeData
}

describe('dataset-family manifests are registered', () => {
  it('resolves all three through the registry', () => {
    for (const id of ['document-extractor', 'chunker', 'dataset']) {
      expect(getManifest(id), id).toBeDefined()
    }
  })

  it('marks all three authorable, so Kopilot can build an ingest pipeline end to end', () => {
    // knowledge-retrieval alone is useless without something that FILLS a
    // dataset — an agent that can author the reader but not the writer can only
    // ever build half the pipeline.
    const authorable = new Set(
      listManifests()
        .filter((m) => m.agent?.authorable)
        .map((m) => m.id)
    )
    expect(authorable).toContain('document-extractor')
    expect(authorable).toContain('chunker')
    expect(authorable).toContain('dataset')
  })
})

describe('chunker', () => {
  it('seeds defaults the engine also falls back to', () => {
    // The engine uses these same constants when the field is unset
    // (`nodes/dataset/chunker.ts`), so a node built from defaults and a node
    // with the fields stripped chunk identically.
    const defaults = chunkerManifest.defaultData()
    expect(defaults.chunkSize).toBe(CHUNKER_DEFAULT_CHUNK_SIZE)
    expect(defaults.chunkOverlap).toBe(CHUNKER_DEFAULT_CHUNK_OVERLAP)
  })

  it('requires content, and rejects an overlap at or above the chunk size', () => {
    expect(validateChunkerConfig(chunker()).isValid).toBe(false)
    expect(validateChunkerConfig(chunker({ content: 'extractor_1.content' })).isValid).toBe(true)

    const result = validateChunkerConfig(
      chunker({ content: 'extractor_1.content', chunkSize: 100, chunkOverlap: 100 })
    )
    expect(result.isValid).toBe(false)
    expect(result.errors.map((e) => e.field)).toContain('chunkOverlap')
  })

  it('leaves an overlap-too-large config publishable, as a WARNING', () => {
    // Deliberately preserved from the pre-migration validator even though the
    // engine's `preprocessNode` THROWS on the same condition. Raising it would
    // newly block publishing — its own decision, not a migration side effect.
    const result = validateChunkerConfig(
      chunker({ content: 'extractor_1.content', chunkSize: 100, chunkOverlap: 90 })
    )
    expect(result.isValid).toBe(true)
    expect(result.errors.some((e) => e.type === 'warning')).toBe(true)
  })

  it('never range-checks a variable-bound size — the value is unknown until the run', () => {
    const result = validateChunkerConfig(
      chunker({
        content: 'extractor_1.content',
        chunkSize: 'var_1.size',
        chunkOverlap: 'var_1.overlap',
      })
    )
    expect(result.isValid).toBe(true)
  })

  it('extracts bound numeric/boolean settings but not literal ones', () => {
    const ids = extractChunkerVariables(
      chunker({
        content: 'extractor_1.content',
        chunkSize: 'sizing_1.chunkSize',
        chunkOverlap: 50,
        normalizeWhitespace: 'flags_1.normalize',
      })
    )
    expect(new Set(ids)).toEqual(
      new Set(['extractor_1.content', 'sizing_1.chunkSize', 'flags_1.normalize'])
    )
  })

  it('advertises the same five paths regardless of config', () => {
    // The processor publishes all five on BOTH the success and the failure
    // path, so nothing here may be config-gated.
    const expected = ['chunks', 'chunkCount', 'metadata', 'success', 'error']
    expect(paths(getChunkerOutputVariables(chunker(), NODE_ID))).toEqual(expected)
    expect(paths(getChunkerOutputVariables(chunker({ chunkSize: 8000 }), NODE_ID))).toEqual(
      expected
    )
  })
})

describe('dataset', () => {
  it('requires a target dataset and a chunks input (new validator)', () => {
    const fresh = validateDatasetConfig(dataset())
    expect(fresh.isValid).toBe(false)
    expect(fresh.errors.map((e) => e.field).sort()).toEqual(['chunks', 'datasetId'])

    expect(
      validateDatasetConfig(dataset({ datasetId: 'ds_1', chunks: 'chunker_1.chunks' })).isValid
    ).toBe(true)
  })

  it('warns — never blocks — on a timeout the engine will silently clamp', () => {
    const result = validateDatasetConfig(
      dataset({ datasetId: 'ds_1', chunks: 'chunker_1.chunks', embeddingTimeoutMinutes: 500 })
    )
    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual([
      expect.objectContaining({ field: 'embeddingTimeoutMinutes', type: 'warning' }),
    ])
  })

  it('advertises the wait-only outputs when the node waits', () => {
    const waitOnly = ['segmentsEmbedded', 'processingTimeMs', 'completedAt']
    const withWait = paths(getDatasetOutputVariables(dataset(), NODE_ID))
    expect(withWait).toEqual(expect.arrayContaining(waitOnly))
  })

  it('withdraws them for a node that cannot produce them', () => {
    // They are written only on the way back in from the embedding pause, so a
    // node that never pauses would offer paths resolving to nothing.
    const waitOnly = ['segmentsEmbedded', 'processingTimeMs', 'completedAt']
    for (const config of [{ waitForEmbeddings: false }, { skipEmbedding: true }]) {
      const advertised = paths(getDatasetOutputVariables(dataset(config), NODE_ID))
      expect(
        waitOnly.some((p) => advertised.includes(p)),
        JSON.stringify(config)
      ).toBe(false)
    }
  })

  it('keeps advertising them when the toggle is variable-bound — unknowable here', () => {
    const advertised = paths(
      getDatasetOutputVariables(dataset({ waitForEmbeddings: 'flags_1.wait' }), NODE_ID)
    )
    expect(advertised).toContain('segmentsEmbedded')
  })

  it('extracts a chunks reference regardless of field mode', () => {
    // `chunks` is always a reference to a Chunker node's array output; there is
    // no constant form of it.
    const ids = extractDatasetVariables(
      dataset({ chunks: 'chunker_1.chunks', fieldModes: { chunks: true } })
    )
    expect(ids).toContain('chunker_1.chunks')
  })
})

describe('document-extractor', () => {
  it('requires a file for a file source and a URL for a URL source (new validator)', () => {
    expect(validateDocumentExtractorConfig(extractor()).errors.map((e) => e.field)).toEqual([
      'fileId',
    ])
    expect(
      validateDocumentExtractorConfig(extractor({ fileId: 'trigger_1.file.id' })).isValid
    ).toBe(true)

    expect(
      validateDocumentExtractorConfig(extractor({ sourceType: DocumentSourceType.URL })).errors.map(
        (e) => e.field
      )
    ).toEqual(['url'])
  })

  it('checks the scheme of a literal URL only', () => {
    const url = (value: string, fieldModes?: Record<string, boolean>) =>
      validateDocumentExtractorConfig(
        extractor({ sourceType: DocumentSourceType.URL, url: value, fieldModes })
      ).isValid

    expect(url('example.com/doc.pdf')).toBe(false)
    expect(url('https://example.com/doc.pdf')).toBe(true)
    // A bound field, or a constant carrying a template, is unknowable until the
    // run — the processor re-checks the RESOLVED value.
    expect(url('trigger_1.url', { url: false })).toBe(true)
    expect(url('{{trigger_1.url}}')).toBe(true)
  })

  it('advertises the metadata properties of the CHOSEN source only', () => {
    const metadataKeys = (data: DocumentExtractorNodeData) =>
      Object.keys(
        getDocumentExtractorOutputVariables(data, NODE_ID).find(
          (v) => v.id === `${NODE_ID}.metadata`
        )?.properties ?? {}
      ).sort()

    expect(metadataKeys(extractor())).toEqual(['extractorUsed', 'fileName', 'fileSize', 'mimeType'])
    expect(metadataKeys(extractor({ sourceType: DocumentSourceType.URL }))).toEqual([
      'contentLength',
      'extractorUsed',
      'fileName',
      'mimeType',
      'sourceUrl',
    ])
  })

  it('ignores the source field the current sourceType does not read', () => {
    // Switching file → url leaves the old `fileId` behind in `data`; declaring a
    // dependency on it would keep a deleted upstream node alive in the graph.
    const ids = extractDocumentExtractorVariables(
      extractor({
        sourceType: DocumentSourceType.URL,
        fileId: 'trigger_1.file.id',
        url: 'trigger_1.url',
      })
    )
    expect(ids).toEqual(['trigger_1.url'])
  })
})

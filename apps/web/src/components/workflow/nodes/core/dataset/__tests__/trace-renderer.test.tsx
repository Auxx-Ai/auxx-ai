// apps/web/src/components/workflow/nodes/core/dataset/__tests__/trace-renderer.test.tsx
//
// Same reason as the knowledge-retrieval renderer's suite: `TraceRenderBoundary`
// swallows crashes, so a renderer that throws on every real payload looks like
// "no preview" rather than like a failure.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DatasetTraceRenderer } from '../trace-renderer'

/** Minimal `TraceRendererProps` — the renderer only reads `execution`. */
function renderTrace(outputs: unknown) {
  return render(
    // biome-ignore lint/suspicious/noExplicitAny: test double for the execution row
    <DatasetTraceRenderer execution={{ outputs } as any} />
  )
}

describe('DatasetTraceRenderer', () => {
  it('renders a completed ingest with its embedding counts', () => {
    renderTrace({
      documentId: 'doc_1',
      segmentIds: ['seg_1', 'seg_2'],
      chunksAdded: 2,
      embeddingStatus: 'completed',
      datasetId: 'ds_1',
      success: true,
      segmentsEmbedded: 2,
      processingTimeMs: 1840,
    })

    expect(screen.getByText('Document doc_1')).toBeTruthy()
    expect(screen.getByText('completed')).toBeTruthy()
    expect(screen.getByText('2 chunks added · 2 embedded · 1840ms')).toBeTruthy()
    expect(screen.getByText('Dataset ds_1')).toBeTruthy()
  })

  it('warns when the run did not wait — the vectors are not there yet', () => {
    // `waitForEmbeddings: false` reports success while the dataset still holds
    // no vectors, which is exactly the failure a knowledge-retrieval node later
    // in the same run reads as "no results".
    renderTrace({
      documentId: 'doc_1',
      chunksAdded: 40,
      embeddingStatus: 'queued',
      datasetId: 'ds_1',
      success: true,
    })

    expect(screen.getByText('queued')).toBeTruthy()
    expect(screen.getByText(/may not\s+see this document yet/)).toBeTruthy()
  })

  it('renders a failed run with its error', () => {
    renderTrace({
      embeddingStatus: 'failed',
      success: false,
      error: 'Chunks array is empty',
    })

    expect(screen.getByText('Chunks array is empty')).toBeTruthy()
  })

  it('degrades to raw JSON on an unrecognised shape instead of throwing', () => {
    const { container } = renderTrace({ something: 'else' })
    expect(container.querySelector('pre')).toBeTruthy()
  })

  it('survives a null/absent outputs payload', () => {
    expect(() => renderTrace(undefined)).not.toThrow()
  })
})

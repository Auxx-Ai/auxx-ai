// apps/web/src/components/workflow/nodes/core/document-extractor/__tests__/trace-renderer.test.tsx
//
// Same reason as the knowledge-retrieval renderer's suite: `TraceRenderBoundary`
// swallows crashes, so a renderer that throws on every real payload looks like
// "no preview" rather than like a failure.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentExtractorTraceRenderer } from '../trace-renderer'

/** Minimal `TraceRendererProps` — the renderer only reads `execution`. */
function renderTrace(outputs: unknown) {
  return render(
    // biome-ignore lint/suspicious/noExplicitAny: test double for the execution row
    <DocumentExtractorTraceRenderer execution={{ outputs } as any} />
  )
}

describe('DocumentExtractorTraceRenderer', () => {
  it('renders a file extraction with its file metadata', () => {
    renderTrace({
      content: 'Returns are accepted within 30 days.',
      wordCount: 6,
      metadata: {
        fileName: 'returns-policy.pdf',
        mimeType: 'application/pdf',
        fileSize: 20480,
        extractorUsed: 'pdf-extractor',
      },
      success: true,
    })

    expect(screen.getByText('returns-policy.pdf')).toBeTruthy()
    expect(screen.getByText('pdf-extractor')).toBeTruthy()
    expect(screen.getByText('6 words · 36 chars · 20 KB · application/pdf')).toBeTruthy()
    expect(screen.getByText('Returns are accepted within 30 days.')).toBeTruthy()
  })

  it('renders a URL extraction, which reports contentLength instead of fileSize', () => {
    renderTrace({
      content: 'Handbook text.',
      wordCount: 2,
      metadata: {
        sourceUrl: 'https://example.com/handbook',
        fileName: 'handbook',
        mimeType: 'text/html',
        contentLength: 512,
        extractorUsed: 'html-extractor',
      },
      success: true,
    })

    expect(screen.getByText('handbook')).toBeTruthy()
    expect(screen.getByText('2 words · 14 chars · 512 B · text/html')).toBeTruthy()
  })

  it('clamps the extracted text for DISPLAY only', () => {
    // The persisted content feeds a Chunker node verbatim — truncating the
    // stored value would shorten every chunk downstream.
    const long = 'x'.repeat(2000)
    const outputs = { content: long, wordCount: 1, success: true }
    renderTrace(outputs)

    const painted = screen.getByText(/^x+…$/)
    expect(painted.textContent!.length).toBeLessThan(long.length)
    expect(outputs.content).toHaveLength(2000)
  })

  it('renders a failed run with its error', () => {
    renderTrace({
      content: '',
      wordCount: 0,
      metadata: {},
      success: false,
      error: 'URL must start with http:// or https://',
    })

    expect(screen.getByText('URL must start with http:// or https://')).toBeTruthy()
  })

  it('says so when a successful run extracted no text', () => {
    renderTrace({ content: '', wordCount: 0, metadata: { fileName: 'scan.pdf' }, success: true })
    expect(screen.getByText('No text extracted')).toBeTruthy()
  })

  it('degrades to raw JSON on an unrecognised shape instead of throwing', () => {
    const { container } = renderTrace({ something: 'else' })
    expect(container.querySelector('pre')).toBeTruthy()
  })

  it('survives a null/absent outputs payload', () => {
    expect(() => renderTrace(undefined)).not.toThrow()
  })
})

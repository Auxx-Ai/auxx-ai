// apps/web/src/components/workflow/nodes/core/chunker/__tests__/trace-renderer.test.tsx
//
// Same reason as the knowledge-retrieval renderer's suite: `TraceRenderBoundary`
// swallows crashes, so a renderer that throws on every real payload looks like
// "no preview" rather than like a failure. The parity harness doesn't cover
// renderers at all.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChunkerTraceRenderer } from '../trace-renderer'

/** Minimal `TraceRendererProps` — the renderer only reads `execution`. */
function renderTrace(outputs: unknown) {
  return render(
    // biome-ignore lint/suspicious/noExplicitAny: test double for the execution row
    <ChunkerTraceRenderer execution={{ outputs } as any} />
  )
}

function chunk(position: number, content: string) {
  return { content, position, tokenCount: Math.ceil(content.length / 4), wordCount: 3 }
}

describe('ChunkerTraceRenderer', () => {
  it('summarises the split and lists the chunks', () => {
    renderTrace({
      chunks: [chunk(0, 'First passage.'), chunk(1, 'Second passage.')],
      chunkCount: 2,
      metadata: { averageChunkSize: 15, minChunkSize: 14, maxChunkSize: 15, totalTokens: 8 },
      success: true,
    })

    expect(screen.getByText('2 chunks · avg 15 chars · 14–15 · ~8 tokens')).toBeTruthy()
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getByText('#2')).toBeTruthy()
    expect(screen.getByText('First passage.')).toBeTruthy()
  })

  it('caps the painted rows without touching the payload', () => {
    // A default 1000-char split over a long document produces hundreds of
    // chunks; a Dataset node downstream writes every one of them verbatim, so
    // the clamp must be display-only.
    const chunks = Array.from({ length: 25 }, (_, i) => chunk(i, `Chunk ${i}`))
    const outputs = { chunks, chunkCount: 25, success: true }
    renderTrace(outputs)

    expect(screen.getByText('#20')).toBeTruthy()
    expect(screen.queryByText('#21')).toBeNull()
    expect(screen.getByText('+5 more in the Outputs tab')).toBeTruthy()
    expect(outputs.chunks).toHaveLength(25)
  })

  it('clamps a long passage for DISPLAY only', () => {
    const long = 'x'.repeat(500)
    const outputs = { chunks: [chunk(0, long)], chunkCount: 1, success: true }
    renderTrace(outputs)

    const painted = screen.getByText(/^x+…$/)
    expect(painted.textContent!.length).toBeLessThan(long.length)
    expect(outputs.chunks[0]!.content).toHaveLength(500)
  })

  it('renders a failed run: the error, and no chunks', () => {
    renderTrace({
      chunks: [],
      chunkCount: 0,
      success: false,
      error: 'Content is empty after preprocessing',
    })

    expect(screen.getByText('Content is empty after preprocessing')).toBeTruthy()
    expect(screen.getByText('No chunks produced')).toBeTruthy()
  })

  it('degrades to raw JSON on an unrecognised shape instead of throwing', () => {
    const { container } = renderTrace({ something: 'else' })
    expect(container.querySelector('pre')).toBeTruthy()
  })

  it('survives a null/absent outputs payload', () => {
    expect(() => renderTrace(undefined)).not.toThrow()
  })
})

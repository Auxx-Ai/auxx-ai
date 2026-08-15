// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/__tests__/trace-renderer.test.tsx
//
// There is no precedent for this — zero trace renderers had tests before this
// file, and the parity harness doesn't cover them. It exists precisely BECAUSE
// `TraceRenderBoundary` swallows crashes: a renderer that throws on every real
// payload looks like "no preview", not like a failure. So a smoke test over the
// three real output shapes is the only thing that would catch it.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { KnowledgeRetrievalTraceRenderer } from '../trace-renderer'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

/** Minimal `TraceRendererProps` — the renderer only reads `execution`. */
function renderTrace(outputs: unknown) {
  return render(
    <KnowledgeRetrievalTraceRenderer
      // biome-ignore lint/suspicious/noExplicitAny: test double for the execution row
      execution={{ outputs } as any}
    />
  )
}

const KB_RESULT = {
  segmentId: 'seg_1',
  content: 'Refunds are issued to the original payment method within 5-7 business days.',
  score: 0.92,
  documentTitle: 'Refund policy',
  datasetName: 'Help Center',
  source: 'kb' as const,
  articleId: 'art_refunds',
  kbId: 'kb_public',
  docSlug: 'help/policies/refund-policy',
}

const RAG_RESULT = {
  segmentId: 'seg_r',
  content: 'Uploaded handbook text.',
  score: 0.71,
  documentTitle: 'Handbook',
  datasetName: 'Uploads',
  source: 'rag' as const,
}

describe('KnowledgeRetrievalTraceRenderer', () => {
  it('renders a KB hit with a deep link into the KB editor', () => {
    renderTrace({
      results: [KB_RESULT],
      total: 1,
      responseTime: 340,
      searchType: 'hybrid',
      success: true,
    })

    expect(screen.getByText('1 result · hybrid · 340ms')).toBeTruthy()

    // `auxx://doc/<slug>` chips don't render outside assistant messages, so a
    // KB hit must deep-link by route instead — which needs kbId + articleId.
    const link = screen.getByRole('link', { name: 'Refund policy' })
    expect(link.getAttribute('href')).toBe('/app/kb/kb_public/editor/r/art_refunds')

    expect(screen.getByText('0.92')).toBeTruthy()
    expect(screen.getByText('Help Center')).toBeTruthy()
  })

  it('renders a RAG hit with no link — it has no article to point at', () => {
    renderTrace({
      results: [RAG_RESULT],
      total: 1,
      responseTime: 12,
      searchType: 'vector',
      success: true,
    })

    expect(screen.getByText('Handbook')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders a failed run: the error, and no results', () => {
    renderTrace({
      results: [],
      total: 0,
      responseTime: 5,
      searchType: 'hybrid',
      success: false,
      error: 'No accessible knowledge sources',
    })

    expect(screen.getByText('No accessible knowledge sources')).toBeTruthy()
    expect(screen.getByText('No results')).toBeTruthy()
  })

  it('clamps the snippet for DISPLAY only, leaving the payload untouched (K11)', () => {
    const long = 'x'.repeat(500)
    const outputs = {
      results: [{ ...KB_RESULT, content: long }],
      total: 1,
      success: true,
    }
    renderTrace(outputs)

    // Painted text is clamped…
    const painted = screen.getByText(/^x+…$/)
    expect(painted.textContent!.length).toBeLessThan(long.length)
    // …while the object handed in is not mutated — a downstream ai/answer node
    // consumes the full passage.
    expect(outputs.results[0]!.content).toHaveLength(500)
  })

  it('degrades to raw JSON on an unrecognised shape instead of throwing', () => {
    const { container } = renderTrace({ something: 'else' })
    expect(container.querySelector('pre')).toBeTruthy()
  })

  it('survives a null/absent outputs payload', () => {
    expect(() => renderTrace(undefined)).not.toThrow()
  })
})

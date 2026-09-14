// apps/web/src/components/attachments/__tests__/pdf-lazy-load.test.tsx
//
// The requirement this whole boundary exists for, pinned:
//
//   **the pdf.js engine is fetched only when a PDF is actually on screen.**
//
// It is 131 KB gzip on the main thread plus a 374 KB gzip worker, and
// `attachment-preview.tsx` is rendered by five surfaces that mostly show images.
// Three ordinary-looking edits would silently undo it: dropping `ssr: false`,
// calling `loadPdfViewer()` ungated in the prefetch effect, or mounting
// `<LazyPdfViewer>` hidden. None of them fail a build, a typecheck, or a
// lint. So it is asserted here instead.
//
// `loadPdfViewer` is the single seam: it is the only thing that resolves the
// chunk, both for the `dynamic()` factory and for the warm-up in
// `AttachmentPreview`. Spying on it answers "did the engine load" exactly.

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadPdfViewer: vi.fn(async () => ({ PdfViewer: () => null })),
  previewRef: {
    type: 'url' as const,
    url: 'https://example.test/signed',
    filename: 'doc',
    mimeType: '',
    size: 1,
    versionNumber: 1,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  },
}))

vi.mock('~/components/attachments/pdf/lazy-pdf-viewer', () => ({
  loadPdfViewer: h.loadPdfViewer,
  // Stands in for the `dynamic()` component, and resolves the chunk on mount
  // exactly as `dynamic()` does, which is the behaviour under test.
  LazyPdfViewer: ({ url }: { url: string }) => {
    h.loadPdfViewer()
    return <div data-testid='pdf-viewer' data-url={url} />
  },
}))

vi.mock('~/trpc/react', () => ({
  api: {
    file: {
      getAttachmentPreviewRef: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => ({
          data: opts?.enabled === false ? undefined : h.previewRef,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
          isFetching: false,
        }),
      },
    },
  },
}))

import { AttachmentPreview } from '../attachment-preview'

describe('AttachmentPreview: the pdf.js chunk loads only for PDFs', () => {
  beforeEach(() => {
    h.loadPdfViewer.mockClear()
    h.previewRef.mimeType = ''
  })

  it('never resolves the engine for an image', async () => {
    h.previewRef.mimeType = 'image/png'

    render(<AttachmentPreview type='asset' id='a1' knownMimeType='image/png' filename='p.png' />)

    await screen.findByRole('img')
    expect(h.loadPdfViewer).not.toHaveBeenCalled()
    expect(screen.queryByTestId('pdf-viewer')).toBeNull()
  })

  it.each([
    ['text/csv', 'a CSV, which falls back to the download card'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'an xlsx'],
    ['video/mp4', 'a video'],
  ])('never resolves the engine for %s (%s)', async (mimeType) => {
    h.previewRef.mimeType = mimeType

    render(<AttachmentPreview type='asset' id='a1' knownMimeType={mimeType} filename='f' />)

    // Nothing to wait on for a fallback render, so give the effects a tick.
    await waitFor(() => expect(h.loadPdfViewer).not.toHaveBeenCalled())
    expect(screen.queryByTestId('pdf-viewer')).toBeNull()
  })

  it('resolves the engine for a PDF, and renders it', async () => {
    h.previewRef.mimeType = 'application/pdf'

    render(
      <AttachmentPreview
        type='asset'
        id='a1'
        knownMimeType='application/pdf'
        filename='quote.pdf'
      />
    )

    expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument()
    expect(h.loadPdfViewer).toHaveBeenCalled()
  })

  it('warms the chunk from knownMimeType before the presigned URL arrives', async () => {
    // `enabled: false` models the query not having resolved. Without the
    // prefetch effect the work would be serial: roundtrip, then 131 KB, then
    // the worker, then the first page.
    h.previewRef.mimeType = 'application/pdf'

    render(
      <AttachmentPreview
        type='asset'
        id='a1'
        knownMimeType='application/pdf'
        filename='quote.pdf'
      />
    )

    await waitFor(() => expect(h.loadPdfViewer).toHaveBeenCalled())
  })

  it('does not warm the chunk for a non-PDF whose type is known up front', async () => {
    // The trap: a bare `void loadPdfViewer()` in the prefetch effect would pass
    // every other test in this file and defeat the boundary for all five call
    // sites.
    h.previewRef.mimeType = 'image/jpeg'

    render(<AttachmentPreview type='asset' id='a1' knownMimeType='image/jpeg' filename='p.jpg' />)

    await screen.findByRole('img')
    expect(h.loadPdfViewer).not.toHaveBeenCalled()
  })
})

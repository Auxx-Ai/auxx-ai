// apps/web/src/components/attachments/pdf/lazy-pdf-viewer.tsx

'use client'

import { Spinner } from '@auxx/ui/components/spinner'
import dynamic from 'next/dynamic'
// Types only, erased at compile time, so this does NOT pull the engine in.
import type { PdfViewerProps } from './pdf-viewer'

/**
 * Resolve the pdf.js chunk.
 *
 * Exported so `AttachmentPreview` can warm it the moment it knows the MIME type
 * is `application/pdf`, in parallel with the presign query, instead of waiting
 * for that roundtrip to finish before starting a 131 KB download. Calling it for
 * anything that is not a PDF defeats the whole boundary.
 */
export const loadPdfViewer = () => import('./pdf-viewer')

/**
 * The PDF engine, behind a boundary that resolves on first mount.
 *
 * `dynamic()` fetches nothing when this module is evaluated, the `import()`
 * inside the factory fires when the component is first mounted. Since
 * `AttachmentPreview` only renders this from `case 'pdf'`, an image, a CSV or a
 * `.docx` never resolves the chunk. Importing `attachment-preview.tsx` is free;
 * rendering a PDF is the trigger.
 *
 * ⚠️ `ssr: false` is load-bearing beyond the fact that pdf.js needs `window`.
 * Without it Next server-renders this for the initial HTML and emits a preload
 * link for its chunk, which drags the download back to page load whether or not
 * a PDF is on screen.
 *
 * ⚠️ Never mount this hidden, inside a `hidden` div, a collapsed tab, or a
 * closed dialog that still mounts children. That resolves the chunk exactly as a
 * visible mount would. The `switch` in `renderPreview()` is safe because it
 * returns exactly one branch.
 */
export const LazyPdfViewer = dynamic<PdfViewerProps>(
  () => loadPdfViewer().then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className='flex h-full items-center justify-center'>
        <Spinner className='size-5 text-muted-foreground' />
      </div>
    ),
  }
)

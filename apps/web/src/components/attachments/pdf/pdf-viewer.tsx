// apps/web/src/components/attachments/pdf/pdf-viewer.tsx

'use client'

// 🛑 **This is the only file in the repo that may import `react-pdf` or
// `pdfjs-dist` as a value.** The engine is 131 KB gzip on the main thread plus a
// 374 KB gzip worker, and it reaches the browser only because `lazy-pdf-viewer`
// keeps it behind a `dynamic()` boundary that resolves on first mount. A value
// import from any eagerly-reachable module puts the whole graph in the shared
// chunk. The build still succeeds and nothing warns. `import type` is fine
// anywhere; see `plans/attachments/11-pdf-viewer.md` §3.4.

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Spinner } from '@auxx/ui/components/spinner'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, type DocumentProps, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import { type PdfMode, PdfToolbar } from './pdf-toolbar'
import { usePdfBytes } from './use-pdf-bytes'
import { usePdfSearch } from './use-pdf-search'

/**
 * Where `copy-pdfjs-assets.ts` put this version's runtime files.
 *
 * The version comes from the engine itself, so bumping `pdfjs-dist` re-points
 * these with no second edit and no cache-busting query string.
 */
const ASSET_BASE = `/pdfjs/${pdfjs.version}`

// ⚠️ Set in THIS module, not a shared one. react-pdf's own docs are explicit:
// assigning `workerSrc` from a separate file can let react-pdf's default
// overwrite it, depending on module execution order.
pdfjs.GlobalWorkerOptions.workerSrc = `${ASSET_BASE}/pdf.worker.min.mjs`

/**
 * Runtime asset URLs. Every one of these defaults to `null` in pdfjs 6, and each
 * omission fails silently and type-specifically: no `cMapUrl` blanks CJK text
 * that does not embed its fonts, no `wasmUrl` breaks JPEG 2000 / JBIG2 scans.
 *
 * Module-level so its identity is stable: `<Document>` reloads the file
 * whenever `options` changes by value.
 */
const PDF_OPTIONS = {
  cMapUrl: `${ASSET_BASE}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${ASSET_BASE}/standard_fonts/`,
  wasmUrl: `${ASSET_BASE}/wasm/`,
  iccUrl: `${ASSET_BASE}/iccs/`,
}

/** Fallback page shape before the first page reports its own, i.e. US Letter. */
const DEFAULT_ASPECT = 11 / 8.5

/**
 * pdf.js's loaded-document handle.
 *
 * Derived from react-pdf's own prop type rather than imported from `pdfjs-dist`:
 * that package is a transitive dependency here, not one `apps/web/package.json`
 * declares, and this repo resolves imports relative to the importing file.
 */
type PdfDocument = Parameters<NonNullable<DocumentProps['onLoadSuccess']>>[0]

export interface PdfViewerProps {
  /** Presigned URL for the bytes. Fetched once, in full. See `usePdfBytes`. */
  url: string
  filename?: string
}

/**
 * A PDF, rendered by us rather than by the browser.
 *
 * The browser's own viewer was doing this job through an `<iframe>` until now,
 * which worked right up until someone's Chrome had
 * `chrome://settings/content/pdfDocuments` set to "Download PDFs". Then the
 * pane became a download stub we could not detect, because `onError` never fires
 * on an iframe whose document loaded fine.
 */
export function PdfViewer({ url, filename }: PdfViewerProps) {
  const { bytes, error: fetchError, isLoading } = usePdfBytes(url)
  const [numPages, setNumPages] = useState(0)
  const [aspect, setAspect] = useState(DEFAULT_ASPECT)
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  const [mode, setMode] = useState<PdfMode>('select')
  const [pdf, setPdf] = useState<PdfDocument | null>(null)
  const [query, setQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)

  const resizeObserver = useRef<ResizeObserver | null>(null)
  const scrollEl = useRef<HTMLDivElement | null>(null)
  /** Pointer origin + scroll origin for an in-progress pan. `null` when idle. */
  const panFrom = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  /** Page wrapper elements, so a jump can scroll to one that has not rendered yet. */
  const pageEls = useRef(new Map<number, HTMLDivElement>())

  const { matches, isIndexing } = usePdfSearch(pdf, query)

  // 🛑 `.slice()` is not defensive copying for its own sake. pdf.js passes the
  // buffer to its worker as a *transferable* (`build/pdf.mjs:15532`:
  // `sendWithPromise("GetDocRequest", docParams, data ? [data.buffer] : null)`),
  // so the array we hand it is detached the moment the document loads. Handing
  // the same one to a second `getDocument` (a retry, a version switch, any
  // remount) throws. The master stays in `bytes`; pdf.js only ever sees a copy.
  const file = useMemo(() => (bytes ? { data: bytes.slice() } : null), [bytes])

  /**
   * Measure the scroll container, via a **callback ref rather than an effect**.
   *
   * The early returns below mean this component renders a spinner first, so the
   * scroll container does not exist on mount. A `useEffect` with `[]` deps would
   * run once against a `null` ref, bail, and never run again once the real tree
   * appeared, which leaves `containerWidth` at 0 forever, which renders no `<Page>`
   * at all and shows an empty pane with a working toolbar over it.
   */
  const attachScrollEl = useCallback((el: HTMLDivElement | null) => {
    resizeObserver.current?.disconnect()
    scrollEl.current = el
    if (!el) {
      resizeObserver.current = null
      return
    }
    setContainerWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(el)
    resizeObserver.current = observer
  }, [])

  useEffect(() => () => resizeObserver.current?.disconnect(), [])

  /**
   * Grab-to-pan, in hand mode only.
   *
   * 🛑 Why this is a mode and not just "drag anywhere". The text layer is the
   * reason this viewer exists rather than an `<img>` of each page: you select
   * the vendor's own `$250,843.72` and compare it to ours. A drag that always
   * panned would consume the same gesture that starts a selection, so the two
   * cannot share it. Every real PDF viewer resolves this the same way, and
   * `select` stays the default because comparison is the job here.
   *
   * `preventDefault` suppresses the native selection drag; pointer capture keeps
   * the move events coming even when the cursor leaves the pane mid-drag.
   */
  const onPanStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollEl.current
      if (mode !== 'pan' || !el || event.button !== 0) return
      event.preventDefault()
      el.setPointerCapture(event.pointerId)
      panFrom.current = {
        x: event.clientX,
        y: event.clientY,
        left: el.scrollLeft,
        top: el.scrollTop,
      }
    },
    [mode]
  )

  const onPanMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollEl.current
    const from = panFrom.current
    if (!el || !from) return
    el.scrollLeft = from.left - (event.clientX - from.x)
    el.scrollTop = from.top - (event.clientY - from.y)
  }, [])

  const onPanEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    panFrom.current = null
    scrollEl.current?.releasePointerCapture(event.pointerId)
  }, [])

  const onDocumentLoad = useCallback(async (pdf: PdfDocument) => {
    setNumPages(pdf.numPages)
    setRenderError(null)
    setPdf(pdf)
    try {
      const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 })
      // Drives the placeholder height for pages that have not rendered yet, so
      // the scrollbar is honest before you reach page 40.
      setAspect(viewport.height / viewport.width)
    } catch {
      // Non-fatal: placeholders just keep the Letter-shaped default.
    }
  }, [])

  const registerPageEl = useCallback((pageNumber: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(pageNumber, el)
    else pageEls.current.delete(pageNumber)
  }, [])

  /**
   * Scroll a page into view.
   *
   * Works for a page that has not rendered because `LazyPage` always keeps a
   * correctly-sized placeholder in the flow, the jump lands in the right place
   * and the `IntersectionObserver` then mounts the real page.
   */
  const goToPage = useCallback((pageNumber: number) => {
    const el = pageEls.current.get(pageNumber)
    if (!el) return
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setCurrentPage(pageNumber)
  }, [])

  const stepMatch = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return
      const next = (activeMatch + direction + matches.length) % matches.length
      setActiveMatch(next)
      const match = matches[next]
      if (match) goToPage(match.pageNumber)
    },
    [matches, activeMatch, goToPage]
  )

  // Jump to the first hit as soon as a query resolves, so typing shows something
  // without also requiring a click.
  const firstMatchPage = matches[0]?.pageNumber
  useEffect(() => {
    setActiveMatch(0)
    if (firstMatchPage) goToPage(firstMatchPage)
  }, [firstMatchPage, goToPage])

  // Horizontal padding of the page column, kept in sync with the wrapper below.
  const pageWidth = containerWidth > 0 ? Math.max(120, (containerWidth - 24) * zoom) : 0

  if (isLoading || (!file && !fetchError)) {
    return (
      <div className='flex h-full items-center justify-center'>
        <Spinner className='size-5 text-muted-foreground' />
      </div>
    )
  }

  if (fetchError || renderError || !file) {
    return (
      <div className='flex h-full flex-col justify-center p-4'>
        <Alert variant='destructive'>
          <AlertTriangle className='h-4 w-4' />
          <AlertDescription>
            {fetchError ?? renderError ?? 'Could not display this PDF'}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className='relative h-full'>
      <div
        ref={attachScrollEl}
        onPointerDown={onPanStart}
        onPointerMove={onPanMove}
        onPointerUp={onPanEnd}
        onPointerCancel={onPanEnd}
        className={cn(
          'h-full overflow-auto bg-muted/40',
          mode === 'pan' && 'cursor-grab select-none active:cursor-grabbing'
        )}>
        <Document
          file={file}
          options={PDF_OPTIONS}
          onLoadSuccess={onDocumentLoad}
          onLoadError={(error: Error) => setRenderError(error.message)}
          // react-pdf 11 defaults `suspense` to true, which would route loading
          // and errors to an Error Boundary and duplicate the states above.
          suspense={false}
          loading={
            <div className='flex h-full items-center justify-center'>
              <Spinner className='size-5 text-muted-foreground' />
            </div>
          }
          error={null}
          noData={null}
          // 🛑 `min-w-fit` is what makes zoom scrollable to BOTH edges.
          //
          // Without it this column is exactly as wide as the scroll container,
          // so a zoomed page, wider than the container, is centred by
          // `items-center` and spills equally off the left and the right. The
          // right spill is reachable; the left is not, because `scrollLeft`
          // cannot go negative. The left edge of the page simply could not be
          // scrolled to.
          //
          // `min-width: fit-content` grows the column to the page's own width,
          // so centring becomes a no-op while zoomed in and `scrollWidth` covers
          // the whole page. Zoomed out, the column is container-width again and
          // the page still centres.
          className='flex min-w-fit flex-col items-center gap-3 px-3 py-3'>
          {Array.from({ length: numPages }, (_, index) => (
            <LazyPage
              key={`${url}-${index + 1}`}
              pageNumber={index + 1}
              width={pageWidth}
              aspect={aspect}
              filename={filename}
              highlight={query.trim()}
              onVisible={setCurrentPage}
              onRegister={registerPageEl}
            />
          ))}
        </Document>
      </div>
      {numPages > 0 && (
        <PdfToolbar
          zoom={zoom}
          onZoomChange={setZoom}
          mode={mode}
          onModeChange={setMode}
          currentPage={currentPage}
          numPages={numPages}
          onGoToPage={goToPage}
          query={query}
          onQueryChange={setQuery}
          matchCount={matches.length}
          activeMatch={activeMatch}
          onStepMatch={stepMatch}
          isIndexing={isIndexing}
        />
      )}
    </div>
  )
}

/**
 * One page, mounted only once it is near the viewport.
 *
 * react-pdf renders every mounted `<Page>` eagerly, so without this a 300-page
 * vendor catalogue would rasterize 300 canvases on open and freeze the tab. The
 * placeholder holds the right amount of space in the meantime, so the scrollbar
 * does not jump as pages resolve.
 */
function LazyPage({
  pageNumber,
  width,
  aspect,
  filename,
  highlight,
  onVisible,
  onRegister,
}: {
  pageNumber: number
  width: number
  aspect: number
  filename?: string
  /** Current search term, highlighted in this page's text layer once rendered. */
  highlight: string
  onVisible: (page: number) => void
  onRegister: (pageNumber: number, el: HTMLDivElement | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shouldRender, setShouldRender] = useState(pageNumber === 1)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    onRegister(pageNumber, el)
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setShouldRender(true)
        onVisible(pageNumber)
      },
      // A screen of lead time, so a page is rendered by the time you reach it.
      { rootMargin: '100% 0px' }
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      onRegister(pageNumber, null)
    }
  }, [pageNumber, onVisible, onRegister])

  /**
   * Tint the text-layer spans containing the term.
   *
   * Best-effort by design: pdf.js splits a line into spans at arbitrary points,
   * so a term straddling two spans is counted by {@link usePdfSearch} (which
   * reads the page's joined text) but not tinted here. Getting every case would
   * mean mapping match offsets back through per-span offsets, which is a lot of
   * machinery for a cosmetic gain; the count and the jump are what actually
   * locate the text, and those are exact.
   */
  useEffect(() => {
    const layer = ref.current?.querySelector('.react-pdf__Page__textContent')
    if (!layer) return
    const spans = layer.querySelectorAll('span')
    const needle = highlight.toLowerCase()
    for (const span of spans) {
      const hit = needle.length > 0 && (span.textContent ?? '').toLowerCase().includes(needle)
      span.style.backgroundColor = hit ? 'rgba(250, 204, 21, 0.45)' : ''
    }
  }, [highlight])

  return (
    <div ref={ref} style={{ width: width || undefined, minHeight: width ? width * aspect : 200 }}>
      {shouldRender && width > 0 && (
        <Page
          pageNumber={pageNumber}
          width={width}
          // The text layer is the point on a comparison screen: it makes the
          // vendor's own numbers selectable and findable with ⌘F.
          renderTextLayer
          // Off deliberately, vendor quotes carry no useful annotations, and
          // leaving it off avoids a second stylesheet and the external-link
          // surface inside annotation objects.
          renderAnnotationLayer={false}
          loading={
            <div
              className='flex items-center justify-center bg-background shadow-sm'
              style={{ width, height: width * aspect }}>
              <Spinner className='size-4 text-muted-foreground' />
            </div>
          }
          className='shadow-sm'
          aria-label={filename ? `${filename}, page ${pageNumber}` : `Page ${pageNumber}`}
        />
      )}
    </div>
  )
}

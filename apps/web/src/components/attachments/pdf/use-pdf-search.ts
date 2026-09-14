// apps/web/src/components/attachments/pdf/use-pdf-search.ts

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** One hit: which page, and where in that page's extracted text. */
export interface PdfMatch {
  pageNumber: number
  /** Character offset into the page's joined text. Used to order hits within a page. */
  offset: number
}

interface PdfSearchState {
  matches: PdfMatch[]
  /** True while the one-time text extraction is running. */
  isIndexing: boolean
}

/**
 * The minimum surface of `PDFDocumentProxy` this hook needs.
 *
 * Structural rather than imported: `pdfjs-dist` is a transitive dependency here
 * and this module is outside `pdf-viewer.tsx`, the one file permitted to import
 * the engine. `items` stays `unknown[]` because pdf.js mixes `TextItem` (which
 * has `str`) with `TextMarkedContent` (which does not) in the same array, the
 * guard below is what tells them apart.
 */
interface SearchableDocument {
  numPages: number
  getPage: (pageNumber: number) => Promise<{
    getTextContent: () => Promise<{ items: unknown[] }>
  }>
}

/** pdf.js emits marked-content markers alongside real text runs; only the latter carry `str`. */
function textOf(item: unknown): string {
  return typeof item === 'object' && item !== null && 'str' in item
    ? String((item as { str: unknown }).str ?? '')
    : ''
}

/**
 * Find a string anywhere in the document, including pages that have not been
 * rendered.
 *
 * 🛑 This exists because the browser's own ⌘F cannot do the job here. `LazyPage`
 * mounts a `<Page>` only when it nears the viewport, so an unrendered page
 * contributes no text to the DOM. ⌘F would search whatever happens to be
 * on-screen and report "not found" for a term sitting on page 30, silently
 * wrong, which is worse than having no search at all.
 *
 * pdf.js can read a page's text without rasterizing it (`getTextContent`), so
 * the index is built from the document itself rather than from the DOM.
 *
 * **Extract once, search many.** The text of every page is pulled a single time
 * and cached; each keystroke after that is a string scan over memory, not a
 * round of `getTextContent` calls. Re-extracting per keystroke would make a
 * 200-page document unusable to type in.
 */
export function usePdfSearch(pdf: SearchableDocument | null, query: string): PdfSearchState {
  const [pageTexts, setPageTexts] = useState<string[] | null>(null)
  const [isIndexing, setIsIndexing] = useState(false)
  const indexedFor = useRef<SearchableDocument | null>(null)

  const trimmed = query.trim()

  const buildIndex = useCallback(async (doc: SearchableDocument) => {
    setIsIndexing(true)
    try {
      const texts: string[] = []
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const content = await (await doc.getPage(pageNumber)).getTextContent()
        // pdf.js splits a line into many items; joining with a space keeps words
        // apart that were only separated by positioning.
        texts.push(content.items.map(textOf).join(' '))
      }
      setPageTexts(texts)
    } catch {
      // A document that refuses to yield text is not a failure worth surfacing -
      // search simply finds nothing, and the pages still render.
      setPageTexts([])
    } finally {
      setIsIndexing(false)
    }
  }, [])

  useEffect(() => {
    if (!pdf || !trimmed) return
    if (indexedFor.current === pdf) return
    indexedFor.current = pdf
    void buildIndex(pdf)
  }, [pdf, trimmed, buildIndex])

  // Reset when the document itself changes, so a new file cannot answer with
  // the previous one's text.
  useEffect(() => {
    if (indexedFor.current !== pdf) {
      setPageTexts(null)
    }
  }, [pdf])

  const matches = useMemo(() => {
    if (!pageTexts || trimmed.length === 0) return []
    const needle = trimmed.toLowerCase()
    const found: PdfMatch[] = []
    pageTexts.forEach((text, index) => {
      const haystack = text.toLowerCase()
      let offset = haystack.indexOf(needle)
      while (offset !== -1) {
        found.push({ pageNumber: index + 1, offset })
        offset = haystack.indexOf(needle, offset + needle.length)
      }
    })
    return found
  }, [pageTexts, trimmed])

  return { matches, isIndexing }
}

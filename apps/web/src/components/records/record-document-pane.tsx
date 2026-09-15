// apps/web/src/components/records/record-document-pane.tsx
'use client'

// The left half of a record's page: the vendor's own document, beside our
// reading of it. Generalised from `intake-document-preview.tsx`
// (plans/money/tasks/38 §6.2) so a record page (the vendor bill,
// plans/money/tasks/58 §6.4) can adopt the same pane rather than growing its
// own copy.
//
// 🛑 Two renderers, because a document arrives in two shapes and only one of
// them is a document a browser can display. A PDF or an image goes to
// `AttachmentPreview`. A spreadsheet does not: there is no xlsx renderer here,
// `AttachmentPreview` sends `text/csv` to its download-card fallback on purpose
// (an iframe auto-downloads CSV), and nothing in the pipeline rasterizes a
// workbook. So a converted document is previewed from the text the MODEL read,
// which the caller keeps around for exactly this.
//
// ⚠️ Never pin `preferredRenderer`. It short-circuits `AttachmentPreview`'s own
// MIME dispatch (`attachment-preview.tsx:152-155`), so a hardcoded `'pdf'` hands
// a spreadsheet to the PDF renderer and shows the person nothing.

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { cn } from '@auxx/ui/lib/utils'
import Papa from 'papaparse'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { AttachmentPreview } from '~/components/attachments/attachment-preview'

interface RecordDocumentPaneProps {
  /** A FileRef string, e.g. `'asset:<id>'` or `'file:<id>'`. `null` when there is no document. */
  documentRef: string | null
  fileName: string | null
  mimeType: string | null
  /** The converted text a model read. `null` for a PDF or an image, or when nothing was read. */
  extractedText: string | null
  /** Show the two review tabs even when the converted source has no text. */
  showTabs?: boolean
  /** Select content directly when the parent owns the Document/As read tabs. */
  view?: 'document' | 'read'
  /** A readable transcription for the review tab (used for PDFs/images). */
  asReadText?: string | null
  /** Which resource authorizes the preview — see `AttachmentPreview`'s `scope` prop. */
  scope?: React.ComponentProps<typeof AttachmentPreview>['scope']
  className?: string
  /**
   * Rendered in place of the document when there is neither a `documentRef` nor
   * `extractedText`. Left to the caller so a record whose page owns an upload
   * affordance (a drop zone) can offer one here; a bare muted placeholder is the
   * default when this is omitted entirely. Pass `null` explicitly to render
   * nothing (the intake review screen's loading gap, where the caller has its
   * own not-yet-ready state above this pane).
   */
  emptyState?: ReactNode
}

/** One `# Heading` block of a converted document — a worksheet, usually. */
interface ExtractedSection {
  title: string | null
  rows: string[][]
}

export function RecordDocumentPane({
  documentRef,
  fileName,
  mimeType,
  extractedText,
  showTabs = false,
  view,
  asReadText,
  scope,
  className,
  emptyState,
}: RecordDocumentPaneProps) {
  const document = (
    <DocumentContent
      documentRef={documentRef}
      fileName={fileName}
      mimeType={mimeType}
      scope={scope}
      className={className}
      emptyState={emptyState}
    />
  )
  const sourceSections = useMemo(() => parseExtractedText(extractedText), [extractedText])
  const sourceContent = sourceSections ? (
    <ExtractedGrid fileName={fileName} sections={sourceSections} />
  ) : (
    document
  )
  const readText = asReadText ?? extractedText
  const readSections = useMemo(() => parseExtractedText(readText), [readText])
  const readContent = readSections ? (
    <ExtractedGrid
      fileName={fileName}
      sections={readSections}
      transcription={showTabs || view === 'read'}
    />
  ) : (
    <div className='flex h-full items-center justify-center p-6'>
      <p className='text-sm text-muted-foreground'>No transcription is available yet.</p>
    </div>
  )

  // Converted quote/intake documents have no inline file renderer. Preserve the
  // established behaviour for callers that do not need review tabs.
  if (view === 'read') return readContent
  if (view === 'document') return sourceContent
  if (!showTabs) return readSections ? readContent : document

  return (
    <Tabs defaultValue='document' className='flex h-full min-h-0 flex-col'>
      <TabsList
        className='w-full shrink-0 justify-start rounded-b-none border-b bg-primary-100'
        variant='outline'>
        <TabsTrigger value='document' variant='outline'>
          Document
        </TabsTrigger>
        <TabsTrigger value='read' variant='outline'>
          As read
        </TabsTrigger>
      </TabsList>
      <TabsContent value='document' className='min-h-0 flex-1'>
        {document}
      </TabsContent>
      <TabsContent value='read' className='min-h-0 flex-1'>
        {readContent}
      </TabsContent>
    </Tabs>
  )
}

function DocumentContent({
  documentRef,
  fileName,
  mimeType,
  scope,
  className,
  emptyState,
}: Omit<RecordDocumentPaneProps, 'extractedText' | 'showTabs' | 'asReadText' | 'view'>) {
  if (!documentRef) {
    if (emptyState !== undefined) return <>{emptyState}</>
    return (
      <div className={cn('flex h-full items-center justify-center p-6', className)}>
        <p className='text-sm text-muted-foreground'>No document on this bill</p>
      </div>
    )
  }

  const { sourceType, id } = parseDocumentRef(documentRef)
  return (
    <AttachmentPreview
      type={sourceType}
      id={id}
      interactive
      height='100%'
      className={className}
      filename={fileName ?? undefined}
      knownMimeType={mimeType ?? undefined}
      scope={scope ?? { kind: 'files' }}
    />
  )
}

/** `'asset:<id>'` / `'file:<id>'` → `AttachmentPreview`'s `type` + `id`. */
function parseDocumentRef(ref: string): { sourceType: 'asset' | 'file'; id: string } {
  const colonIdx = ref.indexOf(':')
  return {
    sourceType: (colonIdx < 0 ? 'asset' : ref.slice(0, colonIdx)) as 'asset' | 'file',
    id: colonIdx < 0 ? ref : ref.slice(colonIdx + 1),
  }
}

/**
 * Split the converted text into its `# Heading` sections and parse each body as
 * CSV.
 *
 * `null` when there is nothing to show, which is what routes the caller to
 * `AttachmentPreview` instead.
 *
 * PapaParse rather than a `split(',')`: a quote line reading
 * `"Bolt, hex, M8x40",500,0.42` is three cells, and getting that wrong here
 * would show a grid that disagrees with the one the model read from.
 */
function parseExtractedText(text: string | null): ExtractedSection[] | null {
  if (!text?.trim()) return null

  const sections: ExtractedSection[] = []
  let title: string | null = null
  let body: string[] = []

  const flush = () => {
    const joined = body.join('\n').trim()
    body = []
    if (!joined) return
    const parsed = Papa.parse<string[]>(joined, { skipEmptyLines: true })
    const rows = (parsed.data ?? []).filter(
      (row) => Array.isArray(row) && row.some((cell) => cell?.trim())
    )
    if (rows.length > 0) sections.push({ title, rows })
  }

  for (const line of text.split('\n')) {
    if (line.startsWith('# ')) {
      flush()
      title = line.slice(2).trim()
      continue
    }
    body.push(line)
  }
  flush()

  return sections.length > 0 ? sections : null
}

/**
 * The converted document as a grid.
 *
 * Every row is rendered the same way — no header row is assumed. A vendor's
 * spreadsheet routinely opens with a logo row, an address block and three blank
 * lines before the table starts, so styling row 1 as headings would be wrong
 * more often than right. The row numbers are the point: they are how a person
 * says "line 12 on the sheet" while looking at line 12 of our reading of it.
 */
function ExtractedGrid({
  fileName,
  sections,
  transcription = false,
}: {
  fileName: string | null
  sections: ExtractedSection[]
  transcription?: boolean
}) {
  return (
    <div className='flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden p-3'>
      <p className='shrink-0 text-xs text-muted-foreground'>
        {transcription ? 'Transcription from ' : ''}
        {fileName ? <span className='font-medium'>{fileName}</span> : 'This document'}
        {transcription ? '.' : ' has no preview of its own, so this is the text the model read.'}
      </p>

      {/* `noFade` because each section's title is `sticky top-0`: the default
          mask-image fade dims whatever sits at the viewport's edge, which is
          precisely the heading a person is reading down the sheet by. */}
      <ScrollArea
        orientation='both'
        noFade
        className='min-h-0 min-w-0 w-full flex-1'
        viewportClassName='h-full'>
        {sections.map((section, index) => (
          <div key={section.title ?? index} className='mb-4'>
            {section.title && (
              <h3 className='sticky top-0 z-10 bg-background py-1 text-xs font-medium'>
                {section.title}
              </h3>
            )}
            <table className='w-max min-w-full border-collapse text-xs tabular-nums'>
              <tbody>
                {section.rows.map((row, rowIndex) => (
                  <tr
                    // Row order IS the identity here — the grid is a snapshot and
                    // nothing reorders or filters it.
                    key={rowIndex}
                    className='border-b border-foreground/5 last:border-0'>
                    <td className='w-8 select-none pr-2 text-right align-top text-muted-foreground/60'>
                      {rowIndex + 1}
                    </td>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className={cn(
                          // A cell may run long (a full item description), so it
                          // is capped and truncated rather than wrapped — a
                          // wrapped cell breaks the row alignment that makes this
                          // readable as a grid at all. The title carries the rest.
                          'max-w-[24rem] truncate whitespace-nowrap px-2 py-1 align-top',
                          isNumeric(cell) && 'text-right'
                        )}
                        title={cell}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </ScrollArea>
    </div>
  )
}

/** Right-align what reads as a number, so quantities and prices line up. */
function isNumeric(cell: string): boolean {
  const trimmed = cell.trim()
  return trimmed.length > 0 && /^[^a-zA-Z]*[\d.,]+[^a-zA-Z]*$/.test(trimmed)
}

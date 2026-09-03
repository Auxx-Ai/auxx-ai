// apps/web/src/components/purchasing/intake/ui/intake-document-preview.tsx
'use client'

// The left half of the review screen: the vendor's own document, beside our
// reading of it (plans/money/tasks/38 §6.2).
//
// 🛑 Two renderers, because a quote arrives in two shapes and only one of them
// is a document a browser can display. A PDF or an image goes to
// `AttachmentPreview`. A spreadsheet does not: there is no xlsx renderer here,
// `AttachmentPreview` sends `text/csv` to its download-card fallback on purpose
// (an iframe auto-downloads CSV), and nothing in the pipeline rasterizes a
// workbook. So a converted document is previewed from the text the MODEL read,
// which the worker keeps on the draft for exactly this.
//
// ⚠️ Never pin `preferredRenderer`. It short-circuits `AttachmentPreview`'s own
// MIME dispatch (`attachment-preview.tsx:152-155`), so a hardcoded `'pdf'` hands
// a spreadsheet to the PDF renderer and shows the person nothing.

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import Papa from 'papaparse'
import { useMemo } from 'react'
import { AttachmentPreview } from '~/components/attachments/attachment-preview'

interface IntakeDocumentPreviewProps {
  draftId: string
  assetId: string | null
  fileName: string | null
  mimeType: string | null
  /** The converted text the model read. `null` for a PDF or an image. */
  extractedText: string | null
}

/** One `# Heading` block of a converted document — a worksheet, usually. */
interface ExtractedSection {
  title: string | null
  rows: string[][]
}

export function IntakeDocumentPreview({
  draftId,
  assetId,
  fileName,
  mimeType,
  extractedText,
}: IntakeDocumentPreviewProps) {
  const sections = useMemo(() => parseExtractedText(extractedText), [extractedText])

  if (sections) {
    return <ExtractedGrid fileName={fileName} sections={sections} />
  }

  if (!assetId) return null

  return (
    <AttachmentPreview
      type='asset'
      id={assetId}
      preferredRenderer={rendererFor(mimeType)}
      interactive
      height='100%'
      filename={fileName ?? undefined}
      knownMimeType={mimeType ?? undefined}
      scope={{ kind: 'intakeDraft', draftId }}
    />
  )
}

/**
 * Which `AttachmentPreview` renderer this MIME type wants.
 *
 * `'auto'` for anything else, so the component's own dispatch decides rather
 * than being overridden with a guess.
 */
function rendererFor(mimeType: string | null): 'auto' | 'pdf' | 'image' {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType?.startsWith('image/')) return 'image'
  return 'auto'
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
    const rows = (parsed.data ?? []).filter((row) => row.some((cell) => cell?.trim()))
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
}: {
  fileName: string | null
  sections: ExtractedSection[]
}) {
  return (
    <div className='flex h-full flex-col gap-3'>
      <p className='shrink-0 text-xs text-muted-foreground'>
        {fileName ? <span className='font-medium'>{fileName}</span> : 'This document'} has no
        preview of its own, so this is the text the model read.
      </p>

      {/* `noFade` because each section's title is `sticky top-0`: the default
          mask-image fade dims whatever sits at the viewport's edge, which is
          precisely the heading a person is reading down the sheet by. */}
      <ScrollArea orientation='both' noFade className='min-h-0 flex-1' viewportClassName='h-full'>
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
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional by nature
                    key={rowIndex}
                    className='border-b border-foreground/5 last:border-0'>
                    <td className='w-8 select-none pr-2 text-right align-top text-muted-foreground/60'>
                      {rowIndex + 1}
                    </td>
                    {row.map((cell, cellIndex) => (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional by nature
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

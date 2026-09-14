// apps/web/src/components/attachments/pdf/pdf-toolbar.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronUp, Hand, Minus, MousePointer2, Plus, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * Which gesture the left mouse button performs.
 *
 * `select` is the default: the text layer is why this viewer exists rather than
 * a picture of each page, and dragging to select is how you compare the vendor's
 * numbers to ours. `pan` trades that for grab-to-drag, which is what you want
 * once zoomed past the pane.
 */
export type PdfMode = 'select' | 'pan'

/**
 * The zoom ladder, as discrete stops rather than a step added to a float.
 *
 * Adding 0.25 and re-rounding compounds: `Math.round((1 + 0.25) * 10) / 10` is
 * 1.3, not 1.25, so the stops drift and the label shows values nobody chose.
 * Indexing a fixed array cannot drift, and it is what every real PDF viewer
 * does.
 */
export const ZOOM_STOPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const

export const MIN_ZOOM: number = ZOOM_STOPS[0]
export const MAX_ZOOM: number = ZOOM_STOPS.at(-1) ?? 4

/** The neighbouring stop in `direction`, or the current zoom if already at the end. */
function nextStop(zoom: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STOPS.find((stop) => stop > zoom + 1e-6) ?? zoom
  return [...ZOOM_STOPS].reverse().find((stop) => stop < zoom - 1e-6) ?? zoom
}

interface PdfToolbarProps {
  zoom: number
  onZoomChange: (zoom: number) => void
  mode: PdfMode
  onModeChange: (mode: PdfMode) => void
  currentPage: number
  numPages: number
  onGoToPage: (page: number) => void
  query: string
  onQueryChange: (query: string) => void
  matchCount: number
  activeMatch: number
  onStepMatch: (direction: 1 | -1) => void
  isIndexing: boolean
}

/**
 * The floating control pill: zoom, mode, page navigation and in-document search.
 *
 * It floats over the page column rather than joining `AttachmentPreview`'s
 * toolbar row, which keeps this state inside the lazily-loaded chunk, the outer
 * toolbar would otherwise hold state it only ever uses for one of five
 * renderers.
 */
export function PdfToolbar({
  zoom,
  onZoomChange,
  mode,
  onModeChange,
  currentPage,
  numPages,
  onGoToPage,
  query,
  onQueryChange,
  matchCount,
  activeMatch,
  onStepMatch,
  isIndexing,
}: PdfToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [pageDraft, setPageDraft] = useState(String(currentPage))
  const searchInput = useRef<HTMLInputElement>(null)

  // Scrolling changes the page under you, so the box follows along, except
  // while it is focused, where overwriting what someone is typing would be rude.
  useEffect(() => {
    if (document.activeElement !== document.querySelector('[data-pdf-page-input]')) {
      setPageDraft(String(currentPage))
    }
  }, [currentPage])

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus()
  }, [searchOpen])

  const commitPage = () => {
    const parsed = Number.parseInt(pageDraft, 10)
    if (Number.isNaN(parsed)) {
      setPageDraft(String(currentPage))
      return
    }
    const clamped = Math.min(numPages, Math.max(1, parsed))
    setPageDraft(String(clamped))
    onGoToPage(clamped)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    onQueryChange('')
  }

  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-2'>
      {searchOpen && (
        <div className='pointer-events-auto flex items-center gap-1 rounded-full border bg-background/95 px-2 py-1 shadow-sm backdrop-blur'>
          <Search className='size-3.5 shrink-0 text-muted-foreground' />
          <input
            ref={searchInput}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onStepMatch(event.shiftKey ? -1 : 1)
              if (event.key === 'Escape') closeSearch()
            }}
            placeholder='Find in document'
            className='w-40 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground'
          />
          <span className='min-w-14 text-right text-xs tabular-nums text-muted-foreground'>
            {isIndexing
              ? 'Reading…'
              : query.trim() === ''
                ? ''
                : matchCount === 0
                  ? 'No results'
                  : `${activeMatch + 1} of ${matchCount}`}
          </span>
          <Button
            variant='ghost'
            size='sm'
            className='size-6 p-0'
            aria-label='Previous match'
            disabled={matchCount === 0}
            onClick={() => onStepMatch(-1)}>
            <ChevronUp />
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='size-6 p-0'
            aria-label='Next match'
            disabled={matchCount === 0}
            onClick={() => onStepMatch(1)}>
            <ChevronDown />
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='size-6 p-0'
            aria-label='Close search'
            onClick={closeSearch}>
            <X />
          </Button>
        </div>
      )}

      <div className='pointer-events-auto flex items-center gap-1 rounded-full border bg-background/90 px-1.5 py-1 shadow-sm backdrop-blur'>
        <Button
          variant='ghost'
          size='sm'
          className='size-7 p-0'
          aria-label='Zoom out'
          disabled={zoom <= MIN_ZOOM}
          onClick={() => onZoomChange(nextStop(zoom, -1))}>
          <Minus />
        </Button>
        <button
          type='button'
          onClick={() => onZoomChange(1)}
          className='min-w-12 rounded px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground'>
          {Math.round(zoom * 100)}%
        </button>
        <Button
          variant='ghost'
          size='sm'
          className='size-7 p-0'
          aria-label='Zoom in'
          disabled={zoom >= MAX_ZOOM}
          onClick={() => onZoomChange(nextStop(zoom, 1))}>
          <Plus />
        </Button>

        <span className='mx-0.5 h-4 w-px bg-border' />
        <Button
          variant='ghost'
          size='sm'
          className={cn('size-7 p-0', mode === 'select' && 'bg-accent text-accent-foreground')}
          aria-label='Select text'
          aria-pressed={mode === 'select'}
          onClick={() => onModeChange('select')}>
          <MousePointer2 />
        </Button>
        <Button
          variant='ghost'
          size='sm'
          className={cn('size-7 p-0', mode === 'pan' && 'bg-accent text-accent-foreground')}
          aria-label='Drag to pan'
          aria-pressed={mode === 'pan'}
          onClick={() => onModeChange('pan')}>
          <Hand />
        </Button>

        <span className='mx-0.5 h-4 w-px bg-border' />
        <Button
          variant='ghost'
          size='sm'
          className={cn('size-7 p-0', searchOpen && 'bg-accent text-accent-foreground')}
          aria-label='Find in document'
          aria-pressed={searchOpen}
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}>
          <Search />
        </Button>

        {numPages > 1 && (
          <>
            <span className='mx-0.5 h-4 w-px bg-border' />
            <input
              data-pdf-page-input
              aria-label='Page number'
              value={pageDraft}
              onChange={(event) => setPageDraft(event.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitPage}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitPage()
                  event.currentTarget.blur()
                }
              }}
              className='w-8 rounded border bg-transparent px-1 py-0.5 text-center text-xs tabular-nums outline-none focus:border-ring'
            />
            <span className='pr-1 text-xs tabular-nums text-muted-foreground'>/ {numPages}</span>
          </>
        )}
      </div>
    </div>
  )
}

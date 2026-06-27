// apps/web/src/components/dynamic-table/components/table-toolbar/records-guide-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  GuideColumn,
  GuideColumns,
  GuideConcept,
  GuideConcepts,
  GuideDialog,
  GuideKbd,
  GuidePage,
  GuideSection,
  GuideShortcut,
  GuideShortcuts,
  GuideStep,
  GuideSteps,
} from '@auxx/ui/components/guide'
import { isMac } from '@auxx/utils'
import {
  ArrowDownUp,
  ChevronRight,
  Columns3,
  Filter,
  LayoutGrid,
  ListChecks,
  Lock,
  MousePointerClick,
  Pin,
  Search,
  Sparkles,
  Star,
  Table2,
} from 'lucide-react'
import { useEffect, useState } from 'react'

type RecordsGuidePage = 'views' | 'display' | 'shortcuts'

/** cmd on Mac, ctrl elsewhere — matches the cell-navigation key handling. */
const mod = isMac() ? 'cmd' : 'ctrl'

/**
 * The records-view help guide: a three-page `GuideDialog` shared by every dynamic
 * view (records, contacts, tickets, connectors, …) via the table toolbar's `?`
 * button. "Views" explains the view lifecycle, "Display" covers view types and how
 * you shape the grid, and "Shortcuts" lists the cell keyboard map. A
 * `Views › Display › Shortcuts` header switches between them; the body crossfades.
 */
export function RecordsGuideDialog({
  open,
  onOpenChange,
  initialPage = 'views',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which page to land on when opened. Defaults to the views overview. */
  initialPage?: RecordsGuidePage
}) {
  // Re-seed the page each time the dialog opens so it never reopens on a stale page.
  const [page, setPage] = useState<RecordsGuidePage>(initialPage)
  useEffect(() => {
    if (open) setPage(initialPage)
  }, [open, initialPage])

  return (
    <GuideDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Records guide'
      heading='Help'
      page={page}
      crumbs={[
        { label: 'Views', active: page === 'views', onClick: () => setPage('views') },
        { label: 'Display', active: page === 'display', onClick: () => setPage('display') },
        { label: 'Shortcuts', active: page === 'shortcuts', onClick: () => setPage('shortcuts') },
      ]}>
      <GuidePage
        value='views'
        size='3xl'
        footer={
          <div className='flex items-center justify-between'>
            <p className='text-muted-foreground text-xs'>Press Esc to close</p>
            <Button variant='ghost' size='xs' onClick={() => setPage('display')}>
              Display options
              <ChevronRight />
            </Button>
          </div>
        }>
        <ViewsGuideBody />
      </GuidePage>
      <GuidePage
        value='display'
        size='3xl'
        footer={
          <div className='flex items-center justify-between'>
            <p className='text-muted-foreground text-xs'>Press Esc to close</p>
            <Button variant='ghost' size='xs' onClick={() => setPage('shortcuts')}>
              Keyboard shortcuts
              <ChevronRight />
            </Button>
          </div>
        }>
        <DisplayGuideBody />
      </GuidePage>
      <GuidePage value='shortcuts' size='3xl'>
        <ShortcutsGuideBody />
      </GuidePage>
    </GuideDialog>
  )
}

// ── Page 1: views ─────────────────────────────────────────────────────────────

/**
 * The view lifecycle: how a saved view captures your layout, plus the vocabulary
 * around the view selector (All rows, default, shared, manage).
 */
function ViewsGuideBody() {
  return (
    <GuideColumns>
      {/* 1: the happy path */}
      <GuideColumn title='Saving a view'>
        <GuideSteps>
          <GuideStep n={1} title='Start from All rows'>
            The base view every table opens with. Shape it freely: it just can't be saved over.
          </GuideStep>
          <GuideStep n={2} title='Shape the layout'>
            Show or hide columns, reorder, resize, sort, and add filters until the table looks the
            way you want.
          </GuideStep>
          <GuideStep n={3} title='Save as a view'>
            One view captures columns, their order, widths, pinning, sort, and filters together.
          </GuideStep>
          <GuideStep n={4} title='Switch anytime'>
            Pick any saved view from the selector; your unsaved tweaks stay until you save or reset
            them.
          </GuideStep>
        </GuideSteps>
      </GuideColumn>

      {/* 2: the vocabulary */}
      <GuideColumn title='Kinds of view'>
        <GuideConcepts>
          <GuideConcept glyph={<Lock className='size-3.5 text-muted-foreground' />} term='All rows'>
            The unsaved starting point. Always shows every record with the default layout.
          </GuideConcept>
          <GuideConcept glyph={<Pin className='size-3.5 text-muted-foreground' />} term='Default'>
            The view this table opens to. Set any saved view as the default from its menu.
          </GuideConcept>
          <GuideConcept glyph={<Star className='size-3.5 text-muted-foreground' />} term='Favorite'>
            Pin a view to your sidebar for one-click access from anywhere.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>

      {/* 3: managing */}
      <GuideColumn title='Managing views'>
        <GuideConcepts>
          <GuideConcept term='Unsaved changes'>
            A dot on the view menu means the layout drifted from what's saved. Save to keep it, or
            reset to snap back.
          </GuideConcept>
          <GuideConcept term='Duplicate & rename'>
            Branch a new view off an existing one, or rename it, from the view menu.
          </GuideConcept>
          <GuideConcept term='Save as new view'>
            Changed the filters? A shortcut button offers to bank them as a fresh view without
            touching the current one.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>
    </GuideColumns>
  )
}

// ── Page 2: display ───────────────────────────────────────────────────────────

/**
 * How you shape what you see: the two view types and the column / filter / sort
 * controls, with formatting and import/export under "Going further".
 */
function DisplayGuideBody() {
  return (
    <>
      <GuideColumns>
        {/* 1: view types */}
        <GuideColumn title='View types'>
          <GuideConcepts>
            <GuideConcept
              glyph={<Table2 className='size-3.5 text-muted-foreground' />}
              term='Table'>
              The dense grid: sort, resize, pin columns, and edit cells inline. The default for any
              records view.
            </GuideConcept>
            <GuideConcept
              glyph={<LayoutGrid className='size-3.5 text-muted-foreground' />}
              term='Kanban'>
              Group records by a single-select field into pipeline columns. Drag cards between
              stages, choose which fields show on each card, and track time-in-status.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>

        {/* 2: shaping the grid */}
        <GuideColumn title='Shaping the grid'>
          <GuideConcepts>
            <GuideConcept
              glyph={<Columns3 className='size-3.5 text-muted-foreground' />}
              term='Columns'>
              Show, hide, reorder, and resize fields. Pin the primary column so it stays put as you
              scroll sideways.
            </GuideConcept>
            <GuideConcept
              glyph={<ArrowDownUp className='size-3.5 text-muted-foreground' />}
              term='Sort'>
              Order rows by any column. Saved into the view so it sticks.
            </GuideConcept>
            <GuideConcept
              glyph={<Filter className='size-3.5 text-muted-foreground' />}
              term='Filter'>
              Build conditions to narrow the rows down. Filters are part of the view.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>

        {/* 3: finding records */}
        <GuideColumn title='Finding records'>
          <GuideConcepts>
            <GuideConcept
              glyph={<Search className='size-3.5 text-muted-foreground' />}
              term='Search'>
              Quick text search across the table, on top of whatever filters the view applies.
            </GuideConcept>
            <GuideConcept
              glyph={<ListChecks className='size-3.5 text-muted-foreground' />}
              term='Select rows'>
              Tick rows to act on several at once. Bulk actions appear when a selection is active.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>
      </GuideColumns>

      <GuideSection title='Going further'>
        <GuideConcept term='Column formatting'>
          Tune how values display per column: currency, dates and times, number precision, phone
          format, and checkboxes.
        </GuideConcept>
        <GuideConcept
          glyph={<ArrowDownUp className='size-3.5 text-muted-foreground' />}
          term='Import & export'>
          Bring records in from a CSV, or export the current view. Find both under the Import /
          Export menu.
        </GuideConcept>
      </GuideSection>
    </>
  )
}

// ── Page 3: shortcuts ─────────────────────────────────────────────────────────

/**
 * The cell keyboard map (from `use-cell-navigation` + `use-cell-clipboard`), plus
 * a couple of mouse-driven tips for the fill handle and range select.
 */
function ShortcutsGuideBody() {
  return (
    <GuideColumns>
      <GuideColumn title='Move & select'>
        <GuideShortcuts>
          <GuideShortcut keys={['↑', '↓', '←', '→']} label='Move cell' />
          <GuideShortcut keys={[mod, '→']} label='Jump to edge' />
          <GuideShortcut keys={['shift', '→']} label='Extend selection' />
          <GuideShortcut keys={['Tab']} label='Next cell' />
          <GuideShortcut keys={['shift', 'Tab']} label='Previous cell' />
          <GuideShortcut keys={[mod, 'A']} label='Select all cells' />
        </GuideShortcuts>
      </GuideColumn>

      <GuideColumn title='Edit & clipboard'>
        <GuideShortcuts>
          <GuideShortcut keys={['enter']} label='Edit cell' />
          <GuideShortcut keys={['esc']} label='Collapse, then clear' />
          <GuideShortcut keys={[mod, 'C']} label='Copy' />
          <GuideShortcut keys={[mod, 'V']} label='Paste' />
          <GuideShortcut keys={['Del']} label='Clear cells' />
        </GuideShortcuts>
      </GuideColumn>

      <GuideColumn title='Tips'>
        <GuideConcepts>
          <GuideConcept
            glyph={<MousePointerClick className='size-3.5 text-muted-foreground' />}
            term='Fill handle'>
            Drag the corner of a selection to copy the value down a column.
          </GuideConcept>
          <GuideConcept
            glyph={<Sparkles className='size-3.5 text-muted-foreground' />}
            term='AI autofill'>
            Drag the fill handle over an AI column to generate a value for each row instead of
            copying.
          </GuideConcept>
          <GuideConcept term='Copy & paste anywhere'>
            Cells round-trip losslessly between auxx tables, and paste cleanly to and from Excel,
            Sheets, and Notion. Press <GuideKbd k='cmd' /> <GuideKbd>C</GuideKbd> to copy a range.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>
    </GuideColumns>
  )
}

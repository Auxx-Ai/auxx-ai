// apps/web/src/components/accounting/ui/journal/discard-action-gating.test.tsx
//
// Who is offered the Discard action, and on what
// (plans/accounting/tasks/09-discard-a-draft-entry.md §4, "Web").
//
// 🛑 The server refuses either way - `ledger.journalEntry.discard` is on
// `permissionProcedure(ledgerPost)` and `discardJournalEntry` refuses anything
// that is not a clean draft. This file is about the SCREEN: an affordance a
// person cannot use is a promise the product then breaks, and "throw this entry
// away" is the worst one to offer to somebody with read-only books.
//
// Both doors are covered, because they compute the gate from different things:
// the Entries list from the row's `kind`, the drawer from the loaded record's
// status AND its `glPostingId`.

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** What `useAccess().can(key)` answers. */
  granted: new Set<string>(),
  /** The one draft the Entries list reads back. */
  drafts: [] as unknown[],
  /** The postings half of the Entries list. */
  postings: [] as unknown[],
  /** The record the drawer's own hook reports. */
  draftState: {} as Record<string, unknown>,
}))

vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ can: (key: string) => h.granted.has(key) }),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      ledger: {
        journalEntry: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } },
        listPostings: { invalidate: vi.fn() },
        periods: { invalidate: vi.fn() },
      },
    }),
    ledger: {
      periods: { useQuery: () => ({ data: [] }) },
      listPostings: { useQuery: () => ({ data: h.postings, isPending: false }) },
      journalEntry: {
        list: { useQuery: () => ({ data: h.drafts, isPending: false }) },
        discard: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  },
}))

// The drawer's draft state has its own suite; standing it up against a fake
// tRPC layer here would test the fake rather than the gate.
vi.mock('~/components/accounting/hooks/use-journal-entry-draft', () => ({
  useJournalEntryDraft: () => h.draftState,
}))

// The heavy leaves the gate does not depend on. `DockableDrawer` renders through
// a portal and `FieldInputAdapter` pulls the whole field-type registry; neither
// decides whether the button exists.
vi.mock('@auxx/ui/components/dockable-drawer', () => ({
  DockableDrawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('~/components/fields/inputs/field-input-adapter', () => ({
  FieldInputAdapter: () => <div />,
}))
// base-ui's scroll area calls `new IntersectionObserver(...)` on mount, and the
// shared jsdom setup stubs that as a plain function. Nothing here is about
// scrolling.
vi.mock('@auxx/ui/components/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('./journal-lines', () => ({
  JournalLines: () => <div />,
  JournalLinesTotals: () => <div />,
  draftRowsFromLines: () => [],
  linesFromDraftRows: () => [],
}))

import { EntriesList } from './entries-list'
import { JournalEntryDrawer } from './journal-entry-drawer'

const DRAFT = {
  id: 'je_1',
  number: 'JNL-0006',
  memo: 'Accrue August rent',
  lines: [],
  createdAt: '2026-08-31T00:00:00.000Z',
}

const POSTING = {
  id: 'post_1',
  postingType: 'manual_journal',
  periodKey: 'JNL-0005',
  txnDate: '2026-08-31',
  docNumber: 'AUXX-JNL-JNL0005',
  status: 'posted',
  revision: 1,
  reversesId: null,
  totalMinor: 50_000,
  memo: 'Posted entry',
  postedAt: '2026-08-31T00:00:00.000Z',
}

/** Both surfaces sit inside the app's tooltip provider in production. */
function withTooltips(ui: React.ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

function entriesList() {
  return withTooltips(
    <EntriesList
      periodKey='2026-08'
      currencyCode='USD'
      onSelectPosting={vi.fn()}
      onSelectJournalEntry={vi.fn()}
    />
  )
}

function drawer() {
  return withTooltips(
    <JournalEntryDrawer
      journalEntryId='je_1'
      isNew={false}
      open
      onOpenChange={vi.fn()}
      isDocked
      width={480}
      onWidthChange={vi.fn()}
      currencyCode='USD'
      defaultDate='2026-08-31'
      onCreated={vi.fn()}
      onPosted={vi.fn()}
      onOpenPosting={vi.fn()}
      onDiscarded={vi.fn()}
    />
  )
}

/** The drawer's hook, as it reports a clean, loaded draft. */
function draftState(overrides: Record<string, unknown> = {}) {
  return {
    isLoading: false,
    date: '2026-08-31',
    memo: '',
    lines: [],
    setDate: vi.fn(),
    setMemo: vi.fn(),
    setLines: vi.fn(),
    number: 'JNL-0006',
    status: 'draft',
    glPostingId: null,
    isSaving: false,
    saveDraft: vi.fn(),
    preview: null,
    isPreviewing: false,
    previewIsStale: false,
    runPreview: vi.fn(),
    isPosting: false,
    runPost: vi.fn(),
    postResult: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.granted = new Set(['ledger.post'])
  h.drafts = [DRAFT]
  h.postings = []
  h.draftState = draftState()
})

describe('the Entries list row', () => {
  it('offers Discard on a draft to a ledger.post holder', () => {
    entriesList()
    expect(screen.getByRole('button', { name: /discard this draft/i })).toBeInTheDocument()
  })

  // 🛑 Discarding is a WRITE. `ledgerView` is the read rung, and the key that
  // gates creating and editing a draft is the key that gates throwing one away.
  it('is absent for a ledgerView-only member', () => {
    h.granted = new Set(['ledger.view'])
    entriesList()
    expect(screen.queryByRole('button', { name: /discard this draft/i })).not.toBeInTheDocument()
  })

  // 🛑 A posted row is a `GlPosting`, and it is corrected by REVERSING it. Its
  // `id` is not even a journal-entry id, so a Discard there could not act on the
  // right record if it wanted to.
  it('is absent on a posted entry', () => {
    h.drafts = []
    h.postings = [POSTING]
    entriesList()
    expect(screen.getByText('Posted entry')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /discard this draft/i })).not.toBeInTheDocument()
  })
})

describe('the journal entry drawer', () => {
  it('offers Discard on a draft to a ledger.post holder', () => {
    drawer()
    expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument()
  })

  it('is absent for a ledgerView-only member', () => {
    h.granted = new Set(['ledger.view'])
    drawer()
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument()
  })

  it('is absent on a posted entry', () => {
    h.draftState = draftState({ status: 'posted', glPostingId: 'post_1' })
    drawer()
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument()
  })

  it('is absent on a reversed entry', () => {
    h.draftState = draftState({ status: 'reversed', glPostingId: 'post_1' })
    drawer()
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument()
  })

  // 🛑 The row the status check alone would let through. `postJournalEntry`
  // claims the posting FIRST and stamps the record SECOND, so an interrupted run
  // leaves status `draft` with a posting id set - and archiving it would orphan a
  // `GlPosting` whose `sourceId` no read path resolves. The server refuses it, so
  // the screen must not offer it.
  it('is absent on a draft that already carries a posting id', () => {
    h.draftState = draftState({ status: 'draft', glPostingId: 'post_1' })
    drawer()
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument()
  })
})

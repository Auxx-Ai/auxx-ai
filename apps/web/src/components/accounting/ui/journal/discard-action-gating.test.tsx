// apps/web/src/components/accounting/ui/journal/discard-action-gating.test.tsx
//
// Which document actions (Discard, Void, Edit) are offered, and on what (91 D5).
// The server refuses either way; this is about the screen not offering what cannot work.

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** What `useAccess().can(key)` answers. */
  granted: new Set<string>(),
  /** The journal entries the Entries list reads back. */
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
  withSavedLineIds: () => [],
}))

import { EntriesList } from './entries-list'
import { JournalEntryDrawer } from './journal-entry-drawer'

const DRAFT = {
  id: 'je_1',
  number: 'JNL-0006',
  memo: 'Accrue August rent',
  kind: 'manual',
  status: 'draft',
  glPostingId: null,
  lines: [],
  createdAt: '2026-08-31T00:00:00.000Z',
}

const POSTING = {
  id: 'post_1',
  postingType: 'manual_journal',
  periodKey: 'JNL-0005',
  txnDate: '2026-08-31',
  docNumber: 'JNL-0005-R1',
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

function entriesList(
  handlers: { onSelectPosting?: () => void; onSelectJournalEntry?: () => void } = {}
) {
  return withTooltips(
    <EntriesList
      periodKey='2026-08'
      currencyCode='USD'
      onSelectPosting={handlers.onSelectPosting ?? vi.fn()}
      onSelectJournalEntry={handlers.onSelectJournalEntry ?? vi.fn()}
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
    kind: 'manual',
    status: 'draft',
    glPostingId: null,
    editing: false,
    isSaving: false,
    save: vi.fn(),
    preview: null,
    isPreviewing: false,
    previewIsStale: false,
    runPreview: vi.fn(),
    isPosting: false,
    runPost: vi.fn(),
    isVoiding: false,
    runVoid: vi.fn(),
    openEdit: vi.fn(),
    saveEdit: vi.fn(),
    cancelEdit: vi.fn(),
    isEditPending: false,
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

  it('is absent for a ledgerView-only member', () => {
    h.granted = new Set(['ledger.view'])
    entriesList()
    expect(screen.queryByRole('button', { name: /discard this draft/i })).not.toBeInTheDocument()
  })

  it('is absent on a posted entry', () => {
    h.drafts = []
    h.postings = [POSTING]
    entriesList()
    expect(screen.getByText('Posted entry')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /discard this draft/i })).not.toBeInTheDocument()
  })

  it('opens a posting no journal entry owns in the posting frame', () => {
    const onSelectPosting = vi.fn()
    const onSelectJournalEntry = vi.fn()
    h.drafts = []
    h.postings = [POSTING]
    entriesList({ onSelectPosting, onSelectJournalEntry })
    fireEvent.click(screen.getByText('Posted entry'))
    expect(onSelectPosting).toHaveBeenCalledWith('post_1')
    expect(onSelectJournalEntry).not.toHaveBeenCalled()
  })

  // A posted journal entry takes over its posting's row, so Void and Edit are reachable.
  it("opens a posted journal entry's row in the journal drawer, without Discard", () => {
    const onSelectPosting = vi.fn()
    const onSelectJournalEntry = vi.fn()
    h.drafts = [{ ...DRAFT, id: 'je_5', status: 'posted', glPostingId: 'post_1' }]
    h.postings = [POSTING]
    entriesList({ onSelectPosting, onSelectJournalEntry })
    expect(screen.getAllByText('Posted entry')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /discard this draft/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Posted entry'))
    expect(onSelectJournalEntry).toHaveBeenCalledWith('je_5')
    expect(onSelectPosting).not.toHaveBeenCalled()
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

  // `draft` is the document's own status: a pointer to a posting that no longer exists reads draft.
  it('is offered on a draft whose pointer names a posting that is gone', () => {
    h.draftState = draftState({ status: 'draft', glPostingId: 'post_gone' })
    drawer()
    expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument()
  })
})

describe('the journal entry drawer, once posted', () => {
  it('offers Void and Edit on a posted manual entry, and hides Save and Post', () => {
    h.draftState = draftState({ status: 'posted', glPostingId: 'post_1' })
    drawer()
    expect(screen.getByRole('button', { name: /void/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^post\b/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view posting/i })).toBeInTheDocument()
  })

  // `spec.ts` edits manual entries only; a generated one is voided and re-entered.
  it('offers Void but not Edit on a posted recurring entry', () => {
    h.draftState = draftState({ status: 'posted', kind: 'recurring', glPostingId: 'post_1' })
    drawer()
    expect(screen.getByRole('button', { name: /void/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  it('offers neither on a reversed entry', () => {
    h.draftState = draftState({ status: 'reversed', glPostingId: 'post_1' })
    drawer()
    expect(screen.queryByRole('button', { name: /void/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  it('offers neither to a ledgerView-only member', () => {
    h.granted = new Set(['ledger.view'])
    h.draftState = draftState({ status: 'posted', glPostingId: 'post_1' })
    drawer()
    expect(screen.queryByRole('button', { name: /void/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  it('swaps to Save and Cancel edit while the edit lane is open', () => {
    const saveEdit = vi.fn()
    h.draftState = draftState({ status: 'posted', glPostingId: 'post_1', editing: true, saveEdit })
    drawer()
    expect(screen.getByRole('button', { name: /cancel edit/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /void/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))
    expect(saveEdit).toHaveBeenCalled()
  })
})

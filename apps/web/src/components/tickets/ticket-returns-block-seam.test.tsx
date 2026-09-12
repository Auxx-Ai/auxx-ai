// apps/web/src/components/tickets/ticket-returns-block-seam.test.tsx
//
// 🛑 The Returns section is the product's FIRST consumer of
// `RecordsBlockConfig.actionsComponent` (plans/money/tasks/54-returns.md §4.1),
// and `BLOCK_ACTIONS_COMPONENTS` was `{}` when this was written. The seam was
// read end to end and declared complete rather than aspirational; this file is
// the proof, run against the REAL `RecordListBlock` with only the registry
// lookup swapped for the entry the coordinator adds.
//
// What it proves, and each one is a way the seam could have disappointed:
//
//  1. A default-exported component named by the config is lazily loaded and
//     actually mounted - `BlockActions` resolves `mod.default`, so a named-only
//     export degrades to a permanent `Loader`.
//  2. 🔑 The actions render after the `EmptyRow`, which is the case that
//     matters here: a ticket with no return yet is exactly where the warehouse
//     raises one. Had the seam rendered them only alongside rows, the section
//     would have been useless on a fresh ticket and the `CardBlock` fallback
//     would have been forced.
//  3. They render below a populated list too, in the row container.
//
// The block's own concerns (which read runs, the filter shape, the cap) are
// covered by `drawers/blocks/record-list-block.test.tsx` and not repeated.

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const TICKET_DEF = 'edf_ticket0000000000000000000'
const TICKET_ROW = 'ein_ticketrow000000000000000'
const TICKET_RECORD_ID = `${TICKET_DEF}:${TICKET_ROW}`
const RETURN_DEF = 'edf_return0000000000000000000'
const RETURN_TICKET_FIELD_ID = 'cf_returnticket00000000000000'

const h = vi.hoisted(() => ({
  /** Instance ids `useRecordList` answers with. */
  listRecordIds: [] as string[],
}))

// ── the registry entry the coordinator adds, and nothing else about it ───────
//
// `block-actions-registry.tsx` is owned by the coordinator, so the loader is
// declared here in exactly the shape that file takes. Anything wrong with the
// entry (a missing default export, a name that does not resolve) fails below.
vi.mock('~/components/drawers/blocks/block-actions-registry', () => ({
  getBlockActionsComponent: (name: string | undefined) =>
    name === 'ticket-returns' ? () => import('./ticket-returns-actions') : undefined,
}))

vi.mock('~/components/resources', () => ({
  parseRecordId: (recordId: string) => {
    const colon = recordId.indexOf(':')
    return {
      entityDefinitionId: recordId.slice(0, colon),
      entityInstanceId: recordId.slice(colon + 1),
    }
  },
  toRecordId: (definitionId: string, instanceId: string) => `${definitionId}:${instanceId}`,
  useResourceProperty: (slug: string) => (slug === 'return' ? RETURN_DEF : undefined),
  useRecordList: () => ({ recordIds: h.listRecordIds, isLoading: false }),
}))

vi.mock('~/components/resources/hooks/use-system-values', () => ({
  useSystemValues: (_recordId: string, attrs: readonly string[]) => ({
    values: Object.fromEntries(attrs.map((attr) => [attr, []])),
    isLoading: false,
  }),
}))

vi.mock('~/components/drawers/cards/related-record-row', () => ({
  RelatedRecordRow: ({ recordId }: { recordId: string }) => (
    <div data-testid='related-row' data-record-id={recordId} />
  ),
  EmptyRow: ({ label }: { label: string }) => <div data-testid='empty-row'>{label}</div>,
  RowSkeleton: () => <div data-testid='row-skeleton' />,
  TREE_SECONDARY_NOTRUNCATE: 'tree-secondary-notruncate',
}))

// The actions component's own collaborators. Stubbed exactly as in
// `ticket-returns-actions.test.tsx`; this file is about placement and loading.
vi.mock('~/components/resources/hooks/use-field', () => ({
  useSystemField: () => ({ id: RETURN_TICKET_FIELD_ID }),
}))

vi.mock('~/components/resources/hooks/use-save-field-value', () => ({
  useSaveFieldValue: () => ({ saveFieldValue: () => {}, isPending: false }),
}))

vi.mock('~/components/resources/store/record-store', () => ({
  getRecordStoreState: () => ({ invalidateLists: () => {} }),
}))

vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ canEditEntity: () => true }),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      record: { listFiltered: { invalidate: () => Promise.resolve() } },
    }),
  },
}))

vi.mock('~/components/pickers/record-picker', () => ({
  RecordPicker: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('~/components/records/record-editor-dialog', () => ({
  RecordEditorDialog: () => null,
}))

import { RecordListBlock } from '~/components/drawers/blocks/record-list-block'

/** The block declaration this brief adds to the ticket drawer, verbatim. */
const RETURNS_BLOCK_CONFIG = {
  source: {
    kind: 'query' as const,
    definition: 'return',
    hostFieldId: 'return:ticket',
    sort: { fieldId: 'createdAt', desc: true },
    pageSize: 20,
  },
  statusAttr: 'return_status',
  emptyLabel: 'No returns',
  visibleLimit: 5,
  actionsComponent: 'ticket-returns',
}

function renderBlock() {
  return render(
    <RecordListBlock recordId={TICKET_RECORD_ID as never} config={RETURNS_BLOCK_CONFIG} />
  )
}

beforeEach(() => {
  h.listRecordIds = []
})

describe('actionsComponent, first real consumer', () => {
  it('mounts the named component on a ticket with no return yet', async () => {
    renderBlock()

    expect(screen.getByTestId('empty-row')).toHaveTextContent('No returns')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create return' })).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Link existing return' })).toBeInTheDocument()
  })

  it('places the actions AFTER the empty row, not before it', async () => {
    const { container } = renderBlock()
    await waitFor(() => screen.getByRole('button', { name: 'Create return' }))

    const empty = screen.getByTestId('empty-row')
    const create = screen.getByRole('button', { name: 'Create return' })
    // 4 === DOCUMENT_POSITION_FOLLOWING: `create` comes after `empty`.
    expect(empty.compareDocumentPosition(create) & 4).toBe(4)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('also renders below a populated list', async () => {
    h.listRecordIds = ['ein_ret0001', 'ein_ret0002']
    renderBlock()

    expect(screen.getAllByTestId('related-row')).toHaveLength(2)
    await waitFor(() => screen.getByRole('button', { name: 'Create return' }))

    const lastRow = screen.getAllByTestId('related-row').at(-1)
    const create = screen.getByRole('button', { name: 'Create return' })
    expect((lastRow?.compareDocumentPosition(create) ?? 0) & 4).toBe(4)
  })
})

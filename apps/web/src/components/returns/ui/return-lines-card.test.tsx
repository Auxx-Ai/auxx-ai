// apps/web/src/components/returns/ui/return-lines-card.test.tsx
//
// The card's own wiring (money/tasks/56 §4, §7), following the mocking
// harness in `tickets/ticket-returns-actions.test.tsx`: heavy leaves (the
// kit's `LineGridFrame`, the persisted/draft row components) are stubbed to
// their props, since each has its own surface; `use-return-line-drafts.ts`
// runs FOR REAL so the draft rhythm (add -> pick part -> `record.create`,
// success and failure) is pinned end to end. `add-from-order-sheet.tsx` also
// runs for real, so its `ceilingSource: 'unknown'` rendering is pinned
// without needing a bespoke render harness of its own.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const RETURN_LINE_DEF = 'edf_returnline000000000000000'
const RETURN_DEF = 'edf_return0000000000000000000'
const RETURN_ROW = 'ein_returnrow000000000000000'
const RETURN_RECORD_ID = `${RETURN_DEF}:${RETURN_ROW}`
const ORDER_ROW = 'ein_orderrow00000000000000000'
const PART_RECORD_ID = 'edf_part00000000000000000000:ein_part0000000000000000000'

const h = vi.hoisted(() => ({
  readOnly: false,
  orderId: null as string | null,
  orderDisplayName: 'SO-1043',
  records: [] as { id: string }[],
  appendCreatedCalls: [] as string[],
  removeFromListCalls: [] as string[],
  invalidatedLists: [] as string[],
  refreshCalls: 0,
  utilsInvalidateReturnGet: 0,
  createCalls: [] as Array<{ entityDefinitionId: string; values: Record<string, unknown> }>,
  createShouldFail: false,
  createManyCalls: [] as unknown[],
  toastErrors: [] as unknown[],
  returnableLines: [] as Array<{
    lineItemId: string
    recordId: string
    name: string | null
    partId: string | null
    partName: string | null
    quantitySold: number | null
    ceiling: number | null
    alreadyReturned: number
    remaining: number | null
    ceilingSource: 'shipped' | 'sold' | 'unknown'
  }>,
}))

vi.mock('~/components/line-grid/hooks/use-line-row-actions', () => ({
  useLineRowActions: () => {},
  LINE_ROW_ACTION_EVENT: 'line-row-action',
}))

vi.mock('~/components/line-grid/ui/line-grid-frame', () => ({
  LineGridFrame: ({
    header,
    onAddRow,
    showEmpty,
    empty,
    children,
  }: {
    header: Array<{ label: React.ReactNode; addButton?: React.ReactNode }>
    onAddRow: () => void
    showEmpty?: boolean
    empty?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div data-testid='line-grid-frame'>
      {header[0]?.addButton}
      <button type='button' data-testid='nav-add-row' onClick={onAddRow}>
        nav add row
      </button>
      {showEmpty ? empty : children}
    </div>
  ),
}))

vi.mock('~/components/records/use-record-drawer-read-only', () => ({
  useRecordDrawerReadOnly: () => h.readOnly,
}))

vi.mock('~/components/resources/hooks/use-field-value-syncer', () => ({
  useFieldValueSyncer: () => ({
    isFetching: false,
    getValue: () => undefined,
    isValueLoading: () => false,
  }),
}))

vi.mock('~/components/resources/hooks/use-record-list', () => ({
  useRecordList: () => ({
    records: h.records,
    isLoading: false,
    isLoadingRecords: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => {},
    refresh: () => {
      h.refreshCalls += 1
    },
    appendCreated: (instanceId: string) => h.appendCreatedCalls.push(instanceId),
    removeFromList: (instanceId: string) => h.removeFromListCalls.push(instanceId),
  }),
}))

vi.mock('~/components/resources/hooks/use-records', () => ({
  useRecords: () => ({
    records: h.orderId ? [{ displayName: h.orderDisplayName }] : [],
    recordsByKey: new Map(),
    isLoading: false,
    isComplete: true,
    notFoundIds: [],
  }),
}))

vi.mock('~/components/resources/hooks/use-resource', () => ({
  useResource: () => ({ resource: { id: RETURN_LINE_DEF } }),
}))

vi.mock('~/components/resources/store', () => ({
  getRecordStoreState: () => ({
    invalidateLists: (definitionId: string) => h.invalidatedLists.push(definitionId),
  }),
  parseRecordId: (recordId: string) => {
    const [entityDefinitionId, entityInstanceId] = recordId.split(':')
    return { entityDefinitionId, entityInstanceId }
  },
  toRecordId: (definitionId: string, instanceId: string) => `${definitionId}:${instanceId}`,
}))

vi.mock('~/components/resources/store/resource-store', () => ({
  useResourceStore: (
    selector: (state: { systemAttributeMap: Record<string, string> }) => unknown
  ) => selector({ systemAttributeMap: {} }),
}))

vi.mock('~/components/resources/hooks/use-seed-created-record', () => ({
  useSeedCreatedRecord: () => ({ seedCreatedRecord: () => {} }),
}))

vi.mock('@auxx/ui/components/toast', () => ({
  toastError: (args: unknown) => h.toastErrors.push(args),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      return: {
        get: {
          invalidate: () => {
            h.utilsInvalidateReturnGet += 1
            return Promise.resolve()
          },
        },
      },
    }),
    return: {
      get: {
        useQuery: () => ({ data: { orderId: h.orderId } }),
      },
      returnableLines: {
        useQuery: () => ({ data: h.returnableLines, isLoading: false }),
      },
    },
    record: {
      create: {
        useMutation: () => ({
          mutateAsync: (input: { entityDefinitionId: string; values: Record<string, unknown> }) => {
            h.createCalls.push(input)
            if (h.createShouldFail) return Promise.reject(new Error('Over the return ceiling'))
            return Promise.resolve({
              recordId: `${RETURN_LINE_DEF}:ein_newline00000000000000000`,
              instance: {
                id: 'ein_newline00000000000000000',
                displayName: null,
                secondaryDisplayValue: null,
                avatarUrl: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            })
          },
        }),
      },
      createMany: {
        useMutation: () => ({
          mutateAsync: (input: unknown) => {
            h.createManyCalls.push(input)
            return Promise.resolve([])
          },
          isPending: false,
        }),
      },
    },
  },
}))

vi.mock('./return-line-row', () => ({
  RETURN_LINE_COLS: 'cols',
  ReturnLineRow: ({ recordId }: { recordId: string }) => <div data-testid={`row-${recordId}`} />,
  ReturnLineDraftRow: ({
    draft,
    onPickPart,
    onDelete,
  }: {
    draft: { draftId: string }
    onPickPart: (recordId: string) => void
    onDelete: () => void
  }) => (
    <div data-testid={`draft-${draft.draftId}`}>
      <button
        type='button'
        data-testid={`pick-part-${draft.draftId}`}
        onClick={() => onPickPart(PART_RECORD_ID)}>
        pick part
      </button>
      <button type='button' data-testid={`delete-draft-${draft.draftId}`} onClick={onDelete}>
        delete
      </button>
    </div>
  ),
}))

import { ReturnLinesCard } from './return-lines-card'

beforeEach(() => {
  h.readOnly = false
  h.orderId = null
  h.orderDisplayName = 'SO-1043'
  h.records = []
  h.appendCreatedCalls = []
  h.removeFromListCalls = []
  h.invalidatedLists = []
  h.refreshCalls = 0
  h.utilsInvalidateReturnGet = 0
  h.createCalls = []
  h.createShouldFail = false
  h.createManyCalls = []
  h.toastErrors = []
  h.returnableLines = []
})

function renderCard() {
  return render(
    <ReturnLinesCard recordId={RETURN_RECORD_ID as never} entityInstanceId={RETURN_ROW} />
  )
}

function draftTestIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="draft-"]')).map(
    (el) => el.getAttribute('data-testid') ?? ''
  )
}

describe('empty states', () => {
  it('names the order when the return has one', () => {
    h.orderId = ORDER_ROW
    h.orderDisplayName = 'SO-1043'
    renderCard()

    expect(
      screen.getByText('Add what arrived from SO-1043, or key a part by hand.')
    ).toBeInTheDocument()
  })

  it('explains there is no order to draw from otherwise', () => {
    h.orderId = null
    renderCard()

    expect(
      screen.getByText('This return names no order, so key the part that turned up on the dock.')
    ).toBeInTheDocument()
  })
})

describe('adding a line', () => {
  it('the header + pushes a draft', async () => {
    const { container } = renderCard()
    expect(draftTestIds(container)).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Add line' }))

    expect(draftTestIds(container)).toHaveLength(1)
  })

  it('nav past the last row also pushes a draft', async () => {
    const { container } = renderCard()

    await userEvent.click(screen.getByTestId('nav-add-row'))

    expect(draftTestIds(container)).toHaveLength(1)
  })

  it('a part pick on a draft calls record.create with return_line_return preset', async () => {
    const { container } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }))
    const [draftTestId] = draftTestIds(container)
    const draftId = draftTestId?.replace('draft-', '') ?? ''

    await userEvent.click(screen.getByTestId(`pick-part-${draftId}`))

    await waitFor(() => expect(h.createCalls).toHaveLength(1))
    expect(h.createCalls[0]).toEqual({
      entityDefinitionId: RETURN_LINE_DEF,
      values: {
        return_line_return: RETURN_RECORD_ID,
        return_line_part: PART_RECORD_ID,
        return_line_quantity: 1,
      },
    })
  })

  it('a rejected create leaves the draft in place and toasts', async () => {
    h.createShouldFail = true
    const { container } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }))
    const [draftTestId] = draftTestIds(container)
    const draftId = draftTestId?.replace('draft-', '') ?? ''

    await userEvent.click(screen.getByTestId(`pick-part-${draftId}`))

    await waitFor(() => expect(h.toastErrors).toHaveLength(1))
    expect(draftTestIds(container)).toEqual([draftTestId])
  })
})

describe('add from order', () => {
  it('is absent when the return names no order', () => {
    h.orderId = null
    renderCard()

    expect(screen.queryByRole('button', { name: 'Add from order' })).not.toBeInTheDocument()
  })

  it('is present when the return names an order', () => {
    h.orderId = ORDER_ROW
    renderCard()

    expect(screen.getByRole('button', { name: 'Add from order' })).toBeInTheDocument()
  })

  it('renders "no ceiling recorded" for a line with ceilingSource unknown, and keeps it selectable', async () => {
    h.orderId = ORDER_ROW
    h.returnableLines = [
      {
        lineItemId: 'li1',
        recordId: 'edf_lineitem0000000000000000:ein_li1000000000000000000000',
        name: 'Hydraulic lift',
        partId: 'ein_part1000000000000000000',
        partName: 'Hydraulic lift part',
        quantitySold: 2,
        ceiling: null,
        alreadyReturned: 0,
        remaining: null,
        ceilingSource: 'unknown',
      },
    ]
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: 'Add from order' }))

    expect(await screen.findByText('never shipped · no ceiling recorded')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: /Hydraulic lift/i })
    expect(checkbox).not.toBeDisabled()
  })
})

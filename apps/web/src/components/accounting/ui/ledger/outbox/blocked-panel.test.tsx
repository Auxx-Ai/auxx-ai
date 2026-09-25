// apps/web/src/components/accounting/ui/ledger/outbox/blocked-panel.test.tsx
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ListSelectionProvider } from '~/components/list-selection'

/** The groups `ledger.listBlocked` hands the panel, the org-channel handler, and the invalidations. */
const state = vi.hoisted(() => ({
  groups: [] as Record<string, unknown>[],
  onEvent: null as ((event: string, payload?: unknown) => void) | null,
  invalidated: [] as string[],
  dialog: null as { open: boolean; initialHandle?: string } | null,
  items: [] as Record<string, unknown>[],
  refs: [] as Record<string, unknown>[],
  retried: [] as unknown[],
  /** Records by id, as `useRecord` answers; system values by record id, as `useSystemValues` does. */
  records: {} as Record<string, { displayName: string }>,
  values: {} as Record<string, Record<string, unknown>>,
}))

vi.mock('~/components/resources', () => ({
  useResourceProperty: (slug: string) => `def-${slug}`,
  useRecord: ({ recordId }: { recordId: string | null }) => ({
    record: recordId ? state.records[recordId] : undefined,
    isLoading: false,
    isNotFound: false,
  }),
}))
vi.mock('~/components/resources/hooks/use-system-values', () => ({
  useSystemValues: (recordId: string | null) => ({
    values: (recordId && state.values[recordId]) || {},
    isLoading: false,
  }),
}))
vi.mock('~/components/resources/ui/record-badge', () => ({
  RecordBadge: ({ recordId, link }: { recordId: string; link?: boolean }) => (
    <span data-testid='record-badge' data-link={link ? 'true' : 'false'}>
      {recordId}
    </span>
  ),
}))

vi.mock('~/components/money/ui/provider-payment-notice', () => ({
  useProviderName: () => 'QuickBooks',
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('~/realtime/hooks', () => ({
  useOrgChannel: (handlers: { onEvent: (event: string, payload?: unknown) => void }) => {
    state.onEvent = handlers.onEvent
    return true
  },
}))
vi.mock('~/components/accounting/ui/settings/payment-gateway-add-dialog', () => ({
  PaymentGatewayAddDialog: (props: { open: boolean; initialHandle?: string }) => {
    state.dialog = { open: props.open, initialHandle: props.initialHandle }
    return null
  },
}))
vi.mock('@auxx/ui/components/tree-row', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/ui/components/tree-row')>()),
  TreeRowButton: ({
    tooltipText,
    children,
    onClick,
    disabled,
  }: {
    tooltipText?: string
    children?: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type='button' aria-label={tooltipText} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))
vi.mock('./outbox-row', () => ({
  OutboxRow: ({
    title,
    typeLabel,
    date,
    amount,
    secondary,
    actions,
    onToggleOpen,
    onOpen,
    active,
    children,
  }: {
    title?: ReactNode
    typeLabel?: string
    date?: string
    amount?: string
    secondary?: ReactNode
    actions?: ReactNode
    onToggleOpen?: () => void
    onOpen?: () => void
    active?: boolean
    children?: ReactNode
  }) => (
    <div data-active={active ? 'true' : undefined}>
      {typeLabel && <span data-testid='type'>{typeLabel}</span>}
      {date && <span data-testid='date'>{date}</span>}
      <span>{title}</span>
      <span>{amount}</span>
      {secondary}
      {actions}
      {onToggleOpen && <button type='button' aria-label='Expand' onClick={onToggleOpen} />}
      {onOpen && <button type='button' aria-label={`Open ${title}`} onClick={onOpen} />}
      {children}
    </div>
  ),
}))

vi.mock('~/trpc/react', () => {
  const invalidate = (name: string) => () => state.invalidated.push(name)
  return {
    api: {
      useUtils: () => ({
        ledger: {
          listBlocked: { invalidate: invalidate('listBlocked') },
          listBlockedItems: { invalidate: invalidate('listBlockedItems') },
          outboxCounts: { invalidate: invalidate('outboxCounts') },
        },
      }),
      ledger: {
        listBlocked: {
          useInfiniteQuery: (input: { reasonCode?: string }) => ({
            data: {
              pages: [
                { items: input.reasonCode ? state.refs : state.groups, nextCursor: undefined },
              ],
            },
            isPending: false,
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
          }),
        },
        listBlockedItems: {
          useInfiniteQuery: () => ({
            data: { pages: [{ items: state.items }] },
            isPending: false,
            hasNextPage: false,
          }),
        },
        retryBlockedGroup: {
          useMutation: () => ({
            mutate: (input: unknown) => state.retried.push(input),
            mutateAsync: vi.fn(),
            isPending: false,
          }),
        },
      },
    },
  }
})

import { BlockedPanel } from './blocked-panel'

function group(overrides: Record<string, unknown> = {}) {
  return {
    reasonCode: 'GATEWAY_UNMAPPED',
    role: null,
    railId: null,
    glAccountId: null,
    externalRef: 'authorize.net',
    count: 55,
    dueCount: 0,
    sourceKinds: ['money_transaction'],
    latestAt: new Date('2026-09-22T12:00:00Z'),
    railName: null,
    glAccountName: null,
    refCount: null,
    refLabel: null,
    ...overrides,
  }
}

function renderPanel(
  props: {
    onSetCosts?: () => void
    onSelectShipment?: (id: string) => void
    onSelectRecord?: (id: string) => void
    activeRecordId?: string | null
  } = {}
) {
  return render(
    <TooltipProvider>
      <ListSelectionProvider>
        <BlockedPanel
          filters={{ search: '', from: '', to: '', categories: [] }}
          bookTimeZone='UTC'
          emptyDescription='Nothing here'
          activeMovementId={null}
          onSelectMovement={vi.fn()}
          activeShipmentId={null}
          onSelectShipment={vi.fn()}
          {...props}
        />
      </ListSelectionProvider>
    </TooltipProvider>
  )
}

beforeEach(() => {
  state.groups = []
  state.onEvent = null
  state.invalidated = []
  state.dialog = null
  state.items = []
  state.refs = []
  state.retried = []
  state.records = {}
  state.values = {}
})

/** A parked item under a part, as `ledger.listBlockedItems` hands it back. */
function priceItem(overrides: Record<string, unknown>) {
  return {
    id: `wi-${overrides.sourceId}`,
    reasonCode: 'STANDARD_COST_MISSING',
    externalRef: 'part_1',
    detail: { partName: 'The Attic-Lift' },
    label: null,
    recordDefinitionId: null,
    moneyTransactionId: null,
    purpose: null,
    amountMinor: null,
    currency: null,
    updatedAt: new Date('2026-09-22T12:00:00Z'),
    providerObjectUrl: null,
    ...overrides,
  }
}

/** A top-level reason row for a `groupsByExternalRef` code. */
function reason(overrides: Record<string, unknown> = {}) {
  return group({ externalRef: null, refCount: 2, ...overrides })
}

describe('BlockedPanel', () => {
  it('folds a grouped code into a reason row; its handle row maps in place', () => {
    state.groups = [reason({ count: 74, refCount: 3 })]
    state.refs = [group({ refLabel: 'authorize.net' })]
    renderPanel()
    expect(screen.getByText('Gateway not mapped · 3 handles · 74 payments')).toBeTruthy()
    expect(screen.queryByLabelText('Map it')).toBeNull()
    fireEvent.click(screen.getByLabelText('Expand'))
    expect(screen.getByText('authorize.net · 55 payments')).toBeTruthy()
    expect(state.dialog?.open).toBe(false)
    fireEvent.click(screen.getByLabelText('Map it'))
    expect(state.dialog).toEqual({ open: true, initialHandle: 'authorize.net' })
  })

  it('retries a whole reason, or one part under it', () => {
    state.groups = [
      reason({ reasonCode: 'STANDARD_COST_MISSING', sourceKinds: ['fulfillment'], count: 1481 }),
    ]
    state.refs = [
      group({
        reasonCode: 'STANDARD_COST_MISSING',
        externalRef: 'part_1',
        refLabel: 'The Attic-Lift',
        count: 446,
        sourceKinds: ['fulfillment'],
      }),
    ]
    renderPanel()
    fireEvent.click(screen.getAllByLabelText('Retry all')[0]!)
    expect(state.retried).toEqual([{ reasonCode: 'STANDARD_COST_MISSING' }])
    fireEvent.click(screen.getByLabelText('Expand'))
    expect(screen.getByText('The Attic-Lift · 446 shipments')).toBeTruthy()
    fireEvent.click(screen.getAllByLabelText('Retry all')[1]!)
    expect(state.retried[1]).toEqual({
      group: {
        reasonCode: 'STANDARD_COST_MISSING',
        role: null,
        railId: null,
        glAccountId: null,
        externalRef: 'part_1',
      },
    })
  })

  it('reads a part row by document kind and opens each kind as its own document', () => {
    state.groups = [
      reason({
        reasonCode: 'STANDARD_COST_MISSING',
        sourceKinds: ['fulfillment', 'build', 'stock_movement'],
        count: 459,
        refCount: 1,
        sourceKindCounts: { fulfillment: 446, build: 12, stock_movement: 1 },
      }),
    ]
    state.refs = [
      group({
        reasonCode: 'STANDARD_COST_MISSING',
        externalRef: 'part_1',
        refLabel: 'The Attic-Lift',
        count: 459,
        sourceKinds: ['fulfillment', 'build', 'stock_movement'],
        sourceKindCounts: { fulfillment: 446, build: 12, stock_movement: 1 },
      }),
    ]
    state.items = [
      priceItem({
        sourceKind: 'fulfillment',
        sourceId: 'f1',
        label: 'Shipment #1001',
        recordDefinitionId: 'def-fulfillment',
      }),
      priceItem({ sourceKind: 'build', sourceId: 'b1' }),
      priceItem({ sourceKind: 'stock_movement', sourceId: 'm1' }),
    ]
    state.records = { 'def-build:b1': { displayName: 'BLD-0007' } }
    state.values = {
      'def-stock_movement:m1': {
        stock_movement_type: 'adjust',
        stock_movement_quantity: -3,
        stock_movement_reason: 'Recount',
        stock_movement_occurred_at: '2026-09-10T09:00:00Z',
      },
    }
    const onSelectShipment = vi.fn()
    const onSelectRecord = vi.fn()
    renderPanel({ onSelectShipment, onSelectRecord, activeRecordId: 'def-build:b1' })

    expect(
      screen.getByText('Standard cost missing · 1 part · 446 shipments · 12 builds · 1 count')
    ).toBeTruthy()
    fireEvent.click(screen.getAllByLabelText('Expand')[0]!)
    expect(screen.getByText('The Attic-Lift · 446 shipments · 12 builds · 1 count')).toBeTruthy()
    fireEvent.click(screen.getAllByLabelText('Expand')[1]!)

    // The shipment row, as before: its own frame.
    fireEvent.click(screen.getByLabelText('Open Shipment #1001'))
    expect(onSelectShipment).toHaveBeenCalledWith('f1')

    // The build row is named by its record and opens it; it is the one the drawer shows.
    const buildRow = screen.getByText('BLD-0007').closest('div')!
    expect(buildRow.getAttribute('data-active')).toBe('true')
    fireEvent.click(screen.getByLabelText('Open BLD-0007'))
    expect(onSelectRecord).toHaveBeenCalledWith('def-build:b1')

    // The count row reads its type, signed quantity and reason off the movement, dated when it happened.
    const countRow = screen.getByText('-3 · Recount').closest('div')!
    expect(countRow.querySelector('[data-testid=type]')?.textContent).toBe('Adjustment')
    expect(countRow.querySelector('[data-testid=date]')?.textContent).toBe('Sep 10, 2026')
    fireEvent.click(screen.getByLabelText('Open -3 · Recount'))
    expect(onSelectRecord).toHaveBeenCalledWith('def-stock_movement:m1')

    const types = screen.getAllByTestId('type').map((node) => node.textContent)
    expect(types).toEqual(expect.arrayContaining(['Shipment', 'Build', 'Adjustment']))
    // Every row's badge is the plain badge while a drawer handler takes the click.
    for (const badge of screen.getAllByTestId('record-badge')) {
      expect(badge.getAttribute('data-link')).toBe('false')
    }
  })

  it('links a build or count out to its record when no drawer handler is given', () => {
    state.groups = [
      group({
        reasonCode: 'STANDARD_COST_MISSING',
        externalRef: 'part_1',
        refLabel: 'The Attic-Lift',
        sourceKinds: ['build'],
        count: 1,
      }),
    ]
    state.items = [priceItem({ sourceKind: 'build', sourceId: 'b1' })]
    renderPanel()
    fireEvent.click(screen.getByLabelText('Expand'))
    expect(screen.getByTestId('record-badge').getAttribute('data-link')).toBe('true')
    expect(screen.queryByLabelText('Open Build')).toBeNull()
  })

  it('offers Set costs on the standard-cost reason only when a handler is given', () => {
    state.groups = [reason({ reasonCode: 'STANDARD_COST_MISSING' })]
    const { unmount } = renderPanel()
    expect(screen.queryByLabelText('Set costs')).toBeNull()
    unmount()
    const onSetCosts = vi.fn()
    renderPanel({ onSetCosts })
    fireEvent.click(screen.getByLabelText('Set costs'))
    expect(onSetCosts).toHaveBeenCalledOnce()
  })

  it('shows a group being retried in place of Retry all', () => {
    state.groups = [group({ reasonCode: 'ROLE_UNMAPPED', role: 'clearing', dueCount: 3 })]
    renderPanel()
    expect(screen.getAllByText('Retrying 3…').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Retry all')).toBeNull()
    expect((screen.getByLabelText('Retrying 3…') as HTMLButtonElement).disabled).toBe(true)
  })

  it('links a provider duplicate to the object to delete in the connected books', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    state.groups = [
      group({
        reasonCode: 'PROVIDER_DUPLICATE',
        externalRef: 'Deposit 403',
        sourceKinds: ['provider_ledger_entry'],
      }),
    ]
    state.items = [
      {
        id: 'wi-1',
        sourceKind: 'provider_ledger_entry',
        sourceId: 'ple-1',
        reasonCode: 'PROVIDER_DUPLICATE',
        externalRef: 'Deposit 403',
        detail: null,
        label: null,
        recordDefinitionId: null,
        moneyTransactionId: null,
        purpose: null,
        amountMinor: null,
        currency: null,
        updatedAt: new Date('2026-09-22T12:00:00Z'),
        providerObjectUrl: 'https://qbo.example/app/deposit?txnId=403',
      },
    ]
    renderPanel()
    fireEvent.click(screen.getByLabelText('Expand'))
    fireEvent.click(screen.getByLabelText('Open in QuickBooks'))
    expect(open).toHaveBeenCalledWith(
      'https://qbo.example/app/deposit?txnId=403',
      '_blank',
      'noopener'
    )
    open.mockRestore()
  })

  it('offers no provider link on an item without one', () => {
    state.groups = [group({ reasonCode: 'ROLE_UNMAPPED', role: 'clearing', externalRef: null })]
    state.items = [
      {
        id: 'wi-2',
        sourceKind: 'money_transaction',
        sourceId: 'mt-1',
        reasonCode: 'ROLE_UNMAPPED',
        externalRef: null,
        detail: null,
        label: 'Acme',
        recordDefinitionId: null,
        moneyTransactionId: 'mt-1',
        purpose: null,
        amountMinor: null,
        currency: null,
        updatedAt: new Date('2026-09-22T12:00:00Z'),
        providerObjectUrl: null,
      },
    ]
    renderPanel()
    fireEvent.click(screen.getByLabelText('Expand'))
    expect(screen.getByText('Acme')).toBeTruthy()
    expect(screen.queryByLabelText('Open in QuickBooks')).toBeNull()
  })

  it('refetches on accountingWork:changed and ignores other frames', () => {
    state.groups = [group()]
    renderPanel()
    state.onEvent?.('exportBatch:changed')
    expect(state.invalidated).toEqual([])
    state.onEvent?.('accountingWork:changed')
    expect(state.invalidated).toEqual(['listBlocked', 'listBlockedItems', 'outboxCounts'])
  })
})

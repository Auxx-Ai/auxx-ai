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
    amount,
    actions,
  }: {
    title?: ReactNode
    amount?: string
    actions?: ReactNode
  }) => (
    <div>
      <span>{title}</span>
      <span>{amount}</span>
      {actions}
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
          useInfiniteQuery: () => ({
            data: { pages: [{ items: state.groups, nextCursor: undefined }] },
            isPending: false,
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
          }),
        },
        listBlockedItems: { useInfiniteQuery: () => ({ data: undefined, isPending: true }) },
        retryBlockedGroup: {
          useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
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
    ...overrides,
  }
}

function renderPanel() {
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
})

describe('BlockedPanel', () => {
  it('names the handle, and Map opens the add dialog in place seeded with it', () => {
    state.groups = [group()]
    renderPanel()
    expect(screen.getByText(/Gateway handle 'authorize.net'/)).toBeTruthy()
    expect(state.dialog?.open).toBe(false)
    fireEvent.click(screen.getByLabelText('Map it'))
    expect(state.dialog).toEqual({ open: true, initialHandle: 'authorize.net' })
  })

  it('shows a group being retried in place of Retry all', () => {
    state.groups = [group({ dueCount: 3 })]
    renderPanel()
    expect(screen.getAllByText('Retrying 3…').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Retry all')).toBeNull()
    expect((screen.getByLabelText('Retrying 3…') as HTMLButtonElement).disabled).toBe(true)
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

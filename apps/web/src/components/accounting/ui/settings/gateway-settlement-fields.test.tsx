// apps/web/src/components/accounting/ui/settings/gateway-settlement-fields.test.tsx
import type { PaymentGatewayRow } from '@auxx/lib/payment-gateways/client'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  canEdit: true,
  mutate: vi.fn(),
  data: {} as Record<string, unknown>,
}))
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }))
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ can: () => state.canEdit }),
}))
vi.mock('~/components/global/forms/field-panel', () => ({
  FieldPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldPanelRow: ({ children, title }: { children: ReactNode; title: string }) => (
    <label>
      {title}
      {children}
    </label>
  ),
}))
vi.mock('~/components/fields/inputs/field-input-adapter', () => ({
  FieldInputAdapter: ({
    value,
    fieldOptions,
    disabled,
    onChange,
  }: {
    value: string
    fieldOptions?: { options: { value: string; label: string }[] }
    disabled: boolean
    onChange: (value: string) => void
  }) =>
    fieldOptions ? (
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}>
        <option value=''>Select</option>
        {fieldOptions.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ) : (
      <input
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
}))
vi.mock('~/components/accounting/ui/bank-account-picker', () => ({
  BankAccountPicker: ({ disabled }: { disabled: boolean }) => (
    <button type='button' disabled={disabled}>
      Pick bank
    </button>
  ),
}))
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      paymentGateway: { settlementReadiness: { setData: vi.fn() }, list: { invalidate: vi.fn() } },
    }),
    paymentGateway: {
      settlementReadiness: { useQuery: () => ({ data: state.data, isPending: false }) },
      updateSettlementSettings: { useMutation: () => ({ mutate: state.mutate, isPending: false }) },
    },
  },
}))

import { GatewaySettlementFields } from './gateway-settlement-fields'

const gateway = {
  id: 'gateway-one',
  processorAccountId: 'merchant-one',
  settlementCurrency: 'USD',
  bankAccountId: 'bank-one',
  settlementSource: 'manual',
  status: 'active',
} as PaymentGatewayRow
beforeEach(() => {
  state.canEdit = true
  state.mutate.mockClear()
  state.data = {
    processorAccountId: 'merchant-one',
    settlementCurrency: 'USD',
    bankAccountId: 'bank-one',
    configured: true,
    issues: [],
    accounts: [
      {
        processorAccountId: 'merchant-one',
        providerKey: 'processor-a',
        externalAccountId: 'merchant/one',
        currencies: ['USD'],
        connections: [],
      },
      {
        processorAccountId: 'merchant-two',
        providerKey: 'processor-a',
        externalAccountId: 'merchant/two',
        currencies: ['CAD'],
        connections: [],
      },
      {
        processorAccountId: 'merchant-three',
        providerKey: 'processor-b',
        externalAccountId: 'merchant/one',
        currencies: ['USD'],
        connections: [],
      },
    ],
  }
})
describe('gateway settlement fields', () => {
  it('exposes all explicit identities independently of the legacy reader and saves the chosen merchant', () => {
    render(<GatewaySettlementFields gateway={gateway} />)
    expect(screen.getByRole('option', { name: 'processor-a · merchant/one' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'processor-b · merchant/one' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Settlement account'), {
      target: { value: 'merchant-two' },
    })
    expect(state.mutate).toHaveBeenCalledWith({
      gatewayId: gateway.id,
      patch: { processorAccountId: 'merchant-two', settlementCurrency: 'CAD', bankAccountId: null },
    })
  })
  it('shows imported activity without claiming it has a verified connection', () => {
    render(<GatewaySettlementFields gateway={gateway} />)
    expect(screen.getByText(/No current connection is linked/)).toBeInTheDocument()
    expect(screen.getByText('Settlement mappings configured.')).toBeInTheDocument()
  })
  it('shows every reporting connection and its independent acquisition health', () => {
    const accounts = state.data.accounts as { connections: Record<string, unknown>[] }[]
    accounts[0]!.connections = [
      {
        connectorId: 'one',
        connectorName: 'Source one',
        connectorStatus: 'active',
        requiresReauth: true,
        verified: true,
      },
      {
        connectorId: 'two',
        connectorName: 'Source two',
        connectorStatus: 'active',
        requiresReauth: false,
        verified: false,
      },
    ]
    render(<GatewaySettlementFields gateway={gateway} />)
    expect(
      screen
        .getAllByRole('link', { name: 'Manage connection' })
        .map((link) => link.getAttribute('href'))
    ).toEqual(['/app/connectors/one', '/app/connectors/two'])
    expect(screen.getByText(/Reconnect to acquire new activity/)).toBeInTheDocument()
    expect(screen.getByText(/Sync to verify the current account/)).toBeInTheDocument()
    expect(screen.getByText('Settlement mappings configured.')).toBeInTheDocument()
  })
  it('requires financial control permission to edit mappings', () => {
    state.canEdit = false
    render(<GatewaySettlementFields gateway={gateway} />)
    expect(screen.getByLabelText('Settlement account')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Receiving bank' })).toBeDisabled()
  })
})

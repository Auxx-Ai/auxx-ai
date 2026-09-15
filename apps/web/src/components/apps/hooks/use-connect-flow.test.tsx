// apps/web/src/components/apps/hooks/use-connect-flow.test.tsx

import { HIDDEN_VALUE } from '@auxx/credentials/crypto/client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ConnectFlowArgs, useConnectFlow } from './use-connect-flow'

const mocks = vi.hoisted(() => {
  const rows = [{ id: 'credential', grantedScopes: ['read_all_orders'] }]
  const list = { getData: () => rows, invalidate: vi.fn() }
  return {
    popup: vi.fn(),
    refresh: vi.fn(),
    edit: { data: { values: { shop: 'fixture' } as Record<string, string>, tokenSet: false } },
    utils: {
      apps: { listConnections: list, listInstalled: { invalidate: vi.fn() } },
      connections: { list },
    },
  }
})

vi.mock('~/hooks/use-oauth-popup', () => ({
  useOAuthPopup: () => ({ open: mocks.popup, cancel: vi.fn(), pending: false }),
}))
vi.mock('~/components/fields/inputs/field-input-adapter', () => ({
  FieldInputAdapter: ({ value }: { value: string }) => <input value={value} readOnly />,
}))
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => mocks.utils,
    apps: { saveSecretConnection: { useMutation: () => ({ isPending: false }) } },
    connections: {
      refreshTokens: { useMutation: () => ({ mutateAsync: mocks.refresh }) },
      save: { useMutation: () => ({ isPending: false }) },
      getForEdit: { useQuery: () => mocks.edit },
    },
  },
}))

const args: ConnectFlowArgs = {
  connectionId: 'credential',
  definitionId: 'definition',
  scope: 'organization',
  verify: async () => null,
  target: {
    title: 'Shopify',
    owner: { kind: 'app', appId: 'app', appSlug: 'shopify', installationId: 'installation' },
    connectionDefinitions: {
      organization: {
        id: 'definition',
        connectionType: 'oauth2-code',
        oauth2Scopes: ['read_orders'],
        oauth2OptionalScopes: ['read_all_orders', 'read_shopify_payments_payouts'],
        connectionVariables: [{ key: 'shop', label: 'Shop', required: true }],
      },
    },
  },
}

function Harness({ input = args }: { input?: ConnectFlowArgs }) {
  const flow = useConnectFlow()
  return (
    <>
      <button type='button' onClick={() => flow.start(input)}>
        Start reconnect
      </button>
      {flow.Dialogs}
    </>
  )
}

describe('reconnect optional permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.edit.data.values = { shop: 'fixture' }
  })

  it('reuses the stored client secret when reconnecting with unchanged masked fields', async () => {
    mocks.edit.data.values = { shop: 'fixture', clientId: 'client', clientSecret: HIDDEN_VALUE }
    const input: ConnectFlowArgs = {
      ...args,
      target: {
        ...args.target,
        connectionDefinitions: {
          organization: {
            ...args.target.connectionDefinitions.organization!,
            requiresOwnClient: true,
            connectionVariables: [
              { key: 'shop', label: 'Shop', required: true },
              { key: 'clientId', label: 'Client ID', required: true },
              { key: 'clientSecret', label: 'Client secret', secret: true, required: true },
            ],
          },
        },
      },
    }
    render(<Harness input={input} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start reconnect' }))
    await screen.findByRole('checkbox', { name: 'read_shopify_payments_payouts' })
    fireEvent.click(screen.getByRole('button', { name: /^Reconnect$/ }))
    await waitFor(() => expect(mocks.popup).toHaveBeenCalledTimes(1))
    const url = new URL(mocks.popup.mock.calls[0]![0].popupUrl, 'https://auxx.test')
    expect(url.searchParams.get('connectionId')).toBe('credential')
    expect(url.searchParams.get('var_clientId')).toBe('client')
    expect(url.searchParams.has('var_clientSecret')).toBe(false)
    expect(url.toString()).not.toContain(HIDDEN_VALUE)
  })

  it('shows held and new permissions, then requests the selected scopes through consent', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Start reconnect' }))
    const held = await screen.findByRole('checkbox', { name: 'read_all_orders' })
    const payout = screen.getByRole('checkbox', { name: 'read_shopify_payments_payouts' })
    expect(held).toBeChecked()
    expect(payout).not.toBeChecked()
    expect(
      screen.queryByText("Set your OAuth app's scopes to match this list before connecting:")
    ).toBeNull()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.popup).not.toHaveBeenCalled()
    fireEvent.click(payout)
    fireEvent.click(screen.getByRole('button', { name: /^Reconnect$/ }))
    await waitFor(() => expect(mocks.popup).toHaveBeenCalledTimes(1))
    const url = new URL(mocks.popup.mock.calls[0]![0].popupUrl, 'https://auxx.test')
    expect(url.searchParams.getAll('scope_add')).toEqual([
      'read_all_orders',
      'read_shopify_payments_payouts',
    ])
    expect(url.searchParams.get('connectionId')).toBe('credential')
    expect(url.searchParams.get('connectionDefinitionId')).toBe('definition')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('sends explicit Edit-dialog selections directly to consent even if token refresh would succeed', () => {
    mocks.refresh.mockResolvedValue({ success: true })
    render(
      <Harness
        input={{ ...args, scopeAdd: ['read_all_orders', 'read_shopify_payments_payouts'] }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start reconnect' }))
    expect(mocks.popup).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('keeps silent refresh for reconnects without optional scopes', async () => {
    mocks.refresh.mockResolvedValue({ success: true })
    render(
      <Harness
        input={{
          ...args,
          target: {
            ...args.target,
            connectionDefinitions: { organization: { connectionType: 'oauth2-code' } },
          },
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start reconnect' }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith({ credentialId: 'credential' }))
    expect(mocks.popup).not.toHaveBeenCalled()
  })
})

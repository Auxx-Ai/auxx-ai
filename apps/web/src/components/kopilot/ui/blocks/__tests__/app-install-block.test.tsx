// apps/web/src/components/kopilot/ui/blocks/__tests__/app-install-block.test.tsx
//
// Plan 19 Phase B — the `auxx:app-install` card is a STATE MACHINE, and every
// arm of it exists because a naive implementation gets it wrong:
//
//  - installed-state must come from `AppsContext`, not from `getBySlug`.
//    `InlineAppInstallButton` refreshes installations but (before this plan) did
//    not invalidate `getBySlug`, so a card gating on `installation.isInstalled`
//    never advances past Install.
//  - the pre-install "will need an account" hint must NOT come from
//    `deriveAppConnectionState`: it derives `requiresConnection` from the
//    INSTALLATIONS list, which holds installed apps only, so an uninstalled app
//    resolves `not_required` — a false negative that hides connect entirely.
//  - connect happens in `AppSettingsDialog`, never through `useConnectFlow` at
//    this level: `flow.start` falls back to `window.location.href` when a popup
//    is blocked, which would destroy the builder and this transcript.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Installation = {
  app: { id: string; slug: string; title: string }
  installationType: 'development' | 'production'
  connectionDefinitions?: { user?: unknown; organization?: unknown }
}

type Connection = {
  id: string
  appId: string
  isDefault: boolean
  connectedAt: Date | null
  connectionStatus: string
  label: string | null
}

const h = vi.hoisted(() => ({
  installations: [] as unknown[],
  connections: [] as unknown[],
  details: undefined as unknown,
  detailsError: false,
  install: vi.fn(),
  refreshInstallations: vi.fn(async () => {}),
  invalidateGetBySlug: vi.fn(async () => {}),
  invalidateConnections: vi.fn(async () => {}),
  onInstalled: undefined as (() => void) | undefined,
  flowStart: vi.fn(),
  dialogProps: null as Record<string, unknown> | null,
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      apps: {
        getBySlug: { invalidate: h.invalidateGetBySlug },
        listConnections: { invalidate: h.invalidateConnections },
      },
    }),
    apps: {
      getBySlug: {
        useQuery: () => ({ data: h.details, isError: h.detailsError, isLoading: false }),
      },
      install: {
        useMutation: (opts?: { onSuccess?: () => void | Promise<void> }) => ({
          mutate: (vars: unknown) => {
            h.install(vars)
            void opts?.onSuccess?.()
          },
          isPending: false,
        }),
      },
    },
  },
}))

vi.mock('~/components/apps/providers/apps-context', () => ({
  useAppsContext: () => ({
    appInstallations: h.installations,
    appConnections: h.connections,
    refreshInstallations: h.refreshInstallations,
  }),
  useOptionalAppsContext: () => ({
    appInstallations: h.installations,
    appConnections: h.connections,
    isLoading: false,
    isLoadingConnections: false,
  }),
}))

// The seam this card's no-redirect guarantee rests on — assert the PROPS, not
// the dialog's internals (which have their own tests).
vi.mock('~/components/apps/ui/app-settings-dialog', () => ({
  AppSettingsDialog: (props: Record<string, unknown>) => {
    h.dialogProps = props
    return props.open ? <div data-testid='app-settings-dialog' /> : null
  },
}))

// Never imported by the card — mocked so that if anyone ever wires it in, the
// "no flow.start outside a click" assertion below actually has something to see.
vi.mock('~/components/apps/hooks/use-connect-flow', () => ({
  useConnectFlow: () => ({ start: h.flowStart, Dialogs: null, pending: false }),
}))

vi.mock('~/components/apps/ui/app-icon', () => ({
  AppIcon: () => <div data-testid='app-icon' />,
}))
vi.mock('~/components/subscriptions/limit-reached-dialog', () => ({
  LimitReachedDialog: () => null,
}))
vi.mock('~/hooks/use-analytics', () => ({ useAnalytics: () => null }))
vi.mock('~/hooks/use-demo', () => ({ useDemo: () => ({ isDemo: false }) }))
vi.mock('next/navigation', () => ({ usePathname: () => '/app/workflows/wf_1' }))

const { AppInstallBlock } = await import('../app-install-block')
const { BLOCK_SCHEMAS } = await import('../block-schemas')

const APP_ID = 'app_ups'
const METHOD = { id: 'cd_1', label: 'UPS account', connectionType: 'oauth2-code' }

/** `apps.getBySlug` output, trimmed to what the card reads. */
function details({
  methods = [] as unknown[],
  isInstalled = false,
  connectionDefinitions = {} as Record<string, unknown>,
} = {}) {
  return {
    app: { id: APP_ID, slug: 'ups', title: 'UPS', avatarUrl: null },
    developerAccount: { title: 'Auxx', logoUrl: null },
    installation: { id: undefined, isInstalled, methods, connectionDefinitions },
  }
}

function installed(): Installation {
  return {
    app: { id: APP_ID, slug: 'ups', title: 'UPS' },
    installationType: 'production',
    connectionDefinitions: { organization: METHOD },
  }
}

function connection(status: string): Connection {
  return {
    id: 'cred_1',
    appId: APP_ID,
    isDefault: true,
    connectedAt: new Date(),
    connectionStatus: status,
    label: 'UPS prod',
  }
}

beforeEach(() => {
  h.installations = []
  h.connections = []
  h.details = details({ methods: [METHOD] })
  h.detailsError = false
  h.dialogProps = null
  h.install.mockClear()
  h.flowStart.mockClear()
  h.invalidateGetBySlug.mockClear()
  h.invalidateConnections.mockClear()
})

describe('app-install schema — partial streaming', () => {
  const schema = BLOCK_SCHEMAS['app-install']

  it('accepts the frames the partial-JSON parser emits mid-stream', () => {
    // `{` → `{}`, then `{"appSlug":"u` → `{ appSlug: 'u' }`. Neither may fall
    // back, or the block remounts and re-runs its entrance animation.
    expect(schema?.safeParse({}).success).toBe(true)
    expect(schema?.safeParse({ appSlug: 'u' }).success).toBe(true)
    expect(schema?.safeParse({ appSlug: 'ups' }).success).toBe(true)
  })

  it('withholds a truncated slug rather than querying a prefix', () => {
    const { container } = render(<AppInstallBlock data={{ appSlug: 'u' }} lastValueTruncated />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('AppInstallBlock — the state machine', () => {
  it('renders a muted line, never an Install button, for a slug that does not exist', () => {
    h.detailsError = true
    h.details = undefined

    render(<AppInstallBlock data={{ appSlug: 'nope' }} />)

    expect(screen.getByText(/isn.t available to install/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: /install/i })).toBeNull()
  })

  it('offers Install with the pre-install connection hint when the app declares one', () => {
    // The detail-4 trap: the resolver would say `not_required` here, because
    // the app is not in the installations list at all.
    render(<AppInstallBlock data={{ appSlug: 'ups' }} />)

    expect(screen.getByRole('button', { name: /install/i })).toBeVisible()
    expect(screen.getByText(/will need a UPS account/i)).toBeVisible()
  })

  it('omits the hint for an app that declares no connection method', () => {
    h.details = details({ methods: [] })

    render(<AppInstallBlock data={{ appSlug: 'ups' }} />)

    expect(screen.getByRole('button', { name: /install/i })).toBeVisible()
    expect(screen.queryByText(/will need a/i)).toBeNull()
  })

  it("keeps InlineAppInstallButton's own Installed badge for an already-installed app", () => {
    h.details = details({ methods: [], isInstalled: true })
    h.installations = [{ ...installed(), connectionDefinitions: {} }]

    render(<AppInstallBlock data={{ appSlug: 'ups' }} />)

    expect(screen.getByText('Installed')).toBeVisible()
    expect(screen.queryByRole('button', { name: /connect/i })).toBeNull()
  })

  it('goes straight to Installed — never Connect — when the app needs no connection', () => {
    h.details = details({ methods: [], isInstalled: true })
    h.installations = [{ ...installed(), connectionDefinitions: {} }]
    h.connections = []

    render(<AppInstallBlock data={{ appSlug: 'ups' }} />)

    expect(screen.getByText('Installed')).toBeVisible()
    expect(screen.queryByText(/connect/i)).toBeNull()
  })

  it('advances to Connect after install, without remounting and without a fresh getBySlug', async () => {
    const user = userEvent.setup()
    const { container, rerender } = render(<AppInstallBlock data={{ appSlug: 'ups' }} />)
    const cardBefore = container.querySelector('[data-testid="app-icon"]')?.parentElement

    await user.click(screen.getByRole('button', { name: /install/i }))
    expect(h.install).toHaveBeenCalledWith({ appSlug: 'ups' })

    // `refreshInstallations()` lands; `getBySlug` deliberately stays STALE
    // (`isInstalled: false`) — the card must advance on the context alone.
    h.installations = [installed()]
    h.connections = []
    rerender(<AppInstallBlock data={{ appSlug: 'ups' }} />)

    expect(screen.getByRole('button', { name: /^connect$/i })).toBeVisible()
    expect(container.querySelector('[data-testid="app-icon"]')?.parentElement).toBe(cardBefore)
  })

  it('shows Reconnect, not Connect, for an expired credential', () => {
    h.details = details({ methods: [METHOD], isInstalled: true })
    h.installations = [installed()]
    h.connections = [connection('expired')]

    render(<AppInstallBlock data={{ appSlug: 'ups' }} />)

    expect(screen.getByRole('button', { name: /reconnect/i })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^connect$/i })).toBeNull()
  })

  it('shows Ready once a connected credential resolves', () => {
    h.details = details({ methods: [METHOD], isInstalled: true })
    h.installations = [installed()]
    h.connections = [connection('connected')]

    render(<AppInstallBlock data={{ appSlug: 'ups' }} />)

    expect(screen.getByText('Ready')).toBeVisible()
    expect(screen.queryByRole('button', { name: /connect/i })).toBeNull()
  })
})

describe('AppInstallBlock — connect never navigates away', () => {
  beforeEach(() => {
    h.details = details({ methods: [METHOD], isInstalled: true })
    h.installations = [installed()]
    h.connections = []
  })

  it('opens AppSettingsDialog on the connections tab with a non-empty returnTo', async () => {
    const user = userEvent.setup()
    render(<AppInstallBlock data={{ appSlug: 'ups' }} />)

    // Mounted closed — no dialog until the user asks for one.
    expect(screen.queryByTestId('app-settings-dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    expect(screen.getByTestId('app-settings-dialog')).toBeVisible()
    expect(h.dialogProps).toMatchObject({
      appSlug: 'ups',
      installationType: 'production',
      initialTab: 'connections',
      open: true,
    })
    expect(String(h.dialogProps?.returnTo ?? '')).not.toBe('')
  })

  it('never reaches flow.start or window.open outside a click handler', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const hrefBefore = window.location.href

    const { rerender } = render(<AppInstallBlock data={{ appSlug: 'ups' }} />)
    rerender(<AppInstallBlock data={{ appSlug: 'ups' }} />)
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    // Opening the DIALOG is safe; starting the flow is what a blocked popup
    // turns into a full-page redirect, and only the dialog's own button may.
    expect(h.flowStart).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
    expect(window.location.href).toBe(hrefBefore)

    openSpy.mockRestore()
  })

  it('installs through the router mutation and refreshes both caches', async () => {
    h.details = details({ methods: [METHOD] })
    h.installations = []
    const user = userEvent.setup()

    render(<AppInstallBlock data={{ appSlug: 'ups' }} />)
    await user.click(screen.getByRole('button', { name: /install/i }))

    expect(h.refreshInstallations).toHaveBeenCalled()
    expect(h.invalidateGetBySlug).toHaveBeenCalledWith({ appSlug: 'ups' })
  })
})

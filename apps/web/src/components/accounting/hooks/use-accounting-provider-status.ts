// apps/web/src/components/accounting/hooks/use-accounting-provider-status.ts
'use client'

// Whether an accounting provider is installed and authorized, for the accounting
// module's own surfaces (14-drive-the-close.md §4).
//
// 🛑 "None connected" is a NORMAL outcome, not a warning. Decision `P1` makes it
// first class: the entry is still built, balanced and persisted, and the result
// is `not_connected` rather than a failure. Every consumer of this hook must read
// `connected: false` as information, never as a readiness requirement - there is
// deliberately no `connect-quickbooks` getting-started goal (`getting-started.ts`)
// and this hook must not become the thing that reintroduces one.
//
// ⚠️ The UI answer and the SERVER's resolution are computed from different
// things, on purpose. `apps/web/src/server/accounting-providers.ts`'s
// `resolveConnectedProvider` reads the installed-apps org cache ONLY, never the
// connection, because the QuickBooks adapter's `resolveQuickbooksContext`
// collapses every unauthorized case into `not_connected` anyway. So an org that
// installed but never authorized reads `connected: false` here and still reaches
// the adapter on the server, which answers `not_connected`. That is consistent.
// Do not reconcile the two, and do not build this hook on `resolveConnectedProvider`.

import { useAppsContext } from '~/components/apps/providers/apps-context'

/** The QuickBooks app's installed-app slug. Same spelling the server's registry uses. */
const QUICKBOOKS_APP_SLUG = 'quickbooks'

/** Where a person installs or authorizes the app. The OAuth flow lives there, not here. */
const QUICKBOOKS_APP_DETAIL_PATH = '/app/settings/apps/quickbooks'

export interface AccountingProviderStatus {
  /** The app is installed in this organization. */
  installed: boolean
  /** The app is installed AND has an authorized connection. */
  connected: boolean
  /** 'QuickBooks Online' when connected, else null. */
  providerLabel: string | null
  /** Where the user goes to install or authorize. */
  appDetailPath: string
  /**
   * Installations or connections are still resolving. They land on two separate
   * queries, so `connected` is `false` for a beat after `installed` turns true.
   * Gate any "nothing connected" copy on this or it flashes on every cold load.
   */
  loading: boolean
}

/**
 * The accounting provider's install/connect state, derived client-side from
 * `useAppsContext()`. Three outcomes, all of them normal:
 *
 * 1. `!installed` - the app is not installed. Offer the install action.
 * 2. `installed && !connected` - installed but not authorized. Offer the connect
 *    action, which is a full OAuth flow living on the app detail page.
 * 3. `connected` - posted entries are mirrored and carry a deep link back.
 *
 * 🛑 None of the three is a failure state. See the `P1` note at the top of this
 * file before adding a warning colour, an alert or a checklist item to any of them.
 *
 * @throws If rendered outside `AppsContextProvider` (mounted in `(protected)/app/layout.tsx`).
 */
export function useAccountingProviderStatus(): AccountingProviderStatus {
  const { appInstallations, appConnections, isLoading, isLoadingConnections } = useAppsContext()

  const installation = appInstallations.find((inst) => inst.app.slug === QUICKBOOKS_APP_SLUG)

  // A connection identifies its app by `appId`, not by slug - `listAppConnections`
  // matches the credential's `appId` against the App table and carries no slug - so
  // the installed app's id is the only thing the two sides share.
  const connected = installation
    ? appConnections.some(
        (conn) => conn.appId === installation.app.id && conn.connectionStatus === 'connected'
      )
    : false

  return {
    installed: Boolean(installation),
    connected,
    providerLabel: connected ? 'QuickBooks Online' : null,
    appDetailPath: QUICKBOOKS_APP_DETAIL_PATH,
    loading: isLoading || isLoadingConnections,
  }
}

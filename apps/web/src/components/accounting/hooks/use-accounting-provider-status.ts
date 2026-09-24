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

import {
  ACCOUNTING_PROVIDER_CATALOGUE,
  type AccountingProviderCatalogueEntry,
} from '@auxx/lib/accounting/providers/client'
import type { AppConnection } from '~/components/apps/providers/apps-context'
import { useAppsContext } from '~/components/apps/providers/apps-context'

/** Where a person browses a provider's app. The OAuth flow lives in `AppSettingsDialog`. */
export function accountingProviderAppPath(entry: AccountingProviderCatalogueEntry): string {
  return `/app/settings/apps/${entry.appSlug}`
}

/**
 * What to call the provider when none is connected.
 *
 * 🛑 {@link AccountingProviderStatus.providerLabel} is `null` until a connection
 * is authorized, and EVERY surface that renders it needs the same fallback - or
 * the product says "QuickBooks" on one screen, "the accounting system" on the
 * next and "your accounting provider" on a third, for an organization that has
 * connected nothing at all. There is one right answer and this is it.
 *
 * ⚠️ It is deliberately not a vendor name. The seam is provider-agnostic
 * (`post-entry.ts`, `postings/types.ts`), and a disconnected org naming a
 * product it has never installed is the defect this constant exists to stop.
 */
export const UNKNOWN_PROVIDER_LABEL = 'the accounting system'

export interface AccountingProviderStatus {
  /** The app is installed in this organization. */
  installed: boolean
  /** The app is installed AND has an authorized connection. */
  connected: boolean
  /** The connected provider's catalogue label, e.g. 'QuickBooks Online', else null. */
  providerLabel: string | null
  /** The installed provider's catalogue entry, or null when none is installed. */
  providerEntry: AccountingProviderCatalogueEntry | null
  /**
   * The installed app's type, required by `AppSettingsDialog`'s settings queries.
   * `null` until the app is installed - which is exactly when there is no dialog
   * to open, so a consumer gating on `installed` never sees the null.
   */
  installationType: 'development' | 'production' | null
  /**
   * The authorized credential itself, when one exists - its label, who connected
   * it and when, and whether it is org-wide.
   *
   * The label IS the company's real name (`Sandbox Company_US_1` on the dev org):
   * the QuickBooks app's `connection-added` handler writes it. It is frozen at
   * connect time, though, so it is a name and never an identity - a rename in
   * QuickBooks, or a reconnect, leaves it pointing at the old company while the
   * connection is authorized against another. Read {@link connectedTenantId} for
   * the question "which company is this", never the label.
   */
  connection: AppConnection | null
  /**
   * WHICH company the connection is authorized against - the QuickBooks realm.
   * `null` when nothing is connected, or when the provider has no such notion.
   *
   * 🛑 An identity for COMPARING, and nothing may render it. Its one consumer is
   * the posted-entry callout, which offers a deep link only when the entry's own
   * `providerTenantId` matches this: QuickBooks entry ids are per-company
   * sequences and no URL can pin the company, so a link followed from the wrong
   * one reports a live entry as deleted - the single conclusion that button
   * exists to prevent (task 24 §4).
   */
  connectedTenantId: string | null
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
 * 3. `connected` - posted entries are mirrored, and one exported to THIS
 *    company carries a deep link back (see {@link AccountingProviderStatus.connectedTenantId}).
 *
 * 🛑 None of the three is a failure state. See the `P1` note at the top of this
 * file before adding a warning colour, an alert or a checklist item to any of them.
 *
 * @throws If rendered outside `AppsContextProvider` (mounted in `(protected)/app/layout.tsx`).
 */
export function useAccountingProviderStatus(): AccountingProviderStatus {
  const { appInstallations, appConnections, isLoading, isLoadingConnections } = useAppsContext()

  // The first catalogue provider with an installed app; the ledger exports to one system at a time.
  let providerEntry: AccountingProviderCatalogueEntry | null = null
  let installation: (typeof appInstallations)[number] | undefined
  for (const entry of ACCOUNTING_PROVIDER_CATALOGUE) {
    installation = appInstallations.find((inst) => inst.app.slug === entry.appSlug)
    if (installation) {
      providerEntry = entry
      break
    }
  }

  // A connection identifies its app by `appId`, not by slug - `listAppConnections`
  // matches the credential's `appId` against the App table and carries no slug - so
  // the installed app's id is the only thing the two sides share.
  const connection = installation
    ? (appConnections.find(
        (conn) => conn.appId === installation.app.id && conn.connectionStatus === 'connected'
      ) ?? null)
    : null
  const connected = Boolean(connection)

  return {
    installed: Boolean(installation),
    connected,
    providerLabel: connected ? (providerEntry?.label ?? null) : null,
    providerEntry,
    installationType: installation?.installationType ?? null,
    connection,
    connectedTenantId: connection?.providerTenantId ?? null,
    loading: isLoading || isLoadingConnections,
  }
}

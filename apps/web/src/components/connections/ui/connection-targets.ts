// apps/web/src/components/connections/ui/connection-targets.ts
import type {
  ConnectFlowArgs,
  ConnectFlowDefinition,
} from '~/components/apps/hooks/use-connect-flow'
import type { AppInstallation } from '~/components/apps/providers/apps-context'
import type { RouterOutputs } from '~/trpc/react'

/** A platform provider as projected by `connections.listProviders`. */
export type ProviderRow = RouterOutputs['connections']['listProviders'][number]

type Scope = 'user' | 'organization'

/** A platform provider's credential is org-wide when `global`, else per-user. */
export function platformScope(provider: ProviderRow): Scope {
  return provider.global ? 'organization' : 'user'
}

/** Prefer an app's org-scoped connection when it offers one, else the user-scoped one. */
export function appScope(inst: AppInstallation): Scope {
  return inst.connectionDefinitions?.organization ? 'organization' : 'user'
}

/** Build the connect-flow target for a platform provider owner. */
export function platformTarget(provider: ProviderRow): ConnectFlowArgs['target'] {
  const def: ConnectFlowDefinition = {
    connectionType: provider.connectionType,
    description: provider.description ?? undefined,
    connectionVariables: provider.connectionVariables,
  }
  return {
    owner: {
      kind: 'platform',
      connectionDefinitionId: provider.providerKey,
      providerKey: provider.providerKey,
    },
    title: provider.label,
    connectionDefinitions: provider.global ? { organization: def } : { user: def },
  }
}

/** Build the connect-flow target for an installed-app owner. */
export function appTarget(inst: AppInstallation): ConnectFlowArgs['target'] {
  return {
    owner: {
      kind: 'app',
      appId: inst.app.id,
      appSlug: inst.app.slug,
      installationId: inst.installationId,
    },
    title: inst.app.title,
    connectionDefinitions: inst.connectionDefinitions ?? {},
    // The gate fields must ride along: `useConnectFlow` resolves the dialog's method from
    // `target.methods`, and dropping them here made the same app render its BYO client
    // fields inline through this surface while the app detail tab showed the disclosure.
    methods: (inst.methods ?? []).map((m) => ({
      id: m.id,
      connectionType: m.connectionType,
      description: m.description ?? undefined,
      connectionVariables: m.connectionVariables,
      requiresOwnClient: m.requiresOwnClient,
      ownClientOptional: m.ownClientOptional,
      ownClientReason: m.ownClientReason,
      oauthCallbackUrl: m.oauthCallbackUrl,
    })),
  }
}

/** The definition a target connects under for the given scope. */
export function defForScope(
  target: ConnectFlowArgs['target'],
  scope: Scope
): ConnectFlowDefinition | null | undefined {
  return scope === 'user'
    ? target.connectionDefinitions.user
    : target.connectionDefinitions.organization
}

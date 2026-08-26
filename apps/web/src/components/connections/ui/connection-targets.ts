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
    // Same reason as `appTarget`'s methods map below: the connect dialog's optional-scope
    // picker resolves its vocabulary from the def the flow hands it, so dropping these here
    // renders an empty picker on this surface alone.
    oauth2Scopes: provider.oauth2Scopes,
    oauth2OptionalScopes: provider.oauth2OptionalScopes,
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
      // Optional-scope vocabulary rides along for the same reason as the gate fields above:
      // the connect dialog's picker reads `oauth2OptionalScopes` off the method the flow
      // resolved from here, and the copyable full-scope line needs the `oauth2Scopes` floor
      // to be right. Drop either and the picker silently renders nothing on this surface.
      oauth2Scopes: m.oauth2Scopes,
      oauth2OptionalScopes: m.oauth2OptionalScopes,
    })),
  }
}

/** The two scope lists a definition/provider row carries (`oauth2Scopes` is the floor). */
interface ScopeVocabulary {
  oauth2Scopes?: string[] | null
  oauth2OptionalScopes?: string[] | null
}

/**
 * The **optional** scopes a connection already holds — the intersection of what the provider
 * actually granted with what the definition still declares as optional.
 *
 * This is the seed for both reconnect (§4.4: a full re-auth must re-request what the connection
 * already had, or the grant silently downgrades to the floor) and the Edit dialog's picker
 * (§4.5), which is why it lives here rather than inside either caller.
 *
 * Three things it deliberately drops:
 * - a granted scope the definition no longer declares optional — the authorize route would
 *   intersect it away anyway, so sending it is noise;
 * - a granted scope that sits in the **floor** — `oauth2Scopes` is always requested, so
 *   re-sending it as `scope_add` is redundant. The two lists are supposed to be disjoint, but
 *   this does not assume the authoring guard held for every row already in the database;
 * - duplicates.
 *
 * Order follows the declared optional list, so the result is stable across calls.
 */
export function optionalScopesHeld(
  granted: readonly string[] | null | undefined,
  vocabulary: ScopeVocabulary
): string[] {
  const grantedSet = new Set(granted ?? [])
  const floor = new Set(vocabulary.oauth2Scopes ?? [])
  const held = (vocabulary.oauth2OptionalScopes ?? []).filter(
    (scope) => grantedSet.has(scope) && !floor.has(scope)
  )
  return [...new Set(held)]
}

/**
 * Does a **fresh** `oauth2-code` connect need the connect dialog?
 *
 * Historically the answer was just "does it declare connection variables" — a bare OAuth
 * definition kicked the popup straight from the card. §4.3: a definition with optional scopes
 * and no variables then has nowhere to render the picker, so it never gets one.
 *
 * `shouldOfferOptionalScopes` (the render-time gate) also takes `byoOpen`, which is state that
 * lives *inside* the dialog and cannot exist before it opens. So this uses the reachable form:
 * BYO is either mandatory (`requiresOwnClient` — the picker shows the moment the dialog opens)
 * or offered (`ownClientOptional` — `byoOpen` can become true once the user expands the
 * disclosure). Erring open is the only safe direction: refusing to open the dialog for an
 * `ownClientOptional` method would make the disclosure, and therefore the picker, unreachable.
 * A method whose BYO is neither required nor offered can never show the picker, so it keeps
 * the one-click connect.
 */
export function shouldOpenConnectDialog(def: ConnectFlowDefinition): boolean {
  if ((def.connectionVariables?.length ?? 0) > 0) return true
  if (def.connectionType !== 'oauth2-code') return false
  if ((def.oauth2OptionalScopes?.length ?? 0) === 0) return false
  return !!def.requiresOwnClient || !!def.ownClientOptional
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

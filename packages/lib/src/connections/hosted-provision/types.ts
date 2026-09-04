// packages/lib/src/connections/hosted-provision/types.ts
// Contract for `connectionType: 'hosted-provision'` providers: the platform calls the
// provider's API to create/find a resource, sends the user through the provider's
// onboarding flow, and persists the returned identifier on a Credential. No OAuth code
// exchange, no secret-field dialog. Handlers are resolved lazily by key (see resolve.ts)
// so the connections tier never statically imports a consumer module.
//
// ⚠️ "hosted" is now a slightly wrong name and the doc comment is widened rather than
// the type renamed (decision B13). A `redirect` flow really is hosted by the provider
// (Stripe Connect's Account Links). An `embed` flow is not: the provider hands back a
// client secret and the BROWSER mounts the provider's own modal on our page (Stripe
// Financial Connections). Everything after that point - the completion payload, the
// Credential write, the reconnect path - is identical, which is why this is one
// connection type with two start shapes rather than two connection types.
//
// 🛑 Every capability of a provider is DECLARED on its `PlatformProviderDef` and READ
// generically. No branch in the routes, the UI or this module may name a provider. The
// acceptance test is that a second provider of the same shape needs zero code changes,
// only a definition.

/**
 * What `start()` hands back, and what the connect surface branches on.
 *
 * - `redirect` - navigate the whole page to `url`. The provider hosts the flow and
 *   sends the user back to the return route as a GET.
 * - `embed` - hand `config` to the browser, which mounts the provider's own widget.
 *   The flow finishes in the tab it started in, so the browser POSTs the result back
 *   to the return route itself (there is no provider-driven navigation to catch).
 *
 * `config` is opaque: the surface passes it to whatever the definition's `embed`
 * capability says renders it, and never reads a provider-specific key out of it.
 */
export type HostedProvisionStartResult =
  | { kind: 'redirect'; url: string }
  | { kind: 'embed'; config: Record<string, unknown> }

export type HostedProvisionStartCtx = {
  organizationId: string
  userId: string
  connectionDefinitionId: string
  /** Where the provider sends the user when the hosted flow completes. */
  returnUrl: string
  /** Where the provider sends the user when the hosted link expires mid-flow (re-mints a link). */
  refreshUrl: string
}

export type HostedProvisionCompleteCtx = {
  organizationId: string
  userId: string
  connectionDefinitionId: string
  /**
   * What the browser sent back when the flow finished, for an `embed` start.
   *
   * 🛑 Undefined on the redirect leg, and a handler must not require it there: a
   * provider-hosted flow returns through a GET that carries nothing but the state
   * token, so any in-flight identifier a redirect handler needs has to have been
   * persisted by `start()` (Stripe Connect stashes its `acct_…` in `PaymentAccount`
   * for exactly this reason).
   *
   * ⚠️ Untrusted. It arrives from a browser POST guarded only by the state token, so a
   * handler must treat every value as a claim to verify against the provider - an id
   * to re-read, never a fact to persist.
   */
  payload?: Record<string, unknown>
}

export type HostedProvisionCompleteResult = {
  /** The durable provider-side handle (e.g. a Stripe `acct_…` or `fca_…`). */
  providerAccountId: string
  /** Non-secret values persisted as Credential connection variables (plaintext metadata). */
  connectionVariables: Record<string, string>
  /** Optional provider-yielded secrets (encrypted under `secrets.fields`). */
  secrets?: Record<string, string>
  /** Connection display label (e.g. the provider account's business name). */
  label: string
  /** Onboarding is complete enough for the connection to be usable. */
  ready: boolean
}

export type HostedProvisionHandler = {
  /**
   * Relative app path the return route redirects to after persisting the Credential
   * (the consumer's settings page, e.g. `/app/dispatch/settings/payments`).
   */
  landingPath: string
  /**
   * Create-or-reuse the provider resource + open the onboarding flow. Must be
   * idempotent: a refresh mid-flow re-enters here and must NOT create a second resource.
   */
  start(ctx: HostedProvisionStartCtx): Promise<HostedProvisionStartResult>
  /**
   * On return from the flow: finalize provider state, return what to persist.
   *
   * 🛑 **An array is one flow that yielded SEVERAL provider accounts**, and the return
   * route persists one Credential per element. That is the whole reason
   * `multiAccount` exists as a declared capability: a bank login can hand back four
   * accounts in one authentication, and the alternative - the route enumerating
   * accounts out of the payload so it could call `complete()` once each - would put
   * provider knowledge in the route, which B13 forbids. One call, N results, and the
   * route stays ignorant of what an account is.
   *
   * A handler whose definition does not declare `multiAccount` may still return an
   * array; the route refuses more than one element, so a provider that suddenly
   * returns two fails loudly instead of silently creating a second connection.
   */
  complete(
    ctx: HostedProvisionCompleteCtx
  ): Promise<HostedProvisionCompleteResult | HostedProvisionCompleteResult[]>
  /**
   * Optional consumer side-effects AFTER the Credential row commits (e.g. anchor-table
   * upsert that needs the credential id). Runs even when `ready` is false, and once per
   * persisted credential - so a multi-account flow calls it N times, each with the
   * result that produced that credential.
   */
  onPersisted?(
    ctx: HostedProvisionCompleteCtx & {
      credentialId: string
      result: HostedProvisionCompleteResult
    }
  ): Promise<void>
}

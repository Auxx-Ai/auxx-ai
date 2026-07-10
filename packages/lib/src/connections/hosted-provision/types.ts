// packages/lib/src/connections/hosted-provision/types.ts
// Contract for `connectionType: 'hosted-provision'` providers: the platform calls the
// provider's API to create/find a resource, sends the user through the provider's HOSTED
// onboarding flow, and persists the returned identifier on a Credential. No OAuth code
// exchange, no secret-field dialog. Handlers are resolved lazily by key (see resolve.ts)
// so the connections tier never statically imports a consumer module.

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
}

export type HostedProvisionCompleteResult = {
  /** The durable provider-side handle (e.g. a Stripe `acct_…`). */
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
   * Create-or-reuse the provider resource + mint a hosted onboarding link. Must be
   * idempotent: a refresh mid-flow re-enters here and must NOT create a second resource.
   */
  start(ctx: HostedProvisionStartCtx): Promise<{ redirectUrl: string }>
  /** On return from the hosted flow: finalize provider state, return what to persist. */
  complete(ctx: HostedProvisionCompleteCtx): Promise<HostedProvisionCompleteResult>
  /**
   * Optional consumer side-effects AFTER the Credential row commits (e.g. anchor-table
   * upsert that needs the credential id). Runs even when `ready` is false.
   */
  onPersisted?(ctx: HostedProvisionCompleteCtx & { credentialId: string }): Promise<void>
}

// packages/lib/src/connections/hosted-provision/index.ts
// Barrel for the `hosted-provision` connection type: the handler contract + the lazy resolver.

export { resolveHostedProvisionHandler } from './resolve'
export type {
  HostedProvisionCompleteCtx,
  HostedProvisionCompleteResult,
  HostedProvisionHandler,
  HostedProvisionStartCtx,
  HostedProvisionStartResult,
} from './types'

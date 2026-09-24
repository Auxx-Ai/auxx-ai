// packages/lib/src/connections/providers/provider-registry.ts
// Read-only access to the platform built-in connection providers. Used by the
// seed (ensure-platform-providers) and the connect UI's provider-catalog step.

import { PLATFORM_PROVIDER_DEFS } from './defs'
import type { PlatformProviderDef } from './types'

const BY_KEY = new Map<string, PlatformProviderDef>(
  PLATFORM_PROVIDER_DEFS.map((def) => [def.providerKey, def])
)

/** Platform built-in providers offered in the connect catalog; internal ones are omitted. */
export function getAllProviders(): PlatformProviderDef[] {
  return PLATFORM_PROVIDER_DEFS.filter((def) => def.visibility !== 'internal')
}

/** Look up a single provider by its key (= ConnectionDefinition.providerKey / Credential.type). */
export function getProviderByKey(providerKey: string): PlatformProviderDef | undefined {
  return BY_KEY.get(providerKey)
}

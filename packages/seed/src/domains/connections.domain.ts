// packages/seed/src/domains/connections.domain.ts
// Idempotent seeder for platform built-in ConnectionDefinition rows (Google,
// Postgres, HTTP Basic, …) available to every organization.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('connections-domain')

/**
 * ConnectionsDomain upserts the platform built-in connection providers (owner =
 * providerKey, no organizationId). These are the former workflow-node
 * CREDENTIAL_REGISTRY types, now expressed as ConnectionDefinition rows. The
 * provider catalog lives in `@auxx/lib/connections/providers`; this seeder
 * matters for fresh installs and keeping long-lived environments in sync.
 */
export class ConnectionsDomain {
  /** Upserts all platform provider definitions. Safe to re-run. */
  async insertDirectly(db: Database): Promise<void> {
    const { ensurePlatformProviders } = await import('@auxx/lib/connections/providers')
    await ensurePlatformProviders(db)
    logger.info('Upserted platform connection providers')
  }
}

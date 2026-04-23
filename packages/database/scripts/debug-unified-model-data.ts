// packages/database/scripts/debug-unified-model-data.ts
/**
 * Debug helper: calls `ProviderManager.getUnifiedModelData()` directly against
 * the DB for a given organizationId and prints the shape that the tRPC
 * `aiIntegration.getUnifiedModelData` would return.
 *
 * Bypasses OrgCache / Redis — computes from scratch — so this tells you what
 * the cache *would* contain after a flush.
 *
 * Run with:
 *   npx dotenv -- npx tsx packages/database/scripts/debug-unified-model-data.ts <organizationId>
 */

import { ProviderManager } from '../../lib/src/ai'
import { getOrgCache } from '../../lib/src/cache/singletons'
import { database as db } from '../src'

const orgId = process.argv[2]
if (!orgId) {
  console.error('Usage: ... debug-unified-model-data.ts <organizationId>')
  process.exit(1)
}

async function main() {
  // Flush cached aiProviderConfigs/aiCredentials for this org so we compute from scratch.
  await getOrgCache().flush(orgId, ['aiProviderConfigs', 'aiCredentials'])

  const manager = new ProviderManager(db, orgId, 'debug-script')
  const data = await manager.getUnifiedModelData({
    includeDefaults: true,
    includeUnconfigured: true, // match the AI Settings page
  })

  const summary = {
    providerCount: data.providers.length,
    providers: data.providers.map((p) => ({
      provider: p.provider,
      configured: p.statusInfo.configured,
      status: p.statusInfo.status,
      usingProviderType: p.statusInfo.usingProviderType,
      modelCount: p.models.length,
      sampleModels: p.models.slice(0, 3).map((m) => ({
        modelId: m.modelId,
        status: m.status,
        enabled: m.enabled,
      })),
    })),
    defaultModels: data.defaultModels,
  }

  console.log(JSON.stringify(summary, null, 2))
  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})

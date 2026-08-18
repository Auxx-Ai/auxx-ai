// packages/lib/scripts/reseed-platform-providers.ts
// One-off: re-upsert the platform built-in ConnectionDefinition rows so their
// `connectionVariables` jsonb carries the current FieldType-based shape AND the
// encrypted oauth2ClientId/Secret columns are re-derived from the CURRENT env
// vars. The rows bake encrypted copies of the platform OAuth client at seed
// time, so changing e.g. FACEBOOK_APP_ID in .env is inert until this re-runs.
// Run: npx dotenv -- npx tsx packages/lib/scripts/reseed-platform-providers.ts

import { closePools } from '@auxx/database'
import { ensurePlatformProviders } from '@auxx/lib/connections/providers'

async function main(): Promise<void> {
  await ensurePlatformProviders()
  await closePools()
  // eslint-disable-next-line no-console
  console.log('✓ Reseeded platform connection providers')
  process.exit(0)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('✗ Reseed failed:', err)
  process.exit(1)
})

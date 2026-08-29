// packages/lib/scripts/reconcile-app-fields.ts
//
// Provision an installed app's declared fields against its CURRENT catalog.
//
// A `auxx dev --once` deploy uploads a new catalog but does NOT provision the
// fields in it: `reconcileInstallationAppFields` runs on install, on production
// roll-forward, and when a connection is saved - not on a development deploy. So
// after adding a field to an app's `defineFields`, a local workspace needs this
// (or a reconnect, which fires the same reconcile through `saveAppConnection`).
//
//   npx dotenv -- npx tsx packages/lib/scripts/reconcile-app-fields.ts <orgId> <appSlug>

import { database } from '@auxx/database'
import { reconcileInstallationAppFields } from '../src/apps/installations/app-field-provisioning'

const ORG = process.argv[2] ?? ''
const SLUG = process.argv[3] ?? ''

if (!ORG || !SLUG) {
  console.error('usage: reconcile-app-fields.ts <organizationId> <appSlug>')
  process.exit(1)
}

async function main() {
  const installations = await database.query.AppInstallation.findMany({
    where: (t, { eq }) => eq(t.organizationId, ORG),
    with: { app: { columns: { slug: true } } },
  })
  const target = installations.find((row) => row.app?.slug === SLUG)
  if (!target) {
    console.error(
      `'${SLUG}' is not installed for ${ORG}. Installed: ${installations.map((i) => i.app?.slug).join(', ')}`
    )
    process.exit(1)
  }

  console.log(`reconciling ${SLUG} (installation ${target.id})...`)
  const result = await reconcileInstallationAppFields({
    appInstallationId: target.id,
    organizationId: ORG,
  })
  console.log(JSON.stringify(result, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SCRIPT ERROR:', err)
    process.exit(1)
  })

// packages/lib/scripts/probe-member-access.ts

/**
 * Print one member's COMPOSED access, straight from the capability blob.
 *
 * The Permissions tab shows an area's effective level, which is not the whole
 * answer: an individual instance grant overrules the area gate (plan 43 §0.2a),
 * so a member can read one inbox while the Inboxes area composes to None. This
 * prints both numbers side by side so the two are never confused again.
 *
 *   npx dotenv -- node --conditions source --import tsx/esm \
 *     packages/lib/scripts/probe-member-access.ts --org <orgId> --user <userId> \
 *     [--instance <key>:<instanceId>]
 */

import { getCachedUserInstanceGrants } from '../src/cache'
import { AREA_ORDER, Area, getCapabilities } from '../src/permissions/capabilities'
import type { InstanceAccessKey } from '../src/permissions/capabilities/instance-access'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const organizationId = arg('org')
  const userId = arg('user')
  if (!organizationId || !userId) {
    console.error('usage: --org <orgId> --user <userId> [--instance <key>:<instanceId>]')
    process.exit(1)
  }

  const caps = await getCapabilities(userId, organizationId)

  console.log(`\nAREA LEVELS  user=${userId} org=${organizationId}`)
  for (const area of AREA_ORDER) {
    const level = caps.areaLevel(area)
    if (level > 0) console.log(`  ${area.padEnd(24)} ${level}`)
  }

  const instance = arg('instance')
  if (instance) {
    const [key, instanceId] = instance.split(':')
    if (!key || !instanceId) {
      console.error('--instance takes <key>:<instanceId>, e.g. inbox:abc123')
      process.exit(1)
    }
    const areaOf = Area[key as keyof typeof Area]
    console.log(`\nINSTANCE  ${key}:${instanceId}`)
    console.log(`  area level      ${areaOf ? caps.areaLevel(areaOf) : '(no area for key)'}`)
    console.log(`  instance level  ${caps.instanceLevel(key as InstanceAccessKey, instanceId)}`)
    console.log(`  row-less default ${caps.instanceFallbackLevel(key as InstanceAccessKey)}`)
    console.log(
      '\n  An instance level above the area level is NOT a bug: an individual grant\n' +
        '  overrules the area gate. That is how "no inboxes except this one" is said.'
    )
  }
  console.log('\nMAIL-RELEVANT CAPABILITY KEYS')
  for (const key of ['inboxes.view', 'inboxes.manage', 'channels.view', 'channels.manage']) {
    console.log(`   can(${key.padEnd(16)}) = ${caps.can(key as never)}`)
  }

  // MAIL is a different authority. `user:capabilities` does not decide what mail
  // a viewer sees — `user:instance-grants` does, through `inboxLens`. Reading the
  // capability blob for a mail question gives a confident wrong answer.
  const grants = await getCachedUserInstanceGrants(userId, organizationId)
  console.log('\nMAIL VISIBILITY (user:instance-grants)')
  console.log(`  isMailAdmin      ${grants.isMailAdmin}`)
  console.log(`  personalInboxIds ${Object.keys(grants.personalInboxIds).join(', ') || '(none)'}`)
  const lenses = Object.entries(grants.inboxLens)
  if (lenses.length === 0) console.log('  inboxLens        (none)')
  for (const [id, lens] of lenses) console.log(`  inboxLens        ${id} -> ${lens}`)

  process.exit(0)
}

void main()

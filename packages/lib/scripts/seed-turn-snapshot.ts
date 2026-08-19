// packages/lib/scripts/seed-turn-snapshot.ts
//
// Dev-only: seed a Kopilot pre-turn snapshot so the workflow builder's
// "turn stopped early" Undo banner can be exercised without having to make a
// real turn trip the token budget. See plans/kopilot/workflow/20-partial-turn-survival.md
//
//   npx dotenv -- npx tsx packages/lib/scripts/seed-turn-snapshot.ts <workflowAppId> <endedAs> [--bad-hash]

import { getRedisData, setRedisData } from '@auxx/redis'

const [workflowAppId, endedAs = 'exhausted'] = process.argv.slice(2)
const badHash = process.argv.includes('--bad-hash')
if (!workflowAppId)
  throw new Error('usage: seed-turn-snapshot.ts <workflowAppId> [endedAs] [--bad-hash]')

const key = `workflow:graph:${workflowAppId}:preturn`

const snapshot = {
  turnId: `turn-seeded-${Date.now()}`,
  name: 'Tracking number',
  description: null,
  // Deliberately EMPTY: the banner should report "N nodes back to 0".
  graph: { nodes: [], edges: [] },
  triggerType: null,
  capturedAt: Date.now() - 5 * 60 * 1000,
  ...(badHash ? { postTurnGraphHash: 'deadbeefdeadbeefdeadbeefdeadbeef' } : {}),
  endedAs,
}

await setRedisData(key, snapshot, 24 * 60 * 60)
console.log('seeded', key)
console.log(JSON.stringify(await getRedisData(key), null, 2))
process.exit(0)

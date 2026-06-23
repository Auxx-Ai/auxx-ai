// packages/lib/scripts/flush-channels-cache.ts
//
// Dev util: bust the `channels` org cache for all orgs so it recomputes with the
// latest CachedChannel shape (e.g. after adding `credentialId`). Next read per org
// lazily recomputes. Run with the source condition so it picks up src, not stale dist:
//   npx dotenv -- node --conditions source --import tsx/esm packages/lib/scripts/flush-channels-cache.ts

import { getOrgCache } from '../src/cache'

async function main() {
  await getOrgCache().flushKeyForAllOrgs(['channels'])
  console.log('Flushed `channels` cache for all orgs — next read recomputes.')
  process.exit(0)
}

void main()

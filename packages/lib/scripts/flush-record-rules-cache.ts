// packages/lib/scripts/flush-record-rules-cache.ts
//
// Dev util: bust the `recordRules` org cache for all orgs so it recomputes with the
// current system-rule declarations (the cached union predates them — e.g. after B2 §9
// added the entity lifecycle rules). Next read per org lazily recomputes. Run with the
// source condition so it picks up src, not stale dist:
//   npx dotenv -- node --conditions source --import tsx/esm packages/lib/scripts/flush-record-rules-cache.ts

import { getOrgCache } from '../src/cache'

async function main() {
  await getOrgCache().flushKeyForAllOrgs(['recordRules'])
  console.log('Flushed `recordRules` cache for all orgs — next read recomputes.')
  process.exit(0)
}

void main()

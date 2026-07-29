// packages/lib/scripts/flush-user-capabilities-cache.ts
//
// Dev util: bust the `userCapabilities` cache for all users so every blob recomposes
// against the CURRENT registry (area/key set) and `UserCapabilities` shape. Next read
// per user lazily recomputes.
//
// Use this while a capabilities shape change is still being iterated on. The
// `user:capabilities:vN` prefix in `user-cache-keys.ts` stays the mechanism for a real
// rollout — bump it in the same change that reaches users, so a draining old instance
// cannot repopulate the new keyspace. A flush cannot promise that mid-deploy; it is the
// dev-loop shortcut, not a replacement.
//
// `userMailVisibility` goes with it (plan 40 §4.2/§4.5): `computeUserMailVisibility`
// READS the capability blob for its `Area.inboxes` fallback and `isMailAdmin` flag, so
// flushing capabilities alone would leave every member's mail floors composed against
// the levels you just discarded — for the full ONE_DAY TTL. Same dependency the
// `permission-profile.changed` / `permission-grant.changed` graph edges encode.
//
// Run with the source condition so it picks up src, not stale dist:
//   npx dotenv -- node --conditions source --import tsx/esm packages/lib/scripts/flush-user-capabilities-cache.ts

import { getUserCache } from '../src/cache'

async function main() {
  await getUserCache().flushKeyForAllUsers(['userCapabilities', 'userMailVisibility'])
  console.log(
    'Flushed `userCapabilities` + `userMailVisibility` for all users — next read recomputes.'
  )
  process.exit(0)
}

void main()

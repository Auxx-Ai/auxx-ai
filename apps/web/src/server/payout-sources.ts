// apps/web/src/server/payout-sources.ts

import 'server-only'

/**
 * The payout-source registration, re-exported for `server/bootstrap.ts`
 * exactly as `./accounting-providers.ts` re-exports its counterpart.
 *
 * One registration in `@auxx/lib/money/payout-sources`, two boot sequences
 * calling it (this one and `apps/worker/src/server.ts`): the payout pipeline
 * knows only the `PayoutSource` interface, and a process that never fills the
 * registry syncs nothing (brief 27 §4, §7).
 */
export { registerPayoutSources } from '@auxx/lib/money/payout-sources'

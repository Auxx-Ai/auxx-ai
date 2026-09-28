// apps/web/src/server/processors.ts

import 'server-only'

/**
 * The processor registration, re-exported for `server/bootstrap.ts` exactly as
 * `./accounting-providers.ts` re-exports its counterpart.
 *
 * One registration in `@auxx/lib/accounting/processors`, two boot sequences
 * calling it (this one and `apps/worker/src/server.ts`): the payout pipeline
 * knows only the `PayoutSource` interface, and a process that never fills the
 * registry syncs nothing (brief 27 §4, §7).
 */
export { registerProcessors } from '@auxx/lib/accounting/processors'

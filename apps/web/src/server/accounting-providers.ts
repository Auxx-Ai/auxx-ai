// apps/web/src/server/accounting-providers.ts

import 'server-only'

/**
 * The accounting-provider registration, re-exported for `server/bootstrap.ts`.
 *
 * The implementation moved to `@auxx/lib/money/accounting-providers` on
 * 2026-09-14 (brief 27 §1.5): the worker posts payout entries too, and with the
 * registration living only here every entry it posted resolved to the null
 * provider, landed as `not_required`, and never reached QuickBooks. One
 * registration in lib, two boot sequences calling it - the same shape
 * `registerChannelHooks()` already takes. This file keeps its path so the
 * bootstrap import and the comments that name it stay true.
 */
export { registerAccountingProviders } from '@auxx/lib/money/accounting-providers'

// packages/lib/src/test/live-api.ts

/**
 * Opt-in gate for the provider suites that hit REAL vendor endpoints.
 *
 * These suites cost money and depend on a vendor's current model catalogue, so
 * they are not part of a normal run. Set `LIVE_API_TESTS=1` in addition to the
 * vendor's key:
 *
 * ```bash
 * LIVE_API_TESTS=1 npx vitest run --project lib src/ai/providers
 * ```
 *
 * **Why the key alone is not the gate.** These used to be
 * `describe.skipIf(!VENDOR_API_KEY)`, which reads as "run when you can" — but a
 * developer's `.env` supplies real keys, so they ran on every local `vitest run`
 * and failed with vendor errors (402 "Insufficient Balance", "This is not a chat
 * model"), while CI skipped them for lack of keys. That put two permanently-red
 * files in every local full-suite result, which is exactly the noise that makes
 * a real regression easy to wave away. **Holding a credential is not consent to
 * spend it.**
 *
 * They are gated rather than excluded from the vitest config on purpose: an
 * excluded file stops being collected and typechecked, and this repo has found
 * three separate cases of dead code kept alive only by its own test suite.
 */
export const liveApiTestsEnabled = process.env.LIVE_API_TESTS === '1'

/**
 * True only when live-API tests are opted into AND the vendor key is present.
 * Use as `describe.skipIf(!canRunLiveApi(VENDOR_API_KEY))(...)`.
 */
export function canRunLiveApi(apiKey: string | undefined): boolean {
  return liveApiTestsEnabled && !!apiKey
}

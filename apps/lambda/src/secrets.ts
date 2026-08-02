// apps/lambda/src/secrets.ts

/**
 * Boot-time secret capture, then removal from the process environment.
 *
 * User-authored code (workflow code nodes, app server bundles) is evaluated with
 * `new Function` inside this service's own realm, so it can reach `globalThis.Deno`
 * and — while the process holds `--allow-env` — read anything in the environment.
 * `LAMBDA_INVOKE_SECRET` is the worst case: it signs inbound invocations *and* is
 * the signing key for callback tokens, whose org claim is never cross-checked, so
 * leaking it is a cross-tenant compromise.
 *
 * This module reads the values it needs once at import time and {@link sealEnvironment}
 * then deletes them from the environment. `Deno.env.delete` genuinely removes the
 * variable from the process, so unlike scrubbing globals this is not bypassable —
 * `import('node:fs')` or any other route to the environment finds nothing there.
 *
 * This is an interim mitigation, NOT isolation. It shrinks the blast radius of the
 * shared realm; it does not fix the shared realm. See
 * `plans/lambda/security/01-sandbox-hardening-plan.md` §9 Phase A.
 *
 * ORDERING IS LOAD-BEARING: `sealEnvironment()` must be called from an entry point
 * *after* all module-level initialization has run. `bundle-loader.ts` captures the
 * S3 credentials into its `S3Client` at import time; deleting them before that
 * module initializes would leave the client unauthenticated.
 */

/** Secrets removed from the environment by {@link sealEnvironment}. */
const SEALED_VARS = ['LAMBDA_INVOKE_SECRET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const

/**
 * The inbound-request signing secret, captured before the environment is sealed.
 * Undefined when unset (development only — the handler rejects with
 * `AUTH_CONFIG_ERROR` outside development).
 */
const INVOKE_SECRET = Deno.env.get('LAMBDA_INVOKE_SECRET')

/**
 * The inbound HMAC signing secret. Read this instead of `Deno.env.get`, which
 * returns `undefined` once {@link sealEnvironment} has run.
 */
export function getInvokeSecret(): string | undefined {
  return INVOKE_SECRET
}

/**
 * Delete captured secrets from the process environment. Idempotent, and safe to
 * call when a variable was never set.
 *
 * Call once from each entry point, after imports and before serving any request.
 */
export function sealEnvironment(): void {
  for (const name of SEALED_VARS) {
    try {
      Deno.env.delete(name)
    } catch {
      // A narrowed --allow-env may deny delete on a var that was never set.
      // Nothing to remove in that case; the goal is already satisfied.
    }
  }

  console.log('[Secrets] Environment sealed:', { removed: SEALED_VARS.length })
}

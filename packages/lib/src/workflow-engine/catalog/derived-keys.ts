// packages/lib/src/workflow-engine/catalog/derived-keys.ts

/**
 * The ONE declaration of what a *derived* node/edge data key is.
 *
 * Derived keys are canvas state: written by the workflow initializer on load
 * (connection metadata, branch handles, loop bookkeeping, run status),
 * stripped on every save, never read by the engine, and never authorable by
 * an agent. `_targetBranches` is the canonical member.
 *
 * Six places independently re-implemented `key.startsWith('_')` and the
 * seventh — config-schema validation — forgot to, which is how every stored
 * HTTP node acquired a permanent, unfixable "`_targetBranches` is required"
 * warning that the patcher then refused to let anyone clear.
 *
 * THE INVARIANT this file exists to protect: a manifest's `configSchema`
 * validates *persisted* config, and derived keys are guaranteed absent from
 * persisted config — so no `configSchema` may declare one. Asserted by
 * `derived-keys.test.ts`.
 */

export const DERIVED_KEY_PREFIX = '_'

/** Is this a derived (canvas-owned, never-persisted) data key? */
export function isDerivedKey(key: string): boolean {
  return key.startsWith(DERIVED_KEY_PREFIX)
}

/** A shallow copy of `record` with every derived key removed. */
export function stripDerivedKeys<T extends Record<string, unknown>>(
  record: T
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !isDerivedKey(key)))
}

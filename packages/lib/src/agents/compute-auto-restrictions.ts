// packages/lib/src/agents/compute-auto-restrictions.ts

import type { AgentKind, ToolRestrictionMap, ToolsetEntry } from '@auxx/database'

/**
 * Minimal projection of a catalog tool needed to auto-create identity
 * restrictions: its LLM-facing registered name (the `toolRestrictions` key) and
 * the identity-scoped inputs it declares. Sourced from the installed-apps cache
 * (`CachedAgentTool`).
 */
export interface AutoRestrictionTool {
  registeredName: string
  identityScopedInputs?: ReadonlyArray<{ name: string; suggestedVar?: string }>
}

/**
 * Compute the auto-created identity restrictions for a toolset enable
 * transition, merged onto the agent's current `toolRestrictions`. Pure and
 * unit-testable — the service layer reads the inputs (kind, toolsets,
 * tools-per-slug, var registry) and persists the returned map.
 *
 * Semantics (plans/chat/v6 phase-6 §1):
 *  - **Chat-kind only** — internal agents return the current map unchanged;
 *    `identityScopedInputs` isn't enforced off-chat.
 *  - **Enable transition only** — a binding is auto-created only for a toolset
 *    whose `enabled` flips from not-true (in `prevToolsets`) to true (in
 *    `nextToolsets`). A plain re-save of an already-enabled toolset adds
 *    nothing, so an admin who deliberately removed a binding isn't fought.
 *  - **Idempotent / non-clobbering** — an existing
 *    `toolRestrictions[tool][arg]` is never overwritten.
 *  - **Connection-dependent vars defer gracefully** — when `suggestedVar` is
 *    absent or doesn't resolve in the var registry (e.g. a Shopify customerId
 *    var that needs a bound store), the arg is left unbound; phase-3
 *    fail-closed + the phase-4 banner flag it, and re-running enablement after
 *    the store is bound fills it.
 *
 * Returns the same map reference when nothing changed so callers can skip the
 * write.
 */
export function computeAutoRestrictions(
  kind: AgentKind,
  prevToolsets: ToolsetEntry[],
  nextToolsets: ToolsetEntry[],
  currentRestrictions: ToolRestrictionMap,
  toolsBySlug: Map<string, AutoRestrictionTool[]>,
  resolvableVarIds: ReadonlySet<string>
): ToolRestrictionMap {
  if (kind !== 'chat') return currentRestrictions

  const prevEnabled = new Set(prevToolsets.filter((t) => t.enabled === true).map((t) => t.slug))
  const newlyEnabledSlugs = nextToolsets
    .filter((t) => t.enabled === true && !prevEnabled.has(t.slug))
    .map((t) => t.slug)
  if (newlyEnabledSlugs.length === 0) return currentRestrictions

  let next = currentRestrictions
  let changed = false

  const ensureMutable = (): ToolRestrictionMap => {
    if (!changed) {
      next = { ...currentRestrictions }
      changed = true
    }
    return next
  }

  for (const slug of newlyEnabledSlugs) {
    const tools = toolsBySlug.get(slug)
    if (!tools) continue
    for (const tool of tools) {
      const inputs = tool.identityScopedInputs
      if (!inputs || inputs.length === 0) continue
      for (const input of inputs) {
        // Non-clobbering: never overwrite an existing binding.
        if (currentRestrictions[tool.registeredName]?.[input.name]) continue
        // Defer gracefully when there's no resolvable var to bind to.
        if (!input.suggestedVar || !resolvableVarIds.has(input.suggestedVar)) continue

        const map = ensureMutable()
        const perTool = { ...(map[tool.registeredName] ?? {}) }
        perTool[input.name] = { source: 'var', var: input.suggestedVar, required: true }
        map[tool.registeredName] = perTool
      }
    }
  }

  return changed ? next : currentRestrictions
}

/**
 * Build the set of var ids a `suggestedVar` can resolve against. A suggestedVar
 * is accepted when its id is present in the org's var registry, OR when it's a
 * well-formed `visitor:` / `thread:` anchor id (hidden app fields like Shopify's
 * customerId are excluded from the picker registry yet still resolve at runtime;
 * see `buildResolveVar`). Kept pragmatic per plans/chat/v6 phase-2.
 */
export function buildResolvableVarIdSet(
  registryVarIds: Iterable<string>,
  suggestedVars: Iterable<string>
): Set<string> {
  const resolvable = new Set<string>(registryVarIds)
  for (const v of suggestedVars) {
    if (!resolvable.has(v) && parsesAsAnchorVarId(v)) resolvable.add(v)
  }
  return resolvable
}

/**
 * A var id is `<anchor>:<ref>` with `anchor ∈ {visitor, thread}` and a non-empty
 * `ref`. Mirrors `parseVarId` in `var-registry.ts` — inlined so this module
 * stays free of the resolver's deps.
 */
function parsesAsAnchorVarId(varId: string): boolean {
  const idx = varId.indexOf(':')
  if (idx <= 0 || idx === varId.length - 1) return false
  const anchor = varId.slice(0, idx)
  return anchor === 'visitor' || anchor === 'thread'
}

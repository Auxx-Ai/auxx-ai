// packages/lib/src/cache/org-system-rules.ts

import { getSystemRuleDeclarations, resolveSystemRules } from '../record-rules/system-rules'
import type { CachedRecordRule } from '../record-rules/types'
import { getOrgCache } from './singletons'

/**
 * Resolve the code-declared system rules (`declareSystemRules`) for one org.
 *
 * ⚠️ This is deliberately NOT cached, and the `recordRules` cache deliberately
 * holds DB rules ONLY. System rules live in the deployed code, not in any row,
 * so caching the union means a Redis entry can outlive the declaration that
 * produced it: add an action to a system rule and every org that already has a
 * cached union keeps running the OLD action list until the entry expires. That
 * failure is silent and total — the rule still fires, so nothing errors and no
 * log line appears; the new action simply never runs. It cost a day of debugging
 * when `recalculatePurchaseOrderLineReceived` was added as a third action to
 * `mfg-stock-movements-created`: QoH (action 2, in the cached copy) kept
 * updating while the purchase-order-line roll-up (action 3, not in it) never
 * ran, so received quantities stayed at zero with the movements written
 * correctly underneath. Nothing in the invalidation graph can fix that, because
 * the thing that changed was the code, not the org.
 *
 * Resolving at read time makes the whole class impossible: the declarations are
 * an in-process array, so they are always exactly what this deploy declares.
 *
 * The cost is the three projection reads below. All three are themselves cached
 * (100 ms L1, then a single Redis hash GET each, issued concurrently), and this
 * runs on write paths that already touch the DB.
 */
export async function resolveOrgSystemRules(orgId: string): Promise<CachedRecordRule[]> {
  // Self-init: declarations are populated by the field-hooks bootstrap
  // (`registerAllHooks → registerFieldSystemRules`), which is lazy. A fresh
  // process whose first rules read lands here would otherwise resolve nothing.
  // Lazy-import — a static import re-introduces the field-hooks ⇄ record-rules
  // ⇄ cache load cycle that breaks vi.mock.
  const { ensureHooksRegistered } = await import('../field-hooks/registry')
  ensureHooksRegistered()

  const declarations = getSystemRuleDeclarations()
  if (declarations.length === 0) return []

  const cache = getOrgCache()
  const [customFields, slugMap, typeMap] = await Promise.all([
    cache.get(orgId, 'customFields'),
    cache.get(orgId, 'entityDefSlugs'),
    cache.get(orgId, 'entityDefs'),
  ])

  // Declarations whose def or field this org lacks are dropped by the resolver.
  // Not logged: this runs per read, so a line here would be per-write noise.
  return resolveSystemRules(orgId, declarations, {
    defIdBySlug: (slug) => slugMap[slug] ?? typeMap[slug],
    fieldIdBySystemAttribute: (defId, attr) =>
      (customFields[defId] ?? []).find((f) => f.systemAttribute === attr)?.id,
  })
}

// packages/lib/src/cache/providers/record-rules-provider.ts

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { dehydrateRecordRule } from '../../record-rules/store'
import { getSystemRuleDeclarations, resolveSystemRules } from '../../record-rules/system-rules'
import type { CachedRecordRule } from '../../record-rules/types'
import { ArrayAccessor } from '../accessors'
import type { CacheProvider } from '../org-cache-provider'
import { customFieldsProvider } from './custom-fields-provider'
import { entityDefSlugsProvider } from './entity-def-slugs-provider'
import { entityDefsProvider } from './entity-defs-provider'

const logger = createScopedLogger('record-rules-provider')

/**
 * Computes all record rules for an organization: the DB-backed user rules PLUS the
 * code-declared system rules (`declareSystemRules`) resolved to this org's concrete
 * field / def ids. Orgs lacking a system rule's field or def drop it. The dispatch hot
 * paths (field-change hook + lifecycle bus consumer) filter this array in memory.
 */
export const recordRulesProvider: CacheProvider<CachedRecordRule[]> = {
  async compute(orgId, db) {
    // Self-init: system-rule declarations are only populated by the field-hooks
    // bootstrap (`registerAllHooks → registerFieldSystemRules`), which is lazy. A
    // fresh process whose FIRST record-rules touch is this compute (e.g. a connector
    // sync hitting `getCachedRecordRules`) would otherwise cache a system-rule-free
    // union to Redis for a day, silently disabling every native rule org-wide.
    // Lazy-import — a static import of the registry re-introduces the
    // field-hooks ⇄ record-rules ⇄ cache load cycle that breaks vi.mock.
    const { ensureHooksRegistered } = await import('../../field-hooks/registry')
    ensureHooksRegistered()

    const rows = await db
      .select()
      .from(schema.RecordRule)
      .where(eq(schema.RecordRule.organizationId, orgId))
    const dbRules = rows.map(dehydrateRecordRule)

    const declarations = getSystemRuleDeclarations()
    if (declarations.length === 0) {
      logger.warn('Record-rules cache computed with ZERO system-rule declarations', {
        organizationId: orgId,
        dbRules: dbRules.length,
      })
      return dbRules
    }

    // Resolve system-rule declarations against this org's fields / defs. Computing the
    // sibling projections directly (as groups-provider does) avoids cache re-entrancy.
    const [customFields, slugMap, typeMap] = await Promise.all([
      customFieldsProvider.compute(orgId, db),
      entityDefSlugsProvider.compute(orgId, db),
      entityDefsProvider.compute(orgId, db),
    ])
    const systemRules = resolveSystemRules(orgId, declarations, {
      defIdBySlug: (slug) => slugMap[slug] ?? typeMap[slug],
      fieldIdBySystemAttribute: (defId, attr) =>
        (customFields[defId] ?? []).find((f) => f.systemAttribute === attr)?.id,
    })
    const resolvedIds = new Set(systemRules.map((r) => r.id))
    logger.info('Record-rules cache computed', {
      organizationId: orgId,
      dbRules: dbRules.length,
      declarations: declarations.length,
      systemRules: systemRules.map((r) => r.id),
      droppedDeclarations: declarations
        .filter((d) => !resolvedIds.has(`system:${d.key}`))
        .map((d) => d.key),
    })
    return [...dbRules, ...systemRules]
  },

  createAccessor(dataFn: () => Promise<CachedRecordRule[]>) {
    return new ArrayAccessor(dataFn)
  },
}

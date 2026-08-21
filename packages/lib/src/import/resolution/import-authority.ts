// packages/lib/src/import/resolution/import-authority.ts

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('import-authority')

/** Options for {@link buildImportAuthority} */
export interface ImportAuthorityOptions {
  /**
   * The member the import runs as (`ImportJob.createdById`). Used to assert
   * import authority for each relation TARGET definition INDEPENDENTLY of the
   * import's own gate, auto-creating a `company` from a parts import is a
   * write into `company`, and `assertImportEntity('part')` says nothing about
   * it.
   *
   * Fail-closed: with neither `userId` nor {@link canImportTarget}, every
   * probe answers `false`. Silently minting records for an unauthenticated
   * caller is not an option.
   */
  userId?: string
  /**
   * Explicit authority probe, overriding {@link userId}. Exists for callers
   * that already hold a `CapabilitySet` (and for tests).
   */
  canImportTarget?: (entityDefinitionId: string) => boolean | Promise<boolean>
}

/**
 * Build the per-target import-authority probe, memoized per definition.
 *
 * The relation TARGET's gate is asked separately from the import's own.
 * `assertImportEntity('part')` authorizes writing parts and nothing else; a
 * parts file that names unknown suppliers is asking to write `company` rows.
 * With no way to ask, the answer is NO — the plan-time caller reports it per
 * value so it surfaces in the preview rather than 403-ing halfway through
 * execution, and the execution-time caller refuses the run outright.
 *
 * `getCapabilities` is entirely cache-backed, so this is one warm read per
 * import even in a worker with no request context.
 *
 * @param organizationId - Org the import belongs to
 * @param options - Actor, or an explicit probe that overrides it
 * @returns Probe answering whether the actor may import into a definition
 */
export function buildImportAuthority(
  organizationId: string,
  options: ImportAuthorityOptions
): (entityDefinitionId: string) => Promise<boolean> {
  if (options.canImportTarget) {
    const probe = options.canImportTarget
    return async (defId) => probe(defId)
  }
  if (!options.userId) {
    let warned = false
    return async () => {
      if (!warned) {
        warned = true
        logger.warn('Relation auto-create refused: no userId or canImportTarget supplied', {
          organizationId,
        })
      }
      return false
    }
  }

  const userId = options.userId
  // Lazy + memoized: the dynamic import keeps the permissions graph out of
  // this module's static import cycle.
  let capsPromise: Promise<{ canImportEntity: (defId: string) => boolean }> | null = null
  const cache = new Map<string, Promise<boolean>>()
  return (entityDefinitionId) => {
    const hit = cache.get(entityDefinitionId)
    if (hit) return hit
    const answer = (async () => {
      capsPromise ??= import('../../permissions/capabilities/get-capabilities').then((m) =>
        m.getCapabilities(userId, organizationId)
      )
      try {
        const caps = await capsPromise
        return caps.canImportEntity(entityDefinitionId)
      } catch (error) {
        logger.error('Failed to resolve import authority for relation target', {
          organizationId,
          entityDefinitionId,
          error: error instanceof Error ? error.message : String(error),
        })
        return false
      }
    })()
    cache.set(entityDefinitionId, answer)
    return answer
  }
}

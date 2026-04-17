// packages/lib/src/ingest/companies/find-or-create.ts

import type { UnifiedCrudHandler } from '../../resources/crud/unified-handler'

/**
 * Find-or-create a company by domain. Uses `findByField` first to avoid the
 * pre-existing shape asymmetry in `UnifiedCrudHandler.findOrCreate`.
 *
 * `companyIdByDomain` is a per-batch cache owned by the caller. Passing it in
 * dedupes concurrent callers inside a single ingest batch; cross-batch races
 * can occasionally produce duplicate companies and are tolerated per plan v1.
 */
export async function findOrCreateCompanyByDomain(
  crudHandler: UnifiedCrudHandler,
  domain: string,
  companyIdByDomain?: Map<string, string | null>
): Promise<string | null> {
  const cached = companyIdByDomain?.get(domain)
  if (cached !== undefined) return cached

  const existing = await crudHandler.findByField('company', 'company_domain', domain)
  if (existing) {
    companyIdByDomain?.set(domain, existing.id)
    return existing.id
  }

  const result = await crudHandler.create('company', {
    company_domain: domain,
    company_name: domain,
    company_website: `https://${domain}`,
  })

  const createdId = result.instance.id
  companyIdByDomain?.set(domain, createdId)
  return createdId
}

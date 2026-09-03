// packages/lib/src/interactions/employer-attach.ts
//
// Attach existing contacts to an existing company by email domain.
//
// The mirror image of `ingest/companies/link-contact.ts`. That one runs from a CONTACT that
// mail just produced and may CREATE the company; this one runs from a COMPANY that already
// exists and creates nothing. It is what makes an imported company mean anything: a company
// row brought in from an ERP arrives with no employees (0 of the 20,414 contacts in the
// import this was written for carried an employer link), and a company's interaction stamps
// are derived entirely from the contacts linked to it.
//
// Same rules as the ingest twin, deliberately: EMAIL only, `classifyForCompany` for
// personal domains / excluded TLDs / own domains, the `company.autoCreate` org setting, and
// never overwrite an employer a person or another writer already set.

import { type Database, database as defaultDb } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { classifyForCompany } from '../ingest/domain/classifier'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { toRecordId } from '../resources/resource-id'
import { SystemUserService } from '../users/system-user-service'

const logger = createScopedLogger('interactions')

/**
 * Ceiling on links written by one call.
 *
 * A domain like a large customer's can carry hundreds of contacts, and each link is a real
 * record write that fires the normal write path (timeline entry included — this is content,
 * not bookkeeping). Anything past the cap is picked up the next time the company is touched
 * or by the nightly sweep.
 */
const MAX_ATTACH_PER_RUN = 500

/**
 * Link domain-matching contacts to these companies, and report how many links were written.
 *
 * Returns 0 quietly for every org that has no company definition, no `company_domain` field,
 * or `company.autoCreate` disabled — the same three gates the ingest path applies.
 */
export async function attachContactsToCompanies(
  organizationId: string,
  companyIds: readonly string[],
  db: Database = defaultDb
): Promise<number> {
  if (companyIds.length === 0) return 0

  try {
    const settings = await getOrgCache().get(organizationId, 'orgSettings')
    if (settings['company.autoCreate'] === false) return 0

    const [companyDefId, contactDefId] = await Promise.all([
      getCachedEntityDefId(organizationId, 'company'),
      getCachedEntityDefId(organizationId, 'contact'),
    ])
    if (!companyDefId || !contactDefId) return 0

    const fields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['company_domain', 'primary_email', 'contact_employer'])
    // `customFields` is an ORG-wide projection and a systemAttribute is only unique within
    // its def, so every field is checked against the def it must belong to.
    const domainField =
      fields.company_domain?.entityDefinitionId === companyDefId ? fields.company_domain : null
    const emailField =
      fields.primary_email?.entityDefinitionId === contactDefId ? fields.primary_email : null
    const employerField =
      fields.contact_employer?.entityDefinitionId === contactDefId ? fields.contact_employer : null
    if (!domainField || !emailField || !employerField) return 0

    const companyIdByDomain = await resolveCompanyDomains(
      organizationId,
      domainField.id,
      companyIds,
      db
    )
    if (companyIdByDomain.size === 0) return 0

    const candidates = await findUnattachedContacts(
      organizationId,
      emailField.id,
      employerField.id,
      [...companyIdByDomain.keys()],
      db
    )
    if (candidates.length === 0) return 0

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    const crud = new UnifiedCrudHandler(organizationId, systemUserId, db)

    let attached = 0
    for (const candidate of candidates) {
      const companyId = companyIdByDomain.get(candidate.domain)
      if (!companyId) continue
      try {
        await crud.update(toRecordId(contactDefId, candidate.contactId), {
          contact_employer: toRecordId(companyDefId, companyId),
        })
        attached++
      } catch (error) {
        logger.warn('Employer attach failed for contact', {
          organizationId,
          contactId: candidate.contactId,
          companyId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logger.info('Employer attach done', {
      organizationId,
      companies: companyIdByDomain.size,
      candidates: candidates.length,
      attached,
    })
    return attached
  } catch (error) {
    logger.warn('Employer attach failed', {
      organizationId,
      companies: companyIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

/**
 * `domain → companyId` for the companies in this batch that carry a linkable domain.
 *
 * A domain claimed by two companies is DROPPED rather than assigned to either: the whole
 * point of the match is that a domain identifies one organisation, and picking one of two
 * duplicates by row order would attach every contact on it to an arbitrary winner. Those
 * two companies are a duplicate pair, which is `duplicateScanJob`'s business.
 */
async function resolveCompanyDomains(
  organizationId: string,
  domainFieldId: string,
  companyIds: readonly string[],
  db: Database
): Promise<Map<string, string>> {
  const rows = await db.execute<{ companyId: string; domain: string }>(sql`
    SELECT fv."entityId" AS "companyId", lower(trim(fv."valueText")) AS "domain"
    FROM "FieldValue" fv
    JOIN "EntityInstance" ei ON ei.id = fv."entityId" AND ei."archivedAt" IS NULL
    WHERE fv."organizationId" = ${organizationId}
      AND fv."fieldId" = ${domainFieldId}
      AND fv."valueText" IS NOT NULL
      AND fv."entityId" IN (${sql.join(
        companyIds.map((id) => sql`${id}`),
        sql`, `
      )})
  `)

  const byDomain = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const row of rows.rows) {
    if (!row.domain) continue
    const existing = byDomain.get(row.domain)
    if (existing && existing !== row.companyId) {
      ambiguous.add(row.domain)
      continue
    }
    byDomain.set(row.domain, row.companyId)
  }
  for (const domain of ambiguous) byDomain.delete(domain)

  // The same classifier the ingest path uses — a company row whose domain is `gmail.com`
  // (users do create these) must not adopt every personal address in the org.
  const linkable = new Map<string, string>()
  for (const [domain, companyId] of byDomain) {
    const classified = await classifyForCompany(organizationId, `x@${domain}`)
    if (classified) linkable.set(classified, companyId)
  }
  return linkable
}

interface AttachCandidate {
  contactId: string
  domain: string
}

/**
 * Contacts on one of these domains that carry no employer at all.
 *
 * The host is matched exactly or as a subdomain (`john@mail.acme.com` belongs to
 * `acme.com`), which is as close to the registrable-domain rule as SQL gets without a public
 * suffix list. The dot in the suffix pattern is what keeps `evil-acme.com` out.
 */
async function findUnattachedContacts(
  organizationId: string,
  emailFieldId: string,
  employerFieldId: string,
  domains: readonly string[],
  db: Database
): Promise<AttachCandidate[]> {
  const rows = await db.execute<{ contactId: string; domain: string }>(sql`
    WITH wanted(domain) AS (VALUES ${sql.join(
      domains.map((d) => sql`(${d})`),
      sql`, `
    )}),
    emails AS (
      SELECT DISTINCT
        fv."entityId" AS "contactId",
        split_part(lower(fv."valueText"), '@', 2) AS host
      FROM "FieldValue" fv
      JOIN "EntityInstance" ei ON ei.id = fv."entityId" AND ei."archivedAt" IS NULL
      WHERE fv."organizationId" = ${organizationId}
        AND fv."fieldId" = ${emailFieldId}
        AND fv."valueText" IS NOT NULL
    )
    SELECT e."contactId", w.domain AS "domain"
    FROM emails e
    JOIN wanted w ON e.host = w.domain OR e.host LIKE '%.' || w.domain
    WHERE NOT EXISTS (
      SELECT 1 FROM "FieldValue" ex
      WHERE ex."entityId" = e."contactId"
        AND ex."fieldId" = ${employerFieldId}
        AND ex."relatedEntityId" IS NOT NULL
    )
    -- One contact matching two of the wanted domains (two addresses) would produce two
    -- rows; the first employer write wins and the second is dropped by the guard above on
    -- the next pass, so take a stable single row per contact here.
    ORDER BY e."contactId", w.domain
    LIMIT ${MAX_ATTACH_PER_RUN}
  `)

  const seen = new Set<string>()
  const candidates: AttachCandidate[] = []
  for (const row of rows.rows) {
    if (seen.has(row.contactId)) continue
    seen.add(row.contactId)
    candidates.push({ contactId: row.contactId, domain: row.domain })
  }
  return candidates
}

// apps/extension/src/iframe/routes/root/lookups.ts

import type { ParsedCompany, ParsedPerson } from '../../../lib/parsers/types'
import { type LookupByFieldCandidate, lookupByField } from '../../trpc'
import { instanceIdFromRecordId } from '../types'
import { companyToPerson, personToCompany } from './field-values'
import type { EntityType, ExistingMatch, GenericPage } from './types'

/**
 * Dedup lookups against the network.
 *
 * Single round-trip priority lookup via `record.lookupByField`:
 * externalId first (exact match on the capture's source+id), then
 * primary_email / company_domain as a wider-net fallback. See
 * plans/folk/21-record-lookup-by-field.md §"Wire shape" for why we send
 * the whole list in one call rather than two serial searches.
 *
 * Limit raised to 5 so the iframe can show folk's "N similar found" list
 * instead of pretending the first hit is the only one.
 */
const LOOKUP_LIMIT = 5

async function findExistingByPerson(person: ParsedPerson): Promise<ExistingMatch[]> {
  const candidates: LookupByFieldCandidate[] = [
    { systemAttribute: 'external_id', value: person.externalId },
  ]
  if (person.primaryEmail) {
    candidates.push({ systemAttribute: 'primary_email', value: person.primaryEmail })
  }
  try {
    const result = await lookupByField({
      entityDefinitionId: 'contact',
      candidates,
      limit: LOOKUP_LIMIT,
    })
    return result.items.map((item) => ({
      recordId: item.recordId,
      entityType: 'contact',
      displayName: item.displayName,
      secondaryDisplayValue: item.secondaryDisplayValue,
      avatarUrl: item.avatarUrl,
    }))
  } catch {
    return []
  }
}

async function findExistingByCompany(company: ParsedCompany): Promise<ExistingMatch[]> {
  const candidates: LookupByFieldCandidate[] = [
    { systemAttribute: 'external_id', value: company.externalId },
  ]
  if (company.domain) {
    candidates.push({ systemAttribute: 'company_domain', value: company.domain })
  }
  try {
    const result = await lookupByField({
      entityDefinitionId: 'company',
      candidates,
      limit: LOOKUP_LIMIT,
    })
    return result.items.map((item) => ({
      recordId: item.recordId,
      entityType: 'company',
      displayName: item.displayName,
      secondaryDisplayValue: item.secondaryDisplayValue,
      avatarUrl: item.avatarUrl,
    }))
  } catch {
    return []
  }
}

/**
 * Look up existing records in a specific entity type, synthesizing the
 * cross-entity candidate via personToCompany / companyToPerson when the
 * parse result only carries the other shape. Twitter profiles, for
 * example, always parse as a person — but the user may have hit the
 * secondary "Save as company" button on a prior visit, writing a company
 * row with the same externalId. Without this cross-lookup, the iframe
 * would offer Save again on re-visit.
 */
export async function findExistingInEntity(
  entityType: EntityType,
  person: ParsedPerson | null,
  company: ParsedCompany | null
): Promise<ExistingMatch[]> {
  if (entityType === 'contact') {
    const p = person ?? companyToPerson(company)
    return p ? findExistingByPerson(p) : []
  }
  const c = company ?? personToCompany(person)
  return c ? findExistingByCompany(c) : []
}

export async function findExistingByGenericPage(page: GenericPage): Promise<string | null> {
  // Generic-site capture stays single-hit — the URL→company mapping is
  // 1:1 (we key on hostname), so a list view would only ever have one
  // row. Single string return preserves the existing call sites.
  const candidates: LookupByFieldCandidate[] = [
    { systemAttribute: 'external_id', value: `website:${page.hostname}` },
    { systemAttribute: 'company_domain', value: page.hostname },
  ]
  try {
    const result = await lookupByField({ entityDefinitionId: 'company', candidates })
    const hit = result.items[0]?.recordId
    return hit ? instanceIdFromRecordId(hit) : null
  } catch {
    return null
  }
}

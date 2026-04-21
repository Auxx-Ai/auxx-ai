// packages/lib/src/ingest/companies/link-contact.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull } from 'drizzle-orm'
import { requireCachedEntityDefId } from '../../cache'
import { getOrgCache } from '../../cache/singletons'
import type { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { classifyForCompany } from '../domain/classifier'
import { findOrCreateCompanyByDomain } from './find-or-create'

const logger = createScopedLogger('ingest:link-contact-to-company')

export interface LinkContactArgs {
  organizationId: string
  crudHandler: UnifiedCrudHandler
  contactId: string
  identifier: string
  identifierType: string
  /** Optional per-batch cache of domain → companyId (created by ingest orchestrator). */
  companyIdByDomain?: Map<string, string | null>
  /** Optional pre-fetched own-domains set — avoids redundant org-cache reads per participant. */
  ownDomains?: Set<string>
  db?: Database
}

/**
 * Auto-create a company for the participant's email domain and link the contact to it.
 *
 * Rules (v1):
 * - Only EMAIL identifiers are considered (phone/PSID are skipped).
 * - Skip personal/free email domains, excluded TLDs, own domains.
 * - Skip when `company.autoCreate` org setting is false.
 * - Set `contact.employer` only if not already set — never overwrite.
 * - Set `company.primaryContact` only if not already set.
 * - Failures are logged but never thrown — contact creation must succeed even if linking fails.
 */
export async function linkContactToCompanyByDomain(args: LinkContactArgs): Promise<void> {
  if (args.identifierType !== 'EMAIL') return

  const db = args.db ?? defaultDb

  try {
    const settings = await getOrgCache().get(args.organizationId, 'orgSettings')
    if (settings['company.autoCreate'] === false) return

    const domain = await classifyForCompany(args.organizationId, args.identifier, args.ownDomains)
    if (!domain) return

    const companyId = await findOrCreateCompanyByDomain(
      args.crudHandler,
      domain,
      args.companyIdByDomain
    )
    if (!companyId) return

    // Resolve system entity types to EntityDefinition UUIDs so relationship writes
    // store the canonical `relatedEntityDefinitionId`. Server-side normalization in
    // the field-value mutation path also canonicalizes these, but resolving here
    // keeps callers consistent and avoids any type-name-prefixed RecordIds in transit.
    const [contactDefId, companyDefId, contactEmployerField, companyPrimaryContactField] =
      await Promise.all([
        requireCachedEntityDefId(args.organizationId, 'contact'),
        requireCachedEntityDefId(args.organizationId, 'company'),
        db
          .select({ id: schema.CustomField.id })
          .from(schema.CustomField)
          .where(
            and(
              eq(schema.CustomField.organizationId, args.organizationId),
              eq(schema.CustomField.systemAttribute, 'contact_employer')
            )
          )
          .limit(1),
        db
          .select({ id: schema.CustomField.id })
          .from(schema.CustomField)
          .where(
            and(
              eq(schema.CustomField.organizationId, args.organizationId),
              eq(schema.CustomField.systemAttribute, 'company_primary_contact')
            )
          )
          .limit(1),
      ])

    const updates: Array<Promise<unknown>> = []

    // Only set contact.employer if it's currently empty.
    if (contactEmployerField[0]) {
      const existing = await db
        .select({ id: schema.FieldValue.id })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, args.organizationId),
            eq(schema.FieldValue.fieldId, contactEmployerField[0].id),
            eq(schema.FieldValue.entityId, args.contactId),
            isNotNull(schema.FieldValue.relatedEntityId)
          )
        )
        .limit(1)

      if (existing.length === 0) {
        updates.push(
          args.crudHandler.update(toRecordId(contactDefId, args.contactId), {
            contact_employer: toRecordId(companyDefId, companyId),
          })
        )
      }
    }

    // Only set company.primaryContact if it's currently empty.
    if (companyPrimaryContactField[0]) {
      const existing = await db
        .select({ id: schema.FieldValue.id })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, args.organizationId),
            eq(schema.FieldValue.fieldId, companyPrimaryContactField[0].id),
            eq(schema.FieldValue.entityId, companyId),
            isNotNull(schema.FieldValue.relatedEntityId)
          )
        )
        .limit(1)

      if (existing.length === 0) {
        updates.push(
          args.crudHandler.update(toRecordId(companyDefId, companyId), {
            company_primary_contact: toRecordId(contactDefId, args.contactId),
          })
        )
      }
    }

    if (updates.length > 0) await Promise.all(updates)
  } catch (err) {
    logger.warn('Company linking failed, continuing', {
      organizationId: args.organizationId,
      contactId: args.contactId,
      identifier: args.identifier,
      error: (err as Error).message,
    })
  }
}

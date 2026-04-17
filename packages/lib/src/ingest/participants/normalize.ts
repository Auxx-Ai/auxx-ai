// packages/lib/src/ingest/participants/normalize.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { IdentifierType as IdentifierTypeEnum } from '@auxx/database/enums'
import type { IdentifierType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { IngestContext } from '../context'

const logger = createScopedLogger('ingest:participants:normalize')

/** Normalize an identifier based on its type (lowercased email, digits-only phone, trimmed otherwise). */
export function normalizeIdentifier(identifier: string, type: IdentifierType): string {
  const trimmed = identifier.trim()
  switch (type) {
    case IdentifierTypeEnum.EMAIL:
      return trimmed.toLowerCase()
    case IdentifierTypeEnum.PHONE: {
      const digits = trimmed.replace(/\D/g, '')
      return trimmed.startsWith('+') ? `+${digits}` : digits
    }
    default:
      return trimmed
  }
}

/**
 * Determine the IdentifierType for a raw identifier, given an integrationId.
 * Looks up the integration's provider (cached per-batch via ctx) and falls
 * back to a shape guess (email-shape → EMAIL, digits → PHONE) if the provider
 * doesn't disambiguate.
 */
export async function determineIdentifierType(
  ctx: IngestContext,
  identifier: string,
  integrationId: string
): Promise<IdentifierType> {
  const provider = await resolveProvider(ctx, integrationId, ctx.db)
  switch (provider) {
    case 'google':
    case 'outlook':
    case 'mailgun':
    case 'email':
      return IdentifierTypeEnum.EMAIL
    case 'openphone':
    case 'sms':
      return IdentifierTypeEnum.PHONE
    case 'facebook':
      return IdentifierTypeEnum.FACEBOOK_PSID
    case 'instagram':
      return IdentifierTypeEnum.INSTAGRAM_IGSID
    default:
      if (identifier.includes('@')) return IdentifierTypeEnum.EMAIL
      if (identifier.match(/^\+?\d{7,}$/)) return IdentifierTypeEnum.PHONE
      logger.warn(
        `Could not reliably determine identifier type for provider ${provider}, identifier: ${identifier}. Defaulting to EMAIL.`
      )
      return IdentifierTypeEnum.EMAIL
  }
}

async function resolveProvider(
  ctx: IngestContext,
  integrationId: string,
  db: Database = defaultDb
): Promise<string | undefined> {
  const cached = ctx.providerByIntegrationId.get(integrationId)
  if (cached) return cached
  const [integration] = await db
    .select({ provider: schema.Integration.provider })
    .from(schema.Integration)
    .where(and(eq(schema.Integration.id, integrationId), isNull(schema.Integration.deletedAt)))
    .limit(1)
  const provider = integration?.provider
  if (provider) ctx.providerByIntegrationId.set(integrationId, provider)
  return provider
}

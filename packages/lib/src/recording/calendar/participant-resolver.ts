// packages/lib/src/recording/calendar/participant-resolver.ts

import { database as db, schema } from '@auxx/database'
import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import type { CalendarAttendeeInput, RecordingResult, ResolvedParticipant } from './types'

/**
 * Known attendee patterns that should be treated as automation/bot identities.
 */
const BOT_PATTERNS = [/^noreply@/i, /^calendar-notification@/i, /^meet_[^@]*@/i]

/**
 * Resolve attendees into internal users, contacts, and companies.
 */
export async function resolveParticipants(
  attendees: CalendarAttendeeInput[],
  organizationId: string,
  orgDomains: string[]
): RecordingResult<ResolvedParticipant[]> {
  try {
    const normalizedOrgDomains = new Set(orgDomains.map(normalizeDomain).filter(Boolean))
    const results: ResolvedParticipant[] = []

    for (const attendee of attendees) {
      const email = attendee.email.trim().toLowerCase()
      if (!email) continue

      const emailDomain = extractEmailDomain(email)
      const isExternal = emailDomain ? !normalizedOrgDomains.has(emailDomain) : true
      const isBot = BOT_PATTERNS.some((pattern) => pattern.test(email))
      const contactResult = await findContactEntityInstanceIdByEmail(email, organizationId)
      if (contactResult.isErr()) {
        return err(contactResult.error)
      }

      const companyResult = emailDomain
        ? await findCompanyByDomain(emailDomain, organizationId)
        : ok<string | null>(null)

      if (companyResult.isErr()) {
        return err(companyResult.error)
      }

      const internalUserId = await findInternalUserIdByEmail(email, organizationId)

      results.push({
        name: attendee.name?.trim() || email,
        email,
        emailDomain,
        responseStatus: normalizeRsvpStatus(attendee.responseStatus),
        isOrganizer: attendee.organizer ?? false,
        isBot,
        isExternal,
        userId: internalUserId,
        contactEntityInstanceId: contactResult.value,
        companyEntityInstanceId: companyResult.value,
      })
    }

    return ok(results)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Find a company entity by matching a domain against company website/domain fields.
 */
export async function findCompanyByDomain(
  domain: string,
  organizationId: string
): RecordingResult<string | null> {
  try {
    const normalizedDomain = normalizeDomain(domain)
    if (!normalizedDomain) {
      return ok(null)
    }

    const [companyDefinition] = await db
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          or(
            eq(schema.EntityDefinition.standardType, 'company'),
            eq(schema.EntityDefinition.entityType, 'company')
          )!
        )
      )
      .limit(1)

    if (!companyDefinition) {
      return ok(null)
    }

    const companyFields = await db
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, companyDefinition.id),
          or(
            eq(schema.CustomField.systemAttribute, 'company_website'),
            sql`lower(${schema.CustomField.name}) = 'website'`,
            sql`lower(${schema.CustomField.name}) = 'domain'`
          )!
        )
      )

    if (companyFields.length === 0) {
      return ok(null)
    }

    const fieldIds = companyFields.map((field) => field.id)
    const [match] = await db
      .select({
        entityId: schema.FieldValue.entityId,
      })
      .from(schema.FieldValue)
      .innerJoin(
        schema.EntityInstance,
        and(
          eq(schema.EntityInstance.id, schema.FieldValue.entityId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.fieldId, fieldIds),
          ilike(schema.FieldValue.valueText, `%${normalizedDomain}%`)
        )
      )
      .orderBy(asc(schema.FieldValue.entityId))
      .limit(1)

    return ok(match?.entityId ?? null)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Replace the participant set for a synced meeting/calendar event.
 */
export async function upsertMeetingParticipants(
  meetingId: string,
  calendarEventId: string,
  organizationId: string,
  participants: ResolvedParticipant[]
): RecordingResult<void> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.MeetingParticipant)
        .where(
          and(
            eq(schema.MeetingParticipant.organizationId, organizationId),
            eq(schema.MeetingParticipant.calendarEventId, calendarEventId)
          )
        )

      if (participants.length === 0) {
        return
      }

      await tx.insert(schema.MeetingParticipant).values(
        participants.map((participant) => ({
          organizationId,
          meetingId,
          calendarEventId,
          userId: participant.userId,
          name: participant.name,
          email: participant.email,
          emailDomain: participant.emailDomain,
          contactEntityInstanceId: participant.contactEntityInstanceId,
          companyEntityInstanceId: participant.companyEntityInstanceId,
          isOrganizer: participant.isOrganizer,
          rsvpStatus: participant.responseStatus,
          isBot: participant.isBot,
          isExternal: participant.isExternal,
        }))
      )
    })

    return ok(undefined)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Resolve an internal org member by email.
 */
async function findInternalUserIdByEmail(
  email: string,
  organizationId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.User.id })
    .from(schema.User)
    .innerJoin(
      schema.OrganizationMember,
      and(
        eq(schema.OrganizationMember.userId, schema.User.id),
        eq(schema.OrganizationMember.organizationId, organizationId)
      )
    )
    .where(eq(schema.User.email, email))
    .limit(1)

  return row?.id ?? null
}

/**
 * Find a Contact entity instance by its primary email field.
 */
async function findContactEntityInstanceIdByEmail(
  email: string,
  organizationId: string
): RecordingResult<string | null> {
  try {
    const [contactDefinition] = await db
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, 'contact')
        )
      )
      .limit(1)

    if (!contactDefinition) {
      return ok(null)
    }

    const [emailField] = await db
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, contactDefinition.id),
          eq(schema.CustomField.systemAttribute, 'primary_email')
        )
      )
      .limit(1)

    if (!emailField) {
      return ok(null)
    }

    const [match] = await db
      .select({ entityId: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.FieldValue,
        and(
          eq(schema.FieldValue.entityId, schema.EntityInstance.id),
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.fieldId, emailField.id),
          eq(schema.FieldValue.valueText, email)
        )
      )
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, contactDefinition.id),
          isNull(schema.EntityInstance.archivedAt)
        )
      )
      .limit(1)

    return ok(match?.entityId ?? null)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Normalize provider RSVP values into the database enum.
 */
function normalizeRsvpStatus(
  status?: string | null
): 'accepted' | 'declined' | 'tentative' | 'needs_action' {
  switch (status) {
    case 'accepted':
      return 'accepted'
    case 'declined':
      return 'declined'
    case 'tentative':
      return 'tentative'
    default:
      return 'needs_action'
  }
}

/**
 * Extract the domain portion from an email address.
 */
function extractEmailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase().trim() ?? ''
}

/**
 * Normalize domains for reliable comparisons.
 */
function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
}

/**
 * Convert unknown thrown values into Error instances.
 */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return new Error((error as { message: string }).message)
  }

  return new Error('Unknown participant-resolver error')
}

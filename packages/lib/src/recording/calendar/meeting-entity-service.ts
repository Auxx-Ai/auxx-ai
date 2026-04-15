// packages/lib/src/recording/calendar/meeting-entity-service.ts

import type { CalendarEventEntity } from '@auxx/database'
import { database as db, schema } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { requireCachedEntityDefId } from '../../cache'
import { FieldValueService } from '../../field-values'
import { linkCalendarEventToMeeting } from './calendar-event-service'
import type { RecordingResult, ResolvedParticipant } from './types'

/**
 * Create a Meeting entity for a synced calendar event.
 */
export async function createMeetingFromCalendarEvent(
  event: CalendarEventEntity,
  organizationId: string,
  userId: string,
  participants: ResolvedParticipant[]
): RecordingResult<string> {
  try {
    const entityDefinitionId = await requireCachedEntityDefId(organizationId, 'meeting')

    const created = await createEntityInstanceRecord({
      entityDefinitionId,
      organizationId,
      createdById: userId,
      displayName: event.title,
    })

    if (created.isErr()) {
      return err(toError(created.error))
    }

    const entityInstanceId = created.value.id
    const syncResult = await syncMeetingEntityFromCalendarEvent(
      entityInstanceId,
      event,
      organizationId,
      userId,
      participants,
      entityDefinitionId
    )

    if (syncResult.isErr()) {
      return err(syncResult.error)
    }

    return ok(entityInstanceId)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Update Meeting field values from the latest calendar state.
 */
export async function syncMeetingEntityFromCalendarEvent(
  entityInstanceId: string,
  event: CalendarEventEntity,
  organizationId: string,
  userId: string,
  participants: ResolvedParticipant[],
  entityDefinitionId?: string
): RecordingResult<void> {
  try {
    const resolvedDefinitionId =
      entityDefinitionId ?? (await requireCachedEntityDefId(organizationId, 'meeting'))

    const fieldIds = await getMeetingFieldIdMap(organizationId, resolvedDefinitionId)
    const fieldValueService = new FieldValueService(organizationId, userId, db)
    const organizerUserId = resolveOrganizerUserId(event, participants)
    const companyRecordId = resolveSingleExternalCompanyRecordId(participants)
    const contactRecordId = resolveSingleExternalContactRecordId(participants)
    const durationMinutes = Math.max(
      0,
      Math.round((event.endTime.getTime() - event.startTime.getTime()) / 60000)
    )

    await fieldValueService.setValuesForEntity({
      recordId: toRecordId(resolvedDefinitionId, entityInstanceId),
      values: [
        { fieldId: fieldIds.meeting_title, value: event.title },
        { fieldId: fieldIds.meeting_type, value: event.meetingUrl ? 'video' : 'call' },
        { fieldId: fieldIds.meeting_date_time, value: event.startTime.toISOString() },
        { fieldId: fieldIds.meeting_duration_minutes, value: durationMinutes },
        { fieldId: fieldIds.meeting_location, value: event.location ?? null },
        { fieldId: fieldIds.meeting_url, value: event.meetingUrl ?? null },
        { fieldId: fieldIds.meeting_organizer, value: organizerUserId },
        { fieldId: fieldIds.meeting_company, value: companyRecordId },
        { fieldId: fieldIds.meeting_contact, value: contactRecordId },
      ],
      publishEvents: false,
    })

    const linkResult = await linkCalendarEventToMeeting(event.id, entityInstanceId, organizationId)
    if (linkResult.isErr()) {
      return err(linkResult.error)
    }

    return ok(undefined)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Resolve the Meeting custom-field IDs for the canonical sync attributes.
 */
async function getMeetingFieldIdMap(organizationId: string, entityDefinitionId: string) {
  const rows = await db
    .select({
      id: schema.CustomField.id,
      systemAttribute: schema.CustomField.systemAttribute,
    })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, entityDefinitionId)
      )
    )

  const map = new Map(rows.map((row) => [row.systemAttribute, row.id]))
  const requiredAttributes = [
    'meeting_title',
    'meeting_type',
    'meeting_date_time',
    'meeting_duration_minutes',
    'meeting_location',
    'meeting_url',
    'meeting_organizer',
    'meeting_company',
    'meeting_contact',
  ] as const

  for (const attribute of requiredAttributes) {
    if (!map.get(attribute)) {
      throw new Error(`Missing Meeting field for system attribute ${attribute}`)
    }
  }

  return {
    meeting_title: map.get('meeting_title')!,
    meeting_type: map.get('meeting_type')!,
    meeting_date_time: map.get('meeting_date_time')!,
    meeting_duration_minutes: map.get('meeting_duration_minutes')!,
    meeting_location: map.get('meeting_location')!,
    meeting_url: map.get('meeting_url')!,
    meeting_organizer: map.get('meeting_organizer')!,
    meeting_company: map.get('meeting_company')!,
    meeting_contact: map.get('meeting_contact')!,
  }
}

/**
 * Create an EntityInstance row for a synced Meeting record.
 */
async function createEntityInstanceRecord(params: {
  entityDefinitionId: string
  organizationId: string
  createdById?: string | null
  displayName?: string | null
}): RecordingResult<typeof schema.EntityInstance.$inferSelect> {
  try {
    const [created] = await db
      .insert(schema.EntityInstance)
      .values({
        entityDefinitionId: params.entityDefinitionId,
        organizationId: params.organizationId,
        createdById: params.createdById ?? null,
        displayName: params.displayName ?? null,
      })
      .returning()

    if (!created) {
      return err(new Error('Failed to create meeting entity instance'))
    }

    return ok(created)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Resolve the organizer user ID from the event organizer payload or participant rows.
 */
function resolveOrganizerUserId(
  event: CalendarEventEntity,
  participants: ResolvedParticipant[]
): string | null {
  const organizer = event.organizer as { email?: string | null } | null
  const organizerEmail = organizer?.email?.trim().toLowerCase()

  if (organizerEmail) {
    const matchedOrganizer = participants.find(
      (participant) => participant.email === organizerEmail && participant.userId
    )
    if (matchedOrganizer?.userId) {
      return matchedOrganizer.userId
    }
  }

  return (
    participants.find((participant) => participant.isOrganizer && participant.userId)?.userId ??
    null
  )
}

/**
 * Resolve a single clear external company match from participant rows.
 */
function resolveSingleExternalCompanyRecordId(participants: ResolvedParticipant[]): string | null {
  const companyIds = Array.from(
    new Set(
      participants
        .filter((participant) => participant.isExternal && participant.companyEntityInstanceId)
        .map((participant) => participant.companyEntityInstanceId!)
    )
  )

  if (companyIds.length !== 1) {
    return null
  }

  return toRecordId('company', companyIds[0]!)
}

/**
 * Resolve a single clear external contact match from participant rows.
 */
function resolveSingleExternalContactRecordId(participants: ResolvedParticipant[]): string | null {
  const contactIds = Array.from(
    new Set(
      participants
        .filter((participant) => participant.isExternal && participant.contactEntityInstanceId)
        .map((participant) => participant.contactEntityInstanceId!)
    )
  )

  if (contactIds.length !== 1) {
    return null
  }

  return toRecordId('contact', contactIds[0]!)
}

/**
 * Convert unknown thrown values into Error instances.
 */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error('Unknown meeting-entity-service error')
}

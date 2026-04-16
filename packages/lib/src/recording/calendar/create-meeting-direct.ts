// packages/lib/src/recording/calendar/create-meeting-direct.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { createEntityInstance } from '@auxx/services/entity-instances'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { getCachedCustomFields, requireCachedEntityDefId } from '../../cache'
import { FieldValueService } from '../../field-values'
import type { MeetingPlatformValue, RecordingResult, ResolvedParticipant } from './types'

const logger = createScopedLogger('recording:create-meeting-direct')

export interface CreateMeetingDirectParams {
  organizationId: string
  userId: string
  title: string
  startTime: Date
  durationMinutes: number
  meetingUrl?: string
  meetingPlatform?: MeetingPlatformValue
  participants: ResolvedParticipant[]
}

/**
 * Create a Meeting entity directly (without a linked CalendarEvent).
 * Used for manual URL meetings (Zoom/Teams/Other).
 */
export async function createMeetingDirect(
  params: CreateMeetingDirectParams
): RecordingResult<string> {
  try {
    const entityDefinitionId = await requireCachedEntityDefId(params.organizationId, 'meeting')

    const created = await createEntityInstance({
      entityDefinitionId,
      organizationId: params.organizationId,
      createdById: params.userId,
      displayName: params.title,
    })

    if (created.isErr()) {
      return err(new Error(created.error.message))
    }

    const entityInstanceId = created.value.id

    // Set meeting field values
    const fields = await getCachedCustomFields(params.organizationId, entityDefinitionId)
    const fieldMap = new Map(fields.map((f) => [f.systemAttribute, f.id]))
    const fieldValueService = new FieldValueService(params.organizationId, params.userId, db)

    const organizerUserId =
      params.participants.find((p) => p.isOrganizer && p.userId)?.userId ?? null
    const companyRecordId = resolveSingleExternalId(
      params.participants,
      'companyEntityInstanceId',
      'company'
    )
    const contactRecordId = resolveSingleExternalId(
      params.participants,
      'contactEntityInstanceId',
      'contact'
    )

    await fieldValueService.setValuesForEntity({
      recordId: toRecordId(entityDefinitionId, entityInstanceId),
      values: [
        { fieldId: fieldMap.get('meeting_title')!, value: params.title },
        { fieldId: fieldMap.get('meeting_type')!, value: params.meetingUrl ? 'video' : 'call' },
        { fieldId: fieldMap.get('meeting_date_time')!, value: params.startTime.toISOString() },
        { fieldId: fieldMap.get('meeting_duration_minutes')!, value: params.durationMinutes },
        { fieldId: fieldMap.get('meeting_location')!, value: null },
        { fieldId: fieldMap.get('meeting_url')!, value: params.meetingUrl ?? null },
        { fieldId: fieldMap.get('meeting_organizer')!, value: organizerUserId },
        { fieldId: fieldMap.get('meeting_company')!, value: companyRecordId },
        { fieldId: fieldMap.get('meeting_contact')!, value: contactRecordId },
      ],
      publishEvents: false,
    })

    // Insert participants (no calendarEventId — use meetingId-based upsert)
    if (params.participants.length > 0) {
      await insertMeetingParticipantsDirect(
        entityInstanceId,
        params.organizationId,
        params.participants
      )
    }

    logger.info('Created meeting entity directly', {
      meetingEntityId: entityInstanceId,
      organizationId: params.organizationId,
      platform: params.meetingPlatform ?? 'unknown',
    })

    return ok(entityInstanceId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown create-meeting-direct error'
    logger.error('Failed to create direct meeting', { error: message })
    return err(error instanceof Error ? error : new Error(message))
  }
}

/**
 * Insert meeting participants for a direct meeting (no calendarEventId).
 * Deletes existing participants by meetingId before inserting.
 */
async function insertMeetingParticipantsDirect(
  meetingId: string,
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
            eq(schema.MeetingParticipant.meetingId, meetingId)
          )
        )

      await tx.insert(schema.MeetingParticipant).values(
        participants.map((participant) => ({
          organizationId,
          meetingId,
          calendarEventId: null,
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
    return err(error instanceof Error ? error : new Error('Failed to insert meeting participants'))
  }
}

/**
 * Resolve a single external entity ID from participants.
 */
function resolveSingleExternalId(
  participants: ResolvedParticipant[],
  key: 'contactEntityInstanceId' | 'companyEntityInstanceId',
  entityType: string
): string | null {
  const ids = Array.from(
    new Set(participants.filter((p) => p.isExternal && p[key]).map((p) => p[key]!))
  )

  return ids.length === 1 ? toRecordId(entityType, ids[0]!) : null
}

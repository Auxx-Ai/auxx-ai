// packages/lib/src/ai/kopilot/capabilities/mail/recipient-resolver.ts

import { schema } from '@auxx/database'
import type { IdentifierType } from '@auxx/database/types'
import { isRecordId, parseRecordId, type RecordId } from '@auxx/types/resource'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { IntegrationCatalogEntry } from '../../../../cache/integration-catalog'
import { getCachedCustomFields } from '../../../../cache/org-cache-helpers'
import { Result, type TypedResult } from '../../../../result'
import type { ToolContext } from '../../../agent-framework/tool-context'

export type RecipientRole = 'to' | 'cc' | 'bcc'

export interface ResolvedRecipient {
  /** Source recordId, when the entry was a recordId. */
  recordId?: string
  /** Source participantId, when the entry was a participantId or resolved from a recordId. */
  participantId?: string
  /** The actual identifier sent to the channel (email address, phone number, …). */
  identifier: string
  identifierType: IdentifierType
  role: RecipientRole
  /** Display label suitable for UI cards (name when available, else identifier). */
  displayName?: string
}

export interface ResolveRecipientsInputs {
  to?: string[]
  cc?: string[]
  bcc?: string[]
}

export class RecipientResolutionError extends Error {
  constructor(
    message: string,
    public readonly entry: string,
    public readonly role: RecipientRole
  ) {
    super(message)
    this.name = 'RecipientResolutionError'
  }
}

const CUID_RE = /^[a-z0-9]{20,32}$/i
const PHONE_RE = /^\+?[\d\s().-]{7,}$/

type ChannelIdTypes = readonly IdentifierType[]

function identifierTypesForIntegration(integration: IntegrationCatalogEntry): ChannelIdTypes {
  switch (integration.recipientModel) {
    case 'email':
      return ['EMAIL']
    case 'phone':
      return ['PHONE']
    case 'thread_only':
      // Facebook/Instagram replies — both PSID variants accepted; specific tool
      // calls reach this path only when threadReply mode resolves recipients.
      return ['FACEBOOK_PSID', 'INSTAGRAM_IGSID']
    case 'platform_user':
      return []
  }
}

/**
 * `systemAttribute` value on the contact's identifier `CustomField` for each
 * channel. Used as the fallback path when no `Participant` exists for the
 * contact yet (e.g. brand-new contact with only the email/phone set as a
 * field value, no inbound message history).
 */
function systemAttributeForChannel(
  integration: IntegrationCatalogEntry
): { systemAttributes: string[]; identifierType: IdentifierType } | undefined {
  switch (integration.recipientModel) {
    case 'email':
      return { systemAttributes: ['primary_email'], identifierType: 'EMAIL' }
    case 'phone':
      return { systemAttributes: ['phone', 'primary_phone'], identifierType: 'PHONE' }
    default:
      return undefined
  }
}

/**
 * Look up the contact's primary identifier (email/phone) directly on the
 * `FieldValue` table for the relevant `systemAttribute` `CustomField`. This
 * is the canonical place where a contact's email lives — the `Participant`
 * table only has a row when a thread/message has actually been recorded with
 * that contact, which isn't true for brand-new CRM contacts.
 */
async function lookupIdentifierFromFieldValue(
  ctx: ToolContext,
  entityDefinitionId: string,
  entityInstanceId: string,
  systemAttributes: string[]
): Promise<string | undefined> {
  const customFields = await getCachedCustomFields(ctx.organizationId, entityDefinitionId)
  const matchingFieldIds = customFields
    .filter((f) => f.systemAttribute && systemAttributes.includes(f.systemAttribute))
    .map((f) => f.id)
  if (matchingFieldIds.length === 0) return undefined

  const rows = await ctx.db.query.FieldValue.findMany({
    where: and(
      eq(schema.FieldValue.organizationId, ctx.organizationId),
      eq(schema.FieldValue.entityId, entityInstanceId),
      inArray(schema.FieldValue.fieldId, matchingFieldIds)
    ),
    orderBy: [desc(schema.FieldValue.updatedAt)],
  })
  for (const row of rows) {
    const value = row.valueText?.trim()
    if (value) return value
  }
  return undefined
}

function detectFormat(entry: string): 'recordId' | 'participantId' | 'email' | 'phone' | 'unknown' {
  if (entry.includes(':') && isRecordId(entry)) return 'recordId'
  if (entry.includes('@')) return 'email'
  if (PHONE_RE.test(entry) && entry.replace(/\D/g, '').length >= 7) return 'phone'
  if (CUID_RE.test(entry)) return 'participantId'
  return 'unknown'
}

/**
 * Resolve smart-parsed recipient strings (recordIds / participantIds / raw
 * identifiers) into concrete `ResolvedRecipient` rows for the given channel.
 *
 * - **recordId**: looks up the contact's participants matching the channel's
 *   `recipientModel`, picks the most recently used (no primary flag exists on
 *   `Participant` today).
 * - **participantId**: fetches by id, validates `identifierType` matches the
 *   channel.
 * - **raw**: validated for shape; passed through with no participantId.
 *
 * Returns an aggregated error if any entry fails to resolve so the LLM can
 * react in one shot rather than getting a stream of single-entry rejections.
 */
export async function resolveRecipients(
  inputs: ResolveRecipientsInputs,
  integration: IntegrationCatalogEntry,
  ctx: ToolContext
): Promise<TypedResult<ResolvedRecipient[], RecipientResolutionError>> {
  const acceptableTypes = identifierTypesForIntegration(integration)
  if (acceptableTypes.length === 0) {
    return Result.error(
      new RecipientResolutionError(
        `Channel ${integration.platform} does not support recipient resolution from input identifiers`,
        '',
        'to'
      )
    )
  }

  const entries: { value: string; role: RecipientRole }[] = []
  for (const v of inputs.to ?? []) entries.push({ value: v, role: 'to' })
  for (const v of inputs.cc ?? []) entries.push({ value: v, role: 'cc' })
  for (const v of inputs.bcc ?? []) entries.push({ value: v, role: 'bcc' })

  const recordIdEntries = entries.filter((e) => detectFormat(e.value) === 'recordId')
  const participantIdEntries = entries.filter((e) => detectFormat(e.value) === 'participantId')

  const instanceIds = recordIdEntries.map(
    (e) => parseRecordId(e.value as RecordId).entityInstanceId
  )
  const participantsByInstance = instanceIds.length
    ? await ctx.db.query.Participant.findMany({
        where: and(
          eq(schema.Participant.organizationId, ctx.organizationId),
          inArray(schema.Participant.entityInstanceId, instanceIds),
          inArray(schema.Participant.identifierType, acceptableTypes as IdentifierType[])
        ),
        orderBy: [desc(schema.Participant.lastSentMessageAt), desc(schema.Participant.updatedAt)],
      })
    : []

  const byInstance = new Map<string, typeof participantsByInstance>()
  for (const p of participantsByInstance) {
    if (!p.entityInstanceId) continue
    const list = byInstance.get(p.entityInstanceId) ?? []
    list.push(p)
    byInstance.set(p.entityInstanceId, list)
  }

  const participantIds = participantIdEntries.map((e) => e.value)
  const participantsById = participantIds.length
    ? await ctx.db.query.Participant.findMany({
        where: and(
          eq(schema.Participant.organizationId, ctx.organizationId),
          inArray(schema.Participant.id, participantIds)
        ),
      })
    : []
  const byId = new Map(participantsById.map((p) => [p.id, p]))

  const resolved: ResolvedRecipient[] = []
  for (const entry of entries) {
    const fmt = detectFormat(entry.value)
    switch (fmt) {
      case 'recordId': {
        const parsed = parseRecordId(entry.value as RecordId)
        const matches = byInstance.get(parsed.entityInstanceId)
        const pick = matches?.[0]
        if (pick) {
          resolved.push({
            recordId: entry.value,
            participantId: pick.id,
            identifier: pick.identifier,
            identifierType: pick.identifierType,
            role: entry.role,
            displayName: pick.displayName ?? pick.name ?? pick.identifier,
          })
          break
        }
        // Fallback: no Participant row yet (brand-new contact with only the
        // identifier set as a field value). Read directly from FieldValue via
        // the contact's primary_email / phone systemAttribute.
        const sysAttr = systemAttributeForChannel(integration)
        if (sysAttr) {
          const identifier = await lookupIdentifierFromFieldValue(
            ctx,
            parsed.entityDefinitionId,
            parsed.entityInstanceId,
            sysAttr.systemAttributes
          )
          if (identifier) {
            resolved.push({
              recordId: entry.value,
              identifier:
                sysAttr.identifierType === 'EMAIL'
                  ? identifier.toLowerCase()
                  : sysAttr.identifierType === 'PHONE'
                    ? identifier.replace(/[\s().-]/g, '')
                    : identifier,
              identifierType: sysAttr.identifierType,
              role: entry.role,
              displayName: identifier,
            })
            break
          }
        }
        return Result.error(
          new RecipientResolutionError(
            `Contact has no ${integration.channel} identifier on file`,
            entry.value,
            entry.role
          )
        )
      }
      case 'participantId': {
        const p = byId.get(entry.value)
        if (!p) {
          return Result.error(
            new RecipientResolutionError(
              `Participant ${entry.value} not found`,
              entry.value,
              entry.role
            )
          )
        }
        if (!acceptableTypes.includes(p.identifierType)) {
          return Result.error(
            new RecipientResolutionError(
              `Participant ${entry.value} is a ${p.identifierType.toLowerCase()} contact, but ${integration.platform} requires ${acceptableTypes.join('/')}`,
              entry.value,
              entry.role
            )
          )
        }
        resolved.push({
          participantId: p.id,
          identifier: p.identifier,
          identifierType: p.identifierType,
          role: entry.role,
          displayName: p.displayName ?? p.name ?? p.identifier,
        })
        break
      }
      case 'email': {
        if (!acceptableTypes.includes('EMAIL')) {
          return Result.error(
            new RecipientResolutionError(
              `Email recipient given but ${integration.platform} expects ${acceptableTypes.join('/')}`,
              entry.value,
              entry.role
            )
          )
        }
        resolved.push({
          identifier: entry.value.trim().toLowerCase(),
          identifierType: 'EMAIL',
          role: entry.role,
        })
        break
      }
      case 'phone': {
        if (!acceptableTypes.includes('PHONE')) {
          return Result.error(
            new RecipientResolutionError(
              `Phone recipient given but ${integration.platform} expects ${acceptableTypes.join('/')}`,
              entry.value,
              entry.role
            )
          )
        }
        resolved.push({
          identifier: entry.value.replace(/[\s().-]/g, ''),
          identifierType: 'PHONE',
          role: entry.role,
        })
        break
      }
      case 'unknown':
        return Result.error(
          new RecipientResolutionError(
            `Could not parse recipient "${entry.value}" — expected recordId (entityDefinitionId:instanceId), participantId (cuid), email, or phone`,
            entry.value,
            entry.role
          )
        )
    }
  }

  return Result.ok(resolved)
}

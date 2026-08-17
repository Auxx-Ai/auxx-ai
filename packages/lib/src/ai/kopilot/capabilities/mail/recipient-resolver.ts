// packages/lib/src/ai/kopilot/capabilities/mail/recipient-resolver.ts

import { schema } from '@auxx/database'
import type { IdentifierType } from '@auxx/database/types'
import { isRecordId, parseRecordId, type RecordId } from '@auxx/types/resource'
import { formatPhoneNumber, type PhoneRegion, regionFromIdentifier } from '@auxx/utils'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { IntegrationCatalogEntry } from '../../../../cache/integration-catalog'
import { getCachedCustomFields } from '../../../../cache/org-cache-helpers'
import {
  identifierFieldsForModel,
  identifierTypesForModel,
} from '../../../../participants/channel-identifier-fields'
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

/**
 * Look up the contact's primary identifier (email/phone) directly on the
 * `FieldValue` table for the relevant `systemAttribute` `CustomField`. This
 * is the canonical place where a contact's email lives — the `Participant`
 * table only has a row when a thread/message has actually been recorded with
 * that contact, which isn't true for brand-new CRM contacts.
 *
 * The primary value is the FIRST row by ascending `sortKey`.
 */
async function lookupIdentifierFromFieldValue(
  ctx: ToolContext,
  entityDefinitionId: string,
  entityInstanceId: string,
  systemAttributes: readonly string[]
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
    orderBy: [asc(schema.FieldValue.sortKey)],
  })
  for (const row of rows) {
    const value = row.valueText?.trim()
    if (value) return value
  }
  return undefined
}

/**
 * Canonical form of a recipient identifier, or `null` when the value is not a
 * valid identifier of that type.
 *
 * 🔴 **Phone goes through `formatPhoneNumber`, never a hand-rolled strip.** This
 * used to be `value.replace(/[\s().-]/g, '')`, which is separator removal and not
 * normalization: E.164 drops the trunk prefix, so `030 901820` became
 * `030901820` where storage and the send both expect `+4930901820`, and
 * `(415) 555-1234` became `4155551234` rather than `+14155551234`. The result was
 * a `Participant.identifier` matching no stored row and an address handed to the
 * channel raw. `formatPhoneNumber` is THE normalizer — the write validator,
 * `normalizeForLookup` and the import resolver all funnel through it
 * specifically so write and lookup cannot drift (`@auxx/utils` `contact.ts`).
 *
 * `region` matters and must come from the SENDING channel's own number
 * (`regionFromIdentifier(integration.identifier)`), not a global default: an org
 * with a German and a US number parses the same national input differently
 * depending on which one it is sending from.
 *
 * Returning `null` rather than a best-effort string is deliberate — an invalid
 * number should reach the LLM as a resolution error it can act on, not become a
 * silently undeliverable send. Compare `normalizeOwnIdentifier`
 * (`channels/own-identities.ts`), which applies the same rule but returns `''`
 * because its contract is "never matches an own identity".
 */
export function normalizeRecipientIdentifier(
  value: string,
  type: IdentifierType,
  region: PhoneRegion
): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (type === 'PHONE') return formatPhoneNumber(trimmed, region)
  if (type === 'EMAIL') return trimmed.toLowerCase()
  // PSIDs / chat-visitor ids are opaque provider tokens — pass through as-is.
  return trimmed
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
 *   `recipientModel`, prefers the one matching the contact's primary
 *   identifier (first FieldValue row by sortKey), else the most recently
 *   used in a stable order (no primary flag exists on `Participant` today).
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
  const acceptableTypes = identifierTypesForModel(integration.recipientModel)
  // Region for national (no `+`) phone input: the sending channel's own number.
  const region = regionFromIdentifier(integration.identifier)
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
        orderBy: [
          desc(schema.Participant.lastSentMessageAt),
          desc(schema.Participant.updatedAt),
          asc(schema.Participant.id),
        ],
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
        // The contact's primary identifier: first FieldValue row by sortKey.
        const sysAttr = identifierFieldsForModel(integration.recipientModel)
        const primaryIdentifier = sysAttr
          ? await lookupIdentifierFromFieldValue(
              ctx,
              parsed.entityDefinitionId,
              parsed.entityInstanceId,
              sysAttr.systemAttributes
            )
          : undefined
        // Prefer the participant matching the primary identifier; otherwise
        // fall back to the stable most-recently-used ordering above.
        //
        // 🔴 Both sides are normalized, not just lowercased. `own-identities.ts`
        // states the rule and the reason: ingest's `normalizeIdentifier(x, PHONE)`
        // is a bare digit-strip, so `+18889155797` and `18889155797` can both
        // exist as stored identifiers while the contact's field value is E.164.
        // A `toLowerCase()` comparison misses that, and the miss is silent — it
        // falls through to `matches[0]` and addresses a DIFFERENT number of the
        // same person.
        const primaryNormalized =
          primaryIdentifier && sysAttr
            ? normalizeRecipientIdentifier(primaryIdentifier, sysAttr.identifierType, region)
            : undefined
        const pick =
          (primaryNormalized &&
            matches?.find(
              (p) =>
                normalizeRecipientIdentifier(p.identifier, p.identifierType, region) ===
                primaryNormalized
            )) ||
          matches?.[0]
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
        // identifier set as a field value). Use the primary identifier read
        // from FieldValue via the contact's primary_email / phone
        // systemAttribute above.
        if (sysAttr && primaryIdentifier) {
          const normalized = normalizeRecipientIdentifier(
            primaryIdentifier,
            sysAttr.identifierType,
            region
          )
          if (!normalized) {
            return Result.error(
              new RecipientResolutionError(
                `Contact's ${integration.channel} identifier "${primaryIdentifier}" is not a valid ${sysAttr.identifierType.toLowerCase()}`,
                entry.value,
                entry.role
              )
            )
          }
          resolved.push({
            recordId: entry.value,
            identifier: normalized,
            identifierType: sysAttr.identifierType,
            role: entry.role,
            // The stored value, not the normalized one — this is the label a
            // human recognizes on the confirmation card.
            displayName: primaryIdentifier,
          })
          break
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
          identifier: normalizeRecipientIdentifier(entry.value, 'EMAIL', region) ?? entry.value,
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
        const normalizedPhone = normalizeRecipientIdentifier(entry.value, 'PHONE', region)
        if (!normalizedPhone) {
          return Result.error(
            new RecipientResolutionError(
              `"${entry.value}" is not a valid phone number${region === 'US' ? '' : ` for region ${region}`} — use E.164 (e.g. +14155551234)`,
              entry.value,
              entry.role
            )
          )
        }
        resolved.push({
          identifier: normalizedPhone,
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

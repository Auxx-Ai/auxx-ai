// packages/lib/src/channels/lifecycle.ts

import { type Database, type IntegrationEntity, schema, type Transaction } from '@auxx/database'
import type { IntegrationProviderType } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, ConflictError, databaseErrorCodes, NotFoundError } from '../errors'
import { InboxService } from '../inboxes/inbox-service'
import { createScopedLogger } from '../logger'
import { OpenPhoneService } from '../providers/openphone/openphone-service'
import { Result, type TypedResult } from '../result'
import type { ChannelCtx, OpenPhoneInput } from './types'

const logger = createScopedLogger('channels.lifecycle')

type DbHandle = Database | Transaction

export interface CreateChannelInput {
  provider: IntegrationProviderType
  name: string
}

/**
 * Create a new Integration row (a "channel") for the org. Returns
 * `ConflictError` when a uniqueness constraint (e.g. same email per org)
 * trips.
 *
 * Pass a `tx` to participate in an outer transaction.
 */
export async function createChannel(
  ctx: ChannelCtx,
  input: CreateChannelInput,
  tx?: Transaction
): Promise<TypedResult<IntegrationEntity, Error>> {
  const db: DbHandle = tx ?? ctx.db
  try {
    const [row] = await db
      .insert(schema.Integration)
      .values({
        organizationId: ctx.organizationId,
        provider: input.provider,
        name: input.name,
        enabled: true,
        updatedAt: new Date(),
      })
      .returning()
    if (!row) {
      return Result.error(new BadRequestError('Failed to create channel'))
    }
    return Result.ok(row)
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === databaseErrorCodes.uniqueViolation) {
      return Result.error(
        new ConflictError(`A ${input.provider} channel with this name already exists`)
      )
    }
    throw error
  }
}

/**
 * Replace the inbox link for a channel. Pass `inboxId: null` to clear the
 * link without re-linking. Validates the integration and inbox belong to the
 * given org.
 */
export async function linkChannelToInbox(
  ctx: ChannelCtx,
  channelId: string,
  inboxId: string | null,
  tx?: Transaction
): Promise<TypedResult<void, Error>> {
  const db: DbHandle = tx ?? ctx.db

  const [integration] = await db
    .select({ id: schema.Integration.id })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.id, channelId),
        eq(schema.Integration.organizationId, ctx.organizationId)
      )
    )
    .limit(1)
  if (!integration) return Result.error(new NotFoundError('Channel not found'))

  if (inboxId) {
    const inbox = await new InboxService(ctx.db, ctx.organizationId).getInboxById(inboxId)
    if (!inbox) return Result.error(new BadRequestError('Inbox not found in this organization'))
  }

  await db
    .delete(schema.InboxIntegration)
    .where(eq(schema.InboxIntegration.integrationId, channelId))

  if (inboxId) {
    await db.insert(schema.InboxIntegration).values({
      inboxId,
      integrationId: channelId,
      isDefault: false,
      updatedAt: new Date(),
    })
  }

  return Result.nil()
}

/**
 * Add an OpenPhone channel for the org. Wraps the provider-specific
 * `OpenPhoneService.addIntegration` so the router doesn't need to
 * instantiate it.
 */
export async function addOpenPhoneChannel(
  ctx: ChannelCtx & { userId: string },
  input: OpenPhoneInput
) {
  logger.info('Attempting to add OpenPhone channel', {
    organizationId: ctx.organizationId,
    phoneNumber: input.phoneNumber,
  })

  const service = new OpenPhoneService(ctx.db, ctx.organizationId, ctx.userId)
  return await service.addIntegration(input)
}

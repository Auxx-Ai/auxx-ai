// packages/lib/src/chat-widget/config.ts

import { type Database, schema } from '@auxx/database'
import { desc, eq } from 'drizzle-orm'
import { getOrgChannelProviderMap } from '../channels/cache'
import { BadRequestError, ConflictError, databaseErrorCodes, NotFoundError } from '../errors'
import { InboxService } from '../inboxes/inbox-service'
import { createScopedLogger } from '../logger'
import { Result, type TypedResult } from '../result'

const logger = createScopedLogger('chat-widget/config')

export interface ServiceContext {
  db: Database
  organizationId: string
}

/** Integration row with the ChatWidget row + inbox linkage attached. */
export type ChatWidgetWithIntegration = NonNullable<Awaited<ReturnType<typeof loadChatWidget>>>

/** Fields callers can update on a chat widget. */
export interface UpdateChatWidgetInput {
  name?: string
  title?: string
  subtitle?: string | null
  primaryColor?: string
  /** Hex color for the Home hero band. Separate from `primaryColor`. */
  headerColor?: string
  logoLight?: string | null
  logoDark?: string | null
  position?: string
  autoOpen?: boolean
  mobileFullScreen?: boolean
  collectUserInfo?: boolean
  offlineMessage?: string | null
  allowedDomains?: string[]
  isActive?: boolean
  inboxId?: string | null
  /** Agent that auto-replies to widget messages. Pass `null` to disable AI auto-reply. */
  agentId?: string | null

  // v2 Home config
  /** Tiptap JSON doc, or `null` to clear. */
  homeGreetingTemplate?: unknown
  homeShowRecentMessage?: boolean
  homeShowSendMessageCta?: boolean
  brandingFooterEnabled?: boolean
  allowDownloadTranscript?: boolean
  /** Pass `null` to unlink the knowledge base. */
  knowledgeBaseId?: string | null
  featuredArticleIds?: string[]

  // Dark mode
  defaultTheme?: 'light' | 'dark' | 'system'
  primaryColorDark?: string | null
  headerColorDark?: string | null

  /** Up to 5 tap-to-send suggestion chips shown above the composer on a fresh thread. */
  suggestedReplies?: string[]
}

/**
 * Get a single chat-widget integration scoped to the org. Returns
 * `NotFoundError` when the integration is missing, not a chat widget, or
 * doesn't belong to the org.
 */
export async function getChatWidget(
  ctx: ServiceContext,
  channelId: string
): Promise<TypedResult<ChatWidgetWithIntegration, Error>> {
  const ownership = await assertChatChannel(ctx, channelId)
  if (ownership.error) return Result.error(ownership.error)

  const integration = await loadChatWidget(ctx.db, channelId)
  if (!integration) return Result.error(new NotFoundError('Chat widget not found'))
  return Result.ok(integration)
}

/** List every chat-widget integration for the org, newest first. */
export async function listChatWidgets(
  ctx: ServiceContext
): Promise<TypedResult<ChatWidgetWithIntegration[], Error>> {
  const channelIds = await getChatChannelIds(ctx)
  if (channelIds.length === 0) return Result.ok([])

  const integrations = await ctx.db.query.Integration.findMany({
    where: (i, { inArray }) => inArray(i.id, channelIds),
    orderBy: (i) => [desc(i.createdAt)],
    with: {
      chatWidget: { with: { operatingHours: true } },
      inboxIntegration: { columns: { inboxId: true } },
    },
  })

  return Result.ok(
    integrations.filter((row): row is ChatWidgetWithIntegration => row.chatWidget !== null)
  )
}

/**
 * Update the integration name, ChatWidget settings, and inbox link in a
 * single transaction. Pass `inboxId: null` to unlink the inbox.
 */
export async function updateChatWidget(
  ctx: ServiceContext,
  channelId: string,
  input: UpdateChatWidgetInput
): Promise<TypedResult<void, Error>> {
  const ownership = await assertChatChannel(ctx, channelId)
  if (ownership.error) return Result.error(ownership.error)

  const widget = await ctx.db.query.ChatWidget.findFirst({
    where: (w, { eq }) => eq(w.integrationId, channelId),
    columns: { id: true },
  })
  if (!widget) return Result.error(new NotFoundError('Chat widget not found'))

  if (input.inboxId) {
    const inbox = await new InboxService(ctx.db, ctx.organizationId).getInboxById(input.inboxId)
    if (!inbox) {
      return Result.error(
        new BadRequestError('Selected inbox not found or does not belong to this organization')
      )
    }
  }

  // v1 of the in-widget KB reader only supports PUBLIC KBs — INTERNAL KBs
  // need the signed-identity flow that doesn't exist yet. Reject the link
  // here so admins get a clear error instead of a confusing 403 in the widget.
  if (input.knowledgeBaseId) {
    const kb = await ctx.db.query.KnowledgeBase.findFirst({
      where: (k, { and, eq }) =>
        and(eq(k.id, input.knowledgeBaseId!), eq(k.organizationId, ctx.organizationId)),
      columns: { id: true, visibility: true },
    })
    if (!kb) {
      return Result.error(
        new BadRequestError('Selected knowledge base not found in this organization')
      )
    }
    if (kb.visibility !== 'PUBLIC') {
      return Result.error(
        new BadRequestError('PUBLIC visibility required for chat widget integration')
      )
    }
  }

  const { name, inboxId, ...widgetData } = input
  const hasInboxKey = Object.hasOwn(input, 'inboxId')

  try {
    await ctx.db.transaction(async (tx) => {
      if (name !== undefined) {
        await tx
          .update(schema.Integration)
          .set({ name, updatedAt: new Date() })
          .where(eq(schema.Integration.id, channelId))
        await tx
          .update(schema.ChatWidget)
          .set({ name, updatedAt: new Date() })
          .where(eq(schema.ChatWidget.id, widget.id))
      }

      const widgetUpdate = Object.fromEntries(
        Object.entries(widgetData).filter(([, v]) => v !== undefined)
      )
      if (Object.keys(widgetUpdate).length > 0) {
        await tx
          .update(schema.ChatWidget)
          .set({ ...widgetUpdate, updatedAt: new Date() })
          .where(eq(schema.ChatWidget.id, widget.id))
      }

      if (hasInboxKey) {
        await tx
          .delete(schema.InboxIntegration)
          .where(eq(schema.InboxIntegration.integrationId, channelId))
        if (inboxId) {
          await tx.insert(schema.InboxIntegration).values({
            inboxId,
            integrationId: channelId,
            isDefault: false,
            updatedAt: new Date(),
          })
        }
      }
    })
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === databaseErrorCodes.uniqueViolation) {
      return Result.error(
        new ConflictError('A chat widget integration with this name already exists')
      )
    }
    logger.error('Failed to update chat widget', { error, channelId })
    throw error
  }

  return Result.nil()
}

/**
 * Validate that `domain` is allowed for this chat widget. An empty allowlist
 * matches any domain.
 */
export async function validateDomain(
  ctx: ServiceContext,
  channelId: string,
  domain: string
): Promise<TypedResult<{ valid: boolean }, Error>> {
  const ownership = await assertChatChannel(ctx, channelId)
  if (ownership.error) return Result.error(ownership.error)

  const widget = await ctx.db.query.ChatWidget.findFirst({
    where: (w, { eq }) => eq(w.integrationId, channelId),
    columns: { allowedDomains: true },
  })
  if (!widget) return Result.error(new NotFoundError('Chat widget not found'))

  const allowed = widget.allowedDomains ?? []
  if (allowed.length === 0) return Result.ok({ valid: true })

  const valid = allowed.some((d) => domain === d || domain.endsWith(`.${d}`))
  return Result.ok({ valid })
}

/** Verify `channelId` is a chat-provider integration in the org, via the org cache. */
async function assertChatChannel(
  ctx: ServiceContext,
  channelId: string
): Promise<TypedResult<void, Error>> {
  const providers = await getOrgChannelProviderMap(ctx.organizationId, ctx.db)
  if (providers.get(channelId) !== 'chat') {
    return Result.error(new NotFoundError('Chat widget not found'))
  }
  return Result.nil()
}

/** All chat-provider channel ids in the org, from the org cache. */
async function getChatChannelIds(ctx: ServiceContext): Promise<string[]> {
  const providers = await getOrgChannelProviderMap(ctx.organizationId, ctx.db)
  const ids: string[] = []
  for (const [id, provider] of providers) {
    if (provider === 'chat') ids.push(id)
  }
  return ids
}

async function loadChatWidget(db: Database, channelId: string) {
  return db.query.Integration.findFirst({
    where: (i, { eq }) => eq(i.id, channelId),
    with: {
      chatWidget: { with: { operatingHours: true } },
      inboxIntegration: { columns: { inboxId: true } },
    },
  })
}

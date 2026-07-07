// src/server/api/routers/channel.ts

import { insertCredential, splitSensitiveFields } from '@auxx/credentials/store'
import { type Database, schema } from '@auxx/database'
import { getCachedAgentById, onCacheEvent } from '@auxx/lib/cache'
import {
  addExcludedSender as addExcludedSenderToChannel,
  assertSharedConnectInbox,
  channelProviderKey,
  countBillableChannels,
  createChannel,
  disconnect as disconnectChannel,
  getAllStats,
  getSettings as getChannelSettings,
  getProviderType,
  linkChannelToInbox,
  list as listChannels,
  requireChannelManageAccess,
  resolveChannelDefinitionId,
  supportsPersonalChannelConnection,
  syncAllMessages,
  syncMessages,
  toggle as toggleChannel,
  updateAllowedSenders,
  updateSettings as updateChannelSettings,
} from '@auxx/lib/channels'
import { getChatJwtSuccessCount } from '@auxx/lib/chat'
import {
  getChatWidget,
  type UpdateChatWidgetInput,
  updateChatWidget,
} from '@auxx/lib/chat-widget/config'
import { resolveOwnClientRequirement } from '@auxx/lib/connections'
import { getUserOrganizationId, requireAdminAccess } from '@auxx/lib/email'
import { SyncMessages } from '@auxx/lib/messages'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import type { ImapCredentialData } from '@auxx/lib/providers'
import { ImapClientProvider, ImapSmtpSendService, LdapAuthService } from '@auxx/lib/providers'
import { fanOutAuxxChatAudienceToShopify } from '@auxx/lib/shopify'
import { widgetSchema as chatWidgetInputSchema } from '@auxx/lib/widgets/types'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, count, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { adminProcedure, createTRPCRouter, notDemo, protectedProcedure } from '../trpc'

const logger = createScopedLogger('channel-router')

/** Check channel limit before creating a new integration */
async function checkChannelLimit(db: Database, organizationId: string) {
  const featureService = new FeaturePermissionService(db)
  const limit = await featureService.getLimit(organizationId, FeatureKey.channels)
  if (typeof limit === 'number' && limit >= 0) {
    const current = await countBillableChannels(db, organizationId)
    if (current >= limit) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `You have reached your channel limit (${limit}). Upgrade your plan to connect more channels.`,
      })
    }
  }
}

/**
 * Default Tiptap document seeded into `ChatWidget.welcomeMessageTemplate` on
 * channel create. Plain prose — the widget's `WelcomeBubble` resolves the
 * sender identity (agent name / org fallback) separately. Admins can edit
 * the doc and add `visitor:*` placeholders via the appearance section.
 */
function defaultWelcomeMessageTemplate() {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hi there! How can I help you today?' }],
      },
    ],
  }
}

export const channelRouter = createTRPCRouter({
  /**
   * Prepare a Gmail/Outlook connect via the unified connections OAuth flow. Enforces
   * admin + channel-limit, then returns the generic authorize URL plus the platform-client
   * approval gate (§3.1) so the UI knows whether to collect a bring-your-own OAuth client.
   *
   * Personal connects (mail-permissions §11.1) are open to every member —
   * the account is theirs; the channel limit still applies. The provider must
   * support personal connection (fail closed, the authorize route re-checks).
   */
  prepareConnect: protectedProcedure
    .input(
      z.object({
        provider: z.enum(['google', 'outlook', 'facebook', 'instagram']),
        personal: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)

      const PROVIDER_KEY_BY_CHANNEL = {
        google: 'gmail',
        outlook: 'outlookMail',
        facebook: 'facebook',
        instagram: 'instagram',
      } as const
      const providerKey = PROVIDER_KEY_BY_CHANNEL[input.provider]
      const supportsPersonal = supportsPersonalChannelConnection(providerKey)

      if (input.personal) {
        if (!supportsPersonal) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This channel cannot be connected as a personal account',
          })
        }
      } else {
        await requireAdminAccess(userId, organizationId)
      }
      await checkChannelLimit(ctx.db, organizationId)
      const def = await ctx.db.query.ConnectionDefinition.findFirst({
        where: (cd, { eq }) => eq(cd.providerKey, providerKey),
        columns: { oauth2ClientId: true, oauth2ClientSecret: true, platformClientApproved: true },
      })
      if (!def) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Connection definition ${providerKey} not found`,
        })
      }

      const gate = resolveOwnClientRequirement(def)
      return {
        providerKey,
        authorizeUrl: `/api/connections/${providerKey}/oauth2/authorize`,
        requiresOwnClient: gate.requiresOwnClient,
        ownClientReason: gate.reason,
        supportsPersonalConnection: supportsPersonal,
      }
    }),

  /**
   * Get all configured integrations for the organization.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    // Passing userId hides other members' personal channels from non-admins.
    return listChannels({ db: ctx.db, organizationId, userId: ctx.session.userId })
  }),

  /**
   * Disconnects an integration.
   */
  disconnect: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .use(notDemo('disconnect email integrations'))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      // Admin, or the owner of this personal channel.
      await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)

      const result = await disconnectChannel(
        { db: ctx.db, organizationId, userId },
        input.integrationId
      )
      if (!result.ok) throw result.error

      await onCacheEvent('channel.disconnected', { orgId: organizationId })

      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'integration.disconnected',
        targetType: 'Channel',
        targetId: input.integrationId,
      })

      return result.value
    }),

  /**
   * Enable/disable an integration.
   */
  toggle: protectedProcedure
    .input(z.object({ integrationId: z.string(), enabled: z.boolean() }))
    .use(notDemo('toggle email integrations'))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)

      const result = await toggleChannel(
        { db: ctx.db, organizationId, userId },
        input.integrationId,
        input.enabled
      )
      if (!result.ok) throw result.error
      return result.value
    }),

  /**
   * Manually trigger message synchronization for a specific integration.
   */
  syncMessages: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
        days: z.number().min(1).max(90).default(30),
      })
    )
    .use(notDemo('sync messages'))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)

      const result = await syncMessages(
        { db: ctx.db, organizationId, userId },
        input.integrationId,
        input.days
      )
      if (!result.ok) throw result.error
      return result.value
    }),

  // Note: Statistics endpoints (`getAllEmailStats`, `getEmailStats`) are removed for now.
  // They need significant rework to handle the generic `Message` model and potentially
  // different ways of categorizing messages (e.g., `emailLabel` might not apply to SMS).
  // A new stats endpoint can be added later based on the `Message` and `Thread` models.

  /**
   * Manually triggers sync for all enabled integrations.
   */
  syncAllMessages: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(7) }))
    .use(notDemo('sync all messages'))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      return syncAllMessages({ db: ctx.db, organizationId, userId }, input.days)
    }),

  /**
   * Add a new Chat Widget Integration.
   */
  addChatWidgetIntegration: protectedProcedure
    .use(notDemo('add chat widgets'))
    .input(
      z.object({
        name: z.string().min(1, 'Widget name is required'),
        title: chatWidgetInputSchema.shape.title,
        subtitle: chatWidgetInputSchema.shape.subtitle.optional(),
        primaryColor: chatWidgetInputSchema.shape.primaryColor.optional(),
        logoLight: chatWidgetInputSchema.shape.logoLight.optional(),
        logoDark: chatWidgetInputSchema.shape.logoDark.optional(),
        position: chatWidgetInputSchema.shape.position.optional(),
        autoOpen: chatWidgetInputSchema.shape.autoOpen.optional(),
        mobileFullScreen: chatWidgetInputSchema.shape.mobileFullScreen.optional(),
        collectUserInfo: chatWidgetInputSchema.shape.collectUserInfo.optional(),
        offlineMessage: chatWidgetInputSchema.shape.offlineMessage.optional(),
        allowedDomains: chatWidgetInputSchema.shape.allowedDomains.optional(),
        // Inbox-first (channels v2): a new chat channel requires a validated shared inbox.
        inboxId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      await checkChannelLimit(ctx.db, organizationId)
      await assertSharedConnectInbox(ctx.db, organizationId, input.inboxId)

      const serviceCtx = { db: ctx.db, organizationId }
      const { inboxId, ...widgetConfig } = input

      const integrationId = await ctx.db.transaction(async (tx) => {
        const channelResult = await createChannel(
          serviceCtx,
          { provider: 'chat', name: widgetConfig.name },
          tx
        )
        if (!channelResult.ok) throw channelResult.error
        const integration = channelResult.value

        await tx.insert(schema.ChatWidget).values({
          organizationId,
          integrationId: integration.id,
          name: widgetConfig.name,
          title: widgetConfig.title,
          subtitle: widgetConfig.subtitle,
          primaryColor: widgetConfig.primaryColor,
          logoLight: widgetConfig.logoLight,
          logoDark: widgetConfig.logoDark,
          position: widgetConfig.position,
          autoOpen: widgetConfig.autoOpen,
          mobileFullScreen: widgetConfig.mobileFullScreen,
          collectUserInfo: widgetConfig.collectUserInfo,
          offlineMessage: widgetConfig.offlineMessage,
          allowedDomains: widgetConfig.allowedDomains ?? [],
          isActive: true,
          updatedAt: new Date(),
        })

        if (inboxId) {
          const linkResult = await linkChannelToInbox(serviceCtx, integration.id, inboxId, tx)
          if (!linkResult.ok) throw linkResult.error
        }

        return integration.id
      })

      await onCacheEvent('channel.connected', { orgId: organizationId })

      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'integration.connected',
        targetType: 'Channel',
        targetId: integrationId,
        metadata: { provider: 'chat', name: input.name },
      })

      return { success: true, integrationId }
    }),

  /**
   * Update an existing Chat Widget Integration.
   */
  updateChatWidgetIntegration: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
        name: z.string().min(1, 'Widget name is required').optional(),
        title: chatWidgetInputSchema.shape.title.optional(),
        subtitle: chatWidgetInputSchema.shape.subtitle.optional(),
        primaryColor: chatWidgetInputSchema.shape.primaryColor.optional(),
        headerColor: z
          .string()
          .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a valid hex color')
          .optional()
          .nullable(),
        logoLight: chatWidgetInputSchema.shape.logoLight.optional(),
        logoDark: chatWidgetInputSchema.shape.logoDark.optional(),
        position: chatWidgetInputSchema.shape.position.optional(),
        autoOpen: chatWidgetInputSchema.shape.autoOpen.optional(),
        mobileFullScreen: chatWidgetInputSchema.shape.mobileFullScreen.optional(),
        collectUserInfo: chatWidgetInputSchema.shape.collectUserInfo.optional(),
        offlineMessage: chatWidgetInputSchema.shape.offlineMessage.optional(),
        allowedDomains: chatWidgetInputSchema.shape.allowedDomains.optional(),
        isActive: z.boolean().optional(),
        inboxId: z.string().optional().nullable(),
        agentId: z.string().optional().nullable(),

        // v2 Home config
        homeGreetingTemplate: z.unknown().optional(),
        /** v3 — synthetic welcome bubble Tiptap doc. Null clears. */
        welcomeMessageTemplate: z.unknown().optional(),
        homeShowRecentMessage: z.boolean().optional(),
        homeShowSendMessageCta: z.boolean().optional(),
        brandingFooterEnabled: z.boolean().optional(),
        allowDownloadTranscript: z.boolean().optional(),
        knowledgeBaseId: z.string().optional().nullable(),
        featuredArticleIds: z.array(z.string()).optional(),

        // Dark mode
        defaultTheme: z.enum(['light', 'dark', 'system']).optional(),
        primaryColorDark: z.string().optional().nullable(),
        headerColorDark: z.string().optional().nullable(),

        // v3 conversation polish
        suggestedReplies: z
          .array(z.string().trim().max(80))
          .max(5)
          .transform((arr) => arr.filter((s) => s.length > 0))
          .optional(),

        // v3 privacy banner
        privacyPolicyUrl: z
          .union([z.httpUrl().max(2048), z.literal('').transform(() => null), z.null()])
          .optional(),

        // v4 phase 9 — channel audience + JWT rollout stage. Live on the same
        // mutation as the rest of the chat-widget fields; the Redis safety
        // rail on `enforced` is inlined below.
        chatAudience: z.enum(['visitors', 'both', 'users']).optional(),
        identityVerification: z.enum(['off', 'in_progress', 'enforced']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      const { integrationId, ...updateData } = input

      // Only chat-kind agents can answer visitor chat. Reject a bind to an
      // internal agent so phase 3's runtime never has to defend against a
      // mis-bound widget. See plans/chat/v5 phase-2 §9.
      if (updateData.agentId) {
        const agent = await getCachedAgentById(organizationId, updateData.agentId)
        if (!agent) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
        }
        if (agent.kind !== 'chat') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'AGENT_NOT_CHAT_KIND: Only chat agents can be bound to a chat widget.',
          })
        }
      }

      // Safety rail for `in_progress → enforced`: require at least one
      // successfully-verified JWT inside the success-counter TTL before the
      // transition is accepted. Lives at the procedure layer so the
      // updateChatWidget service stays a pure field-level updater with no
      // Redis dependency.
      if (updateData.identityVerification === 'enforced') {
        const successCount = await getChatJwtSuccessCount(integrationId)
        if (successCount === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'No valid JWT requests seen yet — install the SDK and pass a userJwt to Auxx.boot before enforcing.',
          })
        }
      }

      const result = await updateChatWidget(
        { db: ctx.db, organizationId },
        integrationId,
        updateData as UpdateChatWidgetInput
      )
      if (!result.ok) throw result.error

      // Phase 2 (Shopify) — when chatAudience changes, fan out the new value
      // to the auxx.chat_audience shop metafield on every Shopify install
      // bound to this channel. Best-effort; helper logs and swallows per-shop
      // failures.
      if (updateData.chatAudience) {
        try {
          await fanOutAuxxChatAudienceToShopify({
            channelId: integrationId,
            audience: updateData.chatAudience,
          })
        } catch (error) {
          logger.error('fanOutAuxxChatAudienceToShopify threw', {
            error,
            channelId: integrationId,
          })
        }
      }

      return { success: true }
    }),

  /**
   * Read the per-channel JWT-success counter that gates the
   * `in_progress → enforced` transition. The admin UI uses this to disable
   * the Enforce button (with a tooltip) until at least one valid JWT has
   * been seen.
   */
  getChatIdentityState: protectedProcedure
    .input(z.object({ channelId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      const widgetResult = await getChatWidget({ db: ctx.db, organizationId }, input.channelId)
      if (!widgetResult.ok) throw widgetResult.error
      const widget = widgetResult.value
      const successCount = await getChatJwtSuccessCount(input.channelId)
      return {
        state: (widget.chatWidget?.identityVerification ?? 'off') as
          | 'off'
          | 'in_progress'
          | 'enforced',
        audience: (widget.chatWidget?.chatAudience ?? 'visitors') as 'visitors' | 'both' | 'users',
        successCount,
      }
    }),

  /**
   * Create a Chat Widget channel with sensible defaults — used by the
   * "Add Channel" flow to skip the up-front form. Caller redirects to
   * /app/settings/channels/[id] for editing.
   */
  createChatChannel: protectedProcedure
    .use(notDemo('create chat widgets'))
    // Inbox-first (channels v2): the destination inbox is chosen in the gallery before create.
    // An optional name overrides the auto-generated "Chat Widget N".
    .input(z.object({ inboxId: z.string().min(1), name: z.string().trim().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      await checkChannelLimit(ctx.db, organizationId)
      await assertSharedConnectInbox(ctx.db, organizationId, input.inboxId)

      const existingCount = await ctx.db
        .select({ value: count() })
        .from(schema.ChatWidget)
        .where(eq(schema.ChatWidget.organizationId, organizationId))
      const suffix = (existingCount[0]?.value ?? 0) + 1
      const widgetName = input.name ?? (suffix > 1 ? `Chat Widget ${suffix}` : 'Chat Widget')

      const serviceCtx = { db: ctx.db, organizationId }

      const channelId = await ctx.db.transaction(async (tx) => {
        const channelResult = await createChannel(
          serviceCtx,
          { provider: 'chat', name: widgetName },
          tx
        )
        if (!channelResult.ok) throw channelResult.error
        const integration = channelResult.value

        await tx.insert(schema.ChatWidget).values({
          organizationId,
          integrationId: integration.id,
          name: widgetName,
          title: 'Chat',
          primaryColor: '#4F46E5',
          position: 'BOTTOM_RIGHT',
          isActive: true,
          allowedDomains: [],
          autoOpen: false,
          mobileFullScreen: true,
          collectUserInfo: true,
          suggestedReplies: ['Product question', 'Get help', 'Talk to sales'],
          welcomeMessageTemplate: defaultWelcomeMessageTemplate(),
          updatedAt: new Date(),
        })

        const linkResult = await linkChannelToInbox(serviceCtx, integration.id, input.inboxId, tx)
        if (!linkResult.ok) throw linkResult.error

        return integration.id
      })

      await onCacheEvent('channel.connected', { orgId: organizationId })

      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'integration.connected',
        targetType: 'Channel',
        targetId: channelId,
        metadata: { provider: 'chat', name: widgetName },
      })

      return { channelId }
    }),

  /**
   * Get details for a specific Chat Widget Integration.
   */
  getChatWidgetIntegration: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      const result = await getChatWidget({ db: ctx.db, organizationId }, input.integrationId)
      if (!result.ok) throw result.error
      return result.value
    }),

  getProviderType: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      const result = await getProviderType({ db: ctx.db, organizationId }, input.integrationId)
      if (!result.ok) throw result.error
      return result.value
    }),

  /**
   * Update integration settings.
   */
  updateSettings: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
        settings: z.object({
          recordCreation: z
            .object({
              mode: z.enum(['all', 'selective', 'none']),
            })
            .optional(),
          excludeSenders: z.array(z.string().toLowerCase().trim()).optional(),
          excludeRecipients: z.array(z.string().toLowerCase().trim()).optional(),
          onlyProcessRecipients: z.array(z.string().toLowerCase().trim()).optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)

      const result = await updateChannelSettings(
        { db: ctx.db, organizationId, userId },
        input.integrationId,
        input.settings
      )
      if (!result.ok) throw result.error
      return result.value
    }),
  /**
   * Update allowed senders for a forwarding integration.
   */
  updateAllowedSenders: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
        allowedSenders: z.array(z.string().email()).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      const result = await updateAllowedSenders(
        { db: ctx.db, organizationId, userId },
        input.integrationId,
        input.allowedSenders
      )
      if (!result.ok) throw result.error
      return result.value
    }),

  /**
   * Add an email or domain to the excluded senders list.
   */
  addExcludedSender: adminProcedure
    .input(
      z.object({
        integrationId: z.string(),
        entry: z.string().toLowerCase().trim(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      const result = await addExcludedSenderToChannel(
        { db: ctx.db, organizationId, userId },
        input.integrationId,
        input.entry
      )
      if (!result.ok) throw result.error
      return result.value
    }),

  /**
   * Remove an email or domain from the excluded senders list.
   */
  removeExcludedSender: adminProcedure
    .input(
      z.object({
        integrationId: z.string(),
        entry: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      const ctx2 = { db: ctx.db, organizationId, userId }
      const currentResult = await getChannelSettings(ctx2, input.integrationId)
      if (!currentResult.ok) throw currentResult.error
      const existing = currentResult.value?.excludeSenders ?? []
      const updateResult = await updateChannelSettings(ctx2, input.integrationId, {
        excludeSenders: existing.filter((e: string) => e !== input.entry),
      })
      if (!updateResult.ok) throw updateResult.error
      return updateResult.value
    }),

  /**
   * Get message statistics across all providers for the organization.
   */
  getAllEmailStats: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    return getAllStats({ db: ctx.db, organizationId })
  }),

  startSync: protectedProcedure
    .input(
      z.object({
        // integrationId is now optional in the input
        integrationId: z.string().optional(),
        since: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { since, integrationId } = input
      const { userId, organizationId } = ctx.session

      const syncer = new SyncMessages(ctx.db, organizationId, userId)
      return await syncer.sync({ integrationId, since })
    }),

  /**
   * Connect an IMAP/SMTP email server.
   * Tests connections, encrypts credentials, creates integration.
   */
  connectImap: protectedProcedure
    .use(notDemo('connect IMAP email'))
    .input(
      z
        .object({
          email: z.string().email(),
          // Inbox-first (channels v2): IMAP now links its destination inbox at connect
          // time (it previously linked none). Required + validated below.
          inboxId: z.string().min(1),
          authMode: z.enum(['direct', 'ldap']),
          imapHost: z.string().min(1),
          imapPort: z.coerce.number().int().min(1).max(65535).default(993),
          imapSecure: z.boolean().default(true),
          imapUsername: z.string().min(1),
          imapPassword: z.string().min(1),
          imapAllowUnauthorizedCerts: z.boolean().default(false),
          smtpHost: z.string().min(1),
          smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
          smtpSecure: z.boolean().default(false),
          smtpSameCredentials: z.boolean().default(true),
          smtpUsername: z.string().optional(),
          smtpPassword: z.string().optional(),
          smtpAllowUnauthorizedCerts: z.boolean().default(false),
          ldapUrl: z.string().optional(),
          ldapBindDN: z.string().optional(),
          ldapBindPassword: z.string().optional(),
          ldapSearchBase: z.string().optional(),
          ldapSearchFilter: z.string().optional().default('(mail={{email}})'),
          ldapUsernameAttribute: z.string().optional().default('uid'),
          ldapEmailAttribute: z.string().optional().default('mail'),
          ldapAllowUnauthorizedCerts: z.boolean().default(false),
        })
        .refine(
          (data) => {
            if (!data.smtpSameCredentials) {
              return !!data.smtpUsername && !!data.smtpPassword
            }
            return true
          },
          {
            message: 'SMTP username and password are required when not using IMAP credentials',
            path: ['smtpUsername'],
          }
        )
        .refine(
          (data) => {
            if (data.authMode === 'ldap') {
              return (
                !!data.ldapUrl &&
                !!data.ldapBindDN &&
                !!data.ldapBindPassword &&
                !!data.ldapSearchBase
              )
            }
            return true
          },
          {
            message: 'LDAP fields are required when using LDAP authentication',
            path: ['ldapUrl'],
          }
        )
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)
      await checkChannelLimit(ctx.db, organizationId)
      // Validate the chosen inbox up-front (fail before minting a credential / testing servers).
      await assertSharedConnectInbox(ctx.db, organizationId, input.inboxId)

      const credentialData: ImapCredentialData = {
        authMode: input.authMode,
        imap: {
          host: input.imapHost,
          port: input.imapPort,
          secure: input.imapSecure,
          username: input.imapUsername,
          password: input.imapPassword,
          allowUnauthorizedCerts: input.imapAllowUnauthorizedCerts,
        },
        smtp: {
          host: input.smtpHost,
          port: input.smtpPort,
          secure: input.smtpSecure,
          username: input.smtpSameCredentials ? input.imapUsername : input.smtpUsername!,
          password: input.smtpSameCredentials ? input.imapPassword : input.smtpPassword!,
          allowUnauthorizedCerts: input.smtpAllowUnauthorizedCerts,
        },
        ldap:
          input.authMode === 'ldap'
            ? {
                url: input.ldapUrl!,
                bindDN: input.ldapBindDN!,
                bindPassword: input.ldapBindPassword!,
                searchBase: input.ldapSearchBase!,
                searchFilter: input.ldapSearchFilter || '(mail={{email}})',
                usernameAttribute: input.ldapUsernameAttribute || 'uid',
                emailAttribute: input.ldapEmailAttribute || 'mail',
                allowUnauthorizedCerts: input.ldapAllowUnauthorizedCerts,
              }
            : undefined,
      }

      // Test IMAP connection
      const clientProvider = new ImapClientProvider()
      const client = await clientProvider.getClient(credentialData)
      await clientProvider.closeClient(client)

      // Test SMTP connection
      const smtpService = new ImapSmtpSendService()
      await smtpService.initialize(credentialData)
      const smtpOk = await smtpService.verify()
      await smtpService.close()
      if (!smtpOk) throw new Error('SMTP connection failed')

      // Test LDAP if applicable
      if (credentialData.authMode === 'ldap' && credentialData.ldap) {
        const ldapService = new LdapAuthService()
        const ldapResult = await ldapService.testConnection(credentialData.ldap)
        if (!ldapResult.success) throw new Error(`LDAP: ${ldapResult.message}`)
      }

      // Encrypt and store credentials. Object-valued fields (imap/smtp/ldap
      // bags) land in secrets wholesale; scalar non-secrets in metadata.
      const imapProviderKey = channelProviderKey('imap')
      const created = await insertCredential({
        organizationId,
        createdById: userId,
        kind: 'connection',
        type: imapProviderKey,
        connectionDefinitionId: await resolveChannelDefinitionId(ctx.db, imapProviderKey),
        name: `IMAP - ${input.email}`,
        ...splitSensitiveFields(credentialData as Record<string, unknown>),
      })
      if (created.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to save IMAP credentials: ${created.error.message}`,
        })
      }
      const credentialId = created.value.id

      // Create integration record + link its inbox (inbox-first: linked immediately, no
      // post-hoc routing-tab step).
      const [integration] = await ctx.db
        .insert(schema.Integration)
        .values({
          organizationId,
          provider: 'imap',
          email: input.email,
          name: input.email,
          credentialId,
          syncMode: 'auto',
          syncStage: 'IDLE',
          syncStatus: 'NOT_SYNCED',
          updatedAt: new Date(),
        })
        .returning()

      const linkResult = await linkChannelToInbox(
        { db: ctx.db, organizationId },
        integration.id,
        input.inboxId
      )
      if (!linkResult.ok) throw linkResult.error

      await onCacheEvent('channel.connected', { orgId: organizationId })

      return { integrationId: integration.id }
    }),

  /**
   * Reset sync state for a stuck integration.
   * Clears throttle, resets stage to IDLE, and optionally clears lastHistoryId for full re-sync.
   */
  resetSyncState: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
        fullResync: z.boolean().default(false),
      })
    )
    .use(notDemo('reset sync state'))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)

      // Verify integration belongs to this org
      const [integration] = await ctx.db
        .select({ id: schema.Integration.id, syncStage: schema.Integration.syncStage })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, input.integrationId),
            eq(schema.Integration.organizationId, organizationId),
            isNull(schema.Integration.deletedAt)
          )
        )
        .limit(1)

      if (!integration) {
        throw new Error('Integration not found')
      }

      // Clear Redis import cache (both main and processing sets)
      const { clearImportCache } = await import('@auxx/lib/email/polling-import-cache')
      await clearImportCache(input.integrationId)

      // Reset sync state
      const updateData: Record<string, any> = {
        syncStage: 'IDLE',
        syncStatus: 'ACTIVE',
        syncStageStartedAt: null,
        throttleFailureCount: 0,
        throttleRetryAfter: null,
        updatedAt: new Date(),
      }

      if (input.fullResync) {
        updateData.lastHistoryId = null
      }

      await ctx.db
        .update(schema.Integration)
        .set(updateData)
        .where(eq(schema.Integration.id, input.integrationId))

      logger.info('Admin reset sync state', {
        integrationId: input.integrationId,
        fullResync: input.fullResync,
        previousStage: integration.syncStage,
        userId,
      })

      return { success: true }
    }),

  /**
   * Test IMAP/SMTP/LDAP connection without saving.
   */
  testImapConnection: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        authMode: z.enum(['direct', 'ldap']),
        imapHost: z.string().min(1),
        imapPort: z.coerce.number().int().min(1).max(65535).default(993),
        imapSecure: z.boolean().default(true),
        imapUsername: z.string().min(1),
        imapPassword: z.string().min(1),
        imapAllowUnauthorizedCerts: z.boolean().default(false),
        smtpHost: z.string().min(1),
        smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
        smtpSecure: z.boolean().default(false),
        smtpSameCredentials: z.boolean().default(true),
        smtpUsername: z.string().optional(),
        smtpPassword: z.string().optional(),
        smtpAllowUnauthorizedCerts: z.boolean().default(false),
        ldapUrl: z.string().optional(),
        ldapBindDN: z.string().optional(),
        ldapBindPassword: z.string().optional(),
        ldapSearchBase: z.string().optional(),
        ldapSearchFilter: z.string().optional(),
        ldapUsernameAttribute: z.string().optional(),
        ldapEmailAttribute: z.string().optional(),
        ldapAllowUnauthorizedCerts: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      const results = { imap: false, smtp: false, ldap: true }

      const credentialData: ImapCredentialData = {
        authMode: input.authMode,
        imap: {
          host: input.imapHost,
          port: input.imapPort,
          secure: input.imapSecure,
          username: input.imapUsername,
          password: input.imapPassword,
          allowUnauthorizedCerts: input.imapAllowUnauthorizedCerts,
        },
        smtp: {
          host: input.smtpHost,
          port: input.smtpPort,
          secure: input.smtpSecure,
          username: input.smtpSameCredentials ? input.imapUsername : (input.smtpUsername ?? ''),
          password: input.smtpSameCredentials ? input.imapPassword : (input.smtpPassword ?? ''),
          allowUnauthorizedCerts: input.smtpAllowUnauthorizedCerts,
        },
        ldap:
          input.authMode === 'ldap' && input.ldapUrl
            ? {
                url: input.ldapUrl,
                bindDN: input.ldapBindDN ?? '',
                bindPassword: input.ldapBindPassword ?? '',
                searchBase: input.ldapSearchBase ?? '',
                searchFilter: input.ldapSearchFilter || '(mail={{email}})',
                usernameAttribute: input.ldapUsernameAttribute || 'uid',
                emailAttribute: input.ldapEmailAttribute || 'mail',
                allowUnauthorizedCerts: input.ldapAllowUnauthorizedCerts,
              }
            : undefined,
      }

      // Test IMAP
      try {
        const clientProvider = new ImapClientProvider()
        const imapClient = await clientProvider.getClient(credentialData)
        await clientProvider.closeClient(imapClient)
        results.imap = true
      } catch {
        /* results.imap stays false */
      }

      // Test SMTP
      try {
        const smtpService = new ImapSmtpSendService()
        await smtpService.initialize(credentialData)
        results.smtp = await smtpService.verify()
        await smtpService.close()
      } catch {
        /* results.smtp stays false */
      }

      // Test LDAP (if applicable)
      if (input.authMode === 'ldap') {
        results.ldap = false
        try {
          if (credentialData.ldap) {
            const ldapService = new LdapAuthService()
            const result = await ldapService.testConnection(credentialData.ldap)
            results.ldap = result.success
          }
        } catch {
          /* results.ldap stays false */
        }
      }

      return results
    }),
})

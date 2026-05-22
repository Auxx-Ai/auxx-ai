// src/server/api/routers/channel.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { ConfigStorage, CredentialService, configService } from '@auxx/credentials'
import { type Database, database, schema } from '@auxx/database'
import { onCacheEvent, storeOAuthCsrfToken } from '@auxx/lib/cache'
import {
  addExcludedSender as addExcludedSenderToChannel,
  addOpenPhoneChannel,
  createChannel,
  disconnect as disconnectChannel,
  getAllStats,
  getAuthUrl,
  getSettings as getChannelSettings,
  getProviderType,
  linkChannelToInbox,
  list as listChannels,
  syncAllMessages,
  syncMessages,
  toggle as toggleChannel,
  updateAllowedSenders,
  updateSettings as updateChannelSettings,
} from '@auxx/lib/channels'
import {
  getChatWidget,
  type UpdateChatWidgetInput,
  updateChatWidget,
} from '@auxx/lib/chat-widget/config'
import { getUserOrganizationId, requireAdminAccess } from '@auxx/lib/email'
import { SyncMessages } from '@auxx/lib/messages'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import type { ImapCredentialData } from '@auxx/lib/providers'
import {
  ImapClientProvider,
  ImapSmtpSendService,
  LdapAuthService,
  PROVIDER_CREDENTIAL_CONFIG,
} from '@auxx/lib/providers'
import { widgetSchema as chatWidgetInputSchema } from '@auxx/lib/widgets/types'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, count, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, notDemo, protectedProcedure } from '../trpc'

const logger = createScopedLogger('channel-router')

/** Check channel limit before creating a new integration */
async function checkChannelLimit(db: Database, organizationId: string) {
  const featureService = new FeaturePermissionService(db)
  const limit = await featureService.getLimit(organizationId, FeatureKey.channels)
  if (typeof limit === 'number' && limit >= 0) {
    const [{ value: current }] = await db
      .select({ value: count() })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, organizationId),
          isNull(schema.Integration.deletedAt)
        )
      )
    if (current >= limit) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `You have reached your channel limit (${limit}). Upgrade your plan to connect more channels.`,
      })
    }
  }
}

// Define supported provider types, removed 'mailgun'
const SupportedProviderTypes = [
  'google',
  'outlook',
  'facebook',
  'instagram',
  'openphone',
  'chat',
] as const // Add future types here
const IntegrationProviderTypeEnum = z.enum(SupportedProviderTypes)

export const channelRouter = createTRPCRouter({
  /**
   * Get OAuth URL for Google or Outlook.
   */
  getAuthUrl: protectedProcedure
    .input(
      z.object({
        redirectPath: z.string().optional(),
        provider: IntegrationProviderTypeEnum,
      })
    )
    .use(notDemo('connect email integrations'))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)

      await requireAdminAccess(userId, organizationId)

      await checkChannelLimit(ctx.db, organizationId)

      const authUrlResult = await getAuthUrl(
        { db: ctx.db, organizationId, userId },
        input.provider as any,
        input.redirectPath
      )
      if (!authUrlResult.ok) throw authUrlResult.error

      // Store CSRF token in Redis for callback verification
      await storeOAuthCsrfToken(userId, authUrlResult.value.csrfToken)

      return { authUrl: authUrlResult.value.authUrl }
    }),

  /**
   * Get all configured integrations for the organization.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    return listChannels({ db: ctx.db, organizationId })
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
      await requireAdminAccess(userId, organizationId)

      const result = await disconnectChannel(
        { db: ctx.db, organizationId, userId },
        input.integrationId
      )
      if (!result.ok) throw result.error

      await onCacheEvent('channel.disconnected', { orgId: organizationId })

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
      await requireAdminAccess(userId, organizationId)

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
      await requireAdminAccess(userId, organizationId)

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

  addOpenPhoneIntegration: protectedProcedure
    .input(
      z.object({
        apiKey: z.string().min(10),
        phoneNumberId: z.string().min(5),
        phoneNumber: z.string().min(10),
        webhookSigningSecret: z.string().min(16),
      })
    )
    .use(notDemo('connect OpenPhone'))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      await checkChannelLimit(ctx.db, organizationId)

      const result = await addOpenPhoneChannel({ db: ctx.db, organizationId, userId }, input)

      await onCacheEvent('channel.connected', { orgId: organizationId })

      return result
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
        inboxId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      await checkChannelLimit(ctx.db, organizationId)

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
        homeShowRecentMessage: z.boolean().optional(),
        homeShowSendMessageCta: z.boolean().optional(),
        brandingFooterEnabled: z.boolean().optional(),
        allowDownloadTranscript: z.boolean().optional(),
        expandedWidthPx: z.number().int().min(480).max(960).optional(),
        knowledgeBaseId: z.string().optional().nullable(),
        featuredArticleIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      const { integrationId, ...updateData } = input
      const result = await updateChatWidget(
        { db: ctx.db, organizationId },
        integrationId,
        updateData as UpdateChatWidgetInput
      )
      if (!result.ok) throw result.error
      return { success: true }
    }),

  /**
   * Create a Chat Widget channel with sensible defaults — used by the
   * "Add Channel" flow to skip the up-front form. Caller redirects to
   * /app/settings/channels/[id] for editing.
   */
  createChatChannel: protectedProcedure
    .use(notDemo('create chat widgets'))
    .mutation(async ({ ctx }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      await checkChannelLimit(ctx.db, organizationId)

      const existingCount = await ctx.db
        .select({ value: count() })
        .from(schema.ChatWidget)
        .where(eq(schema.ChatWidget.organizationId, organizationId))
      const suffix = (existingCount[0]?.value ?? 0) + 1
      const widgetName = suffix > 1 ? `Chat Widget ${suffix}` : 'Chat Widget'

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
          updatedAt: new Date(),
        })

        return integration.id
      })

      await onCacheEvent('channel.connected', { orgId: organizationId })

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

  /**
   * Get widget installation code.
   */
  getInstallationCode: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      const result = await getChatWidget({ db: ctx.db, organizationId }, input.integrationId)
      if (!result.ok) throw result.error
      const scriptSrc = `${WEBAPP_URL}/api/integrations/chat/${result.value.id}/script.js`
      return { script: `<script src="${scriptSrc}" async defer></script>` }
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
      await requireAdminAccess(userId, organizationId)

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

      // Encrypt and store credentials
      const credentialId = await CredentialService.saveCredential(
        organizationId,
        userId,
        'imap',
        `IMAP - ${input.email}`,
        credentialData as any
      )

      // Create integration record
      const [integration] = await ctx.db
        .insert(schema.Integration)
        .values({
          organizationId,
          provider: 'imap',
          email: input.email,
          name: input.email,
          credentialId,
          authStatus: 'AUTHENTICATED',
          syncMode: 'auto',
          syncStage: 'IDLE',
          syncStatus: 'NOT_SYNCED',
          updatedAt: new Date(),
        })
        .returning()

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
      await requireAdminAccess(userId, organizationId)

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
   * Check if org has custom OAuth credentials for a provider.
   */
  getProviderCredentialStatus: protectedProcedure
    .input(z.object({ provider: z.enum(['google', 'outlook']) }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      const config = PROVIDER_CREDENTIAL_CONFIG[input.provider]
      const overrides = await new ConfigStorage().getAllForOrg(organizationId)
      const hasClientId = overrides.some((o) => o.key === config.clientIdKey)
      const hasClientSecret = overrides.some((o) => o.key === config.clientSecretKey)
      const clientIdEntry = overrides.find((o) => o.key === config.clientIdKey)
      const platformApproved = configService.get<boolean>(config.approvalFlagKey)

      return {
        hasCustomCredentials: hasClientId && hasClientSecret,
        clientId: clientIdEntry?.value as string | undefined,
        platformCredentialsAvailable: !!platformApproved,
        callbackPath: config.callbackPath,
        displayName: config.displayName,
        helpDocsPath: config.helpDocsPath,
      }
    }),

  /**
   * Save org's OAuth credentials for a provider — atomic write of both values.
   */
  setProviderCredentials: adminProcedure
    .input(
      z.object({
        provider: z.enum(['google', 'outlook']),
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
      })
    )
    .use(notDemo('set provider credentials'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const config = PROVIDER_CREDENTIAL_CONFIG[input.provider]
      const storage = new ConfigStorage()

      // Wrap both writes in a transaction so neither is persisted alone
      await database.transaction(async (tx) => {
        await storage.setForOrg(organizationId, config.clientIdKey, input.clientId, userId, tx)
        await storage.setForOrg(
          organizationId,
          config.clientSecretKey,
          input.clientSecret,
          userId,
          tx
        )
      })
    }),

  /**
   * Delete org's custom OAuth credentials for a provider.
   */
  deleteProviderCredentials: adminProcedure
    .input(z.object({ provider: z.enum(['google', 'outlook']) }))
    .use(notDemo('delete provider credentials'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const config = PROVIDER_CREDENTIAL_CONFIG[input.provider]

      // Check for active integrations using these credentials
      const activeIntegrations = await ctx.db
        .select({ id: schema.Integration.id })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.organizationId, organizationId),
            eq(schema.Integration.provider, input.provider),
            eq(schema.Integration.enabled, true),
            isNull(schema.Integration.deletedAt)
          )
        )
        .limit(1)

      if (activeIntegrations.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Cannot delete credentials while active channels exist. Disconnect all channels for this provider first.',
        })
      }

      const storage = new ConfigStorage()
      await database.transaction(async (tx) => {
        await storage.deleteForOrg(organizationId, config.clientIdKey, tx)
        await storage.deleteForOrg(organizationId, config.clientSecretKey, tx)
      })
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

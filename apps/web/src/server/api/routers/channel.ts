// src/server/api/routers/channel.ts

import { ConfigStorage, CredentialService, configService } from '@auxx/credentials'
import { type Database, database, schema } from '@auxx/database'
import { onCacheEvent, storeOAuthCsrfToken } from '@auxx/lib/cache'
import { ChatWidgetService } from '@auxx/lib/chat'
import { getUserOrganizationId, requireAdminAccess } from '@auxx/lib/email'
import { SyncMessages } from '@auxx/lib/messages'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import type { ImapCredentialData } from '@auxx/lib/providers'
import {
  ChannelService,
  ImapClientProvider,
  ImapSmtpSendService,
  LdapAuthService,
  PROVIDER_CREDENTIAL_CONFIG,
} from '@auxx/lib/providers'
import { widgetSchema as chatWidgetInputSchema } from '@auxx/lib/widgets/types'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, asc, count, eq, isNull } from 'drizzle-orm'
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
   * Get integrations for picker components (lightweight query).
   */
  listForPicker: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const integrations = await ctx.db
      .select({
        id: schema.Integration.id,
        name: schema.Integration.name,
        provider: schema.Integration.provider,
        email: schema.Integration.email,
        enabled: schema.Integration.enabled,
      })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, organizationId),
          isNull(schema.Integration.deletedAt)
        )
      )
      .orderBy(asc(schema.Integration.name))
    return integrations
  }),

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

      const service = new ChannelService(ctx.db, organizationId, userId)
      const result = await service.getAuthUrl(input.provider as any, input.redirectPath)

      // Store CSRF token in Redis for callback verification
      await storeOAuthCsrfToken(userId, result.csrfToken)

      return { authUrl: result.authUrl }
    }),

  /**
   * Get all configured integrations for the organization.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    const service = new ChannelService(ctx.db, organizationId)
    return service.getAllChannels()
  }),

  /**
   * Get all email client integrations for the organization.
   */
  getEmailClients: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    const service = new ChannelService(ctx.db, organizationId)
    return service.getEmailClients()
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

      const service = new ChannelService(ctx.db, organizationId, userId)
      const result = await service.disconnect(input.integrationId)

      await onCacheEvent('channel.disconnected', { orgId: organizationId })

      return result
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

      const service = new ChannelService(ctx.db, organizationId, userId)
      return service.toggle(input.integrationId, input.enabled)
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

      const service = new ChannelService(ctx.db, organizationId, userId)
      return service.syncMessages(input.integrationId, input.days)
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

      const service = new ChannelService(ctx.db, organizationId, userId)
      return service.syncAllMessages(input.days)
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

      const service = new ChannelService(ctx.db, organizationId, userId)
      const result = await service.addOpenPhoneChannel(input)

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
        logoUrl: chatWidgetInputSchema.shape.logoUrl.optional(),
        position: chatWidgetInputSchema.shape.position.optional(),
        welcomeMessage: chatWidgetInputSchema.shape.welcomeMessage.optional(),
        autoOpen: chatWidgetInputSchema.shape.autoOpen.optional(),
        mobileFullScreen: chatWidgetInputSchema.shape.mobileFullScreen.optional(),
        collectUserInfo: chatWidgetInputSchema.shape.collectUserInfo.optional(),
        offlineMessage: chatWidgetInputSchema.shape.offlineMessage.optional(),
        allowedDomains: chatWidgetInputSchema.shape.allowedDomains.optional(),
        useAi: chatWidgetInputSchema.shape.useAi.optional(),
        aiModel: chatWidgetInputSchema.shape.aiModel.optional(),
        aiInstructions: chatWidgetInputSchema.shape.aiInstructions.optional(),
        inboxId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      await checkChannelLimit(ctx.db, organizationId)

      const service = new ChatWidgetService(ctx.db, organizationId)
      const result = await service.addChatWidgetIntegration(input)

      await onCacheEvent('channel.connected', { orgId: organizationId })

      return result
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
        logoUrl: chatWidgetInputSchema.shape.logoUrl.optional(),
        position: chatWidgetInputSchema.shape.position.optional(),
        welcomeMessage: chatWidgetInputSchema.shape.welcomeMessage.optional(),
        autoOpen: chatWidgetInputSchema.shape.autoOpen.optional(),
        mobileFullScreen: chatWidgetInputSchema.shape.mobileFullScreen.optional(),
        collectUserInfo: chatWidgetInputSchema.shape.collectUserInfo.optional(),
        offlineMessage: chatWidgetInputSchema.shape.offlineMessage.optional(),
        allowedDomains: chatWidgetInputSchema.shape.allowedDomains.optional(),
        useAi: chatWidgetInputSchema.shape.useAi.optional(),
        aiModel: chatWidgetInputSchema.shape.aiModel.optional(),
        aiInstructions: chatWidgetInputSchema.shape.aiInstructions.optional(),
        inboxId: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      const { integrationId, ...updateData } = input
      const service = new ChatWidgetService(ctx.db, organizationId)
      return service.updateChatWidgetIntegration(integrationId, updateData)
    }),

  /**
   * Get details for a specific Chat Widget Integration.
   */
  getChatWidgetIntegration: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      const service = new ChatWidgetService(ctx.db, organizationId)
      return service.getChatWidgetIntegration(input.integrationId)
    }),

  /**
   * Get widget installation code.
   */
  getInstallationCode: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      const service = new ChatWidgetService(ctx.db, organizationId)
      return service.getInstallationCode(input.integrationId)
    }),

  getProviderType: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      const service = new ChannelService(ctx.db, organizationId)
      return service.getProviderType(input.integrationId)
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
          // Add other settings categories as needed
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      await requireAdminAccess(userId, organizationId)

      const service = new ChannelService(ctx.db, organizationId, userId)
      return service.updateSettings(input.integrationId, input.settings)
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

      const service = new ChannelService(ctx.db, organizationId, userId)
      return service.updateAllowedSenders(input.integrationId, input.allowedSenders)
    }),

  /**
   * Get message statistics across all providers for the organization.
   */
  getAllEmailStats: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    return ChannelService.getAllStats(ctx.db, organizationId)
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
